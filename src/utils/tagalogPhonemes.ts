// Tagalog phoneme analysis - grapheme-to-phoneme (G2P) conversion, phoneme-
// level alignment, and confusion-pair detection.
//
// IMPORTANT SCOPE: this works from PLAIN TEXT ONLY (the target word's
// spelling vs. the speech-to-text transcript's spelling). There is no
// acoustic/audio-level phoneme scoring anywhere in this app - the only
// signal available is Google Cloud STT's text transcript. This measures
// "what the recognizer transcribed" against "what was expected," not true
// pronunciation quality. If STT's language model auto-corrects a
// mispronunciation back to the intended word text (a real, documented STT
// behavior), this analysis will never see a mismatch. That is a real ceiling
// of text-based analysis, not a bug to fix later - callers must not present
// this as acoustic accuracy.
//
// This is additive: it does not replace the existing word-level Levenshtein
// similarity scoring (see similarity() in StudentWordOfDay.tsx) used for
// pass/fail. It produces supplementary diagnostic data (which phoneme was
// likely confused for which) for the phoneme_confusion tracking layer.

export type Phoneme = string;

export type AlignOp = 'match' | 'substitute' | 'delete' | 'insert';

export type PhonemeAlignmentStep = {
  op: AlignOp;
  expected: Phoneme | null; // null for 'insert' (extra phoneme not expected)
  actual: Phoneme | null; // null for 'delete' (expected phoneme missing)
};

export type PhonologyResult = {
  targetWord: string;
  transcriptWord: string;
  targetPhonemes: Phoneme[];
  transcriptPhonemes: Phoneme[];
  alignment: PhonemeAlignmentStep[];
  /** matched phonemes / max(target length, 1) - a diagnostic ratio, not a pass/fail score */
  phonemeMatchRatio: number;
  /** deduplicated "x-y" keys (alphabetically sorted) for every substitution that hit a known confusable pair */
  confusionKeys: string[];
};

// The 11 confusable pairs called out for this feature set. Order within each
// pair doesn't matter - confusionPairKey() always returns them sorted so
// "d confused for r" and "r confused for d" aggregate to the same key.
export const CONFUSION_PAIRS: [string, string][] = [
  ['d', 'r'],
  ['b', 'p'],
  ['t', 'd'],
  ['k', 'g'],
  ['n', 'ng'],
  ['m', 'n'],
  ['l', 'r'],
  ['s', 'ts'],
  ['i', 'e'],
  ['o', 'u'],
  ['a', 'o'],
];

const CONFUSION_PAIR_LOOKUP = new Map<string, string>();
for (const [a, b] of CONFUSION_PAIRS) {
  const key = [a, b].slice().sort().join('-');
  CONFUSION_PAIR_LOOKUP.set(`${a}>${b}`, key);
  CONFUSION_PAIR_LOOKUP.set(`${b}>${a}`, key);
}

export const confusionPairKey = (expected: string, actual: string): string | null =>
  CONFUSION_PAIR_LOOKUP.get(`${expected}>${actual}`) || null;

// Digraphs must be matched before single letters (longest match first).
// 'ng' = /ŋ/, 'ts' = /tʃ/ (loanwords like "tsokolate"), 'ny' = /ɲ/ (rare,
// e.g. "Espanya"). Checked in this order so 'ng' never gets read as 'n'+'g'.
const DIGRAPHS: [string, Phoneme][] = [
  ['ng', 'ng'],
  ['ts', 'ts'],
  ['ny', 'ny'],
];

// Single-letter fallback. c/f/j/q/v/x/z are loanword/proper-noun letters
// that don't appear in this app's actual word lists today (DEFAULT_PHONETIC_
// WORDS, SKILL_LONG_WORDS, the Supabase word bank are all native-spelling
// Filipino words) - mapped as a best-effort fallback only, in case an STT
// transcript ever contains one, not verified against real usage.
const LETTER_TO_PHONEME: Record<string, Phoneme> = {
  a: 'a', e: 'e', i: 'i', o: 'o', u: 'u',
  b: 'b', k: 'k', d: 'd', g: 'g', h: 'h',
  l: 'l', m: 'm', n: 'n', p: 'p', r: 'r',
  s: 's', t: 't', w: 'w', y: 'y',
  // loanword best-effort fallback
  c: 'k', f: 'f', j: 'h', q: 'k', v: 'b', x: 'ks', z: 's',
};

