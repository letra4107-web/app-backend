import unittest
from datetime import datetime, timezone

from ml.feature_extraction import build_datasets


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
        self.assertEqual(historical[-1]["total_attempts_prior"], 5)
        self.assertEqual(historical[-1]["avg_accuracy_last_5"], 70.0)
        self.assertEqual(historical[-1]["bootstrap_readiness_label"], 0)
        self.assertEqual(latest[0]["avg_accuracy_last_5"], 90.0)
        self.assertEqual(latest[0]["bootstrap_readiness_label"], 1)

    def test_candidate_rows_target_next_level_after_bootstrap_advance(self):
        _, _, candidates = build_datasets(
            self.sessions, self.confusions, self.words,
            now=datetime(2026, 8, 7, tzinfo=timezone.utc),
        )
        self.assertEqual([row["word_id"] for row in candidates], ["word-radyo"])
        self.assertEqual(candidates[0]["candidate_difficulty"], "intermediate")
        self.assertGreater(candidates[0]["weakness_match_score"], 0)
        self.assertEqual(candidates[0]["unseen_word"], 1)


if __name__ == "__main__":
    unittest.main()
