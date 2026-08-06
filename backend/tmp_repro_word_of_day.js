const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const fetch = require('node-fetch');

dotenv.config({ path: './.env' });

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const email = process.env.LINAW_E2E_STUDENT_EMAIL;
const password = process.env.LINAW_E2E_STUDENT_PASSWORD;
const backendUrl = 'http://127.0.0.1:5002/api';

if (!url || !anon || !email || !password) {
  console.error('Missing required env variables');
  process.exit(1);
}

const supabase = createClient(url, anon);

(async () => {
  console.log('Signing in as', email);
  const signIn = await supabase.auth.signInWithPassword({ email, password });
  console.log('signIn error', signIn.error ? signIn.error.message : null);
  if (signIn.error) process.exit(1);
  const token = signIn.data.session?.access_token;
  if (!token) {
    console.error('No access token');
    process.exit(1);
  }
  const { data: user, error: userError } = await supabase.auth.getUser(token);
  console.log('user error', userError ? userError.message : null);
  console.log('user id', user?.user?.id);

  const { data: child, error: childError } = await supabase
    .from('children')
    .select('id,auth_uid,parent_id,name,grade_level')
    .eq('auth_uid', user.user.id)
    .maybeSingle();
  console.log('child error', childError ? childError.message : null);
  console.log('child', child);

  if (!child) {
    console.error('No child found');
    process.exit(1);
  }

  const call = async (path, body) => {
    const res = await fetch(`${backendUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log('REQUEST', path, body, 'STATUS', res.status, 'BODY', text);
    return { status: res.status, body: text };
  };

  const response = await call('/speech/word-of-day-result', {
    transcript: 'test',
    childId: child.id,
    durationSeconds: 4,
  });
  process.exit(0);
})().catch((error) => {
  console.error('SCRIPT ERROR', error);
  process.exit(1);
});
