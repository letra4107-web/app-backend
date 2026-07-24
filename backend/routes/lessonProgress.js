const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const studentId = String(req.query.childId || req.query.studentId || '').trim();
    if (!studentId) {
      return res.json({ success: true, progress: [] });
    }

    const { data, error } = await supabaseAdmin
      .from('lesson_progress')
      .select('id,lesson_id,status,opened_at,completed_at')
      .eq('student_id', studentId)
      .order('opened_at', { ascending: false });

    if (error) {
      console.error('[LessonProgress] fetch failed:', error.message || error);
      return res.status(500).json({ success: false, message: 'Failed to fetch lesson progress.' });
    }

    return res.json({ success: true, progress: data || [] });
  } catch (error) {
    console.error('[LessonProgress] fetch threw:', error.message || error);
    return res.status(500).json({ success: false, message: 'Unable to load lesson progress.' });
  }
});

router.post('/open', async (req, res) => {
  try {
    const studentId = String(req.body.childId || req.body.studentId || '').trim();
    const lessonId = String(req.body.lessonId || '').trim();
    if (!studentId || !lessonId) {
      return res.status(400).json({ success: false, message: 'childId and lessonId are required.' });
    }

    const { data: existing } = await supabaseAdmin
      .from('lesson_progress')
      .select('id,status')
      .eq('student_id', studentId)
      .eq('lesson_id', lessonId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabaseAdmin
        .from('lesson_progress')
        .update({ opened_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) throw error;
      return res.json({ success: true, status: existing.status });
    }

    const { error: insertError } = await supabaseAdmin.from('lesson_progress').insert({
      student_id: studentId,
      lesson_id: lessonId,
      status: 'in_progress',
    });
    if (insertError) throw insertError;

    return res.json({ success: true, status: 'in_progress' });
  } catch (error) {
    console.error('[LessonProgress] open failed:', error.message || error);
    return res.status(500).json({ success: false, message: 'Unable to save lesson progress.' });
  }
});

router.post('/complete', async (req, res) => {
  try {
    const studentId = String(req.body.childId || req.body.studentId || '').trim();
    const lessonId = String(req.body.lessonId || '').trim();
    if (!studentId || !lessonId) {
      return res.status(400).json({ success: false, message: 'childId and lessonId are required.' });
    }

    const { error } = await supabaseAdmin.from('lesson_progress').upsert(
      {
        student_id: studentId,
        lesson_id: lessonId,
        status: 'completed',
        completed_at: new Date().toISOString(),
      },
      { onConflict: 'student_id,lesson_id' },
    );
    if (error) throw error;

    return res.json({ success: true, status: 'completed' });
  } catch (error) {
    console.error('[LessonProgress] complete failed:', error.message || error);
    return res.status(500).json({ success: false, message: 'Unable to save lesson progress.' });
  }
});

module.exports = router;
