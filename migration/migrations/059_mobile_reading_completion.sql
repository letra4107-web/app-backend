-- Versioned mobile reading: new clients use v3; the installed v2 RPCs remain
-- available to older app/web builds. No curriculum or historical XP rewrite.
BEGIN;

-- Keep older clients on v2; clone its private recorder for the new contract.
DO $clone$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.record_student_progress_event(uuid,uuid,text,text,integer,integer,boolean)'::regprocedure);
 IF position('BETWEEN 1 AND 2000' IN definition)=0 OR position('p_accuracy>=75' IN definition)=0 THEN RAISE EXCEPTION 'Install migration 057 before mobile reading v3'; END IF;
 definition:=replace(definition,'public.record_student_progress_event(', 'public.record_mobile_legacy_event(');
 definition:=replace(definition,'BETWEEN 1 AND 2000','BETWEEN 1 AND 10000');
 definition:=replace(definition,'p_accuracy>=75','p_accuracy>=80');
 EXECUTE definition;
END $clone$;
REVOKE ALL ON FUNCTION public.record_mobile_legacy_event(uuid,uuid,text,text,integer,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_mobile_legacy_event(uuid,uuid,text,text,integer,integer,boolean) TO service_role;

ALTER TABLE public.children ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS profile_revision integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.child_credential_requests (
 id uuid PRIMARY KEY,child_id uuid NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
 parent_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.child_credential_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.child_credential_requests FROM anon,authenticated;
GRANT ALL ON public.child_credential_requests TO service_role;

CREATE OR REPLACE FUNCTION public.update_parent_child_profile(p_parent_id uuid,p_child_id uuid,p_name text,p_grade integer,p_birth_date date,p_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.children%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF p_name IS NULL OR p_grade IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 100 OR p_grade NOT BETWEEN 1 AND 6 OR p_birth_date IS NULL OR p_birth_date>timezone('Asia/Manila',now())::date OR p_birth_date<'1900-01-01'::date THEN RAISE EXCEPTION 'Invalid child details' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM public.children WHERE id=p_child_id AND parent_id::text=p_parent_id::text FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owned child not found' USING ERRCODE='P0002'; END IF;
 IF c.profile_revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Changed child profile' USING ERRCODE='PT409'; END IF;
 UPDATE public.children SET name=btrim(p_name),grade_level=p_grade,date_of_birth=p_birth_date,profile_revision=profile_revision+1 WHERE id=c.id RETURNING * INTO c;
 UPDATE public.users SET name=c.name WHERE id::text=c.auth_uid::text;
 RETURN to_jsonb(c);
END $$;

CREATE TABLE IF NOT EXISTS public.mobile_reading_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_kind text NOT NULL CHECK(source_kind IN('pdf','lesson')),
 source_id uuid NOT NULL,source_revision text NOT NULL,title text NOT NULL,
 chunks jsonb NOT NULL CHECK(jsonb_typeof(chunks)='array' AND jsonb_array_length(chunks) BETWEEN 1 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(source_kind,source_id,source_revision)
);
CREATE TABLE IF NOT EXISTS public.mobile_reading_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL UNIQUE,
 student_id uuid NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
 target_kind text NOT NULL CHECK(target_kind IN('content','assessment','pdf','lesson')),
 target_id uuid NOT NULL,document_id uuid REFERENCES public.mobile_reading_documents(id),chunk_index integer,
 expected_text text NOT NULL,legacy_event_id uuid UNIQUE REFERENCES public.student_progress_events(id),
 issued_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT(now()+interval '30 minutes'),
 request jsonb,response jsonb,word_feedback jsonb,accuracy integer CHECK(accuracy BETWEEN 0 AND 100),
 xp_awarded integer NOT NULL DEFAULT 0 CHECK(xp_awarded IN(0,10,25,40,50)),legacy_xp integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS public.mobile_reading_page_completions (
 student_id uuid NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
 document_id uuid NOT NULL REFERENCES public.mobile_reading_documents(id),chunk_index integer NOT NULL CHECK(chunk_index>=0),
 event_id uuid NOT NULL UNIQUE REFERENCES public.mobile_reading_events(id),completed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(student_id,document_id,chunk_index)
);
CREATE INDEX IF NOT EXISTS mobile_reading_events_student_date ON public.mobile_reading_events(student_id,issued_at DESC);
CREATE TABLE IF NOT EXISTS public.mobile_reading_document_submissions (
 student_id uuid NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
 document_id uuid NOT NULL REFERENCES public.mobile_reading_documents(id),submitted_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(student_id,document_id)
);

CREATE OR REPLACE FUNCTION public.can_read_mobile_document(p_student_id uuid,p_document_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.mobile_reading_documents d JOIN public.children c ON c.id=p_student_id
 WHERE d.id=p_document_id AND (
 (d.source_kind='pdf' AND EXISTS(SELECT 1 FROM public.pdf_assignments a JOIN public.pdf_materials m ON m.id=a.pdf_material_id WHERE a.id=d.source_id AND a.student_id=c.id AND md5(coalesce(m.extracted_text,''))=d.source_revision)) OR
 (d.source_kind='lesson' AND EXISTS(SELECT 1 FROM public.lessons l WHERE l.id=d.source_id AND l.is_published AND md5(coalesce(l.pdf_url,''))=d.source_revision AND (l.grade_level IS NULL OR lower(btrim(l.grade_level::text)) IN(c.grade_level::text,'grade '||c.grade_level::text,'grade'||c.grade_level::text))))))
$$;

CREATE OR REPLACE FUNCTION public.mobile_xp_tier(p_xp integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN p_xp>=200 THEN 'Champion' WHEN p_xp>=120 THEN 'Expert' WHEN p_xp>=70 THEN 'Rising Star' WHEN p_xp>=35 THEN 'Apprentice' ELSE 'Starter' END $$;

CREATE OR REPLACE FUNCTION public.reconcile_mobile_reading_badges(p_student_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.child_progress%ROWTYPE;n integer;best integer;avg_score numeric;awards jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.child_progress WHERE child_id=p_student_id FOR UPDATE;
 SELECT count(*),max(accuracy),avg(accuracy) INTO n,best,avg_score FROM (
  SELECT accuracy FROM public.student_progress_events WHERE student_id=p_student_id AND source='practice' AND content_attempt_id IS NOT NULL
  UNION ALL SELECT accuracy FROM public.mobile_reading_events WHERE student_id=p_student_id AND target_kind<>'content' AND accuracy IS NOT NULL
 ) verified;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'xp',xp)),'[]'::jsonb) INTO awards FROM (VALUES
  ('unang_bigkas',20,n>=1),('malinaw_magsalita',30,best>=90),('boses_ng_tagumpay',60,n>=25),('bigkas_champion',60,n>=10 AND avg_score>=90),
  ('unang_hakbang',20,coalesce(p.activities_completed,0)>=1),('batang_mambabasa',30,coalesce(p.activities_completed,0)>=5),('masigasig_na_mambabasa',40,coalesce(p.activities_completed,0)>=10),('kampeon_sa_pagbasa',60,coalesce(p.activities_completed,0)>=25),('dalubhasa_sa_pagbasa',80,coalesce(p.activities_completed,0)>=50),
  ('unang_araw',20,p.last_practice_date IS NOT NULL),('tuloy_tuloy',30,coalesce(p.streak,0)>=3),('lingguhang_bayani',40,coalesce(p.streak,0)>=7),('buwan_ng_pagsisikap',60,coalesce(p.streak,0)>=30)
 ) b(id,xp,eligible) WHERE eligible AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p.achievements,'[]')) a WHERE a->>'id'=b.id);
 IF jsonb_array_length(awards)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p.achievements,'[]')) a WHERE a->>'id'='aking_unang_tagumpay') THEN awards:=awards||jsonb_build_array(jsonb_build_object('id','aking_unang_tagumpay','xp',25)); END IF;
 IF jsonb_array_length(awards)=0 THEN RETURN jsonb_build_object('awarded_badge_ids','[]'::jsonb); END IF;
 RETURN public.award_student_badges(p_student_id,awards);
