import base64
import json
import re

from repository import insert_room, read_room, update_room
from state import (
    StateError,
    create_room_state,
    filtered_snapshot,
    generate_room_id,
    join_room,
    now_ms,
    ready_next,
    submit_guess,
)

ROOM_RE = re.compile(r"^/rooms/([A-Za-z0-9]{6})(?:/(join|guess|ready-next))?$")


def handler(event, context):
    try:
        method = event.get("httpMethod", "GET")
        path = route_path(event)
        if method == "OPTIONS":
            return response(204, {})
        if method == "POST" and path == "/rooms":
            return create_room(parse_body(event))

        match = ROOM_RE.match(path)
        if not match:
            raise StateError("Not found", 404)

        room_id, action = match.groups()
        if method == "GET" and action is None:
            return get_room(room_id)
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
        "snapshot": filtered_snapshot(state, ms)
    })


def get_room(room_id):
    ms = now_ms()
    state = read_room(room_id)
    return response(200, filtered_snapshot(state, ms))


def join_existing_room(room_id, body):
    ms = now_ms()
    for attempt in range(2):
        state = read_room(room_id)
        next_state, joined_player_id, joined_token = join_room(state, body.get("playerId"), body.get("playerToken"), ms)
        try:
            if next_state != state:
                next_state = update_room(room_id, next_state)
            return response(200, {
                "roomId": room_id,
                "playerId": joined_player_id,
                "playerToken": joined_token,
                "snapshot": filtered_snapshot(next_state, ms)
            })
        except StateError:
            if attempt == 1:
                raise


def mutate_room(room_id, event, mutate, body):
    ms = now_ms()
    for attempt in range(2):
        state = read_room(room_id)
        next_state = mutate(state, body, ms)
        try:
            if next_state != state:
                next_state = update_room(room_id, next_state)
            return response(200, filtered_snapshot(next_state, ms))
        except StateError:
            if attempt == 1:
                raise


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
