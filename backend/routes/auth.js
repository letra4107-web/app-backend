const express = require('express');
const { sendPasswordResetCodeEmail, transporter } = require('../config/mailer');
const { supabaseAdmin } = require('../config/supabase');
const { createOTPSession, verifyOTP, canResendOTP, deleteOTPSession } = require('../models/otp');
const { enqueueOtpEmail } = require('../jobs/otpEmailQueue');
const crypto = require('crypto');
let bcrypt = null;
try {
  bcrypt = require('bcryptjs');
} catch {
  bcrypt = null;
}

const router = express.Router();

const OTP_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const OTP_REQUEST_CACHE_TTL_MS = 2 * 60 * 1000;
const otpRequestCache = new Map();
const otpRequestInFlight = new Map();
const passwordResetRequestTimes = new Map();
const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;

const isValidEmail = (email) => OTP_EMAIL_REGEX.test(String(email || '').trim());
const otpExpiryPayload = (expiresAt) => {
  const expiresAtMs = new Date(expiresAt).getTime();
  const expiresInSeconds = Number.isFinite(expiresAtMs)
    ? Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000))
    : 0;
  return { expiresAt: new Date(expiresAt).toISOString(), expiresInSeconds };
};
const bearerTokenFrom = (authorization = '') => {
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};
const makeUuid = () => crypto.randomUUID ? crypto.randomUUID() : `child-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const difficultyFromGrade = (gradeLevel) => {
  if (gradeLevel <= 2) return 'Beginner';
  if (gradeLevel <= 4) return 'Intermediate';
  return 'Advanced';
};
const STUDENT_PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const makeStudentPassword = () => Array.from(
  { length: 10 },
  () => STUDENT_PASSWORD_CHARS[crypto.randomInt(0, STUDENT_PASSWORD_CHARS.length)],
).join('');
const makeStudentUsernameBase = (name) => {
  const parts = String(name || '').trim().toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  const first = parts[0] || 'bata';
  const last = parts.length > 1 ? parts[parts.length - 1] : first;
  return `${first[0] || 'b'}${last}`.replace(/\s+/g, '');
};
const getAvailableStudentUsername = async (name) => {
  const base = makeStudentUsernameBase(name);
  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate = `${base}${suffix === 0 ? '' : suffix + 1}@linawletra.edu.ph`;
    const { data, error } = await supabaseAdmin.from('children').select('id').eq('username', candidate).maybeSingle();
    if (error) throw error;
    if (!data) return candidate;
  }
  return `${base}${Date.now()}@linawletra.edu.ph`;
};
const hashPassword = async (password) => {
  if (bcrypt) return bcrypt.hash(password, 10);
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return `pbkdf2_sha256$120000$${salt}$${hash}`;
};

const authLog = (level, message, meta = {}) => {
  console[level](`[auth] ${message}`, { timestamp: new Date().toISOString(), ...meta });
};

const makeOtpRequestKey = (email, clientRequestId) => {
  const cleanRequestId = String(clientRequestId || '').trim().slice(0, 160);
  if (!email || !cleanRequestId) return '';
  return `${normalizeEmail(email)}:${cleanRequestId}`;
};

const setOtpRequestCache = (key, payload) => {
  if (!key) return;
  otpRequestCache.set(key, { payload, expiresAt: Date.now() + OTP_REQUEST_CACHE_TTL_MS });
  setTimeout(() => {
    const cached = otpRequestCache.get(key);
    if (cached && cached.expiresAt <= Date.now()) {
      otpRequestCache.delete(key);
    }
  }, OTP_REQUEST_CACHE_TTL_MS + 1000);
};

const getOtpRequestCache = (key) => {
  if (!key) return null;
  const cached = otpRequestCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    otpRequestCache.delete(key);
    return null;
  }
  return cached.payload;
};

const findUserIdByEmail = async (email) => {
  try {
    const { data, error } = await supabaseAdmin.from('users').select('id').eq('email', email).limit(1);
    if (error) {
      console.warn('Supabase lookup failed for email userId lookup:', error.message || error);
      return `user_${normalizeEmail(email)}`;
    }
    if (Array.isArray(data) && data.length > 0) return data[0].id;
  } catch (error) {
    console.warn('User lookup failed:', error.message || error);
  }
  return `user_${normalizeEmail(email)}`;
};

router.post('/request-password-reset', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const genericMessage = "If an account exists with this email, you'll receive a six-digit reset code shortly.";

  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'Please provide a valid email address' });
  }

  const lastRequestedAt = passwordResetRequestTimes.get(email) || 0;
  if (Date.now() - lastRequestedAt < PASSWORD_RESET_COOLDOWN_MS) {
    return res.status(429).json({ success: false, message: 'Please wait one minute before requesting another reset link.' });
  }
  const requestedAt = Date.now();
  passwordResetRequestTimes.set(email, requestedAt);
  const cleanupTimer = setTimeout(() => {
    if (passwordResetRequestTimes.get(email) === requestedAt) {
      passwordResetRequestTimes.delete(email);
    }
  }, PASSWORD_RESET_COOLDOWN_MS + 1000);
  cleanupTimer.unref?.();

  try {
    const { data: profileRows, error: profileError } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('email', email)
      .limit(1);
    if (profileError) throw profileError;

    const profile = Array.isArray(profileRows) ? profileRows[0] : null;
    if (!profile?.id) {
      authLog('log', 'password reset requested for unknown email', { email });
      return res.json({ success: true, message: genericMessage });
    }

    const { data: authResult, error: authError } = await supabaseAdmin.auth.admin.getUserById(profile.id);
    const authUser = authResult?.user;
    if (authError || !authUser || normalizeEmail(authUser.email) !== email) {
      authLog('warn', 'password reset profile has no matching Auth user', {
        email,
        userId: profile.id,
        error: authError?.message,
      });
      return res.json({ success: true, message: genericMessage });
    }

    const otpSession = await createOTPSession(profile.id, email);
    const delivery = await sendPasswordResetCodeEmail(email, otpSession.otp);
    authLog('log', 'password reset code accepted by email provider', {
      email,
      userId: profile.id,
      messageId: delivery.messageId,
      provider: delivery.provider,
    });
    return res.json({ success: true, message: genericMessage, deliveryMethod: 'code' });
  } catch (error) {
    passwordResetRequestTimes.delete(email);
    authLog('error', 'password reset delivery failed', {
      email,
      message: error?.message || String(error),
      code: error?.code,
      responseCode: error?.responseCode,
    });
    return res.status(503).json({
      success: false,
      message: 'We could not send the reset email right now. Please try again in a moment.',
    });
  }
});

router.post('/complete-password-reset', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || '').trim();
  const password = String(req.body?.password || '');

  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, message: 'Enter the valid email and six-digit reset code.' });
  }
  if (password.length < 8 || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return res.status(400).json({ success: false, message: 'Password must have 8 characters, one uppercase letter, and one number.' });
  }

  try {
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('email', email)
      .limit(1);
    if (profileError) throw profileError;
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    if (!profile?.id) return res.status(400).json({ success: false, message: 'Invalid or expired reset code.' });

    const verification = await verifyOTP(profile.id, code);
    if (normalizeEmail(verification.email) !== email) {
      throw new Error('Reset code does not match this email.');
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(profile.id, { password });
    if (updateError) throw updateError;
    await deleteOTPSession(profile.id);
    authLog('log', 'password reset completed', { email, userId: profile.id });
    return res.json({ success: true, message: 'Password updated successfully.' });
  } catch (error) {
    authLog('warn', 'password reset completion failed', { email, message: error?.message || String(error) });
    return res.status(400).json({ success: false, message: error?.message || 'Invalid or expired reset code.' });
  }
});

const findOtpSessionUserId = async (email, preferredUserId = '') => {
  const normalizedEmail = normalizeEmail(email);

  if (preferredUserId) {
    const { data, error } = await supabaseAdmin
      .from('otp_sessions')
      .select('user_id')
      .eq('user_id', preferredUserId)
      .limit(1);

    if (error) {
      console.warn('[auth] OTP session lookup by userId failed:', error.message || error);
    } else if (Array.isArray(data) && data.length > 0) {
      return data[0].user_id;
    }
  }

  const { data, error } = await supabaseAdmin
    .from('otp_sessions')
    .select('user_id')
    .eq('email', normalizedEmail)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.warn('[auth] OTP session lookup by email failed:', error.message || error);
  } else if (Array.isArray(data) && data.length > 0) {
    return data[0].user_id;
  }

  return preferredUserId || findUserIdByEmail(normalizedEmail);
};

const ensureChildRecordForStudent = async (authUid, displayName, username, parentId = null, gradeLevel = 1) => {
  if (!authUid) {
    throw new Error('Auth UID is required to ensure child record');
  }

  const { data: existingChild, error: lookupError } = await supabaseAdmin
    .from('children')
    .select('id')
    .eq('auth_uid', authUid)
    .maybeSingle();

  if (lookupError) {
    throw lookupError;
  }

  if (existingChild) {
    authLog('log', 'Child record already exists', { authUid, childId: existingChild.id, username });
    return existingChild;
  }

  const childId = makeUuid();
  const childEntry = {
    id: childId,
    parent_id: parentId || null,
    name: displayName || username,
    grade_level: Number.isFinite(gradeLevel) ? gradeLevel : 1,
    username,
    auth_uid: authUid,
    created_at: new Date().toISOString(),
  };

  const { error: insertError } = await supabaseAdmin.from('children').insert(childEntry);
  if (insertError) {
    const lowercaseMessage = String(insertError.message || '').toLowerCase();
    const duplicateConflict = lowercaseMessage.includes('duplicate') || String(insertError.code || '').startsWith('23');
    if (duplicateConflict) {
      const { data: retryChild, error: retryError } = await supabaseAdmin
        .from('children')
        .select('id')
        .eq('auth_uid', authUid)
        .maybeSingle();
      if (retryError) throw retryError;
      if (retryChild) return retryChild;
    }
    throw insertError;
  }

  authLog('log', 'Created missing child record', { authUid, childId, username });
  return childEntry;
};

router.post('/send-email-otp', async (req, res) => {
  const TIMEOUT_MS = 8000;
  const startMs = Date.now();
  const requestId = `send-email-otp-${startMs}-${Math.random().toString(36).slice(2, 8)}`;
  req.setTimeout(TIMEOUT_MS);
  res.setTimeout(TIMEOUT_MS, () => {
    authLog('warn', 'send-email-otp response timeout reached', { requestId, path: req.path, ip: req.ip, elapsedMs: Date.now() - startMs });
  });

  let timeoutTimer;
  let responded = false;
  const sendJsonOnce = (status, payload) => {
    if (responded || res.headersSent) return undefined;
    responded = true;
    return res.status(status).json(payload);
  };

  const timeoutPromise = new Promise((_, reject) => {
    timeoutTimer = setTimeout(() => {
      reject(new Error(`Request timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
  });

  const main = async () => {
    const stepMs = Date.now();
    authLog('log', 'send-email-otp request received', { requestId, origin: req.headers.origin, host: req.headers.host, body: req.body });
    const email = normalizeEmail(req.body.email);
    const clientRequestId = String(req.body.clientRequestId || '').trim();
    const otpRequestKey = makeOtpRequestKey(email, clientRequestId);
    let userId = String(req.body.userId || '').trim();

    if (!email) {
      return sendJsonOnce(400, { success: false, message: 'Email is required' });
    }

    if (!isValidEmail(email)) {
      return sendJsonOnce(400, { success: false, message: 'Please provide a valid email address' });
    }

    const cachedPayload = getOtpRequestCache(otpRequestKey);
    if (cachedPayload) {
      authLog('log', 'send-email-otp returning cached idempotent response', { requestId, clientRequestId, email, userId });
      return sendJsonOnce(200, { ...cachedPayload, idempotentReplay: true, requestDuration: Date.now() - startMs });
    }

    if (otpRequestKey && otpRequestInFlight.has(otpRequestKey)) {
      authLog('log', 'send-email-otp awaiting in-flight idempotent request', { requestId, clientRequestId, email, userId });
      const payload = await otpRequestInFlight.get(otpRequestKey);
      return sendJsonOnce(200, { ...payload, idempotentReplay: true, requestDuration: Date.now() - startMs });
    }

    const operation = (async () => {
      let resolvedUserId = userId;
      if (!resolvedUserId) {
        resolvedUserId = await findUserIdByEmail(email);
      }

      const otpSession = await createOTPSession(resolvedUserId, email);
      authLog('log', 'send-email-otp OTP session created', { requestId, clientRequestId, email, userId: resolvedUserId, generatedAt: new Date(stepMs).toISOString(), elapsedMs: Date.now() - stepMs });

      const enqueueResult = enqueueOtpEmail({ label: 'send-email-otp', userId: resolvedUserId, email, otp: otpSession.otp });
      authLog('log', 'send-email-otp email send queued for background', { requestId, clientRequestId, email, userId: resolvedUserId, enqueueResult, totalElapsedMs: Date.now() - startMs });

      return {
        success: true,
        message: 'OTP queued',
        emailStatus: 'queued',
        jobId: enqueueResult.jobId,
        userId: resolvedUserId,
        ...otpExpiryPayload(otpSession.expiresAt),
      };
    })();

    if (otpRequestKey) {
      otpRequestInFlight.set(otpRequestKey, operation);
    }

    try {
      const payload = await operation;
      setOtpRequestCache(otpRequestKey, payload);
      return sendJsonOnce(200, { ...payload, requestDuration: Date.now() - startMs });
    } finally {
      if (otpRequestKey) {
        otpRequestInFlight.delete(otpRequestKey);
      }
    }
  };

  try {
    const result = await Promise.race([main(), timeoutPromise]);
    return result;
  } catch (error) {
    const elapsedMs = Date.now() - startMs;
    const isTimeout = String(error?.message || '').includes('timed out');
    authLog('error', 'Error in send-email-otp', {
      requestId,
      message: error?.message || error,
      code: error?.code,
      stack: error?.stack,
      body: req.body,
      origin: req.headers.origin,
      elapsedMs,
      isTimeout,
    });

    const status = isTimeout ? 504 : 502;
    return sendJsonOnce(status, {
      success: false,
      message: isTimeout
        ? `Request timed out after ${elapsedMs}ms. Check backend connectivity.`
        : error?.message || 'Unable to queue OTP email. Please verify the address and try again.',
      requestDuration: elapsedMs,
    });
  } finally {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
    }
  }
});

