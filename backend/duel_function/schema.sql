CREATE TABLE duel_rooms (
  room_id Utf8 NOT NULL,
  version Uint64 NOT NULL,
  created_at_ms Int64 NOT NULL,
  updated_at_ms Int64 NOT NULL,
  expires_at_ms Int64 NOT NULL,
  state_json Utf8 NOT NULL,
  PRIMARY KEY (room_id)
);

CREATE TABLE duel_public_matchmaking (
  queue_id Utf8 NOT NULL,
  room_id Utf8 NOT NULL,
  waiting_player_id Utf8 NOT NULL,
  heartbeat_at_ms Int64 NOT NULL,
  expires_at_ms Int64 NOT NULL,
  PRIMARY KEY (queue_id)
);
