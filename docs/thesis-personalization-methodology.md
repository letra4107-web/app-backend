# Personalized Reading Recommendation Methodology

## System boundary and authoritative progression

LinawLetra separates engagement rewards from reading progression:

1. **XP is reward currency only.** Practice and achievement badges may award
   XP, but XP never selects or changes a reading level.
2. **Reading level is curriculum completion.** The client-approved Reading
   Level Progression Plan is stored in `reading_level_requirements` and is the
   only automatic advancement gate.
3. **Personalization ranks eligible practice.** Accuracy, confusion, recency,
   and structural signals order curriculum items, but cannot bypass the
   official completion gate.

The official requirements are:

| Current level | Required completion | Result |
| --- | --- | --- |
| Beginner | 200 words and 200 phonetics | Intermediate |
| Intermediate | 200 words and 200 phrases | Advanced |
| Advanced | 200 words, 200 sentences, and all 20 paragraph assessments | Program complete |

Words, phonetics, phrases, and sentences complete at an accuracy of at least
75%. A paragraph assessment completes after a full scored submission regardless
of score. Its score remains reportable, but the assessment is not converted
into a repeat-until-passed drill.

New students start at Beginner. A higher placement requires a separately
logged `student_reading_level_overrides` row with the responsible authenticated
parent and a written reason. The system never fabricates completions to place a
student at a higher level.

## Curriculum and data pipeline

The unchanged 600-row `words` bank remains the pronunciation-word source.
`reading_content` is the canonical curriculum layer:

- each of the 600 word entries links to its stable `words.id`;
- 200 Beginner phonetics;
- 200 Intermediate phrases;
- 200 Advanced sentences; and
- 20 Advanced paragraph assessments.

`student_content_attempts` is an immutable scored event log.
`student_content_completions` contains at most one qualifying completion per
student/content pair. A service-role-only database function records the attempt,
applies the content-type policy, awards completion, recomputes the official
level, and updates `child_progress` in one transaction. Student clients have
read access but no direct write policy for these progression records.

Pronunciation sessions separately retain stable word id when applicable,
difficulty at attempt, source, accuracy, correctness, response duration, and
timestamp. Phoneme-confusion events can link to the exact session.

## Superseded cold-start gate

An earlier prototype proposed an accuracy-based advancement rubric: five recent
attempts, at least 80% mean accuracy, four correct attempts, and a non-declining
trend. It was designed before the authoritative client curriculum was supplied.

That rubric was **superseded before any Decision Tree or Random Forest was
trained**. It is not a ground-truth label and is no longer used at runtime.
This change is methodologically important: the earlier prototype validated the
feature and audit pipeline, while the later client specification supplied the
actual progression construct. Retiring the informal gate prevented the system
from presenting accuracy as equivalent to curriculum completion.

Runtime output now uses `official_progression_eligible`. Recent accuracy and
trend remain descriptive ranking features only.

## Transparent curriculum ranker

The current strategy is `cold-start-ranker-v2-official-progression`:

```text
ranking_score =
    0.45 * weakness_match
  + 0.25 * mastery_gap
  + 0.20 * recency_need
  + 0.10 * structural_fit
```

The candidate pool is determined by official progression:

- Beginner: words and phonetics;
- Intermediate: words and phrases;
- Advanced: words and sentences.

Paragraph assessments are surfaced separately and are never rankable practice
items. When the current requirements are complete, candidates come from the
next official level. Otherwise, they remain at the current level.

The normalized components are:

- `weakness_match`: exposure to the student's recent confusion pairs;
- `mastery_gap`: lower prior content accuracy receives higher priority, while
  an unseen item receives a neutral 0.50;
- `recency_need`: increases across 14 days and is 1.0 for unseen content; and
- `structural_fit`: compares content type and text load with a conservative
  target for the recommended level.

### Manual-weight limitation

The weights **0.45/0.25/0.20/0.10 were manually selected using domain
reasoning**, prioritizing weakness-targeting. They were not learned, tuned, or
empirically validated against student outcomes. The ranking score is therefore
not a calibrated probability, and the API stores/returns
`predictedProbability: null`.

Once `personalization_recommendation_outcomes` contains enough multi-student
outcomes, future work should tune the weights through a documented validation
procedure and compare them against this frozen version.

## Confusion-data interpretation

Confusion events compare target spelling with speech-to-text output. They are
supplementary text-inferred substitution signals, not direct acoustic phoneme
measurements. Speech recognition may correct or distort what was spoken, so a
`d-r` row must not be claimed as proof of a physical mispronunciation.

## Explainability and audit log

Every recommendation stores:

- strategy and feature-schema versions;
- the official requirement snapshot and eligibility decision;
- recent accuracy, trend, streak, and confusion-rate descriptors;
- current/recommended difficulty and advance/stay decision;
- manually selected weights and their stated origin;
- ranked stable `reading_content.id` values and optional `words.id` links;
- content type, total score, and all four component scores; and
- reason codes such as `targets_confusion_pair`, `low_prior_accuracy`,
  `not_practiced_recently`, `unseen_curriculum_item`, and
  `appropriate_structural_load`.

This permits each decision to be reproduced and later linked to a genuine
outcome label.

## Future supervised model

No Decision Tree or Random Forest is trained yet because the project lacks
adequate multi-student outcomes containing both target classes. XP and the
retired accuracy rubric must not be used as supervised labels.

The intended future binary target is whether a recommendation/advancement led
to successful subsequent performance during a fixed observation window. Once
enough real outcomes exist, evaluation should report accuracy, precision,
recall, confusion matrix, and feature importance using student-grouped or
time-aware splits so correlated attempts from one student do not leak across
training and test sets.

## Runtime and fallback

`POST /api/personalization/recommend` resolves the student exclusively from the
Supabase Bearer token. It loads official progression, selects eligible canonical
curriculum, ranks it, and writes the rationale audit record.

The app requests ranked curriculum when loading practice. If personalization
is unavailable or empty, it falls back to the ordinary level word bank.
Personalization therefore cannot block practice.

## Current limitations

- Cold start: new students have little individualized accuracy/confusion data,
  so unseen-item and structural signals dominate early rankings.
- Confusion signals are spelling/STT-inferred rather than acoustic.
- Manual weights have not been outcome-tuned.
- Placement overrides depend on a human-supplied reason and should be audited.
- The future classifier remains deferred until real outcome labels and both
  readiness classes exist.