/**
 * Converts a plain Tagalog word (no hyphens) into its expected phoneme
 * sequence. Handles the "silent u" in Spanish-derived gui/gue spellings
 * (Sampaguita -> s-a-m-p-a-g-i-t-a), a real word already in this app's
 * word lists.
 */
export const wordToPhonemes = (word: string): Phoneme[] => {
  const normalized = word
    .toLowerCase()
    .replace(/-/g, '')
    .replace(/gui/g, 'gi')
    .replace(/gue/g, 'ge')
    .replace(/[^a-z]/g, '');

  const phonemes: Phoneme[] = [];
  let i = 0;
  while (i < normalized.length) {
    const digraph = DIGRAPHS.find(([letters]) => normalized.startsWith(letters, i));
    if (digraph) {
      phonemes.push(digraph[1]);
      i += digraph[0].length;
      continue;
    }
    const letter = normalized[i];
    phonemes.push(LETTER_TO_PHONEME[letter] || letter);
    i += 1;
  }
  return phonemes;
};

/**
 * Splits an already-hyphenated word (the convention used throughout this
 * app's word data, e.g. "Ka-ba-yo") into its syllable strings. Words without
 * hyphens (Supabase word-bank entries, STT transcripts) return a single
 * "syllable" containing the whole word - full rule-based syllabification is
 * out of scope for this foundational layer.
 */
export const syllablesFromHyphenated = (word: string): string[] =>
  word.includes('-') ? word.split('-').filter(Boolean) : [word];

/** Classic Levenshtein edit-distance alignment, operating on phoneme arrays instead of characters. */
export const alignPhonemes = (expected: Phoneme[], actual: Phoneme[]): PhonemeAlignmentStep[] => {
  const n = expected.length;
  const m = actual.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i += 1) dp[i][0] = i;
  for (let j = 0; j <= m; j += 1) dp[0][j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      if (expected[i - 1] === actual[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrace from (n, m) to (0, 0).
  const steps: PhonemeAlignmentStep[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && expected[i - 1] === actual[j - 1]) {
      steps.push({ op: 'match', expected: expected[i - 1], actual: actual[j - 1] });
      i -= 1;
      j -= 1;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      steps.push({ op: 'substitute', expected: expected[i - 1], actual: actual[j - 1] });
      i -= 1;
      j -= 1;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      steps.push({ op: 'delete', expected: expected[i - 1], actual: null });
      i -= 1;
    } else {
      steps.push({ op: 'insert', expected: null, actual: actual[j - 1] });
      j -= 1;
    }
  }
  steps.reverse();
  return steps;
};

/**
 * Compares a target word's expected spelling against an STT transcript word.
 * See the module-level comment: this is text-based, not acoustic. Returns
 * diagnostic data for phoneme_confusion tracking - callers still use the
 * existing word-level similarity score for pass/fail.
 */
export const analyzePhonology = (targetWord: string, transcriptWord: string): PhonologyResult => {
  const targetPhonemes = wordToPhonemes(targetWord);
  const transcriptPhonemes = wordToPhonemes(transcriptWord || '');
  const alignment = alignPhonemes(targetPhonemes, transcriptPhonemes);

  const confusionKeys = new Set<string>();
  let matched = 0;
  for (const step of alignment) {
    if (step.op === 'match') matched += 1;
    if (step.op === 'substitute' && step.expected && step.actual) {
      const key = confusionPairKey(step.expected, step.actual);
      if (key) confusionKeys.add(key);
    }
  }

  return {
    targetWord,
    transcriptWord,
    targetPhonemes,
    transcriptPhonemes,
    alignment,
    phonemeMatchRatio: targetPhonemes.length ? matched / targetPhonemes.length : 0,
    confusionKeys: Array.from(confusionKeys),
  };
};
