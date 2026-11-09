-- Separate teacher homework from the published lesson library and reading XP.
BEGIN;
CREATE TABLE IF NOT EXISTS public.homework_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
  instructions text NOT NULL CHECK(length(btrim(instructions)) BETWEEN 1 AND 10000),
  grade_level integer NOT NULL CHECK(grade_level BETWEEN 1 AND 6),
  due_at timestamptz,
  file_path text, file_name text,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((file_path IS NULL) = (file_name IS NULL))
);
CREATE TABLE IF NOT EXISTS public.homework_recipients (
  assignment_id uuid NOT NULL REFERENCES public.homework_assignments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  PRIMARY KEY(assignment_id,student_id)
);
CREATE TABLE IF NOT EXISTS public.homework_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  student_id uuid NOT NULL,
  answer_text text NOT NULL DEFAULT '' CHECK(length(answer_text)<=10000),
  file_path text, file_name text,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','reviewed','returned')),
  submitted_at timestamptz, reviewed_at timestamptz,
  feedback text NOT NULL DEFAULT '' CHECK(length(feedback)<=4000),
  revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(assignment_id,student_id),
  FOREIGN KEY(assignment_id,student_id) REFERENCES public.homework_recipients(assignment_id,student_id) ON DELETE CASCADE,
  CHECK((file_path IS NULL)=(file_name IS NULL)),
  CHECK(status='draft' OR submitted_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS homework_teacher_created ON public.homework_assignments(teacher_id,created_at DESC);
CREATE INDEX IF NOT EXISTS homework_student_assignments ON public.homework_recipients(student_id,assignment_id);
CREATE INDEX IF NOT EXISTS homework_submission_student ON public.homework_submissions(student_id);

CREATE OR REPLACE FUNCTION public.homework_student_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT c.id FROM public.children c JOIN public.users u ON u.id=c.auth_uid AND u.role='student'
  WHERE c.auth_uid=auth.uid() LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.can_read_homework(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(SELECT 1 FROM public.homework_assignments a WHERE a.id=p_id AND
    (a.teacher_id=auth.uid() OR EXISTS(SELECT 1 FROM public.homework_recipients r
      WHERE r.assignment_id=a.id AND r.student_id=public.homework_student_id())))
$$;
ALTER TABLE public.homework_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS homework_read ON public.homework_assignments;
CREATE POLICY homework_read ON public.homework_assignments FOR SELECT TO authenticated USING(public.can_read_homework(id));
DROP POLICY IF EXISTS homework_recipient_read ON public.homework_recipients;
CREATE POLICY homework_recipient_read ON public.homework_recipients FOR SELECT TO authenticated USING(
  student_id=public.homework_student_id() OR EXISTS(SELECT 1 FROM public.homework_assignments a WHERE a.id=assignment_id AND a.teacher_id=auth.uid()));
DROP POLICY IF EXISTS homework_submission_read ON public.homework_submissions;
CREATE POLICY homework_submission_read ON public.homework_submissions FOR SELECT TO authenticated USING(
  student_id=public.homework_student_id() OR (status<>'draft' AND EXISTS(SELECT 1 FROM public.homework_assignments a WHERE a.id=assignment_id AND a.teacher_id=auth.uid())));
REVOKE ALL ON public.homework_assignments,public.homework_recipients,public.homework_submissions FROM anon,authenticated;
GRANT SELECT ON public.homework_assignments,public.homework_recipients,public.homework_submissions TO authenticated;
GRANT ALL ON public.homework_assignments,public.homework_recipients,public.homework_submissions TO service_role;

CREATE OR REPLACE FUNCTION public.get_homework_roster() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND role IN ('teacher','admin')) THEN
    RAISE EXCEPTION 'Guro lamang ang maaaring magbigay ng takdang-aralin.' USING ERRCODE='42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name) FROM (
    SELECT DISTINCT c.id,c.name,c.grade_level FROM public.children c JOIN public.teacher_student_links l
      ON l.student_id=c.id WHERE l.teacher_id=auth.uid()) x),'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.create_homework_assignment(p_id uuid,p_title text,p_instructions text,p_grade integer,
  p_student_ids uuid[],p_due_at timestamptz DEFAULT NULL,p_file_path text DEFAULT NULL,p_file_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.homework_assignments%ROWTYPE; v_ids uuid[];
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND role IN ('teacher','admin')) THEN
    RAISE EXCEPTION 'Guro lamang ang maaaring magbigay ng takdang-aralin.' USING ERRCODE='42501'; END IF;
  IF p_id IS NULL OR p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 160 OR p_instructions IS NULL
    OR length(btrim(p_instructions)) NOT BETWEEN 1 AND 10000 OR p_grade IS NULL OR p_grade NOT BETWEEN 1 AND 6
    OR coalesce(cardinality(p_student_ids),0) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Kumpletuhin ang pamagat, panuto, baitang at mga mag-aaral.' USING ERRCODE='22023'; END IF;
  SELECT array_agg(DISTINCT chosen.student_id ORDER BY chosen.student_id) INTO v_ids FROM unnest(p_student_ids) AS chosen(student_id);
  IF EXISTS(SELECT 1 FROM unnest(v_ids) AS chosen(student_id) WHERE chosen.student_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.children c JOIN public.teacher_student_links l ON l.student_id=c.id
      WHERE c.id=chosen.student_id AND l.teacher_id=auth.uid() AND c.grade_level::text=p_grade::text)) THEN
    RAISE EXCEPTION 'Pumili lamang ng mag-aaral sa iyong listahan at napiling baitang.' USING ERRCODE='42501'; END IF;
  IF (p_file_path IS NULL)<>(p_file_name IS NULL) OR (p_file_path IS NOT NULL AND
    (length(p_file_name) NOT BETWEEN 1 AND 255 OR split_part(p_file_path,'/',1)<>auth.uid()::text
     OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='homework-files' AND name=p_file_path))) THEN
    RAISE EXCEPTION 'Hindi makumpirma ang kalakip na file.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.homework_assignments(id,teacher_id,title,instructions,grade_level,due_at,file_path,file_name)
    VALUES(p_id,auth.uid(),btrim(p_title),btrim(p_instructions),p_grade,p_due_at,p_file_path,p_file_name)
    ON CONFLICT(id) DO NOTHING;
  SELECT * INTO a FROM public.homework_assignments WHERE id=p_id FOR UPDATE;
  IF a.teacher_id<>auth.uid() OR (a.title,a.instructions,a.grade_level,a.due_at,a.file_path,a.file_name)
    IS DISTINCT FROM (btrim(p_title),btrim(p_instructions),p_grade,p_due_at,p_file_path,p_file_name) THEN
    RAISE EXCEPTION 'Nagbago ang kahilingan. I-refresh ang listahan bago ulitin.' USING ERRCODE='PT409'; END IF;
  IF EXISTS(SELECT 1 FROM public.homework_recipients WHERE assignment_id=p_id) THEN
    IF (SELECT array_agg(student_id ORDER BY student_id) FROM public.homework_recipients WHERE assignment_id=p_id) IS DISTINCT FROM v_ids THEN
      RAISE EXCEPTION 'Nagbago ang mga tatanggap. I-refresh ang listahan.' USING ERRCODE='PT409'; END IF;
  ELSE
    INSERT INTO public.homework_recipients(assignment_id,student_id) SELECT p_id,unnest(v_ids);
  END IF;
  RETURN to_jsonb(a);