router.post('/send-otp', (req, res, next) => {
  req.url = '/send-email-otp';
  return router.handle(req, res, next);
});

router.post('/create-student-account', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '').trim();
    const displayName = String(req.body.displayName || username).trim();

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required to create a student account',
      });
    }

    const authEmail = `${username}@student.linawletra.app`;

    // Check existing user in Supabase auth or profile table
    let existingUser = null;
    try {
      const { data: usersData, error: usersError } = await supabaseAdmin
        .from('users')
        .select('id, parent_id, name, role, email')
        .eq('email', authEmail)
        .limit(1);
      if (usersError) throw usersError;
      if (Array.isArray(usersData) && usersData.length > 0) existingUser = usersData[0];
    } catch (e) {
      console.warn('Error checking users table for existing account:', e.message || e);
    }

    if (existingUser) {
      await ensureChildRecordForStudent(existingUser.id, displayName, authEmail, existingUser.parent_id || null, 1);
      return res.json({
        success: true,
        message: 'Student authentication account already exists',
        authUid: existingUser.id,
        authEmail,
      });
    }

    if (!displayName) {
      return res.status(400).json({
        success: false,
        message: 'Display name is required for student account creation',
      });
    }

    // Create user in Supabase Auth (admin)
    const { data: createRes, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: authEmail,
      password,
      user_metadata: { displayName, role: 'student' },
      email_confirm: true,
    });
    if (createErr) throw createErr;
    const createdUser = createRes.user || createRes;

    // Set role in user metadata and insert profile into users table
    await supabaseAdmin.auth.admin.updateUserById(createdUser.id, { user_metadata: { role: 'student' } });

    await supabaseAdmin.from('users').upsert({
      id: createdUser.id,
      name: displayName,
      email: authEmail,
      role: 'student',
      created_at: new Date().toISOString(),
      email_verified: true,
    });

    await ensureChildRecordForStudent(createdUser.id, displayName, authEmail, null, 1);

    return res.json({
      success: true,
      message: 'Student authentication account created successfully',
      authUid: createdUser.id,
      authEmail,
    });
  } catch (error) {
    console.error('❌ Error in create-student-account:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create student auth account',
    });
  }
});

