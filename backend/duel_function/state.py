import hashlib
import secrets
import string
import time
from copy import deepcopy

ROOM_ID_ALPHABET = string.ascii_letters + string.digits
ROOM_ID_LENGTH = 6
DUEL_ROUNDS = 7
COUNTDOWN_MS = 3000
SECOND_GUESS_MS = 15000
# Clients submit the timeout guess at 15s. The server auto-reveals at 20s
# to give that POST a small grace window before polling can close the round.
SERVER_TIMEOUT_GRACE_MS = 5000
REVEALED_AUTO_NEXT_MS = 10000
ROOM_TTL_MS = 24 * 60 * 60 * 1000
PUBLIC_WAITING_HEARTBEAT_GRACE_MS = 8000


class StateError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.status_code = status_code


def now_ms():
    return int(time.time() * 1000)


def iso_from_ms(value):
    if value is None:
        return None
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(value // 1000)) + f".{value % 1000:03d}Z"


def generate_room_id():
    return "".join(secrets.choice(ROOM_ID_ALPHABET) for _ in range(ROOM_ID_LENGTH))


def generate_token():
    return secrets.token_urlsafe(24)


def token_hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_room_state(room_id, answer_breed_ids, created_at_ms, visibility="private"):
    if len(answer_breed_ids) != DUEL_ROUNDS:
        raise StateError("Duel requires exactly 7 rounds")
    if len(set(answer_breed_ids)) != DUEL_ROUNDS:
        raise StateError("Duel rounds must be unique")
    if visibility not in ("private", "public"):
        raise StateError("Invalid room visibility")

    player_id = "p1"
    player_token = generate_token()
    state = {
        "schemaVersion": 1,
        "roomId": room_id,
        "visibility": visibility,
        "status": "waiting",
        "createdAtMs": created_at_ms,
        "updatedAtMs": created_at_ms,
        "expiresAtMs": created_at_ms + ROOM_TTL_MS,
        "players": [{
            "id": player_id,
            "slot": 0,
            "tokenHash": token_hash(player_token),
            "joinedAtMs": created_at_ms
        }],
        "currentRoundIndex": 0,
        "roundStartsAtMs": None,
        "readyNextPlayerIds": [],
        "readyNextStartedAtMs": None,
        "rounds": [
            {
                "index": index,
                "answerBreedId": breed_id,
                "firstGuessPlayerId": None,
                "secondDeadlineAtMs": None,
                "revealedAtMs": None,
                "guesses": {}
            }
            for index, breed_id in enumerate(answer_breed_ids)
        ]
    }
    return state, player_id, player_token


def join_room(state, player_id, player_token, current_ms):
    mutable = normalize_state(deepcopy(state), current_ms)
    existing = authenticate_optional(mutable, player_id, player_token)
    if existing:
        return mutable, existing["id"], player_token

    if len(mutable["players"]) >= 2:
        raise StateError("Room is full", 409)

    next_player_id = f"p{len(mutable['players']) + 1}"
    next_token = generate_token()
    mutable["players"].append({
        "id": next_player_id,
        "slot": len(mutable["players"]),
        "tokenHash": token_hash(next_token),
        "joinedAtMs": current_ms
    })
    if mutable["status"] == "waiting":
        start_countdown(mutable, current_ms)
    mutable["updatedAtMs"] = current_ms
    return mutable, next_player_id, next_token


def submit_guess(state, player_id, player_token, breed_id, client_action_id, current_ms):
    mutable = normalize_state(deepcopy(state), current_ms)
    authenticate_required(mutable, player_id, player_token)
    if mutable["status"] != "guessing":
        return mutable

    round_state = current_round(mutable)
    guesses = round_state["guesses"]
    existing = guesses.get(player_id)
    if existing:
        if existing.get("clientActionId") == client_action_id:
            return mutable
        raise StateError("Guess already submitted", 409)

    deadline = round_state["secondDeadlineAtMs"]
    timed_out = deadline is not None and current_ms >= deadline

    guesses[player_id] = {
        "breedId": breed_id,
        "submittedAtMs": deadline if timed_out else current_ms,
        "clientActionId": client_action_id,
        "timedOut": timed_out
    }

    if not round_state["firstGuessPlayerId"]:
        round_state["firstGuessPlayerId"] = player_id
        round_state["secondDeadlineAtMs"] = current_ms + SECOND_GUESS_MS
    elif len(guesses) >= 2 or timed_out:
        reveal_round(mutable, deadline if timed_out else current_ms)

    mutable["updatedAtMs"] = current_ms
    return mutable


def ready_next(state, player_id, player_token, current_ms):
    mutable = normalize_state(deepcopy(state), current_ms)
    authenticate_required(mutable, player_id, player_token)
    if mutable["status"] != "revealed":
        return mutable

    ready = set(mutable["readyNextPlayerIds"])
    if player_id in ready:
        return mutable
    if not ready:
        mutable["readyNextStartedAtMs"] = current_ms
    ready.add(player_id)
    mutable["readyNextPlayerIds"] = sorted(ready)
    if len(ready) >= len(mutable["players"]):
        if mutable["currentRoundIndex"] >= DUEL_ROUNDS - 1:
            mutable["status"] = "finished"
        else:
            mutable["currentRoundIndex"] += 1
            start_countdown(mutable, current_ms)
    mutable["updatedAtMs"] = current_ms
    return mutable


def heartbeat_waiting_room(state, player_id, player_token, current_ms):
    mutable = normalize_state(deepcopy(state), current_ms)
    authenticate_required(mutable, player_id, player_token)
    if mutable["visibility"] != "public" or mutable["status"] != "waiting":
        raise StateError("Room is not waiting for public matchmaking", 409)
    mutable["updatedAtMs"] = current_ms
    return mutable


def expire_public_waiting_room(state, player_id, player_token, current_ms):
    mutable = normalize_state(deepcopy(state), current_ms)
    authenticate_required(mutable, player_id, player_token)
    if mutable["visibility"] != "public" or mutable["status"] != "waiting":
        return mutable
    mutable["updatedAtMs"] = current_ms
    mutable["expiresAtMs"] = current_ms
    return mutable


def normalize_state(state, current_ms):
    state.setdefault("visibility", "private")
    state.setdefault("readyNextStartedAtMs", None)

    if current_ms >= state["expiresAtMs"]:
        raise StateError("Room expired", 410)

    if state["status"] == "countdown" and state["roundStartsAtMs"] is not None and current_ms >= state["roundStartsAtMs"]:
        state["status"] = "guessing"
        state["roundStartsAtMs"] = None
        state["updatedAtMs"] = current_ms

    if state["status"] == "guessing":
        round_state = current_round(state)
        deadline = round_state["secondDeadlineAtMs"]
        if deadline is not None and current_ms >= deadline + SERVER_TIMEOUT_GRACE_MS:
            for player in state["players"]:
                if player["id"] not in round_state["guesses"]:
                    round_state["guesses"][player["id"]] = {
                        "breedId": None,
                        "submittedAtMs": deadline,
                        "clientActionId": f"timeout:{round_state['index']}:{player['id']}",
                        "timedOut": True
                    }
            reveal_round(state, deadline)
            state["updatedAtMs"] = current_ms

    if state["status"] == "revealed":
        ready_started_at = state["readyNextStartedAtMs"]
        if state["readyNextPlayerIds"] and ready_started_at is not None and current_ms >= ready_started_at + REVEALED_AUTO_NEXT_MS:
            if state["currentRoundIndex"] >= DUEL_ROUNDS - 1:
                state["status"] = "finished"
                state["updatedAtMs"] = current_ms
            else:
                state["currentRoundIndex"] += 1
                start_countdown(state, current_ms)
                state["updatedAtMs"] = current_ms
    return state


def filtered_snapshot(state, current_ms, viewer_player_id=None):
    normalized = normalize_state(deepcopy(state), current_ms)
    return {
        "roomId": normalized["roomId"],
        "version": normalized.get("version", 0),
        "visibility": normalized["visibility"],
        "phase": normalized["status"],
        "players": [{"id": player["id"], "slot": player["slot"]} for player in normalized["players"]],
        "currentRoundIndex": normalized["currentRoundIndex"],
        "roundStartsAt": iso_from_ms(normalized["roundStartsAtMs"]),
        "rounds": [filtered_round(round_state, viewer_player_id) for round_state in normalized["rounds"]],
        "readyNextPlayerIds": normalized["readyNextPlayerIds"],
        "readyNextStartedAt": iso_from_ms(normalized["readyNextStartedAtMs"]),
        "serverNow": iso_from_ms(current_ms)
    }


def filtered_round(round_state, viewer_player_id=None):
    revealed = round_state["revealedAtMs"] is not None
    guesses = round_state["guesses"] if revealed else {
        player_id: guess
        for player_id, guess in round_state["guesses"].items()
        if viewer_player_id is not None and player_id == viewer_player_id
    }
    return {
        "index": round_state["index"],
        "answerBreedId": round_state["answerBreedId"],
        "firstGuessPlayerId": round_state["firstGuessPlayerId"],
        "secondDeadlineAt": iso_from_ms(round_state["secondDeadlineAtMs"]),
        "revealedAt": iso_from_ms(round_state["revealedAtMs"]),
        "guesses": {
            player_id: {
                "breedId": guess["breedId"],
                "submittedAt": iso_from_ms(guess["submittedAtMs"]),
                "clientActionId": guess["clientActionId"],
                "timedOut": guess["timedOut"]
            }
            for player_id, guess in guesses.items()
        }
    }


def start_countdown(state, current_ms):
    state["status"] = "countdown"
    state["roundStartsAtMs"] = current_ms + COUNTDOWN_MS
    state["readyNextPlayerIds"] = []
    state["readyNextStartedAtMs"] = None


def reveal_round(state, revealed_at_ms):
    round_state = current_round(state)
    if round_state["revealedAtMs"] is not None:
        return
    round_state["revealedAtMs"] = revealed_at_ms
    state["status"] = "revealed"
    state["roundStartsAtMs"] = None
    state["readyNextPlayerIds"] = []
    state["readyNextStartedAtMs"] = None


def current_round(state):
    return state["rounds"][state["currentRoundIndex"]]


def authenticate_optional(state, player_id, player_token):
    if not player_id or not player_token:
        return None
    for player in state["players"]:
        if player["id"] == player_id and player["tokenHash"] == token_hash(player_token):
            return player
    return None


def authenticate_required(state, player_id, player_token):
    player = authenticate_optional(state, player_id, player_token)
    if not player:
        raise StateError("Invalid player session", 403)
    return player
