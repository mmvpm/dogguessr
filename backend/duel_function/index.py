import base64
import json
import re
from copy import deepcopy

from repository import (
    delete_public_waiting_room,
    insert_public_waiting_room,
    insert_room,
    read_public_waiting_room,
    read_room,
    update_public_waiting_heartbeat,
    update_room,
)
from state import (
    PUBLIC_WAITING_HEARTBEAT_GRACE_MS,
    StateError,
    create_room_state,
    expire_public_waiting_room,
    filtered_snapshot,
    generate_room_id,
    heartbeat_waiting_room,
    join_room,
    normalize_state,
    now_ms,
    ready_next,
    submit_guess,
)

ROOM_RE = re.compile(r"^/rooms/([A-Za-z0-9]{6})(?:/(join|guess|ready-next|heartbeat|leave))?$")


def handler(event, context):
    try:
        method = event.get("httpMethod", "GET")
        path = route_path(event)
        if method == "OPTIONS":
            return response(204, {})
        if method == "POST" and path == "/rooms":
            return create_room(parse_body(event))
        if method == "POST" and path == "/matchmaking/public":
            return create_public_match(parse_body(event))

        match = ROOM_RE.match(path)
        if not match:
            raise StateError("Not found", 404)

        room_id, action = match.groups()
        if method == "GET" and action is None:
            return get_room(room_id, event)
        if method == "POST" and action == "join":
            return join_existing_room(room_id, parse_body(event))
        if method == "POST" and action == "guess":
            return mutate_room(room_id, event, lambda state, body, ms: submit_guess(
                state,
                player_id(event),
                player_token(event),
                body.get("breedId"),
                body.get("clientActionId"),
                ms
            ), parse_body(event))
        if method == "POST" and action == "ready-next":
            return mutate_room(room_id, event, lambda state, body, ms: ready_next(
                state,
                player_id(event),
                player_token(event),
                ms
            ), {})
        if method == "POST" and action == "heartbeat":
            return heartbeat_room(room_id, event)
        if method == "POST" and action == "leave":
            return leave_room(room_id, event)
        raise StateError("Not found", 404)
    except StateError as exc:
        return response(exc.status_code, {"error": str(exc)})
    except Exception as exc:
        return response(500, {
            "error": str(exc),
            "errorType": type(exc).__name__,
            "errorRepr": repr(exc)
        })


def create_room(body):
    room_id = generate_room_id()
    ms = now_ms()
    state, created_player_id, created_token = create_room_state(room_id, body.get("answerBreedIds", []), ms)
    insert_room(room_id, state)
    return response(200, {
        "roomId": room_id,
        "playerId": created_player_id,
        "playerToken": created_token,
        "snapshot": filtered_snapshot(state, ms, created_player_id)
    })


def create_public_match(body):
    for attempt in range(4):
        ms = now_ms()
        queued = read_public_waiting_room()
        if queued:
            joined = try_join_public_waiting_room(queued, ms)
            if joined:
                return joined

        room_id = generate_room_id()
        state, created_player_id, created_token = create_room_state(room_id, body.get("answerBreedIds", []), ms, "public")
        try:
            insert_public_waiting_room(room_id, state, created_player_id, ms, ms + PUBLIC_WAITING_HEARTBEAT_GRACE_MS)
            return response(200, {
                "roomId": room_id,
                "playerId": created_player_id,
                "playerToken": created_token,
                "snapshot": filtered_snapshot({**state, "version": 1}, ms, created_player_id)
            })
        except Exception:
            if attempt == 3:
                raise
    raise StateError("Could not enter matchmaking", 409)