END $$;

CREATE OR REPLACE FUNCTION public.start_mobile_reading_attempt(p_student_id uuid,p_request_id uuid,p_kind text,p_target_id uuid,p_chunk_index integer DEFAULT NULL,p_assessment_attempt_id uuid DEFAULT NULL,p_assessment_item_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.mobile_reading_events%ROWTYPE; d public.mobile_reading_documents%ROWTYPE; expected text; legacy jsonb; legacy_id uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_kind IS NULL OR p_kind NOT IN('content','assessment','pdf','lesson') THEN RAISE EXCEPTION 'Invalid reading attempt' USING ERRCODE='22023'; END IF;
 SELECT * INTO e FROM public.mobile_reading_events WHERE request_id=p_request_id;
 IF FOUND THEN
  IF e.student_id<>p_student_id OR e.target_kind<>p_kind OR e.target_id<>p_target_id OR e.chunk_index IS DISTINCT FROM p_chunk_index OR (p_kind='assessment' AND NOT EXISTS(SELECT 1 FROM public.student_progress_events legacy WHERE legacy.id=e.legacy_event_id AND legacy.assessment_attempt_id IS NOT DISTINCT FROM p_assessment_attempt_id AND legacy.assessment_item_id IS NOT DISTINCT FROM p_assessment_item_id)) THEN RAISE EXCEPTION 'Changed attempt request' USING ERRCODE='PT409'; END IF;
  RETURN jsonb_build_object('eventId',e.id,'expiresAt',e.expires_at);
 END IF;
 IF p_kind IN('content','assessment') THEN
  IF p_kind='content' AND (p_assessment_attempt_id IS NOT NULL OR p_assessment_item_id IS NOT NULL) THEN RAISE EXCEPTION 'Invalid practice context' USING ERRCODE='22023'; END IF;
  legacy:=public.start_student_progress_event(p_student_id,p_target_id,CASE WHEN p_kind='assessment' THEN 'assessment' ELSE 'practice' END,p_assessment_attempt_id,p_assessment_item_id,'mobile',true);
  legacy_id:=(legacy->>'eventId')::uuid;
  SELECT expected_text INTO expected FROM public.student_progress_events WHERE id=legacy_id AND student_id=p_student_id;
  SELECT * INTO e FROM public.mobile_reading_events WHERE legacy_event_id=legacy_id;
  IF FOUND THEN RETURN jsonb_build_object('eventId',e.id,'expiresAt',e.expires_at); END IF;
 ELSE
  SELECT * INTO d FROM public.mobile_reading_documents WHERE id=p_target_id AND source_kind=p_kind;
  IF NOT FOUND OR NOT public.can_read_mobile_document(p_student_id,d.id) THEN RAISE EXCEPTION 'Reading document unavailable' USING ERRCODE='42501'; END IF;
  IF p_chunk_index IS NULL OR p_chunk_index<0 OR p_chunk_index>=jsonb_array_length(d.chunks) THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM generate_series(0,p_chunk_index-1) n WHERE NOT EXISTS(SELECT 1 FROM public.mobile_reading_page_completions c WHERE c.student_id=p_student_id AND c.document_id=d.id AND c.chunk_index=n)) THEN RAISE EXCEPTION 'Complete previous reading pages' USING ERRCODE='42501'; END IF;
  expected:=d.chunks->>p_chunk_index;
 END IF;
 IF nullif(btrim(expected),'') IS NULL OR length(expected)>10000 THEN RAISE EXCEPTION 'Invalid reading text' USING ERRCODE='22023'; END IF;
 INSERT INTO public.mobile_reading_events(request_id,student_id,target_kind,target_id,document_id,chunk_index,expected_text,legacy_event_id)
 VALUES(p_request_id,p_student_id,p_kind,p_target_id,d.id,p_chunk_index,expected,legacy_id)
 ON CONFLICT(request_id) DO NOTHING RETURNING * INTO e;
 IF NOT FOUND THEN
  SELECT * INTO e FROM public.mobile_reading_events WHERE request_id=p_request_id;
  IF e.student_id<>p_student_id OR e.target_kind<>p_kind OR e.target_id<>p_target_id OR e.chunk_index IS DISTINCT FROM p_chunk_index OR (p_kind='assessment' AND NOT EXISTS(SELECT 1 FROM public.student_progress_events legacy WHERE legacy.id=e.legacy_event_id AND legacy.assessment_attempt_id IS NOT DISTINCT FROM p_assessment_attempt_id AND legacy.assessment_item_id IS NOT DISTINCT FROM p_assessment_item_id)) THEN RAISE EXCEPTION 'Changed attempt request' USING ERRCODE='PT409'; END IF;
 END IF;
 RETURN jsonb_build_object('eventId',e.id,'expiresAt',e.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.record_mobile_reading_attempt(p_student_id uuid,p_event_id uuid,p_transcript text,p_duration integer,p_accuracy integer,p_feedback jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.mobile_reading_events%ROWTYPE; p public.child_progress%ROWTYPE; base jsonb; result jsonb; badge jsonb;
 reward integer; old_reward integer:=0; v_today date:=timezone('Asia/Manila',now())::date; v_completed boolean:=false; saved_input jsonb; completion_count integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF p_transcript IS NULL OR length(btrim(p_transcript)) NOT BETWEEN 1 AND 10000 OR p_accuracy IS NULL OR p_accuracy NOT BETWEEN 0 AND 100 OR (p_duration IS NOT NULL AND p_duration NOT BETWEEN 0 AND 3600) OR jsonb_typeof(p_feedback) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid reading answer' USING ERRCODE='22023'; END IF;
 INSERT INTO public.child_progress(child_id,xp,total_attempts,accuracy_sum,activities_completed,completed_words,achievements,badges,level)
 SELECT p_student_id,0,0,0,0,'{}','[]','[]',coalesce(public.get_student_reading_progress(p_student_id)->>'effective_level','Beginner')
 WHERE EXISTS(SELECT 1 FROM public.children WHERE id=p_student_id) ON CONFLICT(child_id) DO NOTHING;
 SELECT * INTO p FROM public.child_progress WHERE child_id=p_student_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Student not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO e FROM public.mobile_reading_events WHERE id=p_event_id AND student_id=p_student_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owned reading event not found' USING ERRCODE='P0002'; END IF;
 saved_input:=jsonb_build_object('transcript',p_transcript,'durationSeconds',p_duration);
 IF e.response IS NOT NULL THEN
  IF e.request IS DISTINCT FROM saved_input THEN RAISE EXCEPTION 'Changed replay' USING ERRCODE='PT409'; END IF;
  RETURN e.response||jsonb_build_object('progress',to_jsonb(p)||jsonb_build_object('xp_tier',public.mobile_xp_tier(p.xp)),'replayed',true,'xpAwarded',0,'baseReward',jsonb_build_object('rewardType','reading_attempt','contentId',e.target_id,'status','already_rewarded','xpAwarded',0),'newlyPersistedAchievementIds','[]'::jsonb);
 END IF;
 IF e.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Expired reading event' USING ERRCODE='PT410'; END IF;
 IF e.target_kind IN('content','assessment') THEN
  base:=public.record_mobile_legacy_event(p_student_id,e.legacy_event_id,e.expected_text,p_transcript,p_accuracy,p_duration,p_accuracy>=80);
  old_reward:=coalesce((base->>'xpAwarded')::integer,0);result:=base->'result';
 ELSE
  IF NOT public.can_read_mobile_document(p_student_id,e.document_id) THEN RAISE EXCEPTION 'Changed reading document' USING ERRCODE='PT409'; END IF;
  IF EXISTS(SELECT 1 FROM generate_series(0,e.chunk_index-1) n WHERE NOT EXISTS(SELECT 1 FROM public.mobile_reading_page_completions c WHERE c.student_id=p_student_id AND c.document_id=e.document_id AND c.chunk_index=n)) THEN RAISE EXCEPTION 'Complete previous reading pages' USING ERRCODE='42501'; END IF;
  IF p_accuracy>=80 THEN
   INSERT INTO public.mobile_reading_page_completions(student_id,document_id,chunk_index,event_id) VALUES(p_student_id,e.document_id,e.chunk_index,e.id) ON CONFLICT DO NOTHING;
   GET DIAGNOSTICS completion_count=ROW_COUNT;v_completed:=completion_count=1;
  END IF;
  IF e.target_kind='pdf' THEN
   INSERT INTO public.pdf_reading_attempts(pdf_assignment_id,student_id,transcript,accuracy,chunk_index,reading_event_id,word_feedback)
   SELECT source_id,p_student_id,p_transcript,p_accuracy,e.chunk_index,e.id,p_feedback FROM public.mobile_reading_documents WHERE id=e.document_id;
   UPDATE public.pdf_assignments SET status='in_progress' WHERE id=(SELECT source_id FROM public.mobile_reading_documents WHERE id=e.document_id) AND student_id=p_student_id AND status='assigned';
  END IF;
  result:=jsonb_build_object('attempt_id',e.id,'content_id',e.target_id,'accuracy',p_accuracy,'correct',p_accuracy>=80,'completion_qualified',p_accuracy>=80,'completion_awarded',v_completed,'progression',public.get_student_reading_progress(p_student_id));
 END IF;
 reward:=CASE WHEN p_accuracy=100 THEN 50 WHEN p_accuracy>=80 THEN 40 WHEN p_accuracy>=70 THEN 25 ELSE 10 END;
 -- Legacy practice already counted the attempt. Assessment and document
 -- attempts are new counters here. The v3 ledger records the legacy adjustment.
 IF e.target_kind<>'content' THEN
  INSERT INTO public.pronunciation_practice_sessions(student_id,word,spoken_text,accuracy_percentage,is_correct,duration_seconds,practice_source)
  VALUES(p_student_id,e.expected_text,p_transcript,p_accuracy,p_accuracy>=80,p_duration,'practice');
  UPDATE public.child_progress SET total_attempts=coalesce(total_attempts,0)+1,accuracy_sum=coalesce(accuracy_sum,0)+p_accuracy,baseline_accuracy=coalesce(baseline_accuracy,p_accuracy) WHERE child_id=p_student_id;
 END IF;
 UPDATE public.child_progress SET xp=coalesce(xp,0)+reward-old_reward,
  streak=CASE WHEN last_practice_date=v_today THEN greatest(coalesce(streak,0),1) WHEN last_practice_date=v_today-1 THEN coalesce(streak,0)+1 WHEN last_practice_date>v_today THEN coalesce(streak,0) ELSE 1 END,
  longest_streak=greatest(coalesce(longest_streak,0),CASE WHEN last_practice_date=v_today THEN greatest(coalesce(streak,0),1) WHEN last_practice_date=v_today-1 THEN coalesce(streak,0)+1 WHEN last_practice_date>v_today THEN coalesce(streak,0) ELSE 1 END),
  last_practice_date=greatest(coalesce(last_practice_date,v_today),v_today),updated_at=now() WHERE child_id=p_student_id;
 UPDATE public.mobile_reading_events SET accuracy=p_accuracy WHERE id=e.id;
 IF e.target_kind='content' AND p_accuracy>=80 THEN
  UPDATE public.child_progress cp SET completed_words=ARRAY(SELECT DISTINCT unnest(coalesce(cp.completed_words,'{}')||ARRAY[e.expected_text])) WHERE child_id=p_student_id;
  UPDATE public.child_progress SET word_count=cardinality(completed_words) WHERE child_id=p_student_id;
 END IF;
 badge:=public.reconcile_mobile_reading_badges(p_student_id);
 SELECT * INTO p FROM public.child_progress WHERE child_id=p_student_id;
 result:=jsonb_build_object('success',true,'result',result||jsonb_build_object('transcript',p_transcript),'wordFeedback',p_feedback,'progress',to_jsonb(p)||jsonb_build_object('xp_tier',public.mobile_xp_tier(p.xp)),'xpAwarded',reward,'replayed',false,
  'baseReward',jsonb_build_object('rewardType','reading_attempt','contentId',e.target_id,'status','awarded','xpAwarded',reward),
  'newlyPersistedAchievementIds',coalesce(base->'newlyPersistedAchievementIds','[]'::jsonb)||coalesce(badge->'awarded_badge_ids','[]'::jsonb));
 UPDATE public.mobile_reading_events SET request=saved_input,response=result,word_feedback=p_feedback,accuracy=p_accuracy,xp_awarded=reward,legacy_xp=old_reward WHERE id=e.id;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.finish_mobile_reading_document(p_student_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d public.mobile_reading_documents%ROWTYPE; inserted integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.child_progress WHERE child_id=p_student_id FOR UPDATE;
 SELECT * INTO d FROM public.mobile_reading_documents WHERE id=p_document_id;
 IF NOT FOUND OR NOT public.can_read_mobile_document(p_student_id,d.id) THEN RAISE EXCEPTION 'Reading document unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM generate_series(0,jsonb_array_length(d.chunks)-1) n WHERE NOT EXISTS(SELECT 1 FROM public.mobile_reading_page_completions c WHERE c.student_id=p_student_id AND c.document_id=d.id AND c.chunk_index=n)) THEN RAISE EXCEPTION 'Complete every reading page before turn-in' USING ERRCODE='22023'; END IF;
 IF d.source_kind='pdf' THEN UPDATE public.pdf_assignments SET status='submitted' WHERE id=d.source_id AND student_id=p_student_id AND status NOT IN('reviewed','completed');
 ELSE INSERT INTO public.lesson_progress(student_id,lesson_id,status,opened_at,completed_at) VALUES(p_student_id,d.source_id,'completed',now(),now()) ON CONFLICT(student_id,lesson_id) DO UPDATE SET status='completed',completed_at=coalesce(lesson_progress.completed_at,excluded.completed_at); END IF;
 INSERT INTO public.mobile_reading_document_submissions(student_id,document_id) VALUES(p_student_id,d.id) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted=1 THEN UPDATE public.child_progress SET activities_completed=coalesce(activities_completed,0)+1 WHERE child_id=p_student_id;PERFORM public.reconcile_mobile_reading_badges(p_student_id); END IF;
 RETURN jsonb_build_object('success',true,'status','submitted');
END $$;

ALTER TABLE public.pdf_reading_attempts ADD COLUMN IF NOT EXISTS chunk_index integer;
ALTER TABLE public.pdf_reading_attempts ADD COLUMN IF NOT EXISTS reading_event_id uuid UNIQUE REFERENCES public.mobile_reading_events(id);
ALTER TABLE public.pdf_reading_attempts ADD COLUMN IF NOT EXISTS word_feedback jsonb;
ALTER TABLE public.pdf_assignments DROP CONSTRAINT IF EXISTS pdf_assignments_status_check;
ALTER TABLE public.pdf_assignments ADD CONSTRAINT pdf_assignments_status_check CHECK(status IN('assigned','in_progress','submitted','reviewed','needs_review','completed')) NOT VALID;

ALTER TABLE public.mobile_reading_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_reading_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_reading_page_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_reading_document_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mobile_reading_document_submissions FROM anon,authenticated;
GRANT ALL ON public.mobile_reading_document_submissions TO service_role;
REVOKE ALL ON public.mobile_reading_documents,public.mobile_reading_events,public.mobile_reading_page_completions FROM anon,authenticated;
GRANT ALL ON public.mobile_reading_documents,public.mobile_reading_events,public.mobile_reading_page_completions TO service_role;
GRANT SELECT ON public.mobile_reading_events,public.mobile_reading_page_completions TO authenticated;
DROP POLICY IF EXISTS "Owned mobile reading history" ON public.mobile_reading_events;
CREATE POLICY "Owned mobile reading history" ON public.mobile_reading_events FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.children c WHERE c.id=student_id AND (c.auth_uid::text=auth.uid()::text OR c.parent_id::text=auth.uid()::text)) OR EXISTS(SELECT 1 FROM public.teacher_student_links t WHERE t.student_id=mobile_reading_events.student_id AND t.teacher_id::text=auth.uid()::text));
DROP POLICY IF EXISTS "Owned reading page completions" ON public.mobile_reading_page_completions;
CREATE POLICY "Owned reading page completions" ON public.mobile_reading_page_completions FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.children c WHERE c.id=student_id AND (c.auth_uid::text=auth.uid()::text OR c.parent_id::text=auth.uid()::text)));

REVOKE ALL ON FUNCTION public.update_parent_child_profile(uuid,uuid,text,integer,date,integer),public.start_mobile_reading_attempt(uuid,uuid,text,uuid,integer,uuid,uuid),public.record_mobile_reading_attempt(uuid,uuid,text,integer,integer,jsonb),public.finish_mobile_reading_document(uuid,uuid),public.can_read_mobile_document(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reconcile_mobile_reading_badges(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_mobile_reading_badges(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_parent_child_profile(uuid,uuid,text,integer,date,integer),public.start_mobile_reading_attempt(uuid,uuid,text,uuid,integer,uuid,uuid),public.record_mobile_reading_attempt(uuid,uuid,text,integer,integer,jsonb),public.finish_mobile_reading_document(uuid,uuid),public.can_read_mobile_document(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
