// Real RLS regression tests in a fresh local PostgreSQL cluster.
// QA_TOOLS_DIR: installation containing embedded-postgres and pg.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (!process.env.QA_TOOLS_DIR) throw new Error('Set QA_TOOLS_DIR to the local QA tools installation.');
const require = createRequire(path.join(process.env.QA_TOOLS_DIR, 'package.json'));
const { default: EmbeddedPostgres } = await import(pathToFileURL(require.resolve('embedded-postgres')));
const { Client } = require('pg');
const listener = net.createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const cluster = new EmbeddedPostgres({
  databaseDir: path.join(root, '.qa', `postgres-${randomUUID()}`),
  port, persistent: true, password: randomUUID(),
  postgresFlags: ['-h', '127.0.0.1'], onLog() {}, onError() {},
});
let db;
let passed = 0;
const owner = randomUUID(), other = randomUUID(), student = randomUUID();
const published = randomUUID(), draft = randomUUID(), foreign = randomUUID();
async function asUser(id, role = 'teacher') {
  await db.query('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)", [id, JSON.stringify({ sub: id, user_metadata: { role } })]);
  await db.query('SET ROLE authenticated');
}
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
try {
  await cluster.initialise(); await cluster.start();
  db = new Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password: cluster.options.password });
  await db.connect();
  await db.query(`
    CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean);
    CREATE TABLE storage.objects(id uuid, bucket_id text);
    CREATE PUBLICATION supabase_realtime;
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, anon;
  `);
  await db.query(await fs.readFile(path.join(root, 'migration/migrations/006_lessons.sql'), 'utf8'));
  await db.query('INSERT INTO auth.users(id) VALUES ($1),($2),($3)', [owner, other, student]);
  await db.query(`INSERT INTO lessons(id,teacher_id,title,pdf_url,is_published) VALUES
    ($1,$4,'Published','published.pdf',true),($2,$4,'Draft','draft.pdf',false),($3,$5,'Other draft','other.pdf',false)`, [published, draft, foreign, owner, other]);
  await asUser(owner);
  await check('original policy reproduces permission error when making a draft', async () => {
    await assert.rejects(db.query('UPDATE lessons SET is_published=false WHERE id=$1', [published]), { code: '42501' });
  });
  await check('original delete silently affects zero rows', async () => {
    assert.equal((await db.query('DELETE FROM lessons WHERE id=$1', [published])).rowCount, 0);
  });
  await db.query('RESET ROLE');
  const migration = await fs.readFile(path.join(root, 'migration/migrations/055_teacher_lesson_management.sql'), 'utf8');
  await db.query(migration);
  await check('repair migration can be reapplied', async () => { await db.query(migration); });
  await asUser(owner);
  await check('owner sees published lessons and own drafts only', async () => {
    assert.deepEqual((await db.query('SELECT id FROM lessons ORDER BY id')).rows.map(row => row.id), [published, draft].sort());
  });
  await check('owner can move a published lesson to draft and receive confirmation', async () => {
    assert.deepEqual((await db.query('UPDATE lessons SET is_published=false WHERE id=$1 RETURNING id', [published])).rows, [{ id: published }]);
  });
  await check('owner can edit and republish a draft', async () => {
    assert.equal((await db.query("UPDATE lessons SET title='Edited',is_published=true WHERE id=$1 RETURNING id", [draft])).rowCount, 1);
  });
  await check('another teacher cannot read or mutate a foreign draft', async () => {
    await asUser(other);
    assert.equal((await db.query('SELECT id FROM lessons WHERE id=$1', [published])).rowCount, 0);
    assert.equal((await db.query('UPDATE lessons SET is_published=true WHERE id=$1 RETURNING id', [published])).rowCount, 0);
    assert.equal((await db.query('DELETE FROM lessons WHERE id=$1 RETURNING id', [published])).rowCount, 0);
  });
  await check('student sees published lessons only and cannot change or remove them', async () => {
    await asUser(student, 'student');
    assert.deepEqual((await db.query('SELECT id FROM lessons')).rows, [{ id: draft }]);
    assert.equal((await db.query('UPDATE lessons SET is_published=false WHERE id=$1 RETURNING id', [draft])).rowCount, 0);
    assert.equal((await db.query('DELETE FROM lessons WHERE id=$1 RETURNING id', [draft])).rowCount, 0);
  });
  await check('owner cannot transfer lesson ownership', async () => {
    await asUser(owner);
    await assert.rejects(db.query('UPDATE lessons SET teacher_id=$2 WHERE id=$1', [draft, other]), { code: '42501' });
  });
  await check('owner can remove a draft and a published lesson with confirmation', async () => {
    for (const id of [published, draft]) assert.deepEqual((await db.query('DELETE FROM lessons WHERE id=$1 RETURNING id', [id])).rows, [{ id }]);
  });
  await check('anonymous users cannot see or remove drafts', async () => {
    await db.query('RESET ROLE'); await db.query('SET ROLE anon');
    assert.equal((await db.query('SELECT id FROM lessons')).rowCount, 0);
    assert.equal((await db.query('DELETE FROM lessons RETURNING id')).rowCount, 0);
  });
  await db.query('RESET ROLE');
  assert.deepEqual((await db.query('SELECT id FROM lessons')).rows, [{ id: foreign }]);
  console.log(`${passed} real PostgreSQL cases passed; no production data changed.`);
} finally {
  if (db) await db.end();
  if (cluster.process) await cluster.stop();
}
