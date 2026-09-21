/* global describe, it, expect */
const { FILIPINO_LETTER_SOUNDS, FILIPINO_TTS_RATES, filipinoIpa, isMultiSyllableWord, toFilipinoSsml } = require('./filipinoTts');

describe('Filipino Cloud TTS phonemes', () => {
  it('uses Filipino isolated vowel sounds for A and U', () => {
    expect(FILIPINO_LETTER_SOUNDS.A).toBe('a');
    expect(FILIPINO_LETTER_SOUNDS.U).toBe('u');
    expect(toFilipinoSsml('A U')).toContain('ph="a"');
    expect(toFilipinoSsml('A U')).toContain('ph="u"');
  });

  it('uses Filipino letter sounds for B and Ng', () => {
    expect(FILIPINO_LETTER_SOUNDS.B).toBe('ba');
    expect(FILIPINO_LETTER_SOUNDS.NG).toBe('nga');
    expect(filipinoIpa('Ng')).toBe('ŋa');
  });

  it('creates Filipino IPA SSML for words and sentences', () => {
    expect(toFilipinoSsml('puno')).toContain('ph="puno"');
    expect(toFilipinoSsml('Ang puno ay mataas.')).toContain('ph="aŋ"');
    expect(toFilipinoSsml('Ang puno ay mataas.')).toContain('ph="mataas"');
  });

  it('uses a slow rate only for multi-syllable practice words', () => {
    expect(isMultiSyllableWord('puno')).toBe(true);
    expect(FILIPINO_TTS_RATES.word).toBe(0.72);
  });

  it('uses gentle 0.85 feedback and meaning playback', () => {
    expect(FILIPINO_TTS_RATES.feedback).toBe(0.85);
    expect(FILIPINO_TTS_RATES.meaning).toBe(0.85);
    expect(FILIPINO_TTS_RATES.repeatCorrectWord).toBe(0.60);
  });
});
