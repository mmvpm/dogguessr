import json
import os

import ydb

from state import StateError

_driver = None
_pool = None


def pool():
    global _driver, _pool
    if _pool is None:
        endpoint = os.environ["YDB_ENDPOINT"]
        database = os.environ["YDB_DATABASE"]
        print("ydb_driver_init_start")
        driver_config = ydb.DriverConfig(
            endpoint,
            database,
            credentials=ydb.credentials_from_env_variables(),
            root_certificates=ydb.load_ydb_root_certificate(),
        )
        _driver = ydb.Driver(driver_config)
        try:
            _driver.wait(timeout=15)
        except TimeoutError as exc:
            details = _driver.discovery_debug_details()
            print("ydb_driver_init_timeout", details)
            raise StateError(f"YDB connect timeout: {details}", 500) from exc
        _pool = ydb.QuerySessionPool(_driver)
        print("ydb_driver_init_done")
    return _pool


def execute_query(query, params=None):
    return pool().execute_with_retries(query, params or {})


def insert_room(room_id, state):
    print("ydb_insert_room_start", room_id)
    query = """
    DECLARE $room_id AS Utf8;
    DECLARE $version AS Int64;
    DECLARE $created_at_ms AS Int64;
    DECLARE $updated_at_ms AS Int64;
    DECLARE $expires_at_ms AS Int64;
    DECLARE $state_json AS Utf8;

    INSERT INTO duel_rooms (room_id, version, created_at_ms, updated_at_ms, expires_at_ms, state_json)
    VALUES ($room_id, Unwrap(CAST($version AS Uint64)), $created_at_ms, $updated_at_ms, $expires_at_ms, $state_json);
    """
    params = {
        "$room_id": room_id,
        "$version": 1,
        "$created_at_ms": state["createdAtMs"],
        "$updated_at_ms": state["updatedAtMs"],
        "$expires_at_ms": state["expiresAtMs"],
        "$state_json": dump_state(state)
    }
    execute_query(query, params)
    print("ydb_insert_room_done", room_id)


def insert_public_waiting_room(room_id, state, waiting_player_id, heartbeat_at_ms, queue_expires_at_ms):
    print("ydb_insert_public_waiting_room_start", room_id)
    query = """
    DECLARE $queue_id AS Utf8;
    DECLARE $room_id AS Utf8;
    DECLARE $waiting_player_id AS Utf8;
    DECLARE $heartbeat_at_ms AS Int64;
    DECLARE $version AS Int64;
    DECLARE $created_at_ms AS Int64;
    DECLARE $updated_at_ms AS Int64;
    DECLARE $room_expires_at_ms AS Int64;
    DECLARE $queue_expires_at_ms AS Int64;
    DECLARE $state_json AS Utf8;

    INSERT INTO duel_rooms (room_id, version, created_at_ms, updated_at_ms, expires_at_ms, state_json)
    VALUES ($room_id, Unwrap(CAST($version AS Uint64)), $created_at_ms, $updated_at_ms, $room_expires_at_ms, $state_json);

    INSERT INTO duel_public_matchmaking (queue_id, room_id, waiting_player_id, heartbeat_at_ms, expires_at_ms)
    VALUES ($queue_id, $room_id, $waiting_player_id, $heartbeat_at_ms, $queue_expires_at_ms);
    """
    execute_query(query, {
        "$queue_id": "public",
        "$room_id": room_id,
        "$waiting_player_id": waiting_player_id,
        "$heartbeat_at_ms": heartbeat_at_ms,
        "$version": 1,
        "$created_at_ms": state["createdAtMs"],
        "$updated_at_ms": state["updatedAtMs"],
        "$room_expires_at_ms": state["expiresAtMs"],
        "$queue_expires_at_ms": queue_expires_at_ms,
        "$state_json": dump_state(state)
    })
    print("ydb_insert_public_waiting_room_done", room_id)


def read_public_waiting_room():
    print("ydb_read_public_waiting_room_start")
    query = """
    DECLARE $queue_id AS Utf8;
    SELECT queue_id, room_id, waiting_player_id, heartbeat_at_ms, expires_at_ms
    FROM duel_public_matchmaking
    WHERE queue_id = $queue_id;
    """
    result_sets = execute_query(query, {"$queue_id": "public"})
    rows = result_sets[0].rows
    if not rows:
        print("ydb_read_public_waiting_room_empty")
        return None
    row = rows[0]
    queued = {
        "queueId": row_value(row, "queue_id"),
        "roomId": row_value(row, "room_id"),
        "waitingPlayerId": row_value(row, "waiting_player_id"),
        "heartbeatAtMs": int(row_value(row, "heartbeat_at_ms")),
        "expiresAtMs": int(row_value(row, "expires_at_ms")),
    }
    print("ydb_read_public_waiting_room_done", queued["roomId"])
    return queued


