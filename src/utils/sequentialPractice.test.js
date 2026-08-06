/* global describe, it, expect */

const {
  buildTrackFrontier,
  chooseRankedFrontier,
  practiceItemState,
  sortCurriculumItems,
} = require('./sequentialPractice');

const item = (id, type, sequence, sourceRow) => ({
  id,
  word_id: type === 'word' ? `word-${id}` : null,
  content_text: id,
  content_type: type,
  level: 'Beginner',
  sequence_no: sequence,
  source_row: sourceRow,
  pattern_note: null,
  backend_category: null,
  is_assessment: false,
});

const curriculum = [
  item('word-1', 'word', 1, 2),
  item('word-2', 'word', 2, 3),
  item('word-3', 'word', 3, 4),
  item('phonetic-1', 'phonetic', 1, 2),
  item('phonetic-2', 'phonetic', 2, 3),
];

describe('sequential Practice frontier', () => {
  it('selects only the first incomplete item in each independent track', () => {
    const frontier = buildTrackFrontier(curriculum, new Set(['word-1']), ['word', 'phonetic']);
    expect(frontier.map((entry) => entry.id)).toEqual(['word-2', 'phonetic-1']);
    expect(frontier.map((entry) => entry.id)).not.toContain('word-3');
  });

  it('lets weakness ranking choose only between valid frontier items', () => {
    const frontier = buildTrackFrontier(curriculum, new Set(), ['word', 'phonetic']);
    expect(chooseRankedFrontier(frontier, ['phonetic-1', 'word-3'])?.id).toBe('phonetic-1');
    expect(chooseRankedFrontier(frontier, ['word-3'])?.id).toBe('word-1');
  });

  it('marks completed/current/locked items and prevents skip-ahead state', () => {
    const completed = new Set(['word-1']);
    expect(practiceItemState(curriculum[0], completed, 'word-2')).toBe('completed');
    expect(practiceItemState(curriculum[1], completed, 'word-2')).toBe('current');
    expect(practiceItemState(curriculum[2], completed, 'word-2')).toBe('locked');
  });

  it('failed attempts do not advance, while persisted completion advances and resumes', () => {
    const before = buildTrackFrontier(curriculum, new Set(['word-1']), ['word']);
    const afterFailure = buildTrackFrontier(curriculum, new Set(['word-1']), ['word']);
    const afterSuccessOrReload = buildTrackFrontier(curriculum, new Set(['word-1', 'word-2']), ['word']);
    expect(before[0].id).toBe('word-2');
    expect(afterFailure[0].id).toBe('word-2');
    expect(afterSuccessOrReload[0].id).toBe('word-3');
  });

  it('does not wrap completed or empty tracks', () => {
    expect(buildTrackFrontier(curriculum, new Set(curriculum.map((entry) => entry.id)), ['word', 'phonetic']))
      .toEqual([]);
    expect(buildTrackFrontier([], new Set(), ['word'])).toEqual([]);
  });

  it('sorts safely by sequence, source row, then stable id when legacy values are missing', () => {
    const rows = [
      item('z-missing', 'word', null, null),
      item('b-tie', 'word', 1, 3),
      item('a-tie', 'word', 1, 3),
      item('later-source', 'word', 1, 4),
    ];
    expect(sortCurriculumItems(rows).map((entry) => entry.id)).toEqual([
      'a-tie', 'b-tie', 'later-source', 'z-missing',
    ]);
  });
});