router.post('/set-role', async (req, res) => {
  try {
    const { uid, role } = req.body;
    if (!uid || !role) {
      return res.status(400).json({
        success: false,
        message: 'User ID and role are required',
      });
    }

    // Update role via Supabase admin API and users table
    await supabaseAdmin.auth.admin.updateUserById(uid, { user_metadata: { role } });
    await supabaseAdmin.from('users').update({ role }).eq('id', uid);

    return res.json({
      success: true,
      message: `Role '${role}' was assigned successfully`,
    });
  } catch (error) {
    console.error('❌ Error in set-role:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to assign role',
    });
  }
});

router.post('/enroll-child', async (req, res) => {
  let createdAuthUid = null;
  try {
    const token = bearerTokenFrom(req.headers.authorization);
    if (!token) return res.status(401).json({ success: false, message: 'Authentication is required.' });
    const { data: authenticated, error: authenticationError } = await supabaseAdmin.auth.getUser(token);
    if (authenticationError || !authenticated?.user?.id) {
      return res.status(401).json({ success: false, message: 'Your sign-in session is invalid or expired.' });
    }
    const { data: parentProfile, error: parentProfileError } = await supabaseAdmin
      .from('users')
      .select('id,role,email')
      .eq('id', authenticated.user.id)
      .maybeSingle();
    if (parentProfileError) throw parentProfileError;
    const authenticatedRole = parentProfile?.role || authenticated.user.user_metadata?.role;
    if (authenticatedRole !== 'parent') {
      return res.status(403).json({ success: false, message: 'Only authenticated parent accounts can enroll a child.' });
    }
    const parentId = authenticated.user.id;
    const parentEmail = authenticated.user.email || parentProfile?.email;

    const { childName, gradeLevel } = req.body;
    const cleanName = String(childName || '').trim();
    const finalGradeLevel = Number(gradeLevel);

    if (!parentEmail || cleanName.length < 2 || !Number.isInteger(finalGradeLevel) || finalGradeLevel < 1 || finalGradeLevel > 6) {
      return res.status(400).json({
        success: false,
        message: 'Student name and a grade level from 1 to 6 are required.',
      });
    }

    const { data: existingEnrollment, error: existingEnrollmentError } = await supabaseAdmin
      .from('children')
      .select('id')
      .eq('parent_id', parentId)
      .eq('grade_level', finalGradeLevel)
      .ilike('name', cleanName)
      .limit(1)
      .maybeSingle();
    if (existingEnrollmentError) throw existingEnrollmentError;
    if (existingEnrollment) {
      return res.status(409).json({
        success: false,
        message: 'Naka-enroll na ang estudyanteng ito. I-refresh ang Manage Children upang makita ang record.',
      });
    }

    const level = difficultyFromGrade(finalGradeLevel);
    const authEmail = await getAvailableStudentUsername(cleanName);
    const password = makeStudentPassword();

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: authEmail,
      password,
      user_metadata: { displayName: cleanName, role: 'student', parentId },
      email_confirm: true,
    });
    if (createErr) throw createErr;
    const userRecord = created.user || created;
    createdAuthUid = userRecord.id;

    await supabaseAdmin.auth.admin.updateUserById(userRecord.id, { user_metadata: { role: 'student', parentId } });

    const childId = makeUuid();
    const childEntry = {
      id: childId,
      parent_id: parentId,
      name: cleanName,
      grade_level: finalGradeLevel,
      username: authEmail,
      auth_uid: userRecord.id,
      created_at: new Date().toISOString(),
    };

    const { error: childError } = await supabaseAdmin.from('children').insert(childEntry);
    if (childError) throw childError;

    const { error: profileError } = await supabaseAdmin.from('users').upsert({
      id: userRecord.id,
      name: cleanName,
      email: authEmail,
      role: 'student',
      parent_id: parentId,
      created_at: new Date().toISOString(),
      email_verified: true,
    });
    if (profileError) throw profileError;

    const { error: progressError } = await supabaseAdmin.from('child_progress').insert({
      child_id: childId,
      // Beginner is the default. A higher value is valid only alongside the
      // separately inserted, attributable placement override below.
      level,
      xp: 0,
      streak: 0,
      completed_words: [],
      total_attempts: 0,
      achievements: [],
      badges: [],
      updated_at: new Date().toISOString(),
    });
    if (progressError) throw progressError;

    if (level !== 'Beginner') {
      const { error: overrideError } = await supabaseAdmin.from('student_reading_level_overrides').insert({
        student_id: childId,
        override_level: level,
        reason: `Automatic grade placement: Grade ${finalGradeLevel}`,
        created_by_auth_uid: parentId,
      });
      if (overrideError) throw overrideError;
    }

    const hashedPassword = await hashPassword(password);
    const { error: credentialsError } = await supabaseAdmin.from('child_credentials').insert({
      child_id: childId,
      username: authEmail,
      hashed_password: hashedPassword,
      plain_password: password,
      sent_at: new Date().toISOString(),
    });
    if (credentialsError) throw credentialsError;

    // TODO: schedule a daily job or Supabase function to clear child_credentials.plain_password after 24 hours.
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'LinawLetra <noreply@linawletra.com>',
      to: parentEmail,
      subject: 'LinawLetra — Inyong Anak ay Naka-enroll Na!',
      text: `Magandang araw! Naka-enroll na si ${childName} sa LinawLetra.

Narito ang kanyang login credentials:
Username: ${authEmail}
Password: ${password}

Gamitin ang mga ito para mag-login sa LinawLetra app.
Reading Level: ${level}

— LinawLetra Team
`,
    });

    return res.json({
      success: true,
      username: authEmail,
      childId,
      readingLevel: level,
      placementOverrideRecorded: level !== 'Beginner',
    });
  } catch (error) {
    console.error('Error in enroll-child:', error);
    if (createdAuthUid) {
      const { data: partialChild } = await supabaseAdmin
        .from('children')
        .select('id')
        .eq('auth_uid', createdAuthUid)
        .maybeSingle();
      if (partialChild?.id) {
        await supabaseAdmin.from('children').delete().eq('id', partialChild.id);
      }
      await supabaseAdmin.from('users').delete().eq('id', createdAuthUid);
      const { error: rollbackError } = await supabaseAdmin.auth.admin.deleteUser(createdAuthUid);
      if (rollbackError) {
        authLog('error', 'failed to roll back incomplete child enrollment', {
          authUid: createdAuthUid,
          message: rollbackError.message,
        });
      }
    }
    return res.status(500).json({
      success: false,
      message: 'Hindi makumpleto ang enrollment. Walang duplicate student record na ginawa.',
    });
  }
});

