const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

const VALID_LEVELS = ['beginner', 'intermediate', 'advanced'];

const bearerTokenFrom = (authorization = '') => {
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const createWordsRouter = (supabase = supabaseAdmin) => {
  const router = express.Router();
  router.get('/', async (req, res) => {
  try {
    // Presentation MVP integrity rule: level is always derived from the
    // authenticated student's server-owned progression. The legacy `level`
    // query parameter is accepted for old clients but is never authoritative.
    const token = bearerTokenFrom(req.headers.authorization);
    if (!token) return res.status(401).json({ success: false, message: 'Authentication is required.' });
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth?.user?.id) {
      return res.status(401).json({ success: false, message: 'Your sign-in session is invalid or expired.' });
    }
    const { data: child, error: childError } = await supabase
      .from('children').select('id').eq('auth_uid', auth.user.id).maybeSingle();
    if (childError) throw childError;
    if (!child?.id) {
      return res.status(403).json({ success: false, message: 'The word bank is available only to student accounts.' });
    }
    const { data: progression, error: progressionError } = await supabase
      .rpc('get_student_reading_progress', { p_student_id: child.id });
    if (progressionError) throw progressionError;
    const level = String(progression?.effective_level || '').trim().toLowerCase();
    if (!VALID_LEVELS.includes(level)) {
      throw new Error('The official reading level is invalid.');
    }

    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 24;

    let query = supabase
      .from('words')
      .select('id,word,level,syllable_count,has_diphthong,has_consonant_cluster');
    // Explicit client-data correction. The canonical grid is sourced from
    // reading_content, but this legacy fallback must not reintroduce the
    // rejected English workbook row.
    query = query.neq('word', 'shorts');
    query = query.eq('level', level);

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

    return res.json({ success: true, effectiveLevel: level, words: pool.slice(0, limit) });
  } catch (error) {
    console.error('[Words] fetch threw:', error.message || error);
    return res.status(500).json({ success: false, message: 'Unable to load words.' });
  }
  });
  return router;
};

module.exports = createWordsRouter();
module.exports.createWordsRouter = createWordsRouter;
module.exports.bearerTokenFrom = bearerTokenFrom;