END $$;

CREATE OR REPLACE FUNCTION public.save_homework_answer(p_assignment_id uuid,p_answer_text text,
  p_file_path text DEFAULT NULL,p_file_name text DEFAULT NULL,p_submit boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_student uuid:=public.homework_student_id(); a public.homework_assignments%ROWTYPE; s public.homework_submissions%ROWTYPE;
BEGIN
  IF v_student IS NULL THEN RAISE EXCEPTION 'Mag-login gamit ang student account.' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM public.homework_assignments WHERE id=p_assignment_id FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.homework_recipients WHERE assignment_id=p_assignment_id AND student_id=v_student) THEN
    RAISE EXCEPTION 'Hindi nakatalaga sa iyo ang takdang-aralin.' USING ERRCODE='42501'; END IF;
  IF p_answer_text IS NULL OR length(p_answer_text)>10000 OR p_submit IS NULL OR
    (p_file_path IS NULL)<>(p_file_name IS NULL) THEN RAISE EXCEPTION 'Hindi wasto ang sagot o file.' USING ERRCODE='22023'; END IF;
  IF p_file_path IS NOT NULL AND (length(p_file_name) NOT BETWEEN 1 AND 255 OR split_part(p_file_path,'/',1)<>auth.uid()::text OR
    NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='homework-files' AND name=p_file_path)) THEN
    RAISE EXCEPTION 'Hindi makumpirma ang kalakip na file.' USING ERRCODE='22023'; END IF;
  IF p_submit AND nullif(btrim(p_answer_text),'') IS NULL AND p_file_path IS NULL THEN
    RAISE EXCEPTION 'Maglagay muna ng sagot o maglakip ng file bago ipasa.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.homework_submissions(assignment_id,student_id) VALUES(p_assignment_id,v_student) ON CONFLICT(assignment_id,student_id) DO NOTHING;
  SELECT * INTO s FROM public.homework_submissions WHERE assignment_id=p_assignment_id AND student_id=v_student FOR UPDATE;
  IF s.status IN ('submitted','reviewed') THEN
    IF p_submit AND (s.answer_text,s.file_path,s.file_name) IS NOT DISTINCT FROM (p_answer_text,p_file_path,p_file_name) THEN RETURN to_jsonb(s); END IF;
    RAISE EXCEPTION 'Naipasa na ang sagot. Hintaying ibalik ng guro bago baguhin.' USING ERRCODE='PT409'; END IF;
  IF a.status<>'open' THEN RAISE EXCEPTION 'Sarado na ang pagpasa para sa takdang-araling ito.' USING ERRCODE='PT409'; END IF;
  UPDATE public.homework_submissions SET answer_text=p_answer_text,file_path=p_file_path,file_name=p_file_name,
    status=CASE WHEN p_submit THEN 'submitted' ELSE 'draft' END,
    submitted_at=CASE WHEN p_submit THEN now() ELSE submitted_at END,
    revision=revision+CASE WHEN p_submit THEN 1 ELSE 0 END,
    feedback=CASE WHEN p_submit THEN '' ELSE feedback END,reviewed_at=CASE WHEN p_submit THEN NULL ELSE reviewed_at END,updated_at=now()
    WHERE id=s.id RETURNING * INTO s;
  RETURN to_jsonb(s);
