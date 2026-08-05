import unittest
from datetime import datetime, timedelta, timezone

from ml.feature_extraction import MANILA, build_datasets, build_readiness_features


class FeatureExtractionTests(unittest.TestCase):
    def setUp(self):
        self.student = "00000000-0000-0000-0000-000000000001"
        accuracies = [0, 80, 85, 90, 95, 100]
        self.sessions = [
            {
                "id": f"session-{index}",
                "student_id": self.student,
                "word_id": "word-bata" if index % 2 == 0 else "word-dahon",
                "word": "bata" if index % 2 == 0 else "dahon",
                "accuracy_percentage": accuracy,
                "is_correct": accuracy >= 75,
                "duration_seconds": 10 - index,
                "difficulty_level_at_attempt": "beginner",
                "created_at": f"2026-08-0{index + 1}T01:00:00+00:00",
            }
            for index, accuracy in enumerate(accuracies)
        ]
        self.confusions = [{
            "student_id": self.student,
            "session_id": "session-1",
            "confusion_key": "d-r",
            "created_at": "2026-08-02T01:01:00+00:00",
        }]
        self.words = [
            {"id": "word-bata", "word": "bata", "level": "beginner", "syllable_count": 2,
             "has_diphthong": False, "has_consonant_cluster": False},
            {"id": "word-dahon", "word": "dahon", "level": "beginner", "syllable_count": 2,
             "has_diphthong": False, "has_consonant_cluster": False},
            {"id": "word-radyo", "word": "radyo", "level": "intermediate", "syllable_count": 2,
             "has_diphthong": False, "has_consonant_cluster": True},
        ]

    def test_historical_snapshots_use_only_prior_attempts(self):
        historical, latest, _ = build_datasets(
            self.sessions, self.confusions, self.words,
            now=datetime(2026, 8, 7, tzinfo=timezone.utc),
        )
        self.assertEqual(len(historical), 6)
        self.assertEqual(historical[0]["total_attempts_prior"], 0)
        self.assertIsNone(historical[0]["avg_accuracy_last_5"])
        self.assertEqual(historical[0]["recent_confusion_event_rate"], 0.0)
        # The confusion occurs one minute after the second snapshot cutoff and
        # must not leak backward into that historical training row.
        self.assertEqual(historical[1]["recent_confusion_event_rate"], 0.0)
        self.assertEqual(historical[2]["recent_confusion_event_rate"], 0.5)
        self.assertEqual(historical[-1]["total_attempts_prior"], 5)
        self.assertEqual(historical[-1]["avg_accuracy_last_5"], 70.0)
        self.assertEqual(latest[0]["avg_accuracy_last_5"], 90.0)
        self.assertFalse(latest[0]["official_progression_eligible"])
        self.assertNotIn("bootstrap_readiness_label", latest[0])

    def test_accuracy_does_not_advance_without_official_completions(self):
        _, _, candidates = build_datasets(
            self.sessions, self.confusions, self.words,
            now=datetime(2026, 8, 7, tzinfo=timezone.utc),
        )
        self.assertEqual([row["word_id"] for row in candidates], ["word-bata", "word-dahon"])
        self.assertTrue(all(row["candidate_difficulty"] == "beginner" for row in candidates))

    def test_candidate_rows_use_new_level_after_official_requirements(self):
        reading_content = [
            {"id": "content-word", "word_id": "word-bata", "content_type": "word", "level": "Beginner"},
            {"id": "content-phonetic", "word_id": None, "content_type": "phonetic", "level": "Beginner"},
        ]
        requirements = [
            {"level": "Beginner", "content_type": "word", "required_count": 1},
            {"level": "Beginner", "content_type": "phonetic", "required_count": 1},
            {"level": "Intermediate", "content_type": "word", "required_count": 1},
            {"level": "Intermediate", "content_type": "phrase", "required_count": 1},
            {"level": "Advanced", "content_type": "word", "required_count": 1},
            {"level": "Advanced", "content_type": "sentence", "required_count": 1},
            {"level": "Advanced", "content_type": "paragraph", "required_count": 1},
        ]
        completions = [
            {"student_id": self.student, "content_id": "content-word", "completed_at": "2026-08-06T01:00:00+00:00"},
            {"student_id": self.student, "content_id": "content-phonetic", "completed_at": "2026-08-06T01:01:00+00:00"},
        ]
        _, latest, candidates = build_datasets(
            self.sessions, self.confusions, self.words,
            now=datetime(2026, 8, 7, tzinfo=timezone.utc),
            reading_content=reading_content,
            completions=completions,
            requirements=requirements,
        )
        # Completing Beginner moves the student to Intermediate. Eligibility
        # then describes whether the now-current Intermediate level is complete,
        # so it remains false until Intermediate's own requirements are met.
        self.assertEqual(latest[0]["current_difficulty"], "intermediate")
        self.assertEqual(latest[0]["official_earned_level"], "Intermediate")
        self.assertFalse(latest[0]["official_progression_eligible"])
        self.assertEqual([row["word_id"] for row in candidates], ["word-radyo"])
        self.assertEqual(candidates[0]["candidate_difficulty"], "intermediate")
        self.assertGreater(candidates[0]["weakness_match_score"], 0)
        self.assertEqual(candidates[0]["unseen_word"], 1)

    def test_manila_timezone_is_fixed_utc_plus_8_without_iana_database(self):
        self.assertEqual(MANILA.utcoffset(None), timedelta(hours=8))
        self.assertEqual(MANILA.tzname(None), "Asia/Manila")

        # Both timestamps have the same UTC date, but cross midnight in Manila.
        # The feature must therefore report one local calendar day elapsed.
        history = [{
            "student_id": self.student,
            "word": "bata",
            "accuracy_percentage": 80,
            "is_correct": True,
            "created_at": "2026-08-06T15:30:00+00:00",
        }]
        row = build_readiness_features(
            self.student,
            history,
            [],
            datetime(2026, 8, 6, 16, 30, tzinfo=timezone.utc),
        )
        self.assertEqual(row["days_since_last_practice"], 1)
        self.assertEqual(row["current_streak"], 1)


if __name__ == "__main__":
    unittest.main()
