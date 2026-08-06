// Seeds public.words from Tagalog_Phonetic_Words_Dyslexia_App_Updated.xlsx.
// Safe to re-run: fetches existing (word, level) pairs first and only
// inserts rows that don't already exist.
//
// Usage: node scripts/seedWords.js [--dry-run]

const path = require('path');
const XLSX = require('xlsx');
const { supabaseAdmin } = require('../config/supabase');

const FILE_PATH = path.join(__dirname, 'Tagalog_Phonetic_Words_Dyslexia_App_Updated.xlsx');
const SHEET_TO_LEVEL = {
  'Level 1 Simple': 'beginner',
  'Level 2 Intermediate': 'intermediate',
  'Level 3 Advanced': 'advanced',
};

const VOWELS = 'aeiou';
const DIPHTHONGS = ['aw', 'ay', 'iw', 'oy', 'uy', 'ey'];
// Client-approved correction to the workbook: "shorts" is an accidental
// English entry, not a curriculum word. Keep the source workbook unchanged
// for auditability while ensuring reruns never seed the rejected row.
const CLIENT_DATA_EXCLUSIONS = new Set(['shorts|beginner']);

const countSyllables = (word) => {
  const w = word.toLowerCase();
  let count = 0;
  let i = 0;
  while (i < w.length) {
    if (VOWELS.includes(w[i])) {
      const pair = w.slice(i, i + 2);
      if (DIPHTHONGS.includes(pair)) {
        count += 1;
        i += 2;
        continue;
      }
      count += 1;
    }
    i += 1;
  }
  return Math.max(1, count);
};

const hasDiphthong = (word) => {
  const w = word.toLowerCase();
  return DIPHTHONGS.some((d) => w.includes(d));
};

const hasConsonantCluster = (word) => {
  // "ng" is one Filipino phoneme, not a cluster - collapse it first so it
  // doesn't get counted as two consonants in a row.
  const w = word.toLowerCase().replace(/ng/g, 'N');
  return /[bcdfghjklmpqrstvwxyz]{2,}/.test(w);
};

const readWordRows = () => {
  const workbook = XLSX.readFile(FILE_PATH);
  const rows = [];
  Object.entries(SHEET_TO_LEVEL).forEach(([sheetName, level]) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      throw new Error(`Expected sheet "${sheetName}" not found in ${FILE_PATH}. Sheets present: ${workbook.SheetNames.join(', ')}`);
    }
    const sheetRows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    sheetRows.forEach((row) => {
      const word = String(row['Word (Salita)'] || '').trim().toLowerCase();
      if (!word) return;
      rows.push({
        word,
        level,
        syllable_count: countSyllables(word),
        has_diphthong: hasDiphthong(word),
        has_consonant_cluster: hasConsonantCluster(word),
      });
    });
  });
  return rows.filter((row) => !CLIENT_DATA_EXCLUSIONS.has(`${row.word}|${row.level}`));
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const rows = readWordRows();
  console.log(`Read ${rows.length} word rows from ${path.basename(FILE_PATH)}.`);

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('words')
    .select('word, level');
  if (fetchError) {
    throw new Error(`Could not fetch existing words: ${fetchError.message || fetchError}`);
  }

  const existingKeys = new Set((existing || []).map((row) => `${row.word}|${row.level}`));
  const toInsert = rows.filter((row) => !existingKeys.has(`${row.word}|${row.level}`));
  const skipped = rows.length - toInsert.length;

  console.log(`${toInsert.length} new rows to insert, ${skipped} already present (skipped).`);

  const byLevel = toInsert.reduce((acc, row) => {
    acc[row.level] = (acc[row.level] || 0) + 1;
    return acc;
  }, {});
  console.log('By level:', byLevel);

  if (dryRun) {
    console.log('--dry-run: no rows written.');
    return;
  }

  if (!toInsert.length) {
    console.log('Nothing to insert.');
    return;
  }

  const BATCH_SIZE = 200;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const { error: insertError } = await supabaseAdmin.from('words').insert(batch);
    if (insertError) {
      throw new Error(`Insert failed on batch starting at row ${i}: ${insertError.message || insertError}`);
    }
    console.log(`Inserted rows ${i + 1}-${i + batch.length}.`);
  }

  console.log('Done.');
}

main().catch((error) => {
  console.error('[seedWords] Failed:', error.message || error);
  process.exitCode = 1;
});
