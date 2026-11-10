const { supabaseAdmin } = require('../config/supabase');

const authenticatedMobileUser = async (req, res, next) => {
  try {
    const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ success: false, message: 'Authentication is required.' });
    const { data, error } = await supabaseAdmin.auth.getUser(match[1]);
    if (error || !data?.user?.id) return res.status(401).json({ success: false, message: 'Invalid session.' });
    req.mobileUserId = data.user.id;
    return next();
  } catch { return res.status(503).json({ success: false, message: 'Unable to authorize request.' }); }
};
const relatedChildren = async userId => {
  const [parent, student] = await Promise.all([
    supabaseAdmin.from('children').select('id,parent_id,auth_uid').eq('parent_id', userId),
    supabaseAdmin.from('children').select('id,parent_id,auth_uid').eq('auth_uid', userId),
  ]);
  if (parent.error || student.error) throw parent.error || student.error;
  return [...(parent.data || []), ...(student.data || [])];
};
module.exports = { authenticatedMobileUser, relatedChildren };
