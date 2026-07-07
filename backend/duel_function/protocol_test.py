import base64
import json
import os
import sys
import types
import unittest
from copy import deepcopy
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))
sys.modules.setdefault("ydb", types.SimpleNamespace())

import index
from state import (
    COUNTDOWN_MS,
    SECOND_GUESS_MS,
    SERVER_TIMEOUT_GRACE_MS,
    StateError,
    create_room_state,
    filtered_snapshot,
    join_room,
    ready_next,
    submit_guess,
)


class DuelProtocolTest(unittest.TestCase):
    def test_snapshot_wire_shape_and_phase_values_match_frontend_contract(self):
        state, p1, token1 = create_room_state("abc123", answer_ids(), 1_000)
        waiting = filtered_snapshot(state, 1_050, p1)

        self.assertEqual(list(waiting.keys()), [
            "roomId",
            "version",
            "phase",
            "players",
            "currentRoundIndex",
            "roundStartsAt",
            "rounds",
            "readyNextPlayerIds",
            "serverNow",
        ])
        self.assertEqual(waiting["phase"], "waiting")
        self.assertEqual(waiting["players"], [{"id": "p1", "slot": 0}])
        self.assertNotIn("tokenHash", waiting["players"][0])
        self.assertEqual(waiting["serverNow"], "1970-01-01T00:00:01.050Z")

        round_snapshot = waiting["rounds"][0]
        self.assertEqual(list(round_snapshot.keys()), [
            "index",
            "answerBreedId",
            "firstGuessPlayerId",
            "secondDeadlineAt",
            "revealedAt",
            "guesses",
        ])
        self.assertEqual(round_snapshot["answerBreedId"], "Affenpinscher")
        self.assertIsNone(round_snapshot["firstGuessPlayerId"])
        self.assertIsNone(round_snapshot["secondDeadlineAt"])
        self.assertIsNone(round_snapshot["revealedAt"])
        self.assertEqual(round_snapshot["guesses"], {})

        state, p2, token2 = join_room(state, None, None, 1_100)
        countdown = filtered_snapshot(state, 1_100, p1)
        guessing = filtered_snapshot(state, 1_100 + COUNTDOWN_MS, p1)
        state = submit_guess(state, p1, token1, "Affenpinscher", "p1-r0", 5_000)
        state = submit_guess(state, p2, token2, "Akita", "p2-r0", 5_100)
        revealed = filtered_snapshot(state, 5_100, p1)
        state = ready_next(state, p1, token1, 5_200)
        state = ready_next(state, p2, token2, 5_300)
        next_countdown = filtered_snapshot(state, 5_300, p1)

        state["currentRoundIndex"] = 6
        state["status"] = "revealed"
        state["rounds"][6]["revealedAtMs"] = 99_000
        state = ready_next(state, p1, token1, 99_100)
        state = ready_next(state, p2, token2, 99_200)
        finished = filtered_snapshot(state, 99_200, p1)

        self.assertEqual([
            waiting["phase"],
            countdown["phase"],
            guessing["phase"],
            revealed["phase"],
            next_countdown["phase"],
            finished["phase"],
        ], ["waiting", "countdown", "guessing", "revealed", "countdown", "finished"])
        self.assertEqual(revealed["rounds"][0]["guesses"][p1], {
            "breedId": "Affenpinscher",
            "submittedAt": "1970-01-01T00:00:05.000Z",
            "clientActionId": "p1-r0",
            "timedOut": False,
        })
        self.assertEqual(revealed["readyNextPlayerIds"], [])
        self.assertEqual(finished["currentRoundIndex"], 6)

    def test_hides_opponent_guess_before_reveal_and_shows_both_after_reveal(self):
        state, p1, token1 = create_room_state("abc123", answer_ids(), 1_000)
        state, p2, token2 = join_room(state, None, None, 1_100)
        state = submit_guess(state, p1, token1, "Affenpinscher", "p1-r0", 5_000)

        p2_before_reveal = filtered_snapshot(state, 5_050, p2)
        p1_before_reveal = filtered_snapshot(state, 5_050, p1)
        self.assertEqual(p2_before_reveal["rounds"][0]["guesses"], {})
        self.assertIn(p1, p1_before_reveal["rounds"][0]["guesses"])
        self.assertEqual(p2_before_reveal["rounds"][0]["firstGuessPlayerId"], p1)

        state = submit_guess(state, p2, token2, "Akita", "p2-r0", 5_100)
        p2_after_reveal = filtered_snapshot(state, 5_100, p2)
        self.assertEqual(set(p2_after_reveal["rounds"][0]["guesses"].keys()), {p1, p2})
        self.assertEqual(p2_after_reveal["rounds"][0]["revealedAt"], "1970-01-01T00:00:05.100Z")

    def test_second_player_deadline_and_server_grace_are_wire_visible(self):
        state, p1, token1 = create_room_state("abc123", answer_ids(), 1_000)
        state, p2, _token2 = join_room(state, None, None, 1_100)
        state = submit_guess(state, p1, token1, "Affenpinscher", "p1-r0", 5_000)
        deadline = 5_000 + SECOND_GUESS_MS

        before_grace = filtered_snapshot(state, deadline + SERVER_TIMEOUT_GRACE_MS - 1, p2)
        after_grace = filtered_snapshot(state, deadline + SERVER_TIMEOUT_GRACE_MS, p2)

        self.assertEqual(before_grace["phase"], "guessing")
        self.assertEqual(before_grace["rounds"][0]["secondDeadlineAt"], "1970-01-01T00:00:20.000Z")
        self.assertEqual(before_grace["rounds"][0]["guesses"], {})
        self.assertEqual(after_grace["phase"], "revealed")
        self.assertEqual(after_grace["rounds"][0]["revealedAt"], "1970-01-01T00:00:20.000Z")
        self.assertEqual(after_grace["rounds"][0]["guesses"][p2], {
            "breedId": None,
            "submittedAt": "1970-01-01T00:00:20.000Z",
            "clientActionId": "timeout:0:p2",
            "timedOut": True,
        })

    def test_duplicate_guess_is_idempotent_only_for_same_client_action_id(self):
        state, p1, token1 = create_room_state("abc123", answer_ids(), 1_000)
        state, _p2, _token2 = join_room(state, None, None, 1_100)
        guessed = submit_guess(state, p1, token1, "Affenpinscher", "same-action", 5_000)
        repeated = submit_guess(guessed, p1, token1, "Akita", "same-action", 5_050)

        self.assertEqual(repeated, guessed)
        with self.assertRaises(StateError) as raised:
            submit_guess(guessed, p1, token1, "Akita", "different-action", 5_060)
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(str(raised.exception), "Guess already submitted")

    def test_session_tokens_are_required_for_mutations_and_reused_on_join(self):
        state, p1, token1 = create_room_state("abc123", answer_ids(), 1_000)
        same_state, same_player_id, same_token = join_room(state, p1, token1, 1_050)
        self.assertEqual(same_state, state)
        self.assertEqual(same_player_id, p1)
        self.assertEqual(same_token, token1)

        with self.assertRaises(StateError) as raised:
            submit_guess(state, p1, "wrong-token", "Affenpinscher", "p1-r0", 5_000)
        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(str(raised.exception), "Invalid player session")

    def test_ready_next_requires_both_players_and_finishes_final_round(self):
        state, p1, token1 = create_room_state("abc123", answer_ids(), 1_000)
        state, p2, token2 = join_room(state, None, None, 1_100)
        state = submit_guess(state, p1, token1, "Affenpinscher", "p1-r0", 5_000)
        state = submit_guess(state, p2, token2, "Akita", "p2-r0", 5_100)

        one_ready = ready_next(state, p1, token1, 5_200)
        self.assertEqual(one_ready["status"], "revealed")
        self.assertEqual(one_ready["readyNextPlayerIds"], [p1])

        next_round = ready_next(one_ready, p2, token2, 5_300)
        self.assertEqual(next_round["status"], "countdown")
        self.assertEqual(next_round["currentRoundIndex"], 1)
        self.assertEqual(next_round["readyNextPlayerIds"], [])

        next_round["currentRoundIndex"] = 6
        next_round["status"] = "revealed"
        next_round["rounds"][6]["revealedAtMs"] = 99_000
        final_one_ready = ready_next(next_round, p1, token1, 99_100)
        finished = ready_next(final_one_ready, p2, token2, 99_200)
        self.assertEqual(finished["status"], "finished")
        self.assertEqual(finished["currentRoundIndex"], 6)


