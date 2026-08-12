import type { ReadingContentItem, ReadingContentType } from '../services/readingContentService';

export type PracticeItemState = 'completed' | 'current' | 'locked';

const FALLBACK_TRACK_ORDER: ReadingContentType[] = ['word', 'phonetic', 'phrase', 'sentence', 'paragraph', 'story'];

const sortableNumber = (value: number | null | undefined) => (
  Number.isFinite(value) && Number(value) > 0 ? Number(value) : Number.MAX_SAFE_INTEGER
);

/** Deterministic workbook order, including safe handling for legacy nulls. */
export const compareCurriculumOrder = (left: ReadingContentItem, right: ReadingContentItem) => (
  sortableNumber(left.sequence_no) - sortableNumber(right.sequence_no)
  || sortableNumber(left.source_row) - sortableNumber(right.source_row)
  || String(left.id).localeCompare(String(right.id))
);

export const sortCurriculumItems = (items: ReadingContentItem[]) => items.slice().sort(compareCurriculumOrder);

/**
 * Returns at most one candidate per track: the first incomplete workbook item.
 * Personalization may rank this frontier, but can never skip within a track.
 */
export const buildTrackFrontier = (
  items: ReadingContentItem[],
  completedIds: ReadonlySet<string>,
  trackOrder: ReadingContentType[] = FALLBACK_TRACK_ORDER,
) => {
  const byType = new Map<ReadingContentType, ReadingContentItem[]>();
  items.forEach((item) => byType.set(item.content_type, [...(byType.get(item.content_type) || []), item]));

  const orderedTypes = [
    ...trackOrder.filter((type) => byType.has(type)),
    ...Array.from(byType.keys()).filter((type) => !trackOrder.includes(type)).sort(),
  ];
  return orderedTypes.flatMap((type) => {
    const firstIncomplete = sortCurriculumItems(byType.get(type) || [])
      .find((item) => !completedIds.has(item.id));
    return firstIncomplete ? [firstIncomplete] : [];
  });
};

export const chooseRankedFrontier = (
  frontier: ReadingContentItem[],
  rankedContentIds: readonly string[],
) => {
  const frontierById = new Map(frontier.map((item) => [item.id, item]));
  for (const contentId of rankedContentIds) {
    const ranked = frontierById.get(contentId);
    if (ranked) return ranked;
  }
  return frontier[0] || null;
};

export const practiceItemState = (
  item: ReadingContentItem,
  completedIds: ReadonlySet<string>,
  currentContentId: string | null | undefined,
): PracticeItemState => {
  if (completedIds.has(item.id)) return 'completed';
  return item.id === currentContentId ? 'current' : 'locked';
};
