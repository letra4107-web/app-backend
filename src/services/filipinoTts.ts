// Filipino pronunciation rules shared by every Cloud TTS request.  Letters
// are expanded to their Filipino reading names before IPA is generated, so a
// standalone "B" is never handed to the voice as the English "bee".
export const FILIPINO_LETTER_SOUNDS: Record<string, string> = {
  A: 'a', E: 'e', I: 'i', O: 'o', U: 'u',
  B: 'ba', K: 'ka', D: 'da', G: 'ga', M: 'ma', N: 'na', NG: 'nga',
  P: 'pa', R: 'ra', S: 'sa', T: 'ta', W: 'wa', Y: 'ya',
};

export const FILIPINO_TTS_RATES = {
  word: 0.72,
  repeatCorrectWord: 0.60,
  feedback: 0.85,
  meaning: 0.85,
} as const;

const escapeSsml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

/** Converts a Filipino word to a conservative IPA string for Google TTS. */
export function filipinoIpa(value: string): string {
  const expanded = FILIPINO_LETTER_SOUNDS[value.trim().toUpperCase()] || value.trim().toLowerCase();
  return expanded
    .replace(/ng/g, 'ŋ')
    .replace(/ñ/g, 'ɲ')
    .replace(/dy/g, 'dʲ')
    .replace(/ts/g, 'tʃ')
    .replace(/a/g, 'a')
    .replace(/e/g, 'e')
    .replace(/i/g, 'i')
    .replace(/o/g, 'o')
    .replace(/u/g, 'u')
    .replace(/r/g, 'ɾ');
}

/**
 * Wrap every Filipino word in an IPA phoneme tag while preserving whitespace
 * and punctuation. Google receives SSML only through our authenticated API.
 */
export function toFilipinoSsml(text: string): string {
  const parts = String(text || '').trim().split(/([A-Za-zÑñ]+(?:-[A-Za-zÑñ]+)?)/g);
  const body = parts.map((part) => {
    if (!/^[A-Za-zÑñ]+(?:-[A-Za-zÑñ]+)?$/.test(part)) return escapeSsml(part);
    const spoken = FILIPINO_LETTER_SOUNDS[part.toUpperCase()] || part.replace(/-/g, ' ');
    return `<phoneme alphabet="ipa" ph="${filipinoIpa(spoken)}">${escapeSsml(spoken)}</phoneme>`;
  }).join('');
  return `<speak>${body}</speak>`;
}

export const isMultiSyllableWord = (word: string) => {
  const vowels = String(word || '').toLowerCase().match(/[aeiou]/g) || [];
  return vowels.length > 1;
};