class DuelHandlerContractTest(unittest.TestCase):
    def test_handler_uses_query_path_json_body_session_headers_and_cors_contract(self):
        rooms = {}

        def insert_room(room_id, state):
            rooms[room_id] = {**deepcopy(state), "version": 1}

        def read_room(room_id):
            if room_id not in rooms:
                raise StateError("Room not found", 404)
            return deepcopy(rooms[room_id])

        def update_room(room_id, state):
            next_state = {**deepcopy(state), "version": int(state.get("version", 1)) + 1}
            rooms[room_id] = next_state
            return deepcopy(next_state)

        with patch.object(index, "generate_room_id", return_value="abc123"), \
                patch.object(index, "now_ms", side_effect=[1_000, 1_100, 5_000]), \
                patch.object(index, "insert_room", side_effect=insert_room), \
                patch.object(index, "read_room", side_effect=read_room), \
                patch.object(index, "update_room", side_effect=update_room):
            created = call_handler({
                "httpMethod": "POST",
                "path": "/rooms",
                "body": json.dumps({"answerBreedIds": answer_ids()}),
            })
            self.assertEqual(created["statusCode"], 200)
            self.assertEqual(created["headers"]["Access-Control-Allow-Headers"], "Content-Type,X-Dogguessr-Player-Id,X-Dogguessr-Player-Token")
            created_body = json.loads(created["body"])
            self.assertEqual(created_body["roomId"], "abc123")
            self.assertEqual(created_body["playerId"], "p1")
            self.assertEqual(created_body["snapshot"]["phase"], "waiting")

            joined = call_handler({
                "httpMethod": "POST",
                "path": "/ignored-by-query-param",
                "queryStringParameters": {"path": "/rooms/abc123/join"},
                "body": base64.b64encode(b"{}").decode("ascii"),
                "isBase64Encoded": True,
            })
            joined_body = json.loads(joined["body"])
            self.assertEqual(joined["statusCode"], 200)
            self.assertEqual(joined_body["playerId"], "p2")
            self.assertEqual(joined_body["snapshot"]["phase"], "countdown")

            guessed = call_handler({
                "httpMethod": "POST",
                "path": "/rooms/abc123/guess",
                "headers": {
                    "X-Dogguessr-Player-Id": created_body["playerId"],
                    "X-Dogguessr-Player-Token": created_body["playerToken"],
                },
                "body": json.dumps({"breedId": "Affenpinscher", "clientActionId": "p1-r0"}),
            })
            guessed_body = json.loads(guessed["body"])
            self.assertEqual(guessed["statusCode"], 200)
            self.assertEqual(guessed_body["phase"], "guessing")
            self.assertEqual(guessed_body["rounds"][0]["firstGuessPlayerId"], "p1")

        missing = call_handler({"httpMethod": "GET", "path": "/rooms/not-a-room"})
        self.assertEqual(missing["statusCode"], 404)
        self.assertEqual(json.loads(missing["body"]), {"error": "Not found"})


def call_handler(event):
    return index.handler(event, None)


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
