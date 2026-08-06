const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config({ path: './.env' });
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY');
  process.exit(1);
}
const supabase = createClient(url, key);

const show = async (label, promise) => {
  try {
    const res = await promise;
    console.log(label, JSON.stringify(res, null, 2));
  } catch (err) {
    console.log(label, 'ERROR', err && err.message ? err.message : err);
  }
};

(async () => {
  await show('rpc complete_personalized_word_of_day_attempt', supabase.rpc('complete_personalized_word_of_day_attempt', { p_child_id: 'abc', p_accuracy: 100, p_is_correct: true }));
  await show('rpc complete_word_of_day_attempt', supabase.rpc('complete_word_of_day_attempt', { p_child_id: 'abc', p_accuracy: 100, p_is_correct: true }));
  await show('columns word_of_day_log', supabase.from('information_schema.columns').select('table_schema, table_name, column_name, is_nullable, data_type').eq('table_name', 'word_of_day_log'));
  await show('columns pronunciation_practice_sessions', supabase.from('information_schema.columns').select('table_schema, table_name, column_name, is_nullable, data_type').eq('table_name', 'pronunciation_practice_sessions'));
  await show('columns student_content_attempts', supabase.from('information_schema.columns').select('table_schema, table_name, column_name, is_nullable, data_type').eq('table_name', 'student_content_attempts'));
})();