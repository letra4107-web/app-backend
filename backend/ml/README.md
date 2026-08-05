# LinawLetra personalization feature pipeline

This directory builds datasets for the personalized difficulty system. It does
not train a model while the project has insufficient multi-student outcome
data.

## Outputs

- `readiness_historical.csv`: one leakage-safe snapshot immediately before
  each historical attempt.
- `readiness_latest.csv`: one current readiness row per student.
- `candidate_word_features.csv`: one row per student and candidate word at the
  difficulty selected by official curriculum eligibility.

`official_progression_eligible` is reconstructed from
`student_content_completions`, `reading_content`,
`reading_level_requirements`, and audited placement overrides using only rows
observable at the snapshot cutoff. Accuracy and trend never set this field.
The earlier accuracy-based bootstrap label was superseded before model training
when the client supplied the authoritative curriculum plan.

This official gate is still not the future supervised outcome target. Future
training must use observed
`personalization_recommendation_outcomes.readiness_label` rows once sufficient
multi-student outcomes and both classes exist.

Confusion features are event rates over the preceding 30 days. The underlying
events compare target spelling with Speech-to-Text output and must not be
described as acoustic phoneme measurements.

## Run against Supabase

Use a service-role credential in the batch environment; never ship it in the
mobile application:

```powershell
python -m ml.feature_extraction --from-supabase --output-dir ml/output
```

Required environment variables are `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`.

The extractor can also read JSON-array fixtures or secure exports:

```powershell
python -m ml.feature_extraction `
  --sessions sessions.json `
  --confusions confusions.json `
  --words words.json `
  --progress progress.json `
  --reading-content reading_content.json `
  --completions completions.json `
  --requirements requirements.json `
  --overrides overrides.json `
  --output-dir ml/output
```

Run its dependency-free tests from `backend/`:

```powershell
python -m unittest ml.test_feature_extraction
```