END $$;

CREATE OR REPLACE FUNCTION public.get_homework_submissions(p_assignment_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.homework_assignments WHERE id=p_assignment_id AND teacher_id=auth.uid()) THEN
    RAISE EXCEPTION 'Hindi mo pinamamahalaan ang takdang-araling ito.' USING ERRCODE='42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('student_id',r.student_id,'name',c.name,
    'submission',CASE WHEN s.status<>'draft' THEN to_jsonb(s) ELSE NULL END) ORDER BY c.name)
    FROM public.homework_recipients r JOIN public.children c ON c.id=r.student_id
    LEFT JOIN public.homework_submissions s ON s.assignment_id=r.assignment_id AND s.student_id=r.student_id
    WHERE r.assignment_id=p_assignment_id),'[]'::jsonb);
END $$;
CREATE OR REPLACE FUNCTION public.review_homework_answer(p_submission_id uuid,p_revision integer,p_feedback text,p_return boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.homework_submissions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.homework_submissions WHERE id=p_submission_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.homework_assignments WHERE id=s.assignment_id AND teacher_id=auth.uid()) THEN
    RAISE EXCEPTION 'Hindi mo pinamamahalaan ang sagot na ito.' USING ERRCODE='42501'; END IF;
  IF p_feedback IS NULL OR length(p_feedback)>4000 OR p_return IS NULL OR (p_return AND nullif(btrim(p_feedback),'') IS NULL) THEN
    RAISE EXCEPTION 'Maglagay ng puna bago ibalik ang sagot. Hanggang 4000 karakter lamang.' USING ERRCODE='22023'; END IF;
  IF p_revision IS NULL OR s.revision<>p_revision OR s.status NOT IN ('submitted','reviewed') THEN
    RAISE EXCEPTION 'Nagbago na ang sagot. I-refresh ang listahan bago suriin.' USING ERRCODE='PT409'; END IF;
  UPDATE public.homework_submissions SET status=CASE WHEN p_return THEN 'returned' ELSE 'reviewed' END,
    feedback=btrim(p_feedback),reviewed_at=now(),updated_at=now() WHERE id=s.id RETURNING * INTO s;
  RETURN to_jsonb(s);
