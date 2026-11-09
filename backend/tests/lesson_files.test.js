const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { PDFDocument } = require('pdf-lib');
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
process.env.EMAIL_USER = 'test@example.com';
process.env.EMAIL_PASS = 'test-password';
const { prepareLessonPdf, validateLessonFile, MAX_FILE_BYTES } = require('../services/lessonFilePreview');
const { createLessonFilesRouter } = require('../routes/lessonFiles');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const jpg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRQBAwQEBQQFCQUFCRQNCw0UFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFP/AABEIAAEAAQMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AO9r+HD+xT//2Q==', 'base64');
const office = Buffer.concat([Buffer.from([80, 75, 3, 4]), Buffer.from('[Content_Types].xml word/document.xml')]);
const file = (originalname, buffer) => ({ originalname, buffer });

test('images become readable PDFs and disguised/empty/unsupported files are rejected', async () => {
  const result = await prepareLessonPdf(file('larawan.PNG', png));
  assert.equal((await PDFDocument.load(result)).getPageCount(), 1);
  const slab = Buffer.alloc(2048); jpg.copy(slab, 13);
  const jpegResult = await prepareLessonPdf(file('photo.jpg', slab.subarray(13, 13 + jpg.length)));
  assert.equal((await PDFDocument.load(jpegResult)).getPageCount(), 1);
  for (const input of [file('bad.png', Buffer.from('wrong')), file('bad.docx', png), file('video.mp4', png), file('empty.pdf', Buffer.alloc(0)), file('huge.png', Buffer.alloc(MAX_FILE_BYTES + 1))]) {
    assert.throws(() => validateLessonFile(input), { status: 400 });
  }
});

test('Office conversion uses isolated paths and always cleans up on success, failure and timeout', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = Buffer.from(await pdf.save());
  for (const mode of ['ok', 'timeout', 'missing', 'corrupt', 'no-output']) {
    let directory;
    const run = async (binary, args, options) => {
      assert.equal(binary, 'test-converter'); assert.equal(options.timeout, 60000);
      directory = args[args.indexOf('--outdir') + 1];
      assert.equal(path.basename(args.at(-1)), 'lesson.docx');
      assert.ok(args[0].startsWith('-env:UserInstallation=file:'));
      const profile = await fs.readFile(path.join(directory, 'profile/user/registrymodifications.xcu'), 'utf8');
      assert.match(profile, /MacroSecurityLevel.*<value>3<\/value>/);
      if (mode === 'timeout') throw Object.assign(new Error('timeout'), { killed: true });
      if (mode === 'missing') throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      if (mode !== 'no-output') await fs.writeFile(path.join(directory, 'lesson.pdf'), mode === 'corrupt' ? Buffer.from('corrupt') : bytes);
    };
    const operation = prepareLessonPdf(file('../../evil.docx', office), { run, binary: 'test-converter' });
    if (mode === 'ok') assert.deepEqual(await operation, bytes);
    else await assert.rejects(operation, { status: mode === 'missing' ? 503 : 422 });
    await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
  }
});

function client(role) {
  return { auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id: 'teacher-1', user_metadata: { role: 'teacher' } } : null } }) },
    from: table => { assert.equal(table, 'users'); return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { role } }) }; } };
}
async function server(options, fn) {
  const app = express(); app.use('/api/lesson-files', createLessonFilesRouter(options));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}/api/lesson-files/prepare`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
function request(url, token = 'valid', name = 'image.png', buffer = png) {
  const form = new FormData(); form.append('file', new Blob([buffer]), name);
  return fetch(url, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
}
test('multipart endpoint validates stored teacher role, returns binary preview and rejects extra files', async () => {
  await server({ client: client('student') }, async url => {
    assert.equal((await request(url)).status, 403);
    assert.equal((await request(url, null)).status, 401);
    assert.equal((await request(url, 'expired')).status, 401);
  });
  await server({ client: client('teacher') }, async url => {
    const response = await request(url); assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal((await PDFDocument.load(await response.arrayBuffer())).getPageCount(), 1);
    assert.equal((await request(url, 'valid', 'fake.docx', png)).status, 400);
    const form = new FormData(); for (const name of ['a.png', 'b.png']) form.append('file', new Blob([png]), name);
    assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer valid' }, body: form })).status, 400);
  });
});
test('conversion capacity is bounded and released after failed requests', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let calls = 0;
  await server({ client: client('teacher'), maxConcurrent: 1, convert: async () => { calls++; started(); await held; throw new Error('conversion failed'); } }, async url => {
    const first = request(url); await ready;
    assert.equal((await request(url)).status, 429); release();
    assert.equal((await first).status, 503);
    assert.equal((await request(url)).status, 503); assert.equal(calls, 2);
  });
});
