const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { authenticatedMobileUser, relatedChildren } = require('../middleware/mobileOwnership');

const router = express.Router();
router.use(authenticatedMobileUser);

const normalizeStatus = (deadline, status) => {
  if (status === 'completed' || status === 'completed_late') return status;
  const due = new Date(deadline);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (!Number.isNaN(due.getTime()) && due < endOfToday) return 'overdue';
  return 'pending';
};

router.get('/', async (req, res) => {
  try {
    const authUid = String(req.query.authUid || req.query.studentId || '').trim();
    const childId = String(req.query.childId || '').trim();
    const parentId = String(req.query.parentId || '').trim();
    const children = await relatedChildren(req.mobileUserId);
    const allowed = new Set([req.mobileUserId, ...children.flatMap(child => [child.id, child.auth_uid])]);
    if ((parentId && parentId !== req.mobileUserId) || (authUid && !allowed.has(authUid)) || (childId && !allowed.has(childId))) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    let studentIds = [];
    if (parentId) {
      const { data: children, error: childrenError } = await supabaseAdmin
        .from('children')
        .select('id,auth_uid')
        .eq('parent_id', parentId);

      if (childrenError) {
        console.error('[Activities] children lookup failed:', childrenError.message || childrenError);
        return res.status(500).json({ success: false, message: 'Failed to load child activities.' });
      }

      studentIds = (children || []).flatMap((child) => [child.id, child.auth_uid]).filter(Boolean);
    } else {
      studentIds = [authUid, childId].filter(Boolean);
    }

    studentIds = Array.from(new Set(studentIds));
    if (!studentIds.length) {
      return res.json({ success: true, activities: [] });
    }

    const { data, error } = await supabaseAdmin
      .from('activities')
      .select('id,title,description,deadline,subject,status,student_id')
      .in('student_id', studentIds)
      .order('deadline', { ascending: true });

    if (error) {
      console.error('[Activities] fetch failed:', error.message || error);
      return res.status(500).json({ success: false, message: 'Failed to fetch activities.' });
    }

    const activities = (data || []).map((row) => ({
      ...row,
      status: normalizeStatus(row.deadline, row.status),
    }));

    return res.json({ success: true, activities });
  } catch (error) {
    console.error('[Activities] fetch threw:', error.message || error);
    return res.status(500).json({ success: false, message: 'Unable to load activities.' });
  }
});

module.exports = router;
