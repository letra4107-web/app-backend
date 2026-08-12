// Probes the live Supabase schema at boot against the set of tables, columns,
// and RPC functions the app code actually depends on, and warns loudly if
// anything is missing - so a schema drift (a migration file committed but
// never run against production, see DEPLOYMENT.md) surfaces in the deploy
// log immediately instead of waiting for a specific feature to hard-fail in
// front of a real user, the way word_of_day_log.accuracy did.
//
// This list is a snapshot from the 2026-08-08 migration audit, not a
// generic schema dump - it only includes objects with a real code
// dependency, found via grep against src/ and backend/. Extend it when a
// migration adds something a route or service will read/write.
//
// Deliberately excluded: RLS policies (not introspectable over PostgREST)
// and the six auth/settings trigger functions (handle_new_auth_user,
// touch_*_updated_at, handle_new_auth_user_settings) - PostgREST never
// exposes RETURNS TRIGGER functions as callable RPCs, so a probe here would
// always read "missing" regardless of whether they exist. Verify those
// manually in the SQL editor:
//   SELECT proname FROM pg_proc WHERE proname IN
//     ('handle_new_auth_user', 'touch_parent_updated_at',
//      'touch_activities_updated_at', 'touch_lessons_updated_at',
//      'touch_settings_updated_at', 'handle_new_auth_user_settings');

const TABLES = [
  'users', 'children', 'otp_sessions', 'reading_activities', 'teacher_uploads',
  'child_progress', 'word_of_day_log', 'teacher_messages', 'notifications', 'child_credentials',
  'parents', 'parents_settings', 'student_settings', 'activities', 'lessons',
  'pronunciation_practice_sessions', 'scheduled_activities', 'lesson_progress',
  'word_definitions', 'words', 'phoneme_confusion',
  'personalization_recommendations', 'personalization_recommendation_words', 'personalization_recommendation_outcomes',
  'reading_content', 'reading_level_requirements', 'student_content_attempts', 'student_content_completions',
  'student_reading_level_overrides',
  'reading_modules', 'reading_module_items', 'reading_module_prerequisites',
  'reading_module_assessments', 'reading_module_assessment_items',
  'student_module_assessment_attempts', 'student_module_assessment_responses',
  'student_module_completions', 'student_equipped_modules',
];

const COLUMNS = {
  child_progress: ['word_count', 'longest_streak', 'baseline_accuracy', 'accuracy_sum', 'activities_completed'],
  word_of_day_log: ['xp_awarded', 'content_id', 'recommendation_id', 'recommendation_reason'],
  pronunciation_practice_sessions: [
    'is_correct', 'duration_seconds', 'word_id', 'difficulty_level_at_attempt', 'practice_source',
    'attempts', 'confidence_score', 'recommendation_reason',
  ],
  parents_settings: ['speech_rate', 'show_accuracy_score', 'auto_read_words'],
  student_settings: ['speech_rate', 'show_accuracy_score', 'auto_read_words'],
  personalization_recommendation_words: ['content_id'],
};

// RPC probes intentionally use arguments that are well-typed but reference
// nothing real, so a genuinely-present function returns a business-logic
// error (proof it exists) rather than "could not find the function"
// (PGRST202, the only signal that actually means missing).
const FUNCTIONS = [
  ['complete_word_of_day_attempt', { p_child_id: 'schema-health-check-probe', p_accuracy: 1, p_is_correct: false }],
  ['complete_personalized_word_of_day_attempt', { p_child_id: 'schema-health-check-probe', p_accuracy: 1, p_is_correct: false }],
  ['get_student_reading_progress', { p_student_id: '00000000-0000-0000-0000-000000000000' }],
  ['record_student_content_attempt', { p_student_id: '00000000-0000-0000-0000-000000000000', p_content_id: '00000000-0000-0000-0000-000000000000', p_accuracy: 1 }],
  ['get_student_module_level', { p_student_id: '00000000-0000-0000-0000-000000000000' }],
  ['get_student_module_path', { p_student_id: '00000000-0000-0000-0000-000000000000' }],
  ['get_reading_module_content', { p_student_id: '00000000-0000-0000-0000-000000000000', p_module_id: '00000000-0000-0000-0000-000000000000' }],
  ['start_module_assessment', { p_student_id: '00000000-0000-0000-0000-000000000000', p_assessment_id: '00000000-0000-0000-0000-000000000000' }],
  ['submit_module_assessment', { p_student_id: '00000000-0000-0000-0000-000000000000', p_attempt_id: '00000000-0000-0000-0000-000000000000', p_responses: [] }],
  ['equip_student_module', { p_student_id: '00000000-0000-0000-0000-000000000000', p_module_id: '00000000-0000-0000-0000-000000000000', p_slot_number: 1 }],
  ['unequip_student_module', { p_student_id: '00000000-0000-0000-0000-000000000000', p_module_id: '00000000-0000-0000-0000-000000000000' }],
];

const isMissingFunctionError = (error) =>
  error?.code === 'PGRST202' || /could not find (the )?function/i.test(error?.message || '');

const isMissingTableOrColumnError = (error) =>
  !!error && (error.code === 'PGRST205' || error.code === '42P01' || error.code === '42703' || error.code === 'PGRST204');

async function runSchemaHealthCheck(supabaseAdmin) {
  const missing = [];

  await Promise.all(TABLES.map(async (table) => {
    const { error } = await supabaseAdmin.from(table).select('*').limit(0);
    if (isMissingTableOrColumnError(error)) missing.push(`table "${table}" (${error.code}: ${error.message})`);
  }));

  await Promise.all(Object.entries(COLUMNS).flatMap(([table, columns]) =>
    columns.map(async (column) => {
      const { error } = await supabaseAdmin.from(table).select(column).limit(1);
      if (isMissingTableOrColumnError(error)) missing.push(`column "${table}.${column}" (${error.code}: ${error.message})`);
    })
  ));

  await Promise.all(FUNCTIONS.map(async ([fn, params]) => {
    const { error } = await supabaseAdmin.rpc(fn, params);
    if (isMissingFunctionError(error)) missing.push(`function "${fn}()" (${error.code}: ${error.message})`);
  }));

  if (missing.length) {
    console.warn('='.repeat(72));
    console.warn('[SchemaHealthCheck] SCHEMA DRIFT DETECTED - the live database is');
    console.warn('missing objects the app code depends on. A migration file was likely');
    console.warn('committed but never run in the Supabase SQL editor - see DEPLOYMENT.md.');
    missing.forEach((item) => console.warn(`  - MISSING ${item}`));
    console.warn('='.repeat(72));
  } else {
    console.log('[SchemaHealthCheck] OK - all audited tables, columns, and functions are present.');
  }

  return missing;
}

module.exports = { runSchemaHealthCheck };
