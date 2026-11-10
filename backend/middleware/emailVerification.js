'use strict';

// Code delivery and recovery must remain reachable by pending accounts.
const verificationRoutes = new Set([
  '/auth/send-otp', '/auth/resend-otp', '/auth/verify-otp',
  '/auth/request-password-reset', '/auth/complete-password-reset',
  '/auth/cancel-verification', '/auth/send-email-otp', '/auth/rollback-incomplete-signup',
]);
function createEmailVerificationGuard(client) {
  return async (req, res, next) => {
    if (req.method === 'OPTIONS' || verificationRoutes.has(req.path.replace(/\/$/, ''))) return next();
    const token = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    // Route-specific guards continue to decide whether anonymous access is valid.
    if (!token) return next();
    try {
      const auth = await client.auth.getUser(token);
      if (auth.error || !auth.data?.user?.id) return res.status(401).json({ success:false, message:'Mag-login muli.' });
      const user = auth.data.user;
      const profile = await client.from('users').select('role,email_verified').eq('id', user.id).maybeSingle();
      if (profile.error) throw profile.error;
      if (profile.data?.role === 'student') return next();
      if (!profile.data) {
        const child = await client.from('children').select('id').eq('auth_uid', user.id).maybeSingle();
        if (child.error) throw child.error;
        if (child.data) return next();
      }
      if (!user.email_confirmed_at || profile.data?.email_verified !== true) {
        return res.status(403).json({ success:false, code:'EMAIL_VERIFICATION_REQUIRED', message:'I-verify muna ang iyong email bago magpatuloy.' });
      }
      return next();
    } catch {
      return res.status(503).json({ success:false, message:'Hindi makumpirma ang account. Subukan muli.' });
    }
  };
}
module.exports = { createEmailVerificationGuard };
