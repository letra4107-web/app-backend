const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

const bearerTokenFrom = (authorization = '') => {
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const createPracticeRouter = (supabase = supabaseAdmin) => {
  const router = express.Router();

  const requireAuthenticatedStudent = async (req, res, next) => {
    try {
      const token = bearerTokenFrom(req.headers.authorization);
      if (!token) {
        return res.status(401).json({ success: false, message: 'Authentication is required.' });
      }

      const { data: auth, error: authError } = await supabase.auth.getUser(token);
      if (authError || !auth?.user?.id) {
        return res.status(401).json({ success: false, message: 'Your sign-in session is invalid or expired.' });
      }

      const { data: child, error: childError } = await supabase
        .from('children')
        .select('id')
        .eq('auth_uid', auth.user.id)
        .maybeSingle();

      if (childError) {
        console.error('[Practice] authenticated student lookup failed:', childError.message || childError);
        return res.status(500).json({ success: false, message: 'Unable to verify the signed-in student.' });
      }
      if (!child?.id) {
        return res.status(403).json({ success: false, message: 'This endpoint is available only to student accounts.' });
      }

      req.authenticatedStudentId = child.id;
      return next();
    } catch (error) {
      console.error('[Practice] authentication check threw:', error.message || error);
      return res.status(500).json({ success: false, message: 'Unable to verify the signed-in student.' });
    }
  };

  router.get('/', (req, res) => {
    res.json({
      success: true,
      message: 'Practice API is available.',
      endpoints: {
        sessions: '/api/practice/sessions',
      },
    });
  });

  router.get('/sessions', requireAuthenticatedStudent, async (req, res) => {
    try {
      const requestedLimit = Number(req.query.limit);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100)
        : 20;

      // The student id is derived exclusively from the verified access token.
      // Query-string studentId/studentIds values are intentionally ignored so
      // they cannot widen this endpoint to another student's records.
      const { data, error } = await supabase
        .from('pronunciation_practice_sessions')
        .select('id,student_id,word,spoken_text,accuracy_percentage,created_at')
        .eq('student_id', req.authenticatedStudentId)
        .order('created_at', { ascending: false })
        .limit(limit);

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

  return router;
};

module.exports = createPracticeRouter();
module.exports.createPracticeRouter = createPracticeRouter;
