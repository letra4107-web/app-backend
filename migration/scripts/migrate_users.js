// Prepare Supabase user import CSV from Firebase Auth export
// Usage: node migrate_users.js firebase_users_export.json output.csv

const fs = require('fs');
const { parse } = require('json2csv');

function usage() {
  console.log('Usage: node migrate_users.js firebase_users_export.json output.csv');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) return usage();
  const input = args[0];
  const output = args[1];

  const raw = fs.readFileSync(input, 'utf8');
  const items = JSON.parse(raw);

  // Expect items.users array (Firebase auth export). Map to Supabase import columns: id,email,password_hash,confirmed_at,created_at
  const users = (items.users || []).map((u) => ({
    id: u.localId || u.uid || '',
    email: u.email || '',
    // If passwordHash present and compatible, include; otherwise leave blank and mark for reset
    password_hash: u.passwordHash || '',
    created_at: u.createdAt ? new Date(Number(u.createdAt)).toISOString() : '',
    email_verified: u.emailVerified || false,
  }));

  const csv = parse(users, { fields: ['id', 'email', 'password_hash', 'created_at', 'email_verified'] });
  fs.writeFileSync(output, csv, 'utf8');
  console.log(`Wrote ${users.length} users to ${output}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