const fetchChildProfileByAuthUid = async (authUid, requestId) => {
  // Only query the existing `children` table. `child_profiles` does not exist in this schema.
  const candidateTables = ['children'];

  for (const table of candidateTables) {
    let { data, error, status } = await supabaseAdmin
      .from(table)
      .select('*, child_progress(*)')
      .eq('auth_uid', authUid)
      .maybeSingle();

    // child_progress has a UNIQUE child_id constraint, so PostgREST embeds it
    // as a to-one relationship (a single object) rather than an array - but
    // every consumer of this response reads `child_progress?.[0]`, expecting
    // an array. Left un-normalized, that indexing silently returns undefined
    // even when the real row was just fetched, and the client falls back to
    // an empty progress object (root cause of progress resetting every login).
    if (!error && data && data.child_progress && !Array.isArray(data.child_progress)) {
      data.child_progress = [data.child_progress];
    }

    const joinFailure = error && (
      String(error.message || '').toLowerCase().includes('relationship') ||
      String(error.message || '').toLowerCase().includes('schema cache') ||
      String(error.message || '').toLowerCase().includes('child_progress') ||
      String(error.code || '').toLowerCase().startsWith('42p') ||
      String(error.code || '').toLowerCase().startsWith('pgrst')
    );

    if (joinFailure) {
      authLog('warn', `Join failed on ${table}, trying plain select fallback`, {
        requestId,
        authUid,
        table,
        status,
        errorMessage: error.message || error,
        errorCode: error.code,
        errorDetails: error.details,
        errorHint: error.hint,
      });

      const fallback = await supabaseAdmin
        .from(table)
        .select('*')
        .eq('auth_uid', authUid)
        .maybeSingle();

      data = fallback.data;
      error = fallback.error;
      status = fallback.status;

      if (!error && data) {
        const progressResult = await supabaseAdmin
          .from('child_progress')
          .select('*')
          .eq('child_id', data.id)
          .order('updated_at', { ascending: false });

        if (!progressResult.error) {
          data.child_progress = progressResult.data || [];
          authLog('log', `Fetched progress separately for ${table}`, {
            requestId,
            childId: data.id,
            rows: data.child_progress.length,
          });
        } else {
          authLog('warn', `Failed to fetch child_progress separately for ${table}`, {
            requestId,
            childId: data.id,
            errorMessage: progressResult.error.message || progressResult.error,
            errorCode: progressResult.error.code,
          });
          data.child_progress = [];
        }
      }
    }

    if (error) {
      authLog('warn', `Supabase query failed on ${table}`, {
        requestId,
        authUid,
        table,
        status,
        errorMessage: error.message || error,
        errorCode: error.code,
        errorDetails: error.details,
        errorHint: error.hint,
      });
      if (table === 'children') {
        continue; // try the fallback table next
      }
      return { data: null, error, status, table };
    }

    if (data) {
      return { data, error: null, status, table };
    }
  }

  const { data: userRow, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, email, name, role, parent_id')
    .eq('id', authUid)
    .maybeSingle();

  if (userError) {
    authLog('warn', 'Users table lookup failed during child-profile fallback', {
      requestId,
      authUid,
      errorMessage: userError.message || userError,
      errorCode: userError.code,
      errorHint: userError.hint,
    });
    return { data: null, error: userError, status: 500, table: 'users' };
  }

  if (userRow) {
    const isStudentAccount = String(userRow.role || '').toLowerCase() === 'student' || String(userRow.email || '').includes('@student.linawletra.app');
    if (isStudentAccount) {
      try {
        const backfilledChild = await ensureChildRecordForStudent(
          authUid,
          userRow.name || userRow.email || authUid,
          userRow.email || `${String(authUid).slice(0, 12)}@student.linawletra.app`,
          userRow.parent_id || null,
          1,
        );
        return { data: backfilledChild, error: null, status: 201, table: 'children' };
      } catch (backfillError) {
        authLog('error', 'Failed to backfill missing child record during child-profile lookup', {
          requestId,
          authUid,
          errorMessage: backfillError.message || backfillError,
          errorCode: backfillError.code,
          email: userRow.email,
          role: userRow.role,
        });
        return { data: null, error: backfillError, status: 500, table: 'children' };
      }
    }
  }

  return { data: null, error: null, status: 404, table: 'children' };
};

router.get('/child-profile/:authUid', async (req, res) => {
  const authUid = String(req.params.authUid || '').trim();
  const requestId = `child-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  authLog('log', 'child-profile request received', {
    requestId,
    authUid,
    path: req.path,
    query: req.query,
    ip: req.ip,
    origin: req.headers.origin,
    authorization: Boolean(req.headers.authorization),
  });

  if (!authUid) {
    authLog('warn', 'child-profile missing authUid', { requestId });
    return res.status(400).json({ success: false, message: 'authUid is required' });
  }

  try {
    authLog('log', 'fetching child profile by authUid', { requestId, authUid });
    const { data: child, error, status, table } = await fetchChildProfileByAuthUid(authUid, requestId);

    if (error) {
      authLog('error', 'Supabase query failed for child-profile', {
        requestId,
        authUid,
        table,
        status,
        errorMessage: error.message || error,
        errorCode: error.code,
        errorHint: error.hint,
        errorDetails: error.details,
      });
      return res.status(500).json({
        success: false,
        message: 'Unable to load child profile',
        details: error.message || 'Supabase query error',
        code: error.code,
        hint: error.hint,
        table,
      });
    }

    if (!child) {
      authLog('warn', 'child-profile not found for authUid', {
        requestId,
        authUid,
        status,
        table,
        debugInfo: `Searched in table: ${table}`,
      });
      return res.status(404).json({
        success: false,
        message: 'Child profile not found',
        table,
        authUid,
      });
    }

    authLog('log', 'child-profile loaded successfully', {
      requestId,
      authUid,
      childId: child.id,
      table,
      childName: child.name,
    });
    return res.status(200).json({ success: true, child });
  } catch (error) {
    authLog('error', 'Unexpected error in child-profile route', {
      requestId,
      authUid,
      message: error?.message || error,
      stack: error?.stack,
    });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.post('/resend-otp', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    let userId = String(req.body.userId || '').trim();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    if (!userId) {
      userId = await findUserIdByEmail(email);
    }

    const resendStatus = await canResendOTP(userId);
    if (!resendStatus.allowed) {
      return res.status(400).json({
        success: false,
        message: resendStatus.message,
      });
    }

    // Using Supabase `otp_sessions` table
    const { data: sessionData, error: sessionErr } = await supabaseAdmin.from('otp_sessions').select('*').eq('user_id', userId).limit(1);
    if (sessionErr) {
      throw sessionErr;
    }
    const sessionRow = Array.isArray(sessionData) && sessionData.length ? sessionData[0] : null;

    if (!sessionRow) {
      const otpSession = await createOTPSession(userId, email);
      await supabaseAdmin
        .from('otp_sessions')
        .update({ resend_count: 1, last_resend_at: new Date().toISOString() })
        .eq('user_id', userId);
      const enqueueResult = enqueueOtpEmail({ label: 'resend-otp-initial', userId, email, otp: otpSession.otp });
      authLog('log', 'resend-otp email send queued for background', { email, userId, enqueueResult });

      return res.json({
        success: true,
        message: 'OTP resent successfully.',
        emailStatus: 'queued',
        jobId: enqueueResult.jobId,
        ...otpExpiryPayload(otpSession.expiresAt),
      });
    }

    const existing = sessionRow;
    if (!existing) {
      return res.status(500).json({ success: false, message: 'OTP session data unavailable' });
    }

    if (new Date() > new Date(existing.expires_at)) {
      await deleteOTPSession(userId);
      const otpSession = await createOTPSession(userId, email);
      await supabaseAdmin
        .from('otp_sessions')
        .update({ resend_count: 1, last_resend_at: new Date().toISOString() })
        .eq('user_id', userId);
      const enqueueResult = enqueueOtpEmail({ label: 'resend-otp-expired', userId, email, otp: otpSession.otp });
      authLog('log', 'resend-otp expired email send queued for background', { email, userId, enqueueResult });

      return res.json({
        success: true,
        message: 'Previous OTP expired. New OTP email queued for delivery.',
        emailStatus: 'queued',
        jobId: enqueueResult.jobId,
        ...otpExpiryPayload(otpSession.expiresAt),
      });
    }

    await supabaseAdmin
      .from('otp_sessions')
      .update({ resend_count: (existing.resend_count || 0) + 1, last_resend_at: new Date().toISOString() })
      .eq('user_id', userId);

    const enqueueResult = enqueueOtpEmail({ label: 'resend-otp', userId, email, otp: existing.otp });
    authLog('log', 'resend-otp existing email send queued for background', { email, userId, enqueueResult });

    return res.json({
      success: true,
      message: 'OTP resend queued for delivery.',
      emailStatus: 'queued',
      jobId: enqueueResult.jobId,
      ...otpExpiryPayload(existing.expires_at),
    });
  } catch (error) {
    console.error('❌ Error in resend-otp:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to resend OTP. Please try again.',
    });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const code = String(req.body.code || req.body.otp || '').trim();
    let userId = String(req.body.userId || '').trim();

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: 'OTP code and email are required',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    userId = await findOtpSessionUserId(email, userId);

    const verificationResult = await verifyOTP(userId, code);
    console.log(`✅ OTP verified for ${email}`);

    // Update the public users table to mark email_verified
    try {
      await supabaseAdmin.from('users').update({ email_verified: true }).eq('id', userId);
    } catch (e) {
      console.warn('Failed to update users.email_verified:', e.message || e);
    }

    // Also attempt to mark the Supabase Auth user as confirmed (service role)
    try {
      // Some Supabase Admin SDKs accept `email_confirmed_at` or `email_confirm` flags.
      // We'll set the timestamp field if supported.
      await supabaseAdmin.auth.admin.updateUserById(userId, { email_confirmed_at: new Date().toISOString() });
    } catch {
      try {
        await supabaseAdmin.auth.admin.updateUserById(userId, { email_confirm: true });
      } catch (err) {
        console.warn('Failed to update auth user confirmation status:', err.message || err);
      }
    }

    return res.json({
      success: true,
      message: 'OTP verified successfully',
      userId,
      email: verificationResult.email,
    });
  } catch (error) {
    console.error('❌ Error in verify-otp:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Invalid OTP, please try again.',
    });
  }
});

router.delete('/cancel-verification', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    let userId = String(req.body.userId || '').trim();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    if (!userId) {
      userId = await findUserIdByEmail(email);
    }

    await deleteOTPSession(userId);
    console.log(`✅ Verification cancelled for ${email}`);

    return res.json({
      success: true,
      message: 'Verification session cancelled',
    });
  } catch (error) {
    console.error('❌ Error in cancel-verification:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to cancel verification',
    });
  }
});

// Removes only the just-created, still-unverified Auth record when the
// required follow-up profile write fails. This is deliberately not a general
// account-deletion endpoint: it requires the per-signup metadata token and a
// short creation window.
router.post('/rollback-incomplete-signup', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const userId = String(req.body?.userId || '').trim();
    const cleanupToken = String(req.body?.cleanupToken || '').trim();
    if (!isValidEmail(email) || !userId || cleanupToken.length < 20) {
      return res.status(400).json({ success: false, message: 'Invalid cleanup request' });
    }

    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    const user = data?.user;
    if (error || !user || normalizeEmail(user.email) !== email) {
      return res.status(404).json({ success: false, message: 'Signup account not found' });
    }
    const createdAt = Date.parse(user.created_at || '');
    const isFresh = Number.isFinite(createdAt) && Date.now() - createdAt <= 15 * 60 * 1000;
    const expectedToken = String(user.user_metadata?.signup_cleanup_token || '');
    const tokensMatch = expectedToken.length === cleanupToken.length
      && crypto.timingSafeEqual(Buffer.from(expectedToken), Buffer.from(cleanupToken));
    if (user.email_confirmed_at || !isFresh || !tokensMatch) {
      return res.status(403).json({ success: false, message: 'Signup cleanup is no longer available' });
    }

    await supabaseAdmin.from('users').delete().eq('id', userId);
    await deleteOTPSession(userId);
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;
    return res.json({ success: true });
  } catch (error) {
    console.error('[auth] incomplete-signup rollback failed:', error);
    return res.status(500).json({ success: false, message: 'Could not clean up incomplete signup' });
  }
});

router.post('/set-role', async (req, res) => {
  try {
    const { uid, role } = req.body;

    if (!uid || !role) {
      return res.status(400).json({
        success: false,
        message: 'uid and role are required',
      });
    }

    // Validate role
    const validRoles = ['parent', 'student', 'teacher', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be one of: parent, student, teacher, admin',
      });
    }

    // Update role via Supabase admin API and users table
    await supabaseAdmin.auth.admin.updateUserById(uid, { user_metadata: { role } });
    await supabaseAdmin.from('users').update({ role }).eq('id', uid);

    console.log(`✅ Set role '${role}' for user ${uid}`);

    res.json({
      success: true,
      message: `Role '${role}' assigned successfully to user ${uid}`,
    });

  } catch (error) {
    console.error('❌ Error setting user role:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to set user role',
    });
  }
});

module.exports = router;

// TEMPORARY DEBUG ROUTE: /api/auth/debug/child/:authUid
// Returns results of multiple test queries to help diagnose missing tables/joins
router.get('/debug/child/:authUid', async (req, res) => {
  const authUid = String(req.params.authUid || '').trim();
  if (!authUid) return res.status(400).json({ success: false, message: 'authUid required' });

  const results = {};
  try {
    // Plain select from children
    const plain = await supabaseAdmin.from('children').select('id, name, auth_uid, grade_level').eq('auth_uid', authUid).maybeSingle();
    results.childrenPlain = { data: plain.data || null, error: plain.error ? String(plain.error.message || plain.error) : null, code: plain.error?.code };

    // Select with child_progress join
    const withJoin = await supabaseAdmin.from('children').select('id, name, child_progress(*)').eq('auth_uid', authUid).maybeSingle();
    results.childrenWithJoin = { data: withJoin.data || null, error: withJoin.error ? String(withJoin.error.message || withJoin.error) : null, code: withJoin.error?.code };

    // If we have an id, fetch progress directly
    if (plain.data && plain.data.id) {
      const progress = await supabaseAdmin.from('child_progress').select('*').eq('child_id', plain.data.id).order('updated_at', { ascending: false });
      results.progressDirect = { count: Array.isArray(progress.data) ? progress.data.length : 0, error: progress.error ? String(progress.error.message || progress.error) : null };
    }

    return res.json({ success: true, authUid, results });
  } catch (err) {
    console.error('[auth/debug] error', err);
    return res.status(500).json({ success: false, message: String(err?.message || err) });
  }
});