def try_join_public_waiting_room(queued, ms):
    room_id = queued["roomId"]
    if queued["expiresAtMs"] <= ms or queued["heartbeatAtMs"] + PUBLIC_WAITING_HEARTBEAT_GRACE_MS < ms:
        delete_public_waiting_room(room_id)
        return None

    try:
        state = read_room(room_id)
    except StateError as exc:
        if exc.status_code in (404, 410):
            delete_public_waiting_room(room_id)
            return None
        raise

    if state.get("visibility", "private") != "public" or state.get("status") != "waiting" or len(state.get("players", [])) != 1:
        delete_public_waiting_room(room_id)
        return None

    try:
        next_state, joined_player_id, joined_token = join_room(state, None, None, ms)
        next_state = update_room(room_id, next_state)
    except StateError as exc:
        if exc.status_code in (409, 410):
            return None
        raise

    delete_public_waiting_room(room_id)
    return response(200, {
        "roomId": room_id,
        "playerId": joined_player_id,
        "playerToken": joined_token,
        "snapshot": filtered_snapshot(next_state, ms, joined_player_id)
    })


def get_room(room_id, event):
    ms = now_ms()
    for attempt in range(2):
        state = read_room(room_id)
        next_state = normalize_state(deepcopy(state), ms)
        try:
            if next_state != state:
                next_state = update_room(room_id, next_state)
            return response(200, filtered_snapshot(next_state, ms, player_id(event)))
        except StateError:
            if attempt == 1:
                raise


def join_existing_room(room_id, body):
    ms = now_ms()
    for attempt in range(2):
        state = read_room(room_id)
        ensure_public_waiting_room_is_fresh(state, ms)
        next_state, joined_player_id, joined_token = join_room(state, body.get("playerId"), body.get("playerToken"), ms)
        try:
            if next_state != state:
                next_state = update_room(room_id, next_state)
            return response(200, {
                "roomId": room_id,
                "playerId": joined_player_id,
                "playerToken": joined_token,
                "snapshot": filtered_snapshot(next_state, ms, joined_player_id)
            })
        except StateError:
            if attempt == 1:
                raise


def ensure_public_waiting_room_is_fresh(state, ms):
    if state.get("visibility", "private") != "public" or state.get("status") != "waiting":
        return
    queued = read_public_waiting_room()
    if not queued or queued["roomId"] != state["roomId"]:
        raise StateError("Public room is no longer waiting", 410)
    if queued["expiresAtMs"] <= ms or queued["heartbeatAtMs"] + PUBLIC_WAITING_HEARTBEAT_GRACE_MS < ms:
        delete_public_waiting_room(state["roomId"])
        raise StateError("Public room is no longer waiting", 410)


def mutate_room(room_id, event, mutate, body):
    ms = now_ms()
    for attempt in range(2):
        state = read_room(room_id)
        next_state = mutate(state, body, ms)
        try:
            if next_state != state:
                next_state = update_room(room_id, next_state)
            return response(200, filtered_snapshot(next_state, ms, player_id(event)))
        except StateError:
            if attempt == 1:
                raise


def heartbeat_room(room_id, event):
    ms = now_ms()
    for attempt in range(2):
        state = read_room(room_id)
        next_state = heartbeat_waiting_room(state, player_id(event), player_token(event), ms)
        try:
            next_state = update_room(room_id, next_state)
            update_public_waiting_heartbeat(room_id, player_id(event), ms, ms + PUBLIC_WAITING_HEARTBEAT_GRACE_MS)
            return response(200, filtered_snapshot(next_state, ms, player_id(event)))
        except StateError:
            if attempt == 1:
                raise


def leave_room(room_id, event):
    ms = now_ms()
    state = read_room(room_id)
    left_queue = state.get("visibility", "private") == "public" and state.get("status") == "waiting"
    next_state = expire_public_waiting_room(state, player_id(event), player_token(event), ms)
    if next_state != state:
        update_room(room_id, next_state)
    delete_public_waiting_room(room_id)
    return response(200, {"left": True, "leftQueue": left_queue})


def parse_body(event):
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    return json.loads(raw)


def route_path(event):
    query = event.get("queryStringParameters") or {}
    path = query.get("path")
    if path:
        return path
    return event.get("path") or ""


def player_id(event):
    return headers(event).get("x-dogguessr-player-id")


def player_token(event):
    return headers(event).get("x-dogguessr-player-token")


def headers(event):
    return {key.lower(): value for key, value in (event.get("headers") or {}).items()}


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type,X-Dogguessr-Player-Id,X-Dogguessr-Player-Token"
        },
        "body": json.dumps(body, ensure_ascii=False)
    }
