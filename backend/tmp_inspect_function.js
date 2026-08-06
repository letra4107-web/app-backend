const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: './.env' });
const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!url || !anon) { console.error('missing env'); process.exit(1); }
const supabase = createClient(url, anon);
(async () => {
  const name = 'complete_personalized_word_of_day_attempt';
  try {
    const res1 = await supabase.from('information_schema.routines').select('routine_name,routine_schema,specific_name').ilike('routine_name', `%${name}%`);
    console.log('routine query', res1.error, res1.data?.slice(0,10));
  } catch (e) { console.error('routine query threw', e); }
  try {
    const res2 = await supabase.from('pg_proc').select('proname,oid').ilike('proname', `%${name}%`);
    console.log('pg_proc query', res2.error, res2.data?.slice(0,10));
  } catch (e) { console.error('pg_proc query threw', e); }
})();
