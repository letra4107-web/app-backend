# Teacher lesson files

`POST /api/lesson-files/prepare` accepts one multipart `file` with a Supabase bearer token. The authenticated user's stored `users.role` must be `teacher` or `admin`. Accepted extensions are PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX, JPG/JPEG and PNG, up to 50 MB. Videos, macro-enabled Office extensions and other file types are rejected.

The response is a PDF, with private/no-store caching. Office files use headless LibreOffice with a separate temporary profile and very-high macro security. Images become a single PDF page. Existing PDFs retain their bytes. The converter does not publish lessons or persist original files.

The teacher web uploader stores this PDF in `lesson-pdfs` and saves the existing `lessons.pdf_url`, `storage_bucket`, `storage_path` and PDF `file_name` fields. Web, iOS and Android continue reading the same lesson contract. Replacing/removing an attachment uses the existing ownership and cleanup flow; removal makes the lesson a draft. Native application changes are unnecessary for viewing these converted lessons.

Production Railway/Nixpacks configuration:

```text
NIXPACKS_APT_PKGS=ffmpeg libreoffice-writer libreoffice-impress libreoffice-calc fonts-liberation
```

Keep `ffmpeg` for the existing speech routes. `LIBREOFFICE_BIN` optionally selects another converter executable. Office conversion has a 60-second deadline, at most two uploads/conversions can be active per backend process, and each authenticated teacher is limited to 20 requests per ten minutes. Temporary conversion files are removed after success or failure.

Run `node --test backend/tests/lesson_files.test.js` from the repository root. The suite covers role verification, multipart uploads, invalid files, image conversion, bounded concurrency, command deadlines and cleanup. Real Office conversion additionally requires the packages above.
