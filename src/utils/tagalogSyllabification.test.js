/* global describe, it, expect */

const { syllabifyText, syllabifyWord } = require('./tagalogSyllabification');

describe('tagalog syllabification', () => {
  it('basic words are hyphenated', () => {
    expect(syllabifyText('Bahay')).toBe('Ba-Hay');
    expect(syllabifyText('Halaman')).toBe('Ha-La-Man');
    expect(syllabifyText('Pag-ibig')).toBe('Pag-ibig'); // preserves manual hyphen
  });

  it('empty and non-letters', () => {
    expect(syllabifyText('')).toBe('');
    expect(syllabifyText('   ')).toBe('');
    expect(syllabifyText('!')).toBe('!');
  });

  it('syllabifyWord returns syllables array', () => {
    const res = syllabifyWord('Bahay');
    // The utility returns token-level display entries in `syllables`.
    expect(res.syllables).toEqual(['Ba-Hay']);
    expect(res.display).toBe('Ba-Hay');
  });
});