END $$;
CREATE OR REPLACE FUNCTION public.set_homework_open(p_assignment_id uuid,p_open boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_open IS NULL THEN RAISE EXCEPTION 'Hindi wasto ang status.' USING ERRCODE='22023'; END IF;
  UPDATE public.homework_assignments SET status=CASE WHEN p_open THEN 'open' ELSE 'closed' END WHERE id=p_assignment_id AND teacher_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Hindi mo pinamamahalaan ang takdang-araling ito.' USING ERRCODE='42501'; END IF;
END $$;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('homework-files','homework-files',false,20971520,ARRAY['application/pdf','image/jpeg','image/png','application/msword',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-powerpoint',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-excel',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) ON CONFLICT(id) DO NOTHING;
DROP POLICY IF EXISTS homework_file_upload ON storage.objects;
CREATE POLICY homework_file_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(
  bucket_id='homework-files' AND (storage.foldername(name))[1]=auth.uid()::text
  AND EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND role IN ('teacher','admin','student')));
DROP POLICY IF EXISTS homework_file_read ON storage.objects;
CREATE POLICY homework_file_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='homework-files' AND (
  (storage.foldername(name))[1]=auth.uid()::text OR EXISTS(SELECT 1 FROM public.homework_assignments a
    WHERE a.file_path=name AND public.can_read_homework(a.id)) OR EXISTS(SELECT 1 FROM public.homework_submissions s
      JOIN public.homework_assignments a ON a.id=s.assignment_id WHERE s.file_path=name AND s.status<>'draft' AND a.teacher_id=auth.uid())));
DROP POLICY IF EXISTS homework_file_cleanup ON storage.objects;
CREATE POLICY homework_file_cleanup ON storage.objects FOR DELETE TO authenticated USING(
  bucket_id='homework-files' AND (storage.foldername(name))[1]=auth.uid()::text
  AND NOT EXISTS(SELECT 1 FROM public.homework_assignments a WHERE a.file_path=name)
  AND NOT EXISTS(SELECT 1 FROM public.homework_submissions s WHERE s.file_path=name));

REVOKE ALL ON FUNCTION public.homework_student_id(),public.can_read_homework(uuid),public.get_homework_roster(),
 public.create_homework_assignment(uuid,text,text,integer,uuid[],timestamptz,text,text),public.save_homework_answer(uuid,text,text,text,boolean),
 public.get_homework_submissions(uuid),public.review_homework_answer(uuid,integer,text,boolean),public.set_homework_open(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.homework_student_id(),public.can_read_homework(uuid),public.get_homework_roster(),
 public.create_homework_assignment(uuid,text,text,integer,uuid[],timestamptz,text,text),public.save_homework_answer(uuid,text,text,text,boolean),
 public.get_homework_submissions(uuid),public.review_homework_answer(uuid,integer,text,boolean),public.set_homework_open(uuid,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
