# Personalized Difficulty Recommendation Methodology

## System boundary

LinawLetra separates reading progression into two concepts:

1. **XP progression** is the existing engagement mechanic. Cumulative XP maps
   to Beginner, Intermediate, or Advanced. It is not evidence that an
   advancement decision was pedagogically successful and is not used as the
   supervised ML target.
2. **Readiness recommendation** uses recent practice behavior to decide whether
   the next practice set should remain at the current difficulty or move to the
   next difficulty. This is the personalization component.

Keeping these concepts separate prevents a future model from merely learning
the deterministic XP thresholds.

## Data pipeline

Each pronunciation session records the stable word identifier when it can be
resolved, difficulty at the time of the attempt, practice source, accuracy,
correctness, response duration, and timestamp. Phoneme-confusion events can
reference the exact pronunciation session.

The offline Python feature pipeline produces:

- leakage-safe historical readiness snapshots using only events before each
  cutoff;
- the latest readiness features per student; and
- student/candidate-word feature rows.

Readiness features include recent average accuracy, accuracy slope and
variation, recent success rate, response time and missingness, days since
practice, recomputed streak, experience and word breadth, and normalized
30-day confusion-pair rates.

Student identifiers are grouping keys, not predictive features. Raw names,
parent details, and transcripts are not features.

## Confusion-data interpretation

Confusion events compare the target word's spelling with Google Speech-to-Text
output. They are supplementary text-inferred substitution signals, not direct
acoustic phoneme measurements. Speech recognition can correct or distort what
was said, so the methodology must not claim that these rows prove a particular
physical mispronunciation.

## Cold-start readiness rubric

The project does not yet have enough students and outcome labels to train or
evaluate a generalizable Decision Tree or Random Forest. During cold start, an
advancement recommendation requires all of the following:

- five recent attempts are available;
- average accuracy over those attempts is at least 80%;
- at least four of five attempts are correct; and
- the accuracy slope is no worse than -2 percentage points per attempt.

With fewer than five attempts, the system always stays at the current level.
The resulting `bootstrap_readiness_label` is a provisional rubric label, not
independent ground truth. It may validate data flow and cold-start behavior but
must not be presented as evidence that an ML model discovered readiness.

## Transparent weakness-based ranking

The deployed cold-start strategy is `cold-start-ranker-v1`:

```text
ranking_score =
    0.45 * weakness_match
  + 0.25 * mastery_gap
  + 0.20 * recency_need
  + 0.10 * structural_fit
```

All components are normalized to the range 0–1:

- `weakness_match` measures whether the candidate exposes phonemes from the
  student's recent confusion pairs;
- `mastery_gap` prioritizes attempted words with lower prior accuracy, while
  assigning unseen words a neutral 0.50 rather than treating them as proven
  weaknesses;
- `recency_need` increases over 14 days and is 1.0 for unseen words; and
- `structural_fit` compares syllable, diphthong, and consonant-cluster load to
  a conservative target of 0.40 when staying or 0.65 when advancing.

### Design decision and limitation: manual weights

The weights **0.45/0.25/0.20/0.10 were manually selected using domain
reasoning**. Weakness-targeting received the largest weight because the main
purpose is to practice the student's recurring difficulty areas. These values
were not learned, tuned, or empirically validated against student outcomes.

This is a stated limitation, not an ML result. Once
`personalization_recommendation_outcomes` contains enough multi-student
outcomes, future work should tune the weights through a documented validation
procedure and compare the tuned ranker with this frozen version.

The ranking score is not a calibrated probability. The API therefore stores
and returns `predictedProbability: null` during cold start.

## Explainability and audit log

Every recommendation records:

- strategy and feature-schema versions;
- the exact readiness feature snapshot;
- current and recommended difficulty;
- the advance/stay decision;
- manually selected weights and their stated origin;
- ranked stable word IDs and total scores;
- all four component scores; and
- reason codes such as `targets_confusion_pair`, `low_prior_accuracy`,
  `not_practiced_recently`, `unseen_diagnostic_word`, and
  `appropriate_structural_load`.

This event log permits the same decision to be explained during evaluation and
later connected to a genuine outcome label.

## Future supervised target

XP changes must not be used as labels. The intended binary outcome is whether
an advancement was successful during a fixed evaluation window. The initial
definition is successful when the first five attempts at the recommended next
level have at least 75% average accuracy and at least four correct attempts.

These observations populate
`personalization_recommendation_outcomes.readiness_label`. Model training is
deferred until there are multiple students, adequate histories, and both label
classes. Evaluation should then use student-grouped or time-aware splits to
avoid placing correlated attempts from the same student on both sides of a
random split.

## Runtime and fallback

`POST /api/personalization/recommend` accepts no authoritative student ID from
the client. It verifies the Supabase Bearer token and resolves the student only
through `children.auth_uid`.

The mobile app requests ranked words when loading the practice bank. If the
endpoint is unavailable, returns no words, or rejects the request, the app
loads the ordinary difficulty-filtered word bank. Personalization therefore
cannot prevent the student from practicing.
