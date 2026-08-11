const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

const isMissingColumnError = (error, column) =>
  error?.code === 'PGRST204' &&
  String(error?.message || '').includes(`'${column}'`);

const normalizeNotification = (row = {}) => ({
  ...row,
  title: row.title || 'Notification',
  body: row.body || row.message || '',
  message: row.message || row.body || '',
  read: Boolean(row.read ?? row.is_read),
  is_read: Boolean(row.is_read ?? row.read),
  created_at: row.created_at || new Date().toISOString(),
});

const mergeNotifications = (...groups) => {
  const byId = new Map();
  groups.flat().filter(Boolean).forEach((row) => byId.set(String(row.id), row));
  return [...byId.values()].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
  );
};

const fetchNotificationsForUser = async (userId) => {
  const select = '*';
  const order = { ascending: false };

  let result = await supabaseAdmin
    .from('notifications')
    .select(select)
    .or(`parent_id.eq.${userId},user_id.eq.${userId}`)
    .order('created_at', order);

  if (!result.error) {
    // A parent must also see rows addressed only to an enrolled student. This
    // includes historical student notifications created before parent_id was
    // attached to every new row.
    const { data: children, error: childrenError } = await supabaseAdmin
      .from('children')
      .select('id, auth_uid')
      .eq('parent_id', userId);

    if (childrenError || !children?.length) return result;

    const childIds = children.map((child) => child.id).filter(Boolean);
    const childAuthUids = children.map((child) => child.auth_uid).filter(Boolean);
    const childQueries = [];

    if (childAuthUids.length) {
      childQueries.push(
        supabaseAdmin.from('notifications').select(select).in('user_id', childAuthUids).order('created_at', order),
      );
    }
    if (childIds.length) {
      childQueries.push(
        supabaseAdmin.from('notifications').select(select).in('student_id', childIds).order('created_at', order),
      );
    }

    const childResults = await Promise.all(childQueries);
    const childError = childResults.find((childResult) => childResult.error)?.error;
    if (childError) return { data: null, error: childError };

    return {
      data: mergeNotifications(result.data || [], ...childResults.map((childResult) => childResult.data || [])),
      error: null,
    };
  }

  const message = String(result.error?.message || '').toLowerCase();
  const missingParentId = isMissingColumnError(result.error, 'parent_id') || message.includes('parent_id');
  const missingUserId = isMissingColumnError(result.error, 'user_id') || message.includes('user_id');

  if (missingParentId && !missingUserId) {
    return supabaseAdmin.from('notifications').select(select).eq('user_id', userId).order('created_at', order);
  }

  if (missingUserId && !missingParentId) {
    return supabaseAdmin.from('notifications').select(select).eq('parent_id', userId).order('created_at', order);
  }

  return result;
};

const stripMissingColumn = (payload, error) => {
  const message = String(error?.message || '');
  return Object.keys(payload).find((key) => message.includes(`'${key}'`) || message.includes(key));
};

router.get('/', async (req, res) => {
  try {
    const userId = String(req.query.userId || req.query.parentId || '').trim();
    if (!userId) {
      return res.json({ success: true, notifications: [], message: 'No userId provided.' });
    }

    const { data, error } = await fetchNotificationsForUser(userId);

    if (error) {
      console.error('[Notifications] fetch failed:', error.message || error);
      return res.status(500).json({ success: false, message: 'Failed to fetch notifications.' });
    }

    return res.json({ success: true, notifications: (data || []).map(normalizeNotification) });
  } catch (error) {
    console.error('[Notifications] fetch threw:', error.message || error);
    return res.status(500).json({ success: false, notifications: [], message: 'Unable to load notifications.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = {
      user_id: req.body.user_id || req.body.userId || req.body.parent_id || req.body.parentId,
      student_id: req.body.student_id || req.body.studentId || null,
      parent_id: req.body.parent_id || req.body.parentId || null,
      title: String(req.body.title || '').trim(),
      body: req.body.body || req.body.message || '',
      message: req.body.message || req.body.body || '',
      type: req.body.type || null,
      is_read: req.body.is_read ?? false,
      read: req.body.read ?? false,
    };

    if (!payload.user_id || !payload.title) {
      return res.status(400).json({ success: false, message: 'user_id and title are required.' });
    }

    let retryPayload = { ...payload };
    let data = null;
    let error = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await supabaseAdmin.from('notifications').insert(retryPayload).select('*').single();
      data = result.data;
      error = result.error;

      const missingColumn = error && stripMissingColumn(retryPayload, error);
      if (!missingColumn) break;

      delete retryPayload[missingColumn];
    }

    if (error) {
      console.error('[Notifications] insert failed:', error.message || error);
      return res.status(500).json({ success: false, message: 'Failed to create notification.' });
    }

    return res.status(201).json({ success: true, notification: normalizeNotification(data) });
  } catch (error) {
    console.error('[Notifications] insert threw:', error.message || error);
    return res.status(500).json({ success: false, message: 'Unable to create notification.' });
  }
});

router.patch('/:id/read', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ success: false, message: 'notification id is required.' });
    }

    let { error } = await supabaseAdmin
      .from('notifications')
      .update({ read: true, is_read: true })
      .eq('id', id);

    if (error && isMissingColumnError(error, 'is_read')) {
      const retry = await supabaseAdmin.from('notifications').update({ read: true }).eq('id', id);
      error = retry.error;
    }

    if (error) {
      console.error('[Notifications] mark read failed:', error.message || error);
      return res.status(500).json({ success: false, message: 'Failed to update notification.' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('[Notifications] mark read threw:', error.message || error);
    return res.status(500).json({ success: false, message: 'Unable to update notification.' });
  }
});

module.exports = router;
