function normalizeSpeechText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fil-PH')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(value) {
  const normalized = normalizeSpeechText(value);
  return normalized ? normalized.split(/\s+/) : [];
}

// Speech recognition often inserts harmless punctuation/spacing differences or
// repeats a single word in a noisy room. This key is deliberately conservative:
// it does not collapse distinct Filipino phonemes (e.g. p/f, b/v, r/d), so a
// wrong pronunciation is not promoted to correct.
function recognitionKey(value) {
  const words = tokens(value);
  if (words.length === 2 && words[0] === words[1]) return words[0];
  return words.join(' ');
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    for (let column = 0; column < previous.length; column += 1) previous[column] = current[column];
  }
  return previous[right.length];
}

// This deliberately scores only the server-fetched expected content. It is a
// deterministic pilot metric, not a replacement for a language-aware speech model.
function scoreTranscript(expectedText, transcript) {
  const expected = tokens(expectedText);
  const heard = tokens(transcript);
  if (!expected.length || !heard.length) {
    return { accuracy: 0, correct: false, expectedTokenCount: expected.length, transcriptTokenCount: heard.length };
  }
  const distance = levenshtein(expected, heard);
  const accuracy = Math.round(Math.max(0, 100 * (1 - distance / Math.max(expected.length, heard.length))));
  return {
    accuracy,
    correct: recognitionKey(expectedText) === recognitionKey(transcript),
    expectedTokenCount: expected.length,
    transcriptTokenCount: heard.length,
  };
}

module.exports = { normalizeSpeechText, recognitionKey, scoreTranscript };
