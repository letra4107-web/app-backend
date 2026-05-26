const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Practice API is available.',
    endpoints: {
      sessions: '/api/practice/sessions',
    },
  });
});

router.get('/sessions', async (req, res) => {
  try {
    const studentId = String(req.query.studentId || req.query.childId || '').trim();
    const studentIds = String(req.query.studentIds || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    let query = supabaseAdmin
      .from('pronunciation_practice_sessions')
      .select('id,student_id,word,spoken_text,accuracy_percentage,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (studentIds.length) {
      query = query.in('student_id', Array.from(new Set(studentIds)));
    } else if (studentId) {
      query = query.eq('student_id', studentId);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[Practice] sessions fetch failed:', error.message || error);
      return res.status(500).json({ success: false, message: 'Failed to fetch practice sessions.' });
    }

    return res.json({ success: true, sessions: data || [] });
  } catch (error) {
    console.error('[Practice] sessions fetch threw:', error.message || error);
    return res.status(500).json({ success: false, message: 'Unable to load practice sessions.' });
  }
});

module.exports = router;
