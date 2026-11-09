-- Allow removing the PDF while retaining an unpublished lesson.
BEGIN;

ALTER TABLE public.lessons ALTER COLUMN pdf_url DROP NOT NULL;
ALTER TABLE public.lessons DROP CONSTRAINT IF EXISTS lessons_published_pdf_required;
ALTER TABLE public.lessons ADD CONSTRAINT lessons_published_pdf_required
CHECK (is_published IS NOT TRUE OR NULLIF(btrim(pdf_url), '') IS NOT NULL) NOT VALID;

-- Files are uploaded under <teacher auth uid>/<unique file name>. Only that
-- owner may remove them after a replacement or attachment removal is saved.
DROP POLICY IF EXISTS "Teachers can delete own lesson PDFs" ON storage.objects;
CREATE POLICY "Teachers can delete own lesson PDFs"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'lesson-pdfs' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

NOTIFY pgrst, 'reload schema';
COMMIT;
