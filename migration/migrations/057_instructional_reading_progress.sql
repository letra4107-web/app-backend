-- Repair verified lesson-page recording without granting assessment access.
-- Applies to the installed progress contract v2; no curriculum or history rewrite.
BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.progress_contract_version()') IS NULL THEN
    RAISE EXCEPTION 'Progress contract v2 must be installed first';
  END IF;
  IF public.progress_contract_version()->>'version' IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'Expected progress contract v2';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.start_student_progress_event(p_student_id uuid,p_content_id uuid,p_source text,
  p_assessment_attempt_id uuid DEFAULT NULL,p_assessment_item_id uuid DEFAULT NULL,p_channel text DEFAULT 'mobile',p_new_attempt boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.reading_content%ROWTYPE; e public.student_progress_events%ROWTYPE; a record; v_level text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_source IS NULL OR p_source NOT IN ('practice','assessment') THEN RAISE EXCEPTION 'Invalid source' USING ERRCODE='22023'; END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('mobile','web') THEN RAISE EXCEPTION 'Invalid channel' USING ERRCODE='22023'; END IF;
  IF p_new_attempt IS NULL THEN RAISE EXCEPTION 'Invalid attempt mode' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.children WHERE id=p_student_id) THEN RAISE EXCEPTION 'Student not found' USING ERRCODE='P0002'; END IF;
  v_level := public.get_student_reading_progress(p_student_id)->>'effective_level';
  IF v_level IS NULL OR v_level NOT IN ('Beginner','Intermediate','Advanced') THEN RAISE EXCEPTION 'Official reading level unavailable' USING ERRCODE='PT503'; END IF;
  INSERT INTO public.child_progress(child_id,xp,total_attempts,accuracy_sum,activities_completed,completed_words,achievements,badges,level)
  VALUES(p_student_id,0,0,0,0,'{}','[]','[]',v_level) ON CONFLICT(child_id) DO NOTHING;
  PERFORM 1 FROM public.child_progress WHERE child_id=p_student_id FOR UPDATE;
  UPDATE public.child_progress SET progress_legacy_completed_words=coalesce(completed_words,'{}')
    WHERE child_id=p_student_id AND progress_legacy_completed_words IS NULL;
  SELECT * INTO c FROM public.reading_content WHERE id=p_content_id AND is_active FOR SHARE;
  IF NOT FOUND OR nullif(btrim(c.content_text),'') IS NULL THEN RAISE EXCEPTION 'Active content not found' USING ERRCODE='P0002'; END IF;
  IF p_source='assessment' THEN
    SELECT attempt.id INTO a FROM public.student_module_assessment_attempts attempt
    JOIN public.reading_module_assessment_items item ON item.assessment_id=attempt.assessment_id
    JOIN public.reading_module_items mi ON mi.id=item.module_item_id
    JOIN public.reading_module_assessments assessment ON assessment.id=attempt.assessment_id AND assessment.is_active
    WHERE attempt.id=p_assessment_attempt_id AND attempt.student_id=p_student_id AND attempt.status='in_progress'
      AND item.id=p_assessment_item_id AND mi.content_id=p_content_id FOR UPDATE OF attempt;
    IF NOT FOUND THEN RAISE EXCEPTION 'No owned active assessment question' USING ERRCODE='42501'; END IF;
  ELSE
    -- Instructional paragraphs/stories are lesson pages, not assessment answers.
    -- Require an active, unlocked module and completed preceding reading pages.
    IF p_assessment_attempt_id IS NOT NULL OR p_assessment_item_id IS NOT NULL OR c.is_assessment
      OR (c.content_type IN ('paragraph','story') AND NOT EXISTS (
        SELECT 1 FROM public.reading_module_items mi
        JOIN public.reading_modules m ON m.id=mi.module_id AND m.is_active
          AND m.level=c.level AND m.instructional_content_type=c.content_type
        WHERE mi.content_id=p_content_id AND mi.role IN ('instruction','practice')
          AND public.is_student_module_unlocked(p_student_id,m.id)
          AND NOT EXISTS (
            SELECT 1 FROM public.reading_module_items previous
            JOIN public.reading_content previous_content ON previous_content.id=previous.content_id
              AND previous_content.is_active AND previous_content.level=m.level
              AND previous_content.content_type=m.instructional_content_type
            WHERE previous.module_id=m.id AND previous.role<>'assessment'
              AND previous.item_order<mi.item_order
              AND NOT EXISTS (SELECT 1 FROM public.student_content_completions done
                WHERE done.student_id=p_student_id AND done.content_id=previous.content_id)
          )
      )) THEN
      RAISE EXCEPTION 'Assessment context required' USING ERRCODE='42501'; END IF;
    v_level := public.get_student_reading_progress(p_student_id)->>'effective_level';
    IF array_position(ARRAY['Beginner','Intermediate','Advanced'],c.level) > array_position(ARRAY['Beginner','Intermediate','Advanced'],v_level)
       OR v_level IS NULL THEN RAISE EXCEPTION 'Content is locked' USING ERRCODE='42501'; END IF;
    IF EXISTS(SELECT 1 FROM public.reading_module_items mi JOIN public.reading_modules m ON m.id=mi.module_id AND m.is_active WHERE mi.content_id=p_content_id)
      AND NOT EXISTS(SELECT 1 FROM public.reading_module_items mi JOIN public.reading_modules m ON m.id=mi.module_id AND m.is_active
        WHERE mi.content_id=p_content_id AND mi.role<>'assessment' AND public.is_student_module_unlocked(p_student_id,mi.module_id)) THEN
      RAISE EXCEPTION 'Module is locked' USING ERRCODE='42501'; END IF;
  END IF;
  SELECT * INTO e FROM public.student_progress_events WHERE student_id=p_student_id AND content_id=p_content_id AND source=p_source AND (p_source='assessment' OR channel=p_channel)
    AND assessment_attempt_id IS NOT DISTINCT FROM p_assessment_attempt_id AND assessment_item_id IS NOT DISTINCT FROM p_assessment_item_id
    AND ((response IS NULL AND expires_at>clock_timestamp()) OR p_source='assessment')
    AND (p_source='assessment' OR NOT p_new_attempt) ORDER BY issued_at DESC LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.student_progress_events(student_id,content_id,source,channel,assessment_attempt_id,assessment_item_id,expected_text)
    VALUES(p_student_id,p_content_id,p_source,p_channel,p_assessment_attempt_id,p_assessment_item_id,c.content_text) RETURNING * INTO e;
  ELSIF e.source='assessment' AND e.response IS NULL AND e.expires_at<=clock_timestamp() THEN
    UPDATE public.student_progress_events SET expires_at=clock_timestamp()+interval '10 minutes',expected_text=c.content_text WHERE id=e.id RETURNING * INTO e;
  END IF;
  RETURN jsonb_build_object('eventId',e.id,'expiresAt',e.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.record_student_progress_event(p_student_id uuid,p_event_id uuid,p_expected_text text,
  p_transcript text,p_accuracy integer,p_duration_seconds integer DEFAULT NULL,p_is_correct boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.student_progress_events%ROWTYPE; c public.reading_content%ROWTYPE; p public.child_progress%ROWTYPE;
  ledger public.student_content_base_rewards%ROWTYPE;
  input jsonb; result jsonb; badge_result jsonb; reward integer := 0; legacy boolean; valid_context jsonb; v_correct boolean;
  reward_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_transcript IS NULL OR length(btrim(p_transcript)) NOT BETWEEN 1 AND 2000 OR p_accuracy IS NULL OR p_accuracy NOT BETWEEN 0 AND 100
    OR (p_duration_seconds IS NOT NULL AND p_duration_seconds NOT BETWEEN 0 AND 3600) THEN RAISE EXCEPTION 'Invalid answer' USING ERRCODE='22023'; END IF;
  SELECT * INTO p FROM public.child_progress WHERE child_id=p_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Progress not initialized' USING ERRCODE='PT503'; END IF;
  IF p.progress_legacy_completed_words IS NULL THEN
    UPDATE public.child_progress SET progress_legacy_completed_words=coalesce(completed_words,'{}')
      WHERE child_id=p_student_id RETURNING * INTO p;
  END IF;
  SELECT * INTO e FROM public.student_progress_events WHERE id=p_event_id AND student_id=p_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Owned event not found' USING ERRCODE='P0002'; END IF;
  input := jsonb_build_object('transcript',p_transcript,'durationSeconds',p_duration_seconds);
  v_correct := coalesce(p_is_correct,p_accuracy>=88);
  IF e.response IS NOT NULL THEN
    IF e.request IS DISTINCT FROM input THEN RAISE EXCEPTION 'Changed replay' USING ERRCODE='PT409'; END IF;
    RETURN e.response || jsonb_build_object('progress',to_jsonb(p),'replayed',true,'xpAwarded',0,
      'baseReward',(e.response->'baseReward') || jsonb_build_object('xpAwarded',0,'status',
        CASE WHEN e.response->'baseReward'->>'status'='awarded' THEN 'already_rewarded' ELSE e.response->'baseReward'->>'status' END),
      'newlyPersistedAchievementIds','[]'::jsonb);
  END IF;
  IF e.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'Expired event' USING ERRCODE='PT410'; END IF;
  IF e.expected_text IS DISTINCT FROM p_expected_text THEN RAISE EXCEPTION 'Changed event' USING ERRCODE='PT409'; END IF;
  SELECT * INTO c FROM public.reading_content WHERE id=e.content_id AND is_active FOR SHARE;
  IF NOT FOUND OR c.content_text IS DISTINCT FROM e.expected_text THEN RAISE EXCEPTION 'Stale content' USING ERRCODE='PT409'; END IF;
  -- Revalidate all authoritative gates inside this transaction before recording.
  valid_context := public.start_student_progress_event(p_student_id,e.content_id,e.source,e.assessment_attempt_id,e.assessment_item_id,e.channel);
  -- Evidence of *possible* old payment blocks automatic backfill. Text fields
  -- only veto uncertain history; they never establish identity or eligibility.
  -- Freeze this decision before writing any new verified attempt on either client.
  SELECT EXISTS(SELECT 1 FROM public.student_content_attempts ca
      WHERE ca.student_id=p_student_id AND ca.content_id=e.content_id
        AND NOT EXISTS(SELECT 1 FROM public.student_progress_events pe WHERE pe.content_attempt_id=ca.id))
    OR EXISTS(SELECT 1 FROM public.student_content_completions cc
      WHERE cc.student_id=p_student_id AND cc.content_id=e.content_id
        AND NOT EXISTS(SELECT 1 FROM public.student_progress_events pe WHERE pe.content_attempt_id=cc.qualifying_attempt_id))
    OR EXISTS(SELECT 1 FROM public.pronunciation_practice_sessions s
      WHERE s.student_id=p_student_id AND s.progress_event_id IS NULL AND lower(btrim(s.word))=lower(btrim(c.content_text)))
    OR EXISTS(SELECT 1 FROM unnest(coalesce(p.progress_legacy_completed_words,'{}')) w WHERE lower(btrim(w))=lower(btrim(c.content_text))) INTO legacy;
  INSERT INTO public.student_content_base_rewards(student_id,content_id,legacy_review_required)
    VALUES(p_student_id,e.content_id,legacy) ON CONFLICT(student_id,reward_type,content_id) DO NOTHING;
  SELECT * INTO ledger FROM public.student_content_base_rewards
    WHERE student_id=p_student_id AND reward_type='content_practice' AND content_id=e.content_id FOR UPDATE;
  result := public.record_student_content_attempt(p_student_id,e.content_id,p_accuracy,p_transcript,p_duration_seconds,
    -- A successfully scored instructional page can complete the page.
    -- Assessment submission semantics remain unchanged; its bound event is
    -- still required by submit_module_assessment.
    c.content_type IN ('paragraph','story') AND (e.source='assessment' OR p_accuracy>=75),e.source);
  reward_status := CASE
    WHEN ledger.awarded_event_id IS NOT NULL THEN 'already_rewarded'
    WHEN ledger.legacy_review_required THEN 'legacy_review_required'
    WHEN e.source<>'practice' OR e.channel<>'mobile' OR c.content_type IN ('paragraph','story') THEN 'not_applicable'
    WHEN p_accuracy<88 THEN 'not_eligible'
    ELSE 'awarded' END;
  IF reward_status='awarded' THEN
    reward:=50;
    UPDATE public.student_content_base_rewards SET awarded_event_id=e.id,amount=reward,awarded_at=clock_timestamp()
      WHERE student_id=p_student_id AND reward_type='content_practice' AND content_id=e.content_id;
  END IF;
  UPDATE public.student_progress_events SET request=input,accuracy=p_accuracy,content_attempt_id=(result->>'attempt_id')::uuid,
    reward_content_id=CASE WHEN reward>0 THEN e.content_id ELSE NULL END WHERE id=e.id;
  IF e.source='practice' THEN
    INSERT INTO public.pronunciation_practice_sessions(student_id,word,spoken_text,accuracy_percentage,is_correct,duration_seconds,practice_source,progress_event_id)
    VALUES(p_student_id,c.content_text,p_transcript,p_accuracy,v_correct,p_duration_seconds,'practice',e.id);
    UPDATE public.child_progress cp SET xp=coalesce(cp.xp,0)+reward,total_attempts=coalesce(cp.total_attempts,0)+1,
      baseline_accuracy=coalesce(cp.baseline_accuracy,p_accuracy),accuracy_sum=coalesce(cp.accuracy_sum,0)+p_accuracy,
      completed_words=CASE WHEN p_accuracy>=88 THEN ARRAY(SELECT DISTINCT unnest(coalesce(cp.completed_words,'{}')||ARRAY[c.content_text])) ELSE cp.completed_words END,
      updated_at=now() WHERE child_id=p_student_id;
    UPDATE public.child_progress SET word_count=cardinality(completed_words) WHERE child_id=p_student_id;
  END IF;
  badge_result := public.reconcile_verified_student_badges(p_student_id);
  SELECT * INTO p FROM public.child_progress WHERE child_id=p_student_id;
  result := result || jsonb_build_object('accuracy',p_accuracy,'correct',v_correct);
  result := jsonb_build_object('success',true,'result',result,'progress',to_jsonb(p),'xpAwarded',reward,'replayed',false,
    'baseReward',jsonb_build_object('rewardType','content_practice','contentId',e.content_id,'status',reward_status,'xpAwarded',reward),
    'newlyPersistedAchievementIds',badge_result->'awarded_badge_ids');
  UPDATE public.student_progress_events SET response=result WHERE id=e.id;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.start_student_progress_event(uuid,uuid,text,uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_student_progress_event(uuid,uuid,text,text,integer,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_student_progress_event(uuid,uuid,text,uuid,uuid,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_student_progress_event(uuid,uuid,text,text,integer,integer,boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
