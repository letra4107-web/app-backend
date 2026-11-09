# Takdang-Aralin

The student Aralin screen has three separate tabs: Mga Modyul, Mga Aralin and Takdang-Aralin. Published lesson files remain in Mga Aralin. Teacher homework and turn-ins use their own tables and do not change lesson progress, curriculum assessments or XP.

Teachers open Mga Aralin → Takdang-Aralin, enter a title and instructions, choose a grade and students from their own roster, optionally attach a file and set a due date, then choose Ibigay ang Takdang-Aralin. Closing an assignment stops new saves/submissions while retaining prior answers. Late submissions are allowed while the assignment is open and are labeled in the teacher review screen.

Students open Aralin → Takdang-Aralin, enter text and/or attach a file, then choose I-save muna or Ipasa ang Sagot. Draft answers and draft files stay private to the student. A confirmed turn-in becomes read-only. The owning teacher can mark it Nasuri or return it with feedback. Returned work can be revised and submitted again.

Files use the private homework-files bucket, owner-prefixed paths and five-minute signed URLs. Accepted attachments: PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX and JPG/JPEG/PNG, up to 20 MB. These remain original files; Office attachments may open in the device's browser or an installed document app.

Database installation: web migrations/055_homework_turn_in.sql, mirrored in mobile migration/migrations/058_homework_turn_in.sql. These are the same migration: run either copy once. Installation is idempotent. All writes use authenticated RPCs with server-owned student identity, roster validation, row locks and review revision checks. Direct authenticated table writes are denied.

Checks: npm test, npm run build, npm run typecheck (mobile), targeted mobile Jest tests, and scripts/check-homework.mjs (web, isolated PostgreSQL using the existing QA tools). QA covered teacher ownership, recipient isolation, draft privacy, private files, duplicate turn-in, immutable submitted work, return/resubmit, stale reviews and closed assignments. The mobile dependency expo-document-picker is aligned to the installed Expo SDK 54. An updated iOS/Android binary is required to ship the picker and the new native screens; exporting bundles alone does not update installed apps.
