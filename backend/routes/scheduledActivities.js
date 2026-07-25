const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

const ACTIVITY_TYPES = ['reading_lesson', 'practice', 'reminder', 'appointment'];
const STATUSES = ['scheduled', 'in_progress', 'completed', 'missed'];

router.get('/', async (req, res) => {
  try {
    const childId = String(req.query.childId || '').trim();
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();

    if (!childId) {
      return res.status(400).json({ success: false, message: 'childId is required.' });
    }

    let query = supabaseAdmin
      .from('scheduled_activities')
      .select('*')
      .eq('child_id', childId)
      .order('scheduled_date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: true });

    if (startDate) query = query.gte('scheduled_date', startDate);
    if (endDate) query = query.lte('scheduled_date', endDate);

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

    const payload = {
      child_id: childId,
      created_by: ['parent', 'teacher', 'system'].includes(req.body.createdBy) ? req.body.createdBy : 'parent',
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
    const { id } = req.params;
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
    const { id } = req.params;
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
    const { id } = req.params;
    const { error } = await supabaseAdmin.from('scheduled_activities').delete().eq('id', id);
    if (error) throw error;

    return res.json({ success: true });
  } catch (error) {
    console.error('[ScheduledActivities] delete failed:', error.message || error);
    return res.status(500).json({ success: false, message: 'Unable to delete scheduled activity.' });
  }
});

module.exports = router;
