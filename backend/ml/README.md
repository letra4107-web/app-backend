# LinawLetra personalization feature pipeline

This directory builds datasets for the personalized difficulty system. It does
not train a model while the project has insufficient multi-student outcome
data.

## Python environment

Install 64-bit CPython 3.11 or newer from the official Python Windows installer
and enable both **Add Python to PATH** and the Python launcher. Python 3.13 is
the recommended version for this project. Close and reopen PowerShell after
installation so the updated PATH is loaded, then verify it from `backend/`:

```powershell
py -3.13 --version
py -3.13 -m pip install -r ml/requirements.txt
py -3.13 -m unittest -v ml.test_feature_extraction
```

The pipeline currently uses only the Python standard library, so
`requirements.txt` contains no third-party dependencies. Manila calendar-day
features use a fixed UTC+8 offset via `datetime.timezone`; they intentionally do
not require the optional IANA `tzdata` package. The Philippines does not
currently observe daylight saving time, making UTC+8 appropriate for this
application's current date calculations. If that policy changes, replace the
fixed offset with `zoneinfo.ZoneInfo("Asia/Manila")` and add `tzdata` for
portable Windows support.

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
py -3.13 -m ml.feature_extraction --from-supabase --output-dir ml/output
```

Required environment variables are `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`.

The extractor can also read JSON-array fixtures or secure exports:

```powershell
py -3.13 -m ml.feature_extraction `
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
py -3.13 -m unittest -v ml.test_feature_extraction
```
