"""Build leakage-safe readiness and candidate-word datasets.

This module deliberately does not train a model. It converts immutable
practice history into snapshots suitable for a future Decision Tree or Random
Forest and exposes the cold-start rubric label as an explicitly provisional
field. Phoneme-confusion events are inferred from spelling versus STT text;
they are not acoustic pronunciation measurements.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import statistics
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

MANILA = timezone(timedelta(hours=8), name="Asia/Manila")
FEATURE_SCHEMA_VERSION = "readiness-v1"
BOOTSTRAP_LABEL_SOURCE = "bootstrap_rubric_v1"
CONFUSION_WINDOW_DAYS = 30
CONFUSION_PAIRS = (
    "d-r", "b-p", "d-t", "g-k", "n-ng", "m-n",
    "l-r", "s-ts", "e-i", "o-u", "a-o",
)
LEVELS = ("beginner", "intermediate", "advanced")


def parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value or "").strip().replace("Z", "+00:00")
        if not text:
            raise ValueError("A timestamp is required")
        parsed = datetime.fromisoformat(text)
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def normalize_word(value: Any) -> str:
    return "".join(character for character in str(value or "").lower() if character.isalpha())


def finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def accuracy_slope(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    x_mean = (len(values) - 1) / 2
    y_mean = sum(values) / len(values)
    denominator = sum((index - x_mean) ** 2 for index in range(len(values)))
    return 0.0 if denominator == 0 else sum(
        (index - x_mean) * (value - y_mean) for index, value in enumerate(values)
    ) / denominator


def current_streak(history: list[dict[str, Any]], cutoff: datetime) -> int:
    dates = sorted({parse_datetime(row["created_at"]).astimezone(MANILA).date() for row in history})
    if not dates:
        return 0
    cutoff_date = cutoff.astimezone(MANILA).date()
    if (cutoff_date - dates[-1]).days > 1:
        return 0
    streak = 1
    for current, previous in zip(reversed(dates[1:]), reversed(dates[:-1])):
        if (current - previous).days != 1:
            break
        streak += 1
    return streak


def latest_level(history: list[dict[str, Any]], progress_level: Any = None) -> str | None:
    for row in reversed(history):
        value = str(row.get("difficulty_level_at_attempt") or "").lower()
        if value in LEVELS:
            return value
    value = str(progress_level or "").lower()
    return value if value in LEVELS else None


def build_readiness_features(
    student_id: str,
    history: list[dict[str, Any]],
    confusions: list[dict[str, Any]],
    cutoff: datetime,
    progress_level: Any = None,
) -> dict[str, Any]:
    history = sorted(history, key=lambda row: parse_datetime(row["created_at"]))
    recent_five = history[-5:]
    recent_ten = history[-10:]
    accuracies = [finite_number(row.get("accuracy_percentage")) for row in recent_five]
    accuracies = [value for value in accuracies if value is not None]
    durations = [finite_number(row.get("duration_seconds")) for row in recent_five]
    valid_durations = [value for value in durations if value is not None and value >= 0]
    last_practice = parse_datetime(history[-1]["created_at"]) if history else None
    days_since = (
        (cutoff.astimezone(MANILA).date() - last_practice.astimezone(MANILA).date()).days
        if last_practice else None
    )

    window_start = cutoff - timedelta(days=CONFUSION_WINDOW_DAYS)
    window_sessions = [
        row for row in history
        if window_start <= parse_datetime(row["created_at"]) < cutoff
    ]
    recent_confusions = [
        row for row in confusions
        if window_start <= parse_datetime(row["created_at"]) < cutoff
    ]
    pair_counts = Counter(str(row.get("confusion_key") or "") for row in recent_confusions)
    exposure_denominator = max(len(window_sessions), 1)

    avg_accuracy = sum(accuracies) / len(accuracies) if accuracies else None
    success_rate = (
        sum(1 for row in recent_five if bool(row.get("is_correct"))) / len(recent_five)
        if recent_five else None
    )
    slope = accuracy_slope(accuracies)
    bootstrap_label = None
    if len(recent_five) == 5 and avg_accuracy is not None and success_rate is not None:
        bootstrap_label = int(
            avg_accuracy >= 80
            and success_rate >= 0.8
            and slope >= -2.0
        )

    row: dict[str, Any] = {
        "student_id": student_id,
        "snapshot_at": cutoff.isoformat(),
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "avg_accuracy_last_5": round(avg_accuracy, 6) if avg_accuracy is not None else None,
        "accuracy_trend_last_5": round(slope, 6),
        "accuracy_std_last_5": round(statistics.pstdev(accuracies), 6) if len(accuracies) > 1 else 0.0,
        "success_rate_last_5": round(success_rate, 6) if success_rate is not None else None,
        "avg_response_time_last_5": round(sum(valid_durations) / len(valid_durations), 6) if valid_durations else None,
        "response_time_missing_rate_last_5": round(
            (len(recent_five) - len(valid_durations)) / len(recent_five), 6
        ) if recent_five else None,
        "days_since_last_practice": days_since,
        "current_streak": current_streak(history, cutoff),
        "total_attempts_prior": len(history),
        "distinct_words_last_10": len({normalize_word(row.get("word")) for row in recent_ten}),
        "current_difficulty": latest_level(history, progress_level),
        "recent_confusion_event_rate": round(len(recent_confusions) / exposure_denominator, 6),
        "bootstrap_readiness_label": bootstrap_label,
        "label_source": BOOTSTRAP_LABEL_SOURCE if bootstrap_label is not None else None,
    }
    for pair in CONFUSION_PAIRS:
        row[f"confusion_{pair.replace('-', '_')}_rate"] = round(pair_counts[pair] / exposure_denominator, 6)
    return row


def next_level(level: str | None) -> str:
    if level not in LEVELS:
        return "beginner"
    return LEVELS[min(LEVELS.index(level) + 1, len(LEVELS) - 1)]


def word_phonemes(word: Any) -> list[str]:
    value = normalize_word(word).replace("gui", "gi").replace("gue", "ge")
    phonemes: list[str] = []
    index = 0
    while index < len(value):
        digraph = next((item for item in ("ng", "ts", "ny") if value.startswith(item, index)), None)
        if digraph:
            phonemes.append(digraph)
            index += len(digraph)
        else:
            phonemes.append(value[index])
            index += 1
    return phonemes


def pair_exposures(word: Any) -> dict[str, int]:
    counts = Counter(word_phonemes(word))
    result = {}
    for pair in CONFUSION_PAIRS:
        left, right = pair.split("-")
        result[pair] = counts[left] + counts[right]
    return result


def build_candidate_word_features(
    readiness_row: dict[str, Any],
    history: list[dict[str, Any]],
    words: list[dict[str, Any]],
    cutoff: datetime,
) -> list[dict[str, Any]]:
    current = readiness_row.get("current_difficulty") or "beginner"
    should_advance = readiness_row.get("bootstrap_readiness_label") == 1
    recommended = next_level(current) if should_advance else current
    candidates = [row for row in words if str(row.get("level") or "").lower() == recommended]
    output = []
    for word in candidates:
        word_id = str(word.get("id") or "")
        normalized = normalize_word(word.get("word"))
        attempts = [
            row for row in history
            if (
                (word_id and str(row.get("word_id") or "") == word_id)
                or (
                    not row.get("word_id")
                    and normalize_word(row.get("word")) == normalized
                    and str(row.get("difficulty_level_at_attempt") or "").lower() == recommended
                )
            )
        ]
        attempt_accuracies = [finite_number(row.get("accuracy_percentage")) for row in attempts]
        attempt_accuracies = [value for value in attempt_accuracies if value is not None]
        last_attempt = max((parse_datetime(row["created_at"]) for row in attempts), default=None)
        exposures = pair_exposures(word.get("word"))
        matched_pairs = [pair for pair, count in exposures.items() if count > 0]
        weakness_match = sum(
            float(readiness_row.get(f"confusion_{pair.replace('-', '_')}_rate") or 0) * min(count, 2)
            for pair, count in exposures.items()
        )
        output.append({
            "student_id": readiness_row["student_id"],
            "snapshot_at": readiness_row["snapshot_at"],
            "feature_schema_version": FEATURE_SCHEMA_VERSION,
            "word_id": word_id,
            "word": word.get("word"),
            "current_difficulty": current,
            "candidate_difficulty": recommended,
            "level_distance": LEVELS.index(recommended) - LEVELS.index(current),
            "student_word_attempt_count": len(attempts),
            "student_word_avg_accuracy": round(sum(attempt_accuracies) / len(attempt_accuracies), 6) if attempt_accuracies else None,
            "days_since_word_practiced": (
                cutoff.astimezone(MANILA).date() - last_attempt.astimezone(MANILA).date()
            ).days if last_attempt else None,
            "unseen_word": int(not attempts),
            "syllable_count": word.get("syllable_count"),
            "has_diphthong": int(bool(word.get("has_diphthong"))),
            "has_consonant_cluster": int(bool(word.get("has_consonant_cluster"))),
            "weakness_match_score": round(weakness_match, 6),
            "matched_confusion_pairs": json.dumps(matched_pairs, separators=(",", ":")),
        })
    return output


def build_datasets(
    sessions: list[dict[str, Any]],
    confusions: list[dict[str, Any]],
    words: list[dict[str, Any]],
    progress: list[dict[str, Any]] | None = None,
    now: datetime | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    sessions_by_student: dict[str, list[dict[str, Any]]] = defaultdict(list)
    confusions_by_student: dict[str, list[dict[str, Any]]] = defaultdict(list)
    progress_by_student = {str(row.get("child_id")): row for row in (progress or [])}
    for row in sessions:
        sessions_by_student[str(row.get("student_id"))].append(row)
    for row in confusions:
        confusions_by_student[str(row.get("student_id"))].append(row)

    historical: list[dict[str, Any]] = []
    latest: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    snapshot_now = now or datetime.now(timezone.utc)
    for student_id, student_sessions in sessions_by_student.items():
        ordered = sorted(student_sessions, key=lambda row: parse_datetime(row["created_at"]))
        student_confusions = confusions_by_student.get(student_id, [])
        for index, next_attempt in enumerate(ordered):
            cutoff = parse_datetime(next_attempt["created_at"])
            snapshot = build_readiness_features(student_id, ordered[:index], student_confusions, cutoff)
            snapshot["next_session_id"] = next_attempt.get("id")
            historical.append(snapshot)
        progress_level = progress_by_student.get(student_id, {}).get("level")
        current = build_readiness_features(student_id, ordered, student_confusions, snapshot_now, progress_level)
        latest.append(current)
        candidates.extend(build_candidate_word_features(current, ordered, words, snapshot_now))
    return historical, latest, candidates


def load_json(path: str | Path | None) -> list[dict[str, Any]]:
    if not path:
        return []
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, list):
        raise ValueError(f"Expected a JSON array in {path}")
    return value


def fetch_supabase_table(base_url: str, service_key: str, table: str, columns: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        query = urllib.parse.urlencode({"select": columns, "limit": 1000, "offset": offset})
        request = urllib.request.Request(
            f"{base_url.rstrip('/')}/rest/v1/{table}?{query}",
            headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            page = json.load(response)
        rows.extend(page)
        if len(page) < 1000:
            return rows
        offset += 1000


def load_from_supabase() -> tuple[list[dict[str, Any]], ...]:
    base_url = os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for a global batch export")
    sessions = fetch_supabase_table(
        base_url, service_key, "pronunciation_practice_sessions",
        "id,student_id,word_id,word,accuracy_percentage,is_correct,duration_seconds,difficulty_level_at_attempt,practice_source,created_at",
    )
    confusions = fetch_supabase_table(
        base_url, service_key, "phoneme_confusion",
        "id,student_id,session_id,confusion_key,target_word,transcript_word,source,created_at",
    )
    words = fetch_supabase_table(
        base_url, service_key, "words",
        "id,word,level,syllable_count,has_diphthong,has_consonant_cluster",
    )
    progress = fetch_supabase_table(base_url, service_key, "child_progress", "child_id,level")
    return sessions, confusions, words, progress


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    columns = list(dict.fromkeys(key for row in rows for key in row))
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-supabase", action="store_true")
    parser.add_argument("--sessions")
    parser.add_argument("--confusions")
    parser.add_argument("--words")
    parser.add_argument("--progress")
    parser.add_argument("--output-dir", default="ml/output")
    args = parser.parse_args()
    if args.from_supabase:
        sessions, confusions, words, progress = load_from_supabase()
    else:
        if not args.sessions or not args.words:
            parser.error("--sessions and --words are required unless --from-supabase is used")
        sessions = load_json(args.sessions)
        confusions = load_json(args.confusions)
        words = load_json(args.words)
        progress = load_json(args.progress)
    historical, latest, candidates = build_datasets(sessions, confusions, words, progress)
    output = Path(args.output_dir)
    write_csv(output / "readiness_historical.csv", historical)
    write_csv(output / "readiness_latest.csv", latest)
    write_csv(output / "candidate_word_features.csv", candidates)
    print(json.dumps({
        "historical_snapshots": len(historical),
        "latest_student_snapshots": len(latest),
        "candidate_word_rows": len(candidates),
        "output_dir": str(output.resolve()),
    }, indent=2))


if __name__ == "__main__":
    main()
