const express = require('express');
const multer = require('multer');
const { supabaseAdmin } = require('../config/supabase');
const { prepareLessonPdf, MAX_FILE_BYTES } = require('../services/lessonFilePreview');

function createLessonFilesRouter({ client = supabaseAdmin, convert = prepareLessonPdf, maxConcurrent = 2 } = {}) {
  const router = express.Router();
  const usage = new Map();
  let active = 0;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0, parts: 2 } }).single('file');
  router.post('/prepare', async (req, res) => {
    try {
      const token = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
      if (!token) return res.status(401).json({ message: 'Mag-login muna upang mag-upload.' });
      const { data: auth, error: authError } = await client.auth.getUser(token);
      if (authError || !auth?.user?.id) return res.status(401).json({ message: 'Mag-login muli upang magpatuloy.' });
      const { data: user, error } = await client.from('users').select('role').eq('id', auth.user.id).maybeSingle();
      if (error) throw error;
      if (!user || !['teacher', 'admin'].includes(user.role)) return res.status(403).json({ message: 'Guro lamang ang maaaring mag-upload ng aralin.' });
      const now = Date.now();
      let limit = usage.get(auth.user.id);
      if (!limit || limit.until <= now) { limit = { count: 0, until: now + 600000 }; usage.set(auth.user.id, limit); }
      if (limit.count >= 20 || active >= maxConcurrent) {
        res.set('Retry-After', '30'); return res.status(429).json({ message: 'May pinoprosesong mga file. Maghintay sandali at subukan muli.' });
      }
      limit.count++;
      if (usage.size > 5000) for (const [id, row] of usage) if (row.until <= now) usage.delete(id);
      active++;
      upload(req, res, async uploadError => {
        const controller = new AbortController();
        const canceled = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', canceled);
        try {
          if (uploadError) return res.status(uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ message: 'Pumili ng isang file na hanggang 50 MB.' });
          if (!req.file) return res.status(400).json({ message: 'Pumili muna ng file para sa aralin.' });
          const result = await convert(req.file, { signal: controller.signal });
          if (controller.signal.aborted) return;
          res.set('Cache-Control', 'private, no-store');
          res.set('Content-Disposition', 'inline; filename="lesson.pdf"');
          res.type('application/pdf').send(result);
        } catch (error) {
          if (!res.destroyed) res.status(error.status || 503).json({ message: error.publicMessage || 'Hindi maihanda ang file. Subukan muli mamaya.' });
        } finally { active--; res.removeListener('close', canceled); }
      });
    } catch {
      return res.status(503).json({ message: 'Hindi ma-verify ang account. Subukan muli mamaya.' });
    }
  });
  return router;
}
module.exports = createLessonFilesRouter();
module.exports.createLessonFilesRouter = createLessonFilesRouter;
