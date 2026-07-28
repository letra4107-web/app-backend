-- The "avatar" storage bucket (public, created 2026-07-25) has no RLS
-- policies granting authenticated users insert/update access, so every
-- avatar upload - parent or student - fails with "new row violates row-level
-- security policy" regardless of the app code. Uploaded paths are flat
-- (`${authUid}.${ext}`, no folder), so ownership is checked against the
-- filename's own prefix rather than storage.foldername().

CREATE POLICY "avatar_insert_own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatar'
  AND split_part(name, '.', 1) = auth.uid()::text
);

CREATE POLICY "avatar_update_own"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatar'
  AND split_part(name, '.', 1) = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'avatar'
  AND split_part(name, '.', 1) = auth.uid()::text
);

-- Bucket is already public, but an explicit SELECT policy keeps this bucket's
-- access self-contained and independent of the dashboard's public-bucket toggle.
CREATE POLICY "avatar_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatar');
