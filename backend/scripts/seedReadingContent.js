// Validates the authoritative workbook against the unchanged 600-row words
// bank, then seeds canonical reading_content. Safe to re-run: source sheet/row
// is stable and upserted without replacing reading_content ids.
//
// Usage:
//   node scripts/seedReadingContent.js --validate-only
//   node scripts/seedReadingContent.js --dry-run
//   node scripts/seedReadingContent.js

const path = require('path');
const XLSX = require('xlsx');
const { supabaseAdmin } = require('../config/supabase');

const FILE_PATH = path.join(__dirname, 'Tagalog_Phonetic_Words_Dyslexia_App_Updated.xlsx');
const EXPECTED_COUNTS = Object.freeze({
  word: 600,
  phonetic: 200,
  phrase: 200,
  sentence: 200,
  paragraph: 20,
});

const WORD_SHEETS = Object.freeze({
  'Level 1 Simple': 'Beginner',
  'Level 2 Intermediate': 'Intermediate',
  'Level 3 Advanced': 'Advanced',
});

const ACTIVITY_SHEETS = Object.freeze({
  'Beginner Phonetics': { type: 'phonetic', level: 'Beginner', assessment: false },
  'Intermediate Phrases': { type: 'phrase', level: 'Intermediate', assessment: false },
  'Advanced Sentences': { type: 'sentence', level: 'Advanced', assessment: false },
  'Advanced Paragraphs': { type: 'paragraph', level: 'Advanced', assessment: true },
});

const normalizeText = (value) => String(value || '')
  .normalize('NFC')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('fil');

const readWorkbookRows = (filePath = FILE_PATH) => {
  const workbook = XLSX.readFile(filePath);
  const rows = [];

  Object.entries(WORD_SHEETS).forEach(([sheetName, level]) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`Missing required sheet: ${sheetName}`);
    const values = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    values.slice(1).forEach((row, index) => {
      const text = String(row[1] || '').trim();
      if (!text) return;
      rows.push({
        word_id: null,
        content_text: text,
        normalized_text: normalizeText(text),
        content_type: 'word',
        level,
        sequence_no: Number(row[0]) || index + 1,
        source_sheet: sheetName,
        source_row: index + 2,
        pattern_note: row[3] ? String(row[3]).trim() : null,
        backend_category: `${level.toLowerCase()}_word`,
        is_assessment: false,
        is_active: true,
      });
    });
  });

  Object.entries(ACTIVITY_SHEETS).forEach(([sheetName, config]) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`Missing required sheet: ${sheetName}`);
    const values = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    values.slice(3).forEach((row, index) => {
      const text = String(row[1] || '').trim();
      if (!text) return;
      rows.push({
        word_id: null,
        content_text: text,
        normalized_text: normalizeText(text),
        content_type: config.type,
        level: config.level,
        sequence_no: Number(row[0]) || index + 1,
        source_sheet: sheetName,
        source_row: index + 4,
        pattern_note: row[4] ? String(row[4]).trim() : null,
        backend_category: row[5] ? String(row[5]).trim() : null,
        is_assessment: config.assessment,
        is_active: true,
      });
    });
  });

  return rows;
};

const validateWorkbookRows = (rows) => {
  const counts = rows.reduce((result, row) => {
    result[row.content_type] = (result[row.content_type] || 0) + 1;
    return result;
  }, {});
  Object.entries(EXPECTED_COUNTS).forEach(([type, expected]) => {
    if ((counts[type] || 0) !== expected) {
      throw new Error(`Expected ${expected} ${type} rows; found ${counts[type] || 0}.`);
    }
  });
  const keys = rows.map((row) => `${row.normalized_text}|${row.content_type}|${row.level}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error('Workbook contains duplicate normalized content within the same type and level.');
  }
  return counts;
};

const attachStableWordIds = (rows, databaseWords) => {
  const wordRows = rows.filter((row) => row.content_type === 'word');
  const databaseMap = new Map((databaseWords || []).map((word) => [
    `${normalizeText(word.word)}|${String(word.level || '').toLowerCase()}`,
    word.id,
  ]));
  const workbookKeys = new Set(wordRows.map((row) => `${row.normalized_text}|${row.level.toLowerCase()}`));
  const databaseKeys = new Set(databaseMap.keys());
  const missing = [...workbookKeys].filter((key) => !databaseKeys.has(key));
  const extra = [...databaseKeys].filter((key) => !workbookKeys.has(key));
  if (databaseWords.length !== EXPECTED_COUNTS.word || missing.length || extra.length) {
    throw new Error(
      `Existing words bank does not exactly match the workbook: database=${databaseWords.length}, workbook=${wordRows.length}, missing=${missing.length}, extra=${extra.length}.`,
    );
  }
  return rows.map((row) => row.content_type === 'word'
    ? { ...row, word_id: databaseMap.get(`${row.normalized_text}|${row.level.toLowerCase()}`) }
    : row);
};

const summarize = (rows) => rows.reduce((result, row) => {
  const key = `${row.level}/${row.content_type}`;
  result[key] = (result[key] || 0) + 1;
  return result;
}, {});

async function main() {
  const validateOnly = process.argv.includes('--validate-only');
  const dryRun = process.argv.includes('--dry-run');
  const rows = readWorkbookRows();
  const counts = validateWorkbookRows(rows);
  console.log(`Validated ${rows.length} canonical rows from ${path.basename(FILE_PATH)}.`, counts);
  console.log('Curriculum breakdown:', summarize(rows));
  if (validateOnly) {
    console.log('--validate-only: workbook parsed; no database request made.');
    return;
  }

  const { data: databaseWords, error: wordsError } = await supabaseAdmin
    .from('words')
    .select('id,word,level')
    .order('level')
    .order('word');
  if (wordsError) throw new Error(`Could not read existing words: ${wordsError.message || wordsError}`);
  const linkedRows = attachStableWordIds(rows, databaseWords || []);
  console.log('Confirmed: all 600 workbook words exactly match public.words and have stable ids.');

  if (dryRun) {
    console.log('--dry-run: validation passed; no reading_content rows written.');
    return;
  }

  const batchSize = 200;
  for (let index = 0; index < linkedRows.length; index += batchSize) {
    const batch = linkedRows.slice(index, index + batchSize);
    const { error } = await supabaseAdmin
      .from('reading_content')
      .upsert(batch, { onConflict: 'source_sheet,source_row' });
    if (error) throw new Error(`reading_content upsert failed at row ${index + 1}: ${error.message || error}`);
    console.log(`Seeded canonical rows ${index + 1}-${index + batch.length}.`);
  }

  const { data: seeded, error: verifyError } = await supabaseAdmin
    .from('reading_content')
    .select('id,word_id,content_type,level,is_assessment,is_active');
  if (verifyError) throw new Error(`Could not verify reading_content: ${verifyError.message || verifyError}`);
  const active = (seeded || []).filter((row) => row.is_active);
  const linkedWords = active.filter((row) => row.content_type === 'word' && row.word_id).length;
  const assessments = active.filter((row) => row.content_type === 'paragraph' && row.is_assessment).length;
  if (active.length !== 1220 || linkedWords !== 600 || assessments !== 20) {
    throw new Error(`Seed verification failed: active=${active.length}, linkedWords=${linkedWords}, assessments=${assessments}.`);
  }
  console.log(`Verified reading_content: active=${active.length}, linkedWords=${linkedWords}, paragraphAssessments=${assessments}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[seedReadingContent] Failed:', error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_COUNTS,
  attachStableWordIds,
  normalizeText,
  readWorkbookRows,
  validateWorkbookRows,
};
