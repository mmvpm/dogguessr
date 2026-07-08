import unittest

from state import (
    REVEALED_AUTO_NEXT_MS,
    SECOND_GUESS_MS,
    SERVER_TIMEOUT_GRACE_MS,
    create_room_state,
    filtered_snapshot,
    join_room,
    ready_next,
    submit_guess,
)


class DuelStateTest(unittest.TestCase):
    def test_timeout_submit_with_selected_breed_counts_as_timed_out_guess(self):
        state, p1, token1 = create_room_state("abc123", answer_ids(), 1_000)
        state, p2, token2 = join_room(state, None, None, 1_100)
        state = submit_guess(state, p1, token1, "Affenpinscher", "p1-guess", 5_000)

        deadline = state["rounds"][0]["secondDeadlineAtMs"]
        snapshot = filtered_snapshot(state, deadline + 30, p2)
        self.assertEqual(snapshot["phase"], "guessing")

        state = submit_guess(state, p2, token2, "Akita", "p2-timeout", deadline + 30)

        round_state = state["rounds"][0]
        self.assertEqual(state["status"], "revealed")
        self.assertEqual(round_state["guesses"][p2]["breedId"], "Akita")
        self.assertTrue(round_state["guesses"][p2]["timedOut"])
        self.assertEqual(round_state["guesses"][p2]["submittedAtMs"], deadline)
        self.assertEqual(round_state["revealedAtMs"], deadline)

    def test_timeout_submit_without_selected_breed_stays_empty(self):
        state, p1, token1 = create_room_state("abc123", answer_ids(), 1_000)
        state, p2, token2 = join_room(state, None, None, 1_100)
        state = submit_guess(state, p1, token1, "Affenpinscher", "p1-guess", 5_000)

        deadline = state["rounds"][0]["secondDeadlineAtMs"]
        state = submit_guess(state, p2, token2, None, "p2-timeout", deadline + 30)

        round_state = state["rounds"][0]
        self.assertEqual(state["status"], "revealed")
        self.assertIsNone(round_state["guesses"][p2]["breedId"])
        self.assertTrue(round_state["guesses"][p2]["timedOut"])

    def test_polling_auto_timeout_waits_for_server_grace(self):
        state, p1, token1 = create_room_state("abc123", answer_ids(), 1_000)
        state, p2, _token2 = join_room(state, None, None, 1_100)
        state = submit_guess(state, p1, token1, "Affenpinscher", "p1-guess", 5_000)

        deadline = state["rounds"][0]["secondDeadlineAtMs"]
        early_snapshot = filtered_snapshot(state, deadline + SERVER_TIMEOUT_GRACE_MS - 1, p2)
        late_snapshot = filtered_snapshot(state, deadline + SERVER_TIMEOUT_GRACE_MS, p2)

        self.assertEqual(early_snapshot["phase"], "guessing")
        self.assertEqual(late_snapshot["phase"], "revealed")
        self.assertIsNone(late_snapshot["rounds"][0]["guesses"][p2]["breedId"])

    def test_snapshot_hides_opponent_guess_until_reveal(self):
        state, p1, token1 = create_room_state("abc123", answer_ids(), 1_000)
        state, p2, _token2 = join_room(state, None, None, 1_100)
        state = submit_guess(state, p1, token1, "Affenpinscher", "p1-guess", 5_000)

        p2_snapshot = filtered_snapshot(state, 5_100, p2)
        self.assertNotIn(p1, p2_snapshot["rounds"][0]["guesses"])
        self.assertEqual(p2_snapshot["rounds"][0]["firstGuessPlayerId"], p1)

        revealed_snapshot = filtered_snapshot(state, 5_000 + SECOND_GUESS_MS + SERVER_TIMEOUT_GRACE_MS, p2)
        self.assertIn(p1, revealed_snapshot["rounds"][0]["guesses"])
        self.assertIn(p2, revealed_snapshot["rounds"][0]["guesses"])

    def test_public_visibility_is_visible_in_snapshot(self):
        state, p1, _token1 = create_room_state("abc123", answer_ids(), 1_000, "public")
        snapshot = filtered_snapshot(state, 1_050, p1)

        self.assertEqual(snapshot["visibility"], "public")

    def test_revealed_round_waits_for_ready_before_auto_advance(self):
        state, p1, token1 = create_room_state("abc123", answer_ids(), 1_000)
        state, p2, token2 = join_room(state, None, None, 1_100)
        state = submit_guess(state, p1, token1, "Affenpinscher", "p1-guess", 5_000)
        state = submit_guess(state, p2, token2, "Akita", "p2-guess", 5_100)

        revealed_at = state["rounds"][0]["revealedAtMs"]
        without_ready = filtered_snapshot(state, revealed_at + REVEALED_AUTO_NEXT_MS, p1)
        state = ready_next(state, p1, token1, revealed_at + REVEALED_AUTO_NEXT_MS + 5_000)
        ready_started_at = state["readyNextStartedAtMs"]
        early = filtered_snapshot(state, ready_started_at + REVEALED_AUTO_NEXT_MS - 1, p1)
        late = filtered_snapshot(state, ready_started_at + REVEALED_AUTO_NEXT_MS, p1)

        self.assertEqual(without_ready["phase"], "revealed")
        self.assertEqual(early["phase"], "revealed")
        self.assertEqual(late["phase"], "countdown")
        self.assertEqual(late["currentRoundIndex"], 1)


def answer_ids():
    return [
        "Affenpinscher",
        "Akita",
        "Basenji",
        "Beagle",
        "Boxer",
        "Briard",
        "Chow Chow",
    ]


if __name__ == "__main__":
    unittest.main()
