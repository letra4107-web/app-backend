// Makes the active word curriculum match an approved three-sheet workbook
// while preserving old rows for student history. Old records remain in the
// database but are inactive and are never offered to learners.
//
// Usage:
//   node scripts/reconcileAuditedWordBank.js --file <workbook.xlsx> [--dry-run]

const path = require('path');
const XLSX = require('xlsx');
const { supabaseAdmin } = require('../config/supabase');

const SHEETS = {
  'Level 1 Simple': 'beginner',
  'Level 2 Intermediate': 'intermediate',
  'Level 3 Advanced': 'advanced',
};

const keyFor = (word, level) => `${String(word).trim().toLocaleLowerCase('fil')}|${String(level).toLowerCase()}`;

const readApprovedWords = (filePath) => {
  const workbook = XLSX.readFile(filePath);
  const rows = [];
  Object.entries(SHEETS).forEach(([sheetName, level]) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`Missing required sheet: ${sheetName}`);
    XLSX.utils.sheet_to_json(sheet, { defval: null }).forEach((row, index) => {
      const word = String(row['Word (Salita)'] || '').trim();
      if (word) rows.push({ word, level, sheetName, sourceRow: index + 2, patternNote: String(row['Pantig Pattern Note'] || '').trim() || null });
    });
  });
  if (rows.length !== 600 || new Set(rows.map((row) => keyFor(row.word, row.level))).size !== rows.length) {
    throw new Error('The audited workbook must contain exactly 600 unique word-and-level entries.');
  }
  return rows;
};

async function main() {
  const fileIndex = process.argv.indexOf('--file');
  if (fileIndex < 0 || !process.argv[fileIndex + 1]) throw new Error('Pass the audited workbook using --file <path>.');
  const dryRun = process.argv.includes('--dry-run');
  const approved = readApprovedWords(path.resolve(process.argv[fileIndex + 1]));
  const { data: words, error: wordsError } = await supabaseAdmin.from('words').select('id,word,level');
  if (wordsError) throw wordsError;
  const wordIds = new Map((words || []).map((row) => [keyFor(row.word, row.level), row.id]));
  const missingWords = approved.filter((row) => !wordIds.has(keyFor(row.word, row.level)));
  if (missingWords.length) throw new Error(`The words table is missing ${missingWords.length} audited entries. Run seedWords.js first.`);

  const { data: content, error: contentError } = await supabaseAdmin
    .from('reading_content')
    .select('id,word_id,content_text,level,is_active')
    .eq('content_type', 'word');
  if (contentError) throw contentError;

  const approvedIds = new Set(approved.map((row) => wordIds.get(keyFor(row.word, row.level))));
  const existingByWordId = new Map((content || []).filter((row) => row.word_id).map((row) => [row.word_id, row]));
  const toDeactivate = (content || []).filter((row) => row.is_active && row.word_id && !approvedIds.has(row.word_id));
  const toInsert = approved.filter((row) => !existingByWordId.has(wordIds.get(keyFor(row.word, row.level))));
  const toReactivate = approved
    .map((row) => existingByWordId.get(wordIds.get(keyFor(row.word, row.level))))
    .filter((row) => row && !row.is_active);

  console.log(JSON.stringify({ approved: approved.length, deactivate: toDeactivate.length, insert: toInsert.length, reactivate: toReactivate.length }, null, 2));
  if (dryRun) return;

  for (let index = 0; index < toDeactivate.length; index += 100) {
    const ids = toDeactivate.slice(index, index + 100).map((row) => row.id);
    const { error } = await supabaseAdmin.from('reading_content').update({ is_active: false }).in('id', ids);
    if (error) throw error;
  }
  for (let index = 0; index < toReactivate.length; index += 100) {
    const ids = toReactivate.slice(index, index + 100).map((row) => row.id);
    const { error } = await supabaseAdmin.from('reading_content').update({ is_active: true }).in('id', ids);
    if (error) throw error;
  }
  for (let index = 0; index < toInsert.length; index += 100) {
    const batch = toInsert.slice(index, index + 100).map((row) => ({
      word_id: wordIds.get(keyFor(row.word, row.level)), content_text: row.word,
      normalized_text: String(row.word).trim().toLocaleLowerCase('fil'), content_type: 'word',
      level: `${row.level[0].toUpperCase()}${row.level.slice(1)}`, sequence_no: row.sourceRow - 1,
      source_sheet: `Audited ${row.sheetName}`, source_row: row.sourceRow,
      pattern_note: row.patternNote, backend_category: `${row.level}_word`, is_assessment: false, is_active: true,
    }));
    const { error } = await supabaseAdmin.from('reading_content').insert(batch);
    if (error) throw error;
  }
  const { count, error: verifyError } = await supabaseAdmin.from('reading_content')
    .select('id', { count: 'exact', head: true }).eq('content_type', 'word').eq('is_active', true);
  if (verifyError) throw verifyError;
  if (count !== 600) throw new Error(`Expected 600 active audited word records; found ${count}.`);
  console.log('Verified: 600 active word records exactly match the audited workbook.');
}

main().catch((error) => { console.error('[reconcileAuditedWordBank] Failed:', error.message || error); process.exitCode = 1; });
