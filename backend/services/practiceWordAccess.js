// Match start_student_progress_event's module gate before offering a word.
// This only reads access state; it never issues attempts or grants completion.
async function availablePracticeWords(client, studentId, words) {
  const memberships = new Map();
  const activeModuleIds = new Set();
  for (const word of words) {
    const active = [];
    for (const item of word.reading_module_items || []) {
      if (!item.reading_modules || typeof item.reading_modules.is_active !== 'boolean') {
        throw new Error('Practice module access is unavailable.');
      }
      if (item.reading_modules.is_active) {
        active.push(item);
        if (item.role !== 'assessment') activeModuleIds.add(item.module_id);
      }
    }
    memberships.set(word, active);
  }
  const unlocked = new Set();
  await Promise.all([...activeModuleIds].map(async moduleId => {
    const { data, error } = await client.rpc('is_student_module_unlocked', {
      p_student_id: studentId, p_module_id: moduleId,
    });
    if (error || typeof data !== 'boolean') throw new Error('Practice module access is unavailable.');
    if (data) unlocked.add(moduleId);
  }));
  return words.filter(word => !word.is_assessment && (
    memberships.get(word).length === 0
    || memberships.get(word).some(item => item.role !== 'assessment' && unlocked.has(item.module_id))
  ));
}
module.exports = { availablePracticeWords };
