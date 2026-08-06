const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

const VALID_LEVELS = ['beginner', 'intermediate', 'advanced'];

router.get('/', async (req, res) => {
  try {
    const level = String(req.query.level || '').trim().toLowerCase();
    if (level && !VALID_LEVELS.includes(level)) {
      return res.status(400).json({ success: false, message: `level must be one of: ${VALID_LEVELS.join(', ')}.` });
    }

    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 24;

    let query = supabaseAdmin
      .from('words')
      .select('id,word,level,syllable_count,has_diphthong,has_consonant_cluster');
    // Explicit client-data correction. The canonical grid is sourced from
    // reading_content, but this legacy fallback must not reintroduce the
    // rejected English workbook row.
    query = query.neq('word', 'shorts');
    if (level) {
      query = query.eq('level', level);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[Words] fetch failed:', error.message || error);
      return res.status(500).json({ success: false, message: 'Failed to fetch words.' });
    }

    // Fisher-Yates shuffle - the words table has no meaningful order to
    // preserve, and the frontend relies on a fresh random sample each call.
    const pool = data || [];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    return res.json({ success: true, words: pool.slice(0, limit) });
  } catch (error) {
    console.error('[Words] fetch threw:', error.message || error);
    return res.status(500).json({ success: false, message: 'Unable to load words.' });
  }
});

module.exports = router;
