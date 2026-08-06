const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(url, key);
(async () => {
  const cols = ['content_id', 'recommendation_reason', 'recommendation_id', 'xp_awarded'];
  for (const col of cols) {
    try {
      const res = await supabase.from('word_of_day_log').select(col).limit(1);
      console.log('col', col, 'status', res.error ? 'ERROR' : 'OK', res.error ? res.error.message : 'exists');
    } catch (err) {
      console.error('col', col, 'threw', err);
    }
  }
  try {
    const sample = await supabase.from('word_of_day_log').select('id,child_id,word,date,correct,attempts,content_id,recommendation_reason,xp_awarded').limit(1);
    console.log('row select status', sample.error ? 'ERROR' : 'OK', sample.error ? sample.error.message : sample.data);
  } catch (err) {
    console.error('row select threw', err);
  }
})();
