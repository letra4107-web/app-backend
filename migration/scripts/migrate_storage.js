// Migrate files from Google Cloud Storage (Firebase Storage) to Supabase Storage
// Requires: GOOGLE_APPLICATION_CREDENTIALS set to service account JSON, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars
// Usage: node migrate_storage.js <source-bucket> <target-bucket> [prefix]

const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const storage = new Storage();

async function migrate(sourceBucketName, targetBucketName, prefix = '') {
  const sourceBucket = storage.bucket(sourceBucketName);
  const [files] = await sourceBucket.getFiles({ prefix });
  console.log(`Found ${files.length} files in ${sourceBucketName}/${prefix}`);

  for (const file of files) {
    try {
      const tmpPath = path.join('/tmp', path.basename(file.name));
      await file.download({ destination: tmpPath });
      const metadata = (await file.getMetadata())[0];
      const fileBuffer = fs.readFileSync(tmpPath);
      const uploadPath = file.name.replace(/^\//, '');
      const { error } = await supabase.storage.from(targetBucketName).upload(uploadPath, fileBuffer, { contentType: metadata.contentType });
      if (error) {
        console.error('Upload error for', file.name, error.message || error);
      } else {
        console.log('Uploaded', file.name, '->', uploadPath);
      }
      fs.unlinkSync(tmpPath);
    } catch (e) {
      console.error('Error migrating file', file.name, e.message || e);
    }
  }
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: node migrate_storage.js <source-bucket> <target-bucket> [prefix]');
  process.exit(1);
}

migrate(args[0], args[1], args[2] || '').then(() => console.log('Migration complete')).catch((e) => { console.error(e); process.exit(1); });
