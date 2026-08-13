const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

const ACTIVITY_TYPES = ['reading_lesson', 'practice', 'reminder', 'appointment'];
const STATUSES = ['scheduled', 'in_progress', 'completed', 'missed'];

const bearerTokenFrom = (authorization = '') => {
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const getRequester = async (req) => {
  const token = bearerTokenFrom(req.headers.authorization);
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();
  return { id: data.user.id, role: profile?.role || data.user.user_metadata?.role };
};

const getChild = async (childId) => {
  const { data, error } = await supabaseAdmin
    .from('children')
    .select('id,parent_id,auth_uid')
    .eq('id', childId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

const canViewChildSchedule = (requester, child) => requester && child && (
  (requester.role === 'parent' && child.parent_id === requester.id) ||
  (requester.role === 'student' && child.auth_uid === requester.id) ||
  requester.role === 'teacher' ||
  requester.role === 'admin'
);

const canManageActivity = (requester, child, activity) => {
  if (!requester || !child || !activity) return false;
  if (requester.role === 'admin') return true;
  if (requester.role === 'parent') {
    return child.parent_id === requester.id && activity.created_by === 'parent';
  }
  if (requester.role === 'teacher') {
    return activity.created_by === 'teacher' && activity.created_by_auth_uid === requester.id;
  }
  return false;
};

router.get('/', async (req, res) => {
  try {
    const requester = await getRequester(req);
    if (!requester) return res.status(401).json({ success: false, message: 'Authentication is required.' });
    const childId = String(req.query.childId || '').trim();
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();

    if (!childId) {
      return res.status(400).json({ success: false, message: 'childId is required.' });
    }
    const child = await getChild(childId);
    if (!canViewChildSchedule(requester, child)) {
      return res.status(403).json({ success: false, message: 'You cannot view this child calendar.' });
    }

    let query = supabaseAdmin
      .from('scheduled_activities')
      .select('*')
      .eq('child_id', childId)
      .order('scheduled_date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: true });

    if (startDate) query = query.gte('scheduled_date', startDate);
    if (endDate) query = query.lte('scheduled_date', endDate);
    if (requester.role === 'teacher') {
      query = query.eq('created_by', 'teacher').eq('created_by_auth_uid', requester.id);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[ScheduledActivities] fetch failed:', error.message || error);
      return res.status(500).json({ success: false, message: 'Failed to fetch scheduled activities.' });
    }

    return res.json({ success: true, activities: data || [] });
  } catch (error) {
    console.error('[ScheduledActivities] fetch threw:', error.message || error);
    return res.status(500).json({ success: false, message: 'Unable to load scheduled activities.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const requester = await getRequester(req);
    if (!requester) return res.status(401).json({ success: false, message: 'Authentication is required.' });
    const childId = String(req.body.childId || '').trim();
    const activityType = String(req.body.activityType || '').trim();
    const title = String(req.body.title || '').trim();
    const scheduledDate = String(req.body.scheduledDate || '').trim();

    if (!childId || !title || !scheduledDate) {
      return res.status(400).json({ success: false, message: 'childId, title, and scheduledDate are required.' });
    }
    if (!ACTIVITY_TYPES.includes(activityType)) {
      return res.status(400).json({ success: false, message: `activityType must be one of: ${ACTIVITY_TYPES.join(', ')}` });
    }
    const child = await getChild(childId);
    const parentOwnsChild = requester.role === 'parent' && child?.parent_id === requester.id;
    if (!parentOwnsChild && requester.role !== 'teacher' && requester.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'You cannot add an activity for this child.' });
    }
    const ownerType = requester.role === 'teacher' ? 'teacher' : requester.role === 'admin' ? 'system' : 'parent';

    const payload = {
      child_id: childId,
      created_by: ownerType,
      created_by_auth_uid: requester.id,
      activity_type: activityType,
      title,
      description: req.body.description || null,
      scheduled_date: scheduledDate,
      start_time: req.body.startTime || null,
      end_time: req.body.endTime || null,
      status: STATUSES.includes(req.body.status) ? req.body.status : 'scheduled',
    };

    const { data, error } = await supabaseAdmin.from('scheduled_activities').insert(payload).select().single();
    if (error) throw error;

    return res.json({ success: true, activity: data });
  } catch (error) {
    console.error('[ScheduledActivities] create failed:', error.message || error);
    return res.status(500).json({ success: false, message: 'Unable to create scheduled activity.' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const requester = await getRequester(req);
    if (!requester) return res.status(401).json({ success: false, message: 'Authentication is required.' });
    const { id } = req.params;
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('scheduled_activities')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return res.status(404).json({ success: false, message: 'Activity not found.' });
    const child = await getChild(existing.child_id);
    if (!canManageActivity(requester, child, existing)) {
      return res.status(403).json({ success: false, message: 'Only the activity owner can edit it.' });
    }
    const updates = {};

    if (req.body.title !== undefined) updates.title = String(req.body.title).trim();
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.scheduledDate !== undefined) updates.scheduled_date = req.body.scheduledDate;
    if (req.body.startTime !== undefined) updates.start_time = req.body.startTime;
    if (req.body.endTime !== undefined) updates.end_time = req.body.endTime;
    if (req.body.activityType !== undefined) {
      if (!ACTIVITY_TYPES.includes(req.body.activityType)) {
        return res.status(400).json({ success: false, message: `activityType must be one of: ${ACTIVITY_TYPES.join(', ')}` });
      }
      updates.activity_type = req.body.activityType;
    }
    if (req.body.status !== undefined) {
      if (!STATUSES.includes(req.body.status)) {
        return res.status(400).json({ success: false, message: `status must be one of: ${STATUSES.join(', ')}` });
      }
      updates.status = req.body.status;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, message: 'No valid fields to update.' });
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('scheduled_activities')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    return res.json({ success: true, activity: data });
  } catch (error) {
    console.error('[ScheduledActivities] update failed:', error.message || error);
    return res.status(500).json({ success: false, message: 'Unable to update scheduled activity.' });
  }
});

router.post('/:id/complete', async (req, res) => {
  try {
    const requester = await getRequester(req);
    if (!requester) return res.status(401).json({ success: false, message: 'Authentication is required.' });
    const { id } = req.params;
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('scheduled_activities')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return res.status(404).json({ success: false, message: 'Activity not found.' });
    const child = await getChild(existing.child_id);
    const studentOwnsRecord = requester.role === 'student' && child?.auth_uid === requester.id;
    if (!studentOwnsRecord && !canManageActivity(requester, child, existing)) {
      return res.status(403).json({ success: false, message: 'You cannot complete this activity.' });
    }
    const { data, error } = await supabaseAdmin
      .from('scheduled_activities')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    return res.json({ success: true, activity: data });
  } catch (error) {
    console.error('[ScheduledActivities] complete failed:', error.message || error);
    return res.status(500).json({ success: false, message: 'Unable to mark activity complete.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const requester = await getRequester(req);
    if (!requester) return res.status(401).json({ success: false, message: 'Authentication is required.' });
    const { id } = req.params;
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('scheduled_activities')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return res.status(404).json({ success: false, message: 'Activity not found.' });
    const child = await getChild(existing.child_id);
    if (!canManageActivity(requester, child, existing)) {
      return res.status(403).json({ success: false, message: 'Only the activity owner can delete it.' });
    }
    const { error } = await supabaseAdmin.from('scheduled_activities').delete().eq('id', id);
    if (error) throw error;

    return res.json({ success: true });
  } catch (error) {
    console.error('[ScheduledActivities] delete failed:', error.message || error);
    return res.status(500).json({ success: false, message: 'Unable to delete scheduled activity.' });
  }
});

module.exports = router;
