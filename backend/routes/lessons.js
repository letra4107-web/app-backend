const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const gradeLevel = String(req.query.gradeLevel || req.query.grade || '').trim();
    let query = supabaseAdmin
      .from('lessons')
      .select('id,teacher_id,title,description,subject,grade_level,pdf_url,file_name,is_published,created_at,updated_at')
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (gradeLevel) {
      query = query.or(`grade_level.eq.${gradeLevel},grade_level.eq.Grade ${gradeLevel},grade_level.is.null`);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[Lessons] fetch failed:', error.message || error);
      return res.status(500).json({ success: false, message: 'Failed to fetch lessons.' });
    }

    return res.json({ success: true, lessons: data || [] });
  } catch (error) {
    console.error('[Lessons] fetch threw:', error.message || error);
    return res.status(500).json({ success: false, message: 'Unable to load lessons.' });
  }
});

module.exports = router;
