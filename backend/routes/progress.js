const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { startProgressEvent, recordProgressEvent } = require('../services/progressEvents');

// Retained for existing helper consumers; public routes never persist client badges.
const mergeAchievements = (existing, incoming) => {
  const ids = new Set(existing.map(a => a?.id).filter(Boolean));
  const added = incoming.filter(a => a?.id && !ids.has(a.id) && ids.add(a.id));
  return { merged: [...existing, ...added], newlyPersistedIds: added.map(a => a.id) };
};
const createProgressRouter = (supabase = supabaseAdmin) => {
  const router = express.Router();
  router.use(require('../middleware/studentIdentity').createStudentGuard(supabase));
  const fail = (res, error) => res.status(error.status || 503).json({ success: false, code: error.code || 'PROGRESS_DEPENDENCY_UNAVAILABLE',
    message: error.status ? error.message : 'Progress is temporarily unavailable. Retry the same attempt later.' });
  const read = async (req, res) => {
    try {
      const { data, error } = await supabase.from('child_progress').select('*').eq('child_id', req.authenticatedStudentId).maybeSingle();
      if (error) throw error;
      return res.json({ success: true, progress: data, newlyPersistedAchievementIds: [] });
    } catch { return res.status(503).json({ success: false, message: 'Unable to load saved progress.' }); }
  };
  router.get('/', read);
  router.post('/update', (req, res) => {
    if (!req.body || Array.isArray(req.body) || Object.keys(req.body).length) return res.status(400).json({ success: false,
      code: 'CLIENT_TOTALS_FORBIDDEN', message: 'Progress totals are server-owned. Update the app to submit learning attempts.' });
    return read(req, res);
  });
  router.post('/events/start', async (req, res) => {
    try { return res.json({ success: true, ...await startProgressEvent(supabase, req.authenticatedStudentId, req.body) }); }
    catch (error) { return fail(res, error); }
  });
  router.post('/events/:eventId', async (req, res) => {
    try { return res.json(await recordProgressEvent(supabase, req.authenticatedStudentId, req.params.eventId, req.body)); }
    catch (error) { return fail(res, error); }
  });
  router.post('/content-attempt', (req, res) => res.status(400).json({ success: false, code: 'VERIFIED_EVENT_REQUIRED',
    message: 'Submit an answer using a server-issued learning attempt.' }));
  router.get('/reading-status', async (req, res) => {
    try {
      const { data, error } = await supabase.rpc('get_student_reading_progress', { p_student_id: req.authenticatedStudentId });
      if (error) throw error;
      return res.json({ success: true, progression: data });
    } catch { return res.status(503).json({ success: false, message: 'Unable to load official reading progress.' }); }
  });
  return router;
};
module.exports = createProgressRouter();
module.exports.createProgressRouter = createProgressRouter;
module.exports.mergeAchievements = mergeAchievements;
