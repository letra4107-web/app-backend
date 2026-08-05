# LinawLetra personalization feature pipeline

This directory builds datasets for the personalized difficulty system. It does
not train a model while the project has insufficient multi-student outcome
data.

## Outputs

- `readiness_historical.csv`: one leakage-safe snapshot immediately before
  each historical attempt.
- `readiness_latest.csv`: one current readiness row per student.
- `candidate_word_features.csv`: one row per student and candidate word at the
  difficulty selected by the provisional cold-start rubric.

The provisional `bootstrap_readiness_label` is **not ground truth**. It is 1
only after five recent attempts when average accuracy is at least 80%, at least
four attempts are correct, and the accuracy slope is no worse than -2 points
per attempt. It exists to validate the pipeline and cold-start behavior. Future
training must prefer `personalization_recommendation_outcomes.readiness_label`.

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
  --output-dir ml/output
```

Run its dependency-free tests from `backend/`:

```powershell
python -m unittest ml.test_feature_extraction
```
