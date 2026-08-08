// Updates the existing 600-word reading_content rows in place with two new
// columns from the client's updated workbook: syllable_hyphenation and
// definition. This never inserts new rows or new word_ids - it matches
// existing curriculum words by normalized text + level, same matching key
// used by seedReadingContent.js's word linking.
//
// Explicitly skipped (never written by this script):
//   - The 10 Level 2 Intermediate fragment words flagged
//     "[NEEDS REVIEW - fragment/unclear entry]" in the workbook (a
//     data-extraction bug tokenized a phrase into individual words) -
//     left untouched pending a decision to remove or replace them.
//   - "shorts" (Level 1), the same client-approved exclusion
//     seedReadingContent.js already deactivates - inactive rows are never
//     matched since this script only updates is_active=true rows.
//
// Level 3 Advanced rows are written with definition_needs_review = true -
// those 200 definitions are AI-drafted for compound phrases, not sourced
// or reviewed, and should not be treated as authoritative without review.
//
// Usage:
//   node scripts/seedWordSyllablesAndDefinitions.js --dry-run
//   node scripts/seedWordSyllablesAndDefinitions.js

const path = require('path');
const XLSX = require('xlsx');
const { supabaseAdmin } = require('../config/supabase');
const { normalizeText, CLIENT_DATA_EXCLUSIONS } = require('./seedReadingContent');

const FILE_PATH = path.join(__dirname, 'Tagalog_Phonetic_Words_Dyslexia_App_Updated_WITH_DEFINITIONS.xlsx');
const NEEDS_REVIEW_MARKER = 'NEEDS REVIEW';

const WORD_SHEETS = Object.freeze({
  'Level 1 Simple': 'Beginner',
  'Level 2 Intermediate': 'Intermediate',
  'Level 3 Advanced': 'Advanced',
});

const readWorkbookRows = (filePath = FILE_PATH) => {
  const workbook = XLSX.readFile(filePath);
  const rows = [];
  const skippedFragments = [];
  const skippedExclusions = [];

  Object.entries(WORD_SHEETS).forEach(([sheetName, level]) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`Missing required sheet: ${sheetName}`);
    const values = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    values.slice(1).forEach((row) => {
      const text = String(row[1] || '').trim();
      if (!text) return;
      const normalized = normalizeText(text);
      const syllableHyphenation = row[4] ? String(row[4]).trim() : null;
      const definition = row[5] ? String(row[5]).trim() : null;

      if (CLIENT_DATA_EXCLUSIONS.has(`${normalized}|word|${level}`)) {
        skippedExclusions.push({ level, text });
        return;
      }
      if (definition && definition.toUpperCase().includes(NEEDS_REVIEW_MARKER)) {
        skippedFragments.push({ level, text, syllableHyphenation });
        return;
      }

      rows.push({
        level,
        text,
        normalized,
        syllable_hyphenation: syllableHyphenation,
        definition,
        definition_needs_review: level === 'Advanced',
      });
    });
  });

  return { rows, skippedFragments, skippedExclusions };
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { rows, skippedFragments, skippedExclusions } = readWorkbookRows();

  console.log(`Parsed ${rows.length} updatable word rows from workbook.`);
  console.log(`Skipped ${skippedFragments.length} flagged fragment words:`, skippedFragments.map((r) => r.text));
  console.log(`Skipped ${skippedExclusions.length} client-excluded words:`, skippedExclusions.map((r) => r.text));

  if (dryRun) {
    console.log('--dry-run: parsed and validated only; no database request made.');
    return;
  }

  let updated = 0;
  let notFound = [];
  for (const row of rows) {
    const { data, error } = await supabaseAdmin
      .from('reading_content')
      .update({
        syllable_hyphenation: row.syllable_hyphenation,
        definition: row.definition,
        definition_needs_review: row.definition_needs_review,
        updated_at: new Date().toISOString(),
      })
      .eq('normalized_text', row.normalized)
      .eq('content_type', 'word')
      .eq('level', row.level)
      .eq('is_active', true)
      .select('id');

    if (error) throw new Error(`Update failed for "${row.text}" (${row.level}): ${error.message || error}`);
    if (!data || !data.length) {
      notFound.push(`${row.text} (${row.level})`);
      continue;
    }
    updated += 1;
  }

  console.log(`Updated ${updated} of ${rows.length} rows.`);
  if (notFound.length) {
    console.warn(`WARNING: ${notFound.length} workbook words had no matching active reading_content row:`, notFound);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[seedWordSyllablesAndDefinitions] Failed:', error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { readWorkbookRows };
