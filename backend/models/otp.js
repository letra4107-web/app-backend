const { supabaseAdmin } = require('../config/supabase');

const OTP_COLLECTION = 'otp_sessions';
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RESEND_ATTEMPTS = 3;
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const createOTPSession = async (userId, email) => {
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
      resend_count: 0,
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

const verifyOTP = async (userId, otp) => {
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

    if (data.verified) {
      throw new Error('OTP already verified');
    }

    if (new Date() > new Date(data.expires_at)) {
      await supabaseAdmin.from(OTP_COLLECTION).delete().eq('user_id', userId);
      throw new Error('OTP has expired. Please request a new one.');
    }

    if (data.attempts >= 5) {
      await supabaseAdmin.from(OTP_COLLECTION).delete().eq('user_id', userId);
      throw new Error('Too many incorrect attempts. Please request a new OTP.');
    }

    if (data.otp !== otp) {
      await supabaseAdmin.from(OTP_COLLECTION).update({ attempts: (data.attempts || 0) + 1 }).eq('user_id', userId);
      throw new Error(`Invalid OTP. ${5 - ((data.attempts || 0) + 1)} attempts remaining.`);
    }

    await supabaseAdmin.from(OTP_COLLECTION).update({ verified: true, verified_at: new Date().toISOString() }).eq('user_id', userId);

    console.log(`OTP verified for user: ${userId}`);
    return { success: true, email: data.email };
  } catch (error) {
    console.error('Error verifying OTP:', error);
    throw error;
  }
};

const canResendOTP = async (userId) => {
  try {
    const { data } = await supabaseAdmin.from(OTP_COLLECTION).select('*').eq('user_id', userId).limit(1);
    const doc = Array.isArray(data) && data.length ? data[0] : null;

    if (!doc) {
      return { allowed: true, message: 'No previous OTP session' };
    }

    if ((doc.resend_count || 0) >= MAX_RESEND_ATTEMPTS) {
      return {
        allowed: false,
        message: `Maximum resend attempts (${MAX_RESEND_ATTEMPTS}) exceeded. Try again later.`,
      };
    }

    const timeSinceLastResend = new Date() - new Date(doc.last_resend_at || 0);
    if (timeSinceLastResend < RESEND_COOLDOWN_MS) {
      const secondsRemaining = Math.ceil((RESEND_COOLDOWN_MS - timeSinceLastResend) / 1000);
      return {
        allowed: false,
        message: `Please wait ${secondsRemaining} seconds before resending.`,
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
