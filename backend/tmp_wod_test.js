const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(url, key);

(async () => {
  const email = process.env.LINAW_E2E_STUDENT_EMAIL;
  const password = process.env.LINAW_E2E_STUDENT_PASSWORD;
  if (!email || !password) {
    console.error('Missing env values');
    process.exit(1);
  }
  const auth = await supabase.auth.signInWithPassword({ email, password });
  if (auth.error) {
    console.error('Auth error:', auth.error.message);
    process.exit(1);
  }
  const childRes = await supabase.from('children').select('id,auth_uid').eq('auth_uid', auth.data.user.id).maybeSingle();
  console.log('childRes', childRes);
  if (!childRes.data) process.exit(1);
  const childId = childRes.data.id;
  const today = new Date().toISOString().slice(0, 10);
  const upsert = await supabase.from('word_of_day_log').upsert({ child_id: childId, word: 'test', date: today, attempts: 0, correct: false }, { onConflict: ['child_id', 'date'], ignoreDuplicates: false }).select().maybeSingle();
  console.log('upsert', upsert);
  const direct = await supabase.rpc('complete_word_of_day_attempt', { p_child_id: childId, p_accuracy: 95, p_is_correct: true });
  console.log('complete_word_of_day_attempt', direct);
  const personalized = await supabase.rpc('complete_personalized_word_of_day_attempt', { p_child_id: childId, p_accuracy: 95, p_is_correct: true });
  console.log('complete_personalized_word_of_day_attempt', personalized);
})();