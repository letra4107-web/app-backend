const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bearerTokenFrom = (authorization = '') => {
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const createModulesRouter = (supabase = supabaseAdmin) => {
  const router = express.Router();

  router.use(async (req, res, next) => {
    try {
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
        return res.status(403).json({ success: false, message: 'Modules are available only to student accounts.' });
      }
      req.authenticatedStudentId = child.id;
      return next();
    } catch (error) {
      console.error('[Modules] authentication failed:', error?.message || error);
      return res.status(500).json({ success: false, message: 'Unable to verify the signed-in student.' });
    }
  });

  router.get('/path', async (req, res) => {
    const { data, error } = await supabase.rpc('get_student_module_path', {
      p_student_id: req.authenticatedStudentId,
    });
    if (error) {
      console.error('[Modules] path failed:', error.message || error);
      return res.status(500).json({ success: false, message: error.message || 'Unable to load module path.' });
    }
    return res.json({ success: true, path: data });
  });

  router.get('/:moduleId', async (req, res) => {
    if (!UUID_PATTERN.test(req.params.moduleId)) {
      return res.status(400).json({ success: false, message: 'A valid module ID is required.' });
    }
    const { data, error } = await supabase.rpc('get_reading_module_content', {
      p_student_id: req.authenticatedStudentId,
      p_module_id: req.params.moduleId,
    });
    if (error) {
      const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : 500;
      return res.status(status).json({ success: false, message: error.message || 'Unable to load module.' });
    }
    return res.json({ success: true, content: data });
  });

  router.post('/assessments/:assessmentId/start', async (req, res) => {
    if (!UUID_PATTERN.test(req.params.assessmentId)) {
      return res.status(400).json({ success: false, message: 'A valid assessment ID is required.' });
    }
    const { data, error } = await supabase.rpc('start_module_assessment', {
      p_student_id: req.authenticatedStudentId,
      p_assessment_id: req.params.assessmentId,
    });
    if (error) {
      const status = error.code === '42501' ? 403
        : error.code === 'P0002' ? 404
          : error.code === 'P0001' ? 409 : 500;
      return res.status(status).json({ success: false, message: error.message || 'Unable to start assessment.' });
    }
    return res.json({ success: true, assessment: data });
  });

  router.post('/attempts/:attemptId/submit', express.json({ limit: '32kb' }), async (req, res) => {
    if (!UUID_PATTERN.test(req.params.attemptId)) {
      return res.status(400).json({ success: false, message: 'A valid attempt ID is required.' });
    }
    const responses = Array.isArray(req.body?.responses) ? req.body.responses : null;
    if (!responses || responses.length !== 4 || responses.some((response) => (
      !UUID_PATTERN.test(String(response?.assessmentItemId || ''))
      || !UUID_PATTERN.test(String(response?.contentAttemptId || ''))
    ))) {
      return res.status(400).json({ success: false, message: 'Exactly four valid assessment responses are required.' });
    }
    const { data, error } = await supabase.rpc('submit_module_assessment', {
      p_student_id: req.authenticatedStudentId,
      p_attempt_id: req.params.attemptId,
      p_responses: responses.map((response) => ({
        assessment_item_id: response.assessmentItemId,
        content_attempt_id: response.contentAttemptId,
      })),
    });
    if (error) {
      const status = ['22023', 'P0001'].includes(error.code) ? 400
        : error.code === 'P0002' ? 404 : error.code === '42501' ? 403 : 500;
      return res.status(status).json({ success: false, message: error.message || 'Unable to submit assessment.' });
    }
    return res.json({ success: true, result: data });
  });

  return router;
};

module.exports = createModulesRouter();
module.exports.createModulesRouter = createModulesRouter;
