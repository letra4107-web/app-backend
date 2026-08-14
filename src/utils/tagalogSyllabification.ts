// Lightweight Tagalog syllabification helper.
// Produces a display string with hyphens between syllables without
// mutating the original input. Designed to be safe and conservative.

const VOWELS = 'aeiouáéíóúâêîôûäëïöü';

export const syllabifyWord = (input = ''): { syllables: string[]; display: string } => {
  if (!input) return { syllables: [], display: '' };
  // Preserve existing manual hyphenation.
  if (input.includes('-')) return { syllables: [input], display: input };

  const word = String(input).trim();
  const lower = word.toLowerCase();

  // Split punctuation and whitespace, syllabify each token separately.
  const tokens = lower.split(/(\s+|[^\p{L}]+)/u);
  const out: string[] = [];

  for (const token of tokens) {
    if (!token) continue;
    // If token is purely whitespace or punctuation, pass through.
    if (!/[\p{L}]/u.test(token)) {
      out.push(token);
      continue;
    }

    // Syllabify a single letter sequence.
    const chars = Array.from(token);
    const syllables: string[] = [];
    let i = 0;
    while (i < chars.length) {
      // Find next vowel (nucleus) from i onward.
      let nucleus = -1;
      for (let j = i; j < chars.length; j++) {
        const ch = chars[j];
        if (VOWELS.includes(ch)) {
          nucleus = j;
          break;
        }
      }
      if (nucleus === -1) {
        // No vowel found - append remaining chars to last syllable or as one chunk.
        const rem = chars.slice(i).join('');
        if (syllables.length) syllables[syllables.length - 1] += rem; else syllables.push(rem);
        break;
      }

      // If nucleus at start of token, include any leading consonants as onset.
      const onset = chars.slice(i, nucleus).join('');

      // Decide coda vs onset for consonants after nucleus.
      // If there is another vowel later, consonants between nucleus and next vowel belong to the next syllable's onset.
      let nextVowel = -1;
      for (let k = nucleus + 1; k < chars.length; k++) {
        if (VOWELS.includes(chars[k])) { nextVowel = k; break; }
      }

      let syll = onset + chars[nucleus];

      if (nextVowel === -1) {
        // No following vowel: include rest as coda
        const rest = chars.slice(nucleus + 1).join('');
        syll += rest;
        syllables.push(syll);
        break;
      }

      // There is a following vowel. A genuine onset cluster (pr/tr/kl/gr/...)
      // is only kept together at the very start of a word - that's already
      // handled above by the initial onset slice, before any nucleus is
      // found. Mid-word, at most one trailing consonant carries over as the
      // next syllable's onset; any earlier consonant(s) in the run become
      // this syllable's coda instead. Without this, "nagbasa" syllabified as
      // na-gba-sa (wrong) instead of nag-ba-sa; "aklat" as a-klat instead of
      // ak-lat.
      const between = chars.slice(nucleus + 1, nextVowel);
      if (between.length > 1) {
        syll += between.slice(0, -1).join('');
        i = nextVowel - 1;
      } else {
        i = nucleus + 1;
      }
      syllables.push(syll);
    }

    // Capitalize display syllables similar to Title Case for readability.
    const display = syllables.map((s) => s ? s[0].toUpperCase() + s.slice(1) : s).join('-');
    out.push(display);
  }

  // Join tokens back preserving punctuation/spacing.
  return { syllables: out.filter(Boolean), display: out.join('') };
};

export const syllabifyText = (text?: string) => syllabifyWord(text || '').display;

export default syllabifyText;
