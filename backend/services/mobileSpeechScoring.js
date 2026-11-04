// Generated from src/utils/scorePronunciation.ts; parity is regression-tested.
"use strict";
// Extracted from StudentDashboard.tsx so it can be unit tested in isolation —
// this is the actual pronunciation-scoring logic used by the Practice/Word of
// Day flows (the backend's pronunciationController.js is unrelated dead code).
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreMessage = exports.scorePronunciation = exports.levenshteinDistance = exports.normalizePronunciation = exports.PRACTICE_PASSING_SCORE = void 0;
// Raised from 70 alongside the scorePronunciation rewrite — see that
// function's comment. 70 was passable by genuinely wrong words (e.g.
// "balikaka" scored 73% against "kalikasan"); 75 keeps real STT-noise near
// misses (dropped vowels, clipped final letters) passing while rejecting
// mismatched words.
exports.PRACTICE_PASSING_SCORE = 88;
// Unicode combining diacritical marks block (U+0300-U+036F), stripped after
// NFD normalization to fold accented characters down to their base letter.
// Built from charCodeAt rather than a literal escape to avoid any ambiguity
// from raw combining characters appearing directly in source.
const COMBINING_MARKS_PATTERN = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g');
const normalizePronunciation = (value = '') => String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS_PATTERN, '')
    .replace(/[^a-zñ]/g, '')
    .replace(/ñ/g, 'n');
exports.normalizePronunciation = normalizePronunciation;
const levenshteinDistance = (a, b) => {
    const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_unused, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= a.length; i += 1) {
        for (let j = 1; j <= b.length; j += 1) {
            rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return rows[a.length][b.length];
};
exports.levenshteinDistance = levenshteinDistance;
const scorePronunciation = (expected, spoken) => {
    const normalizedExpected = (0, exports.normalizePronunciation)(expected);
    const normalizedSpoken = (0, exports.normalizePronunciation)(spoken);
    if (!normalizedExpected || !normalizedSpoken)
        return 0;
    if (normalizedExpected === normalizedSpoken)
        return 100;
    const distance = (0, exports.levenshteinDistance)(normalizedExpected, normalizedSpoken);
    const maxLen = Math.max(normalizedExpected.length, normalizedSpoken.length);
    const ratio = distance / maxLen;
    // Quadratic-ish falloff (exponent 1.6) instead of a linear ratio, and no
    // "starts with the same letter" / "similar length" bonuses — those bonuses
    // used to inflate scores for words that only coincidentally share letters
    // (e.g. "balikaka" vs "kalikasan" scored 73% and was accepted as correct).
    // Length mismatch is already captured by `ratio` itself; it doesn't need a
    // separate reward on top.
    let score = Math.min(99, Math.round(100 * Math.max(0, 1 - ratio) ** 1.6));
    // A mismatched first 1-2 characters changes which Filipino word was said
    // even when a long shared suffix keeps the whole-string ratio high (e.g.
    // "pagkakaibigan" vs "magkakaibigan" - a single "pag-"/"mag-" prefix swap,
    // two different real words with different meanings - scored 88% and
    // passed before this penalty, since 12 of 13 characters matched). Tagalog
    // prefixes like pag-/mag- are grammatically significant, so a mismatch
    // right there is penalized directly instead of being washed out by ratio.
    const prefixLen = Math.min(2, normalizedExpected.length, normalizedSpoken.length);
    if (normalizedExpected.slice(0, prefixLen) !== normalizedSpoken.slice(0, prefixLen)) {
        score = Math.round(score * 0.7);
    }
    return score;
};
exports.scorePronunciation = scorePronunciation;
const scoreMessage = (score) => {
    if (score >= 95)
        return `${score}% Tama!`;
    if (score >= 80)
        return `${score}% Napakalapit!`;
    if (score >= 60)
        return `${score}% Magaling! Konting practice pa!`;
    return `${score}% Ulitin natin!`;
};
exports.scoreMessage = scoreMessage;
