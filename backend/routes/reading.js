const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const LESSON_BUCKET = 'lesson-pdfs';

const getRequestUserId = async (req) => {
  const explicitId = req.body.teacher_id || req.body.teacherId || req.body.uploader_id || req.body.uploaderId;
  if (explicitId) return String(explicitId);

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) {
    console.warn('[Reading] Could not resolve teacher from auth token:', error.message || error);
    return null;
  }
  return data?.user?.id || null;
};

const sanitizePathPart = (value) =>
  String(value || 'lesson')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'lesson';

const normalizeReadingWord = (word) => {
  if (!word || typeof word !== 'string') return '';
  return word
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u017F\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^-+|-+$/g, '');
};

const extractWordsFromText = (text) => {
  const tokens = text
    .split(/\s+/)
    .map(normalizeReadingWord)
    .filter((token) => token.length > 1);
  return Array.from(new Set(tokens));
};

router.post('/upload-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'PDF file is required.' });
    }

    const grade = Number(req.body.grade) || Number(req.body.gradeLevel) || null;
    if (!grade || grade < 1 || grade > 6) {
      return res.status(400).json({ success: false, message: 'Valid grade (1-6) is required.' });
    }

    const buffer = req.file.buffer;
    const data = await pdfParse(buffer);
    const words = extractWordsFromText(data.text || '');

    if (!words.length) {
      console.warn('[Reading] No extractable practice words found; lesson will still be published.');
    }

    const gradeLabel = `Grade ${grade}`;
    const teacherId = await getRequestUserId(req);
    const now = new Date().toISOString();
    const title = String(req.body.title || req.file.originalname || `${gradeLabel} Lesson`).trim();
    const description = String(req.body.description || '').trim() || null;
    const subject = String(req.body.subject || 'Reading').trim();
    const originalName = sanitizePathPart(req.file.originalname || `${title}.pdf`);
    const storagePath = `${teacherId || 'unassigned'}/${gradeLabel.replace(/\s+/g, '-').toLowerCase()}/${Date.now()}-${crypto.randomUUID()}-${originalName}`;

    const { error: storageError } = await supabaseAdmin.storage
      .from(LESSON_BUCKET)
      .upload(storagePath, buffer, {
        contentType: req.file.mimetype || 'application/pdf',
        upsert: false,
      });

    if (storageError) {
      console.error('[Reading] lesson PDF storage upload failed:', storageError.message || storageError);
      return res.status(500).json({ success: false, message: 'Failed to upload lesson PDF.' });
    }

    const { data: publicData } = supabaseAdmin.storage
      .from(LESSON_BUCKET)
      .getPublicUrl(storagePath);

    const pdfUrl = publicData?.publicUrl;
    if (!pdfUrl) {
      return res.status(500).json({ success: false, message: 'Failed to create lesson PDF URL.' });
    }

    // Upsert into reading_activities table keyed by id = grade-<grade>
    const id = `grade-${grade}`;
    if (words.length) {
      await supabaseAdmin.from('reading_activities').upsert({ id, grade, grade_label: gradeLabel, words, updated_at: now });
    }

    const lessonPayload = {
      teacher_id: teacherId,
      title,
      description,
      subject,
      grade_level: gradeLabel,
      pdf_url: pdfUrl,
      file_name: req.file.originalname || originalName,
      is_published: true,
      created_at: now,
      updated_at: now,
    };

    const { data: lesson, error: lessonError } = await supabaseAdmin
      .from('lessons')
      .insert(lessonPayload)
      .select('*')
      .single();

    if (lessonError) {
      console.error('[Reading] lesson metadata insert failed:', lessonError);
      return res.status(500).json({
        success: false,
        message: 'PDF uploaded, but lesson metadata could not be saved. Run migration/migrations/006_lessons.sql.',
        error: lessonError.message || String(lessonError),
      });
    }

    // "New Lesson Ready" notification - fanned out server-side to every
    // student in this grade the moment a lesson is genuinely published, not
    // dependent on any particular student's app being open at that moment.
    try {
      const { data: gradeStudents, error: studentsError } = await supabaseAdmin
        .from('children')
        .select('id, auth_uid, parent_id')
        .eq('grade_level', grade);

      if (studentsError) {
        console.warn('[Reading] could not look up students for new-lesson notification:', studentsError.message || studentsError);
      } else if (gradeStudents?.length) {
        const notifRows = gradeStudents
          .filter((student) => student.auth_uid)
          .map((student) => ({
            user_id: student.auth_uid,
            student_id: student.id,
            parent_id: student.parent_id,
            title: 'New Lesson Ready',
            body: `A new lesson "${title}" is ready for you!`,
            message: `A new lesson "${title}" is ready for you!`,
            type: 'lesson',
            is_read: false,
            read: false,
          }));
        if (notifRows.length) {
          const { error: notifError } = await supabaseAdmin.from('notifications').insert(notifRows);
          if (notifError) {
            console.warn('[Reading] new-lesson notification insert failed:', notifError.message || notifError);
          }
        }
      }
    } catch (notifyErr) {
      console.warn('[Reading] new-lesson notification step threw:', notifyErr?.message || notifyErr);
    }

    return res.json({
      success: true,
      message: `Lesson uploaded for ${gradeLabel}`,
      lesson,
      grade,
      gradeLabel,
      wordsCount: words.length,
      words,
    });
  } catch (error) {
    console.error('[Reading] PDF upload failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to process PDF.', error: error.message || String(error) });
  }
});