def update_public_waiting_heartbeat(room_id, player_id, heartbeat_at_ms, expires_at_ms):
    print("ydb_update_public_waiting_heartbeat_start", room_id)
    query = """
    DECLARE $queue_id AS Utf8;
    DECLARE $room_id AS Utf8;
    DECLARE $waiting_player_id AS Utf8;
    DECLARE $heartbeat_at_ms AS Int64;
    DECLARE $expires_at_ms AS Int64;

    UPDATE duel_public_matchmaking
    SET heartbeat_at_ms = $heartbeat_at_ms,
        expires_at_ms = $expires_at_ms
    WHERE queue_id = $queue_id
      AND room_id = $room_id
      AND waiting_player_id = $waiting_player_id;
    """
    execute_query(query, {
        "$queue_id": "public",
        "$room_id": room_id,
        "$waiting_player_id": player_id,
        "$heartbeat_at_ms": heartbeat_at_ms,
        "$expires_at_ms": expires_at_ms
    })
    queued = read_public_waiting_room()
    if not queued or queued["roomId"] != room_id or queued["waitingPlayerId"] != player_id or queued["heartbeatAtMs"] != heartbeat_at_ms:
        raise StateError("Public matchmaking room is no longer queued", 409)
    print("ydb_update_public_waiting_heartbeat_done", room_id)


def delete_public_waiting_room(room_id=None):
    print("ydb_delete_public_waiting_room_start", room_id)
    if room_id:
        query = """
        DECLARE $queue_id AS Utf8;
        DECLARE $room_id AS Utf8;
        DELETE FROM duel_public_matchmaking
        WHERE queue_id = $queue_id AND room_id = $room_id;
        """
        params = {"$queue_id": "public", "$room_id": room_id}
    else:
        query = """
        DECLARE $queue_id AS Utf8;
        DELETE FROM duel_public_matchmaking
        WHERE queue_id = $queue_id;
        """
        params = {"$queue_id": "public"}
    execute_query(query, params)
    print("ydb_delete_public_waiting_room_done", room_id)


def read_room(room_id):
    print("ydb_read_room_start", room_id)
    query = """
    DECLARE $room_id AS Utf8;
    SELECT room_id, version, state_json
    FROM duel_rooms
    WHERE room_id = $room_id;
    """
    result_sets = execute_query(query, {"$room_id": room_id})
    rows = result_sets[0].rows
    if not rows:
        raise StateError("Room not found", 404)
    row = rows[0]
    state = json.loads(row_value(row, "state_json"))
    state["version"] = int(row_value(row, "version"))
    print("ydb_read_room_done", room_id)
    return state


def update_room(room_id, state):
    print("ydb_update_room_start", room_id)
    version = int(state.get("version", 1))
    next_version = version + 1
    state = {**state, "version": next_version}
    query = """
    DECLARE $room_id AS Utf8;
    DECLARE $version AS Int64;
    DECLARE $next_version AS Int64;
    DECLARE $updated_at_ms AS Int64;
    DECLARE $expires_at_ms AS Int64;
    DECLARE $state_json AS Utf8;

    UPDATE duel_rooms
    SET version = Unwrap(CAST($next_version AS Uint64)),
        updated_at_ms = $updated_at_ms,
        expires_at_ms = $expires_at_ms,
        state_json = $state_json
    WHERE room_id = $room_id AND version = Unwrap(CAST($version AS Uint64));
    """
    execute_query(query, {
        "$room_id": room_id,
        "$version": version,
        "$next_version": next_version,
        "$updated_at_ms": state["updatedAtMs"],
        "$expires_at_ms": state["expiresAtMs"],
        "$state_json": dump_state(state)
    })
    persisted = read_room(room_id)
    if int(persisted.get("version", 0)) != next_version or dump_state({k: v for k, v in persisted.items() if k != "version"}) != dump_state({k: v for k, v in state.items() if k != "version"}):
        raise StateError("Room changed, retry", 409)
    print("ydb_update_room_done", room_id)
    return persisted


def dump_state(state):
    return json.dumps(state, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def row_value(row, key):
    if isinstance(row, dict):
        return row[key]
    return getattr(row, key)
