const { supabaseAdmin } = require('../config/supabase');
const crypto = require('crypto');

const OTP_COLLECTION = 'otp_sessions';
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_RESEND_ATTEMPTS = 3;
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

const generateOTP = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

const createOTPSession = async (userId, email) => {
  const previous = await supabaseAdmin.from(OTP_COLLECTION).select('*').eq('user_id', userId).limit(1);
  if (previous.error) throw previous.error;
  const prior = previous.data?.[0];
  const active = prior && Date.parse(prior.expires_at) > Date.now();
  if (active) {
    const restriction = await canResendOTP(userId);
    if (!restriction.allowed) {
      const error = new Error(restriction.message);
      error.status = 429; error.retryAfterSeconds = restriction.retryAfterSeconds;
      throw error;
    }
  }
  const otp = generateOTP();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);

  try {
    console.log('[OTP] creating OTP session', {
      timestamp: now.toISOString(),
      userId,
      email,
      expiresAt: expiresAt.toISOString(),
    });

    const { error } = await supabaseAdmin.from(OTP_COLLECTION).upsert({
      user_id: userId,
      email,
      otp,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      attempts: 0,
      verified: false,
      resend_count: active ? (prior.resend_count || 0) + 1 : 0,
      last_resend_at: now.toISOString(),
    });

    if (error) {
      console.error('[OTP] OTP session insert failed', {
        timestamp: new Date().toISOString(),
        userId,
        email,
        code: error.code,
        message: error.message || String(error),
        details: error.details,
      });
      throw error;
    }

    console.log('[OTP] OTP session created', {
      timestamp: new Date().toISOString(),
      userId,
      email,
      expiresAt: expiresAt.toISOString(),
    });
    return { otp, expiresAt };
  } catch (error) {
    console.error('[OTP] Error creating OTP session:', {
      timestamp: new Date().toISOString(),
      userId,
      email,
      code: error?.code,
      message: error?.message || String(error),
    });
    throw new Error('Failed to create OTP session');
  }
};

const verifyOTP = async (userId, otp, email, consume = true) => {
  if (!/^\d{6}$/.test(String(otp))) throw new Error('Invalid OTP.');
  const docRef = await supabaseAdmin.from(OTP_COLLECTION).select('*').eq('user_id', userId).limit(1);

  try {
    if (docRef.error) {
      throw docRef.error;
    }

    const rows = docRef.data || (docRef.data === undefined ? [] : docRef.data);
    const doc = Array.isArray(rows) && rows.length ? rows[0] : null;

    if (!doc) {
      throw new Error('No OTP session found for this user');
    }

    const data = doc;
    if (email && String(data.email).trim().toLowerCase() !== String(email).trim().toLowerCase()) throw new Error('Invalid OTP recipient.');

    if (data.verified) {
      throw new Error('OTP already verified');
    }

    if (!Number.isFinite(Date.parse(data.expires_at)) || Date.now() >= Date.parse(data.expires_at)) {
      await supabaseAdmin.from(OTP_COLLECTION).delete().eq('user_id', userId);
      throw new Error('OTP has expired. Please request a new one.');
    }

    if (data.attempts >= 5) {
      await supabaseAdmin.from(OTP_COLLECTION).delete().eq('user_id', userId);
      throw new Error('Too many incorrect attempts. Please request a new OTP.');
    }

    if (data.otp !== otp) {
      const rejected = await supabaseAdmin.from(OTP_COLLECTION).update({ attempts: (data.attempts || 0) + 1 }).eq('user_id', userId).eq('attempts', data.attempts || 0);
      if (rejected.error) throw rejected.error;
      throw new Error(`Invalid OTP. ${5 - ((data.attempts || 0) + 1)} attempts remaining.`);
    }

    if (consume) {
      const consumed = await supabaseAdmin.from(OTP_COLLECTION)
        .update({ verified: true })
        .eq('user_id', userId).eq('otp', otp).eq('verified', false).eq('attempts', data.attempts || 0).eq('expires_at', data.expires_at).select('user_id');
      if (consumed.error) throw consumed.error;
      if (!consumed.data?.length) throw new Error('OTP already used or changed. Please request a new one.');
    }

    console.log(`OTP verified for user: ${userId}`);
    return { success: true, email: data.email };
  } catch (error) {
    console.error('Error verifying OTP:', error);
    throw error;
  }
};

const canResendOTP = async (userId) => {
  try {
    const { data, error } = await supabaseAdmin.from(OTP_COLLECTION).select('*').eq('user_id', userId).limit(1);
    if (error) throw error;
    const doc = Array.isArray(data) && data.length ? data[0] : null;

    if (!doc) {
      return { allowed: true, message: 'No previous OTP session' };
    }
    if (Date.parse(doc.expires_at) <= Date.now()) return { allowed: true, message: 'Previous code expired' };

    if ((doc.resend_count || 0) >= MAX_RESEND_ATTEMPTS) {
      return {
        allowed: false,
        message: `Maximum resend attempts (${MAX_RESEND_ATTEMPTS}) exceeded. Try again later.`,
        retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(doc.expires_at) - Date.now()) / 1000)),
      };
    }

    const timeSinceLastResend = new Date() - new Date(doc.last_resend_at || 0);
    if (timeSinceLastResend < RESEND_COOLDOWN_MS) {
      const secondsRemaining = Math.ceil((RESEND_COOLDOWN_MS - timeSinceLastResend) / 1000);
      return {
        allowed: false,
        message: `Please wait ${secondsRemaining} seconds before resending.`,
        retryAfterSeconds: secondsRemaining,
      };
    }

    return { allowed: true, message: 'OK' };
  } catch (error) {
    console.error('Error checking resend status:', error);
    return { allowed: false, message: 'Error checking resend status' };
  }
};

const deleteOTPSession = async (userId) => {
  try {
    await supabaseAdmin.from(OTP_COLLECTION).delete().eq('user_id', userId);
    console.log(`OTP session deleted for user: ${userId}`);
  } catch (error) {
    console.error('Error deleting OTP session:', error);
  }
};

module.exports = {
  generateOTP,
  createOTPSession,
  verifyOTP,
  canResendOTP,
  deleteOTPSession,
};
