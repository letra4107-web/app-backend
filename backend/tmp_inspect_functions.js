const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });
const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(url, anon);
(async () => {
  const tests = [
    { name: 'complete_personalized_word_of_day_attempt', params: { p_child_id: 'test', p_accuracy: 100, p_is_correct: true } },
    { name: 'get_student_reading_progress', params: { p_student_id: '00000000-0000-4000-0000-000000000000' } },
    { name: 'record_student_content_attempt', params: {
        p_student_id: '00000000-0000-4000-0000-000000000000',
        p_content_id: '00000000-0000-4000-0000-000000000000',
        p_accuracy: 100,
        p_transcript: 'test',
        p_duration_seconds: 5,
        p_is_full_submission: false,
        p_source: 'practice',
      }},
  ];
  for (const test of tests) {
    try {
      const res = await supabase.rpc(test.name, test.params);
      console.log(test.name, { status: 1, data: res.data, error: res.error ? { message: res.error.message, code: res.error.code, details: res.error.details } : null });
    } catch (err) {
      console.log(test.name, { status: 0, error: err && err.message ? err.message : err });
    }
  }
})();