router.get('/activities/:grade', async (req, res) => {
  try {
    const grade = Number(req.params.grade);
    if (!grade || grade < 1 || grade > 6) {
      return res.status(400).json({ success: false, message: 'Valid grade (1-6) is required.' });
    }

    const id = `grade-${grade}`;
    const { data, error } = await supabaseAdmin.from('reading_activities').select('*').eq('id', id).limit(1);
    if (error) {
      console.error('[Reading] Supabase query error:', error.message || error);
      return res.status(500).json({ success: false, message: 'Failed to fetch reading activities.' });
    }
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ success: false, message: 'No reading activities found for this grade.' });
    }

    const row = data[0];
    return res.json({
      success: true,
      grade: row.grade,
      gradeLabel: row.grade_label,
      words: row.words || [],
      updatedAt: row.updated_at,
    });
  } catch (error) {
    console.error('[Reading] Fetch activities failed:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch reading activities.', error: error.message || String(error) });
  }
});

router.get('/uploads', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('teacher_uploads')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Reading] fetch uploads error:', error.message || error);
      return res.status(500).json({ success: false, message: 'Failed to fetch uploads' });
    }

    return res.json({ success: true, uploads: data || [] });
  } catch (err) {
    console.error('[Reading] fetch uploads threw:', err.message || err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.get('/lessons', async (req, res) => {
  try {
    const gradeLevel = String(req.query.gradeLevel || req.query.grade || '').trim();
    let query = supabaseAdmin
      .from('lessons')
      .select('*')
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (gradeLevel) {
      query = query.or(`grade_level.eq.${gradeLevel},grade_level.eq.Grade ${gradeLevel},grade_level.is.null`);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[Reading] fetch lessons error:', error.message || error);
      return res.status(500).json({ success: false, message: 'Failed to fetch lessons' });
    }

    return res.json({ success: true, lessons: data || [] });
  } catch (err) {
    console.error('[Reading] fetch lessons threw:', err.message || err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.get('/uploads/signed-url', async (req, res) => {
  try {
    const filePath = String(req.query.path || '').trim();
    const bucket = String(req.query.bucket || 'teacher-uploads').trim();

    if (!filePath) {
      return res.status(400).json({ success: false, message: 'path query param is required' });
    }

    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(filePath, 300);

    if (error || !data?.signedUrl) {
      console.error('[Reading] signed URL error:', error?.message || error);
      return res.status(500).json({ success: false, message: 'Could not generate signed URL' });
    }

    return res.json({ success: true, url: data.signedUrl });
  } catch (err) {
    console.error('[Reading] signed URL threw:', err.message || err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
