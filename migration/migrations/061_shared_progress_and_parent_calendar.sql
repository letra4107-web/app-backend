-- Share persisted learning evidence with the learner's own family and roster.
-- Teacher deadlines remain read-only to parents. No score or XP rewrite.
BEGIN;

CREATE OR REPLACE FUNCTION public.can_view_child_learning(p_child uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.children c WHERE c.id=p_child AND
   (c.auth_uid=auth.uid() OR c.parent_id::text=auth.uid()::text))
 OR EXISTS(SELECT 1 FROM public.teacher_student_links t WHERE t.student_id=p_child AND t.teacher_id=auth.uid())
 OR EXISTS(SELECT 1 FROM public.users u WHERE u.id=auth.uid() AND u.role='admin')
$$;
REVOKE ALL ON FUNCTION public.can_view_child_learning(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_child_learning(uuid) TO authenticated,service_role;
DROP POLICY IF EXISTS "Linked learning progress" ON public.child_progress;
CREATE POLICY "Linked learning progress" ON public.child_progress FOR SELECT TO authenticated
 USING(public.can_view_child_learning(child_id));
DROP POLICY IF EXISTS "Linked practice history" ON public.pronunciation_practice_sessions;
CREATE POLICY "Linked practice history" ON public.pronunciation_practice_sessions FOR SELECT TO authenticated
 USING(public.can_view_child_learning(student_id));

CREATE OR REPLACE FUNCTION public.get_parent_calendar_deadlines(p_child uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.children%ROWTYPE;
BEGIN
 SELECT * INTO c FROM public.children WHERE id=p_child AND parent_id::text=auth.uid()::text;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owned child not found' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.deadline,d.id) FROM (
   SELECT 'homework:'||a.id::text AS id,c.id AS student_id,a.title,a.instructions AS description,
     a.due_at AS deadline,'Takdang-aralin'::text AS subject,
     CASE WHEN s.status IN('submitted','reviewed') THEN 'completed' ELSE 'pending' END AS status,
     true AS read_only
   FROM public.homework_recipients r JOIN public.homework_assignments a ON a.id=r.assignment_id
   LEFT JOIN public.homework_submissions s ON s.assignment_id=a.id AND s.student_id=r.student_id
   WHERE r.student_id=c.id AND a.due_at IS NOT NULL
   UNION ALL
   SELECT 'pdf:'||a.id::text,c.id,m.title,NULL::text,a.due_date::timestamptz,'Babasahin',
     CASE WHEN a.status IN('submitted','reviewed','completed') THEN 'completed' ELSE 'pending' END,true
   FROM public.pdf_assignments a JOIN public.pdf_materials m ON m.id=a.pdf_material_id
   WHERE a.student_id=c.id AND a.due_date IS NOT NULL
 ) d),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_parent_calendar_deadlines(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_parent_calendar_deadlines(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_parent_contact(p_name text,p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND role='parent') THEN
   RAISE EXCEPTION 'Parent account required' USING ERRCODE='42501'; END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 100 OR p_phone IS NULL
   OR (p_phone<>'' AND p_phone !~ '^\+?[0-9 ()-]{7,25}$') THEN
   RAISE EXCEPTION 'Invalid name or phone number' USING ERRCODE='22023'; END IF;
 UPDATE public.parents SET full_name=btrim(p_name),phone_number=btrim(p_phone) WHERE auth_uid=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Parent profile not found' USING ERRCODE='P0002'; END IF;
 UPDATE public.users SET name=btrim(p_name) WHERE id=auth.uid();
 RETURN jsonb_build_object('full_name',btrim(p_name),'phone_number',btrim(p_phone));
END $$;
REVOKE ALL ON FUNCTION public.save_parent_contact(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_parent_contact(text,text) TO authenticated;

-- Both web v2 and mobile v3 persist an event receipt only after scoring succeeds.
-- Repeated updates on the same day cannot increment the streak twice.
CREATE OR REPLACE FUNCTION public.touch_verified_reading_day()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE reading_day date:=timezone('Asia/Manila',now())::date;
BEGIN
 IF NEW.response IS NULL OR OLD.response IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='student_progress_events' THEN
   IF NEW.source<>'practice' THEN RETURN NEW; END IF;
 END IF;
 UPDATE public.child_progress SET
   streak=CASE WHEN last_practice_date=reading_day THEN greatest(coalesce(streak,0),1)
     WHEN last_practice_date=reading_day-1 THEN coalesce(streak,0)+1
     WHEN last_practice_date>reading_day THEN coalesce(streak,0) ELSE 1 END,
   longest_streak=greatest(coalesce(longest_streak,0),CASE WHEN last_practice_date=reading_day THEN greatest(coalesce(streak,0),1)
     WHEN last_practice_date=reading_day-1 THEN coalesce(streak,0)+1
     WHEN last_practice_date>reading_day THEN coalesce(streak,0) ELSE 1 END),
   last_practice_date=greatest(coalesce(last_practice_date,reading_day),reading_day),updated_at=now()
 WHERE child_id=NEW.student_id;
 NEW.response:=jsonb_set(NEW.response,'{progress}',coalesce(NEW.response->'progress','{}'::jsonb)||
   (SELECT jsonb_build_object('streak',p.streak,'longest_streak',p.longest_streak,'last_practice_date',p.last_practice_date)
    FROM public.child_progress p WHERE p.child_id=NEW.student_id));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.touch_verified_reading_day() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS verified_practice_day ON public.student_progress_events;
CREATE TRIGGER verified_practice_day BEFORE UPDATE OF response ON public.student_progress_events
 FOR EACH ROW EXECUTE FUNCTION public.touch_verified_reading_day();
DROP TRIGGER IF EXISTS verified_mobile_reading_day ON public.mobile_reading_events;
CREATE TRIGGER verified_mobile_reading_day BEFORE UPDATE OF response ON public.mobile_reading_events
 FOR EACH ROW EXECUTE FUNCTION public.touch_verified_reading_day();

-- Repair only missing streak dates from committed evidence. Retain stored XP,
-- achievements, counters and any newer existing reading date.
WITH days AS (
 SELECT DISTINCT student_id,timezone('Asia/Manila',issued_at)::date AS day
 FROM public.student_progress_events WHERE source='practice' AND response IS NOT NULL
 UNION
 SELECT DISTINCT student_id,timezone('Asia/Manila',issued_at)::date
 FROM public.mobile_reading_events WHERE response IS NOT NULL
), islands AS (
 SELECT student_id,day,day-(row_number() OVER(PARTITION BY student_id ORDER BY day))::integer AS island FROM days
), runs AS (
 SELECT student_id,max(day) AS last_day,count(*)::integer AS n FROM islands GROUP BY student_id,island
), recent AS (
 SELECT DISTINCT ON(student_id) student_id,last_day,n,max(n) OVER(PARTITION BY student_id) AS best
 FROM runs ORDER BY student_id,last_day DESC
)
UPDATE public.child_progress p SET last_practice_date=r.last_day,
 streak=CASE WHEN r.last_day>=timezone('Asia/Manila',now())::date-1 THEN r.n ELSE 0 END,
 longest_streak=greatest(coalesce(p.longest_streak,0),r.best)
FROM recent r WHERE p.child_id=r.student_id AND (p.last_practice_date IS NULL OR p.last_practice_date<r.last_day);

NOTIFY pgrst,'reload schema';
COMMIT;
