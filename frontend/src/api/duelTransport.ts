import { DUEL_API_BASE } from "./duelConstants";
import type { DuelSession, DuelSnapshot } from "./types";

type ApiSessionResponse = {
  roomId: string;
  playerId: string;
  playerToken: string;
  snapshot: DuelSnapshot;
};

/** Calls the backend endpoint that returns credentials plus a snapshot. */
export async function requestSession(path: string, init: RequestInit): Promise<DuelSession> {
  const response = await request<ApiSessionResponse>(path, init);
  return {
    roomId: response.roomId,
    playerId: response.playerId,
    playerToken: response.playerToken,
    snapshot: response.snapshot
  };
}

/** Calls an authenticated backend endpoint that returns only the room snapshot. */
export async function requestSnapshot(path: string, init: RequestInit, session: DuelSession): Promise<DuelSnapshot> {
  return request<DuelSnapshot>(path, {
    ...init,
    headers: {
      ...init.headers,
      "X-Dogguessr-Player-Id": session.playerId,
      "X-Dogguessr-Player-Token": session.playerToken
    }
  });
}

/** Calls an authenticated backend endpoint for commands whose response body is optional. */
export async function requestAuthenticatedCommand<T = unknown>(path: string, init: RequestInit, session: DuelSession): Promise<T> {
  return request<T>(path, {
    ...init,
    headers: {
      ...init.headers,
      "X-Dogguessr-Player-Id": session.playerId,
      "X-Dogguessr-Player-Token": session.playerToken
    }
  });
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  if (!DUEL_API_BASE) {
    throw new Error("Duel API is not configured");
  }

  const url = new URL(DUEL_API_BASE);
  url.searchParams.set("path", path);

  const response = await fetch(url.toString(), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers
    }
  });
  const body = await response.text();
  const parsed = body ? JSON.parse(body) as { error?: string } : {};
  if (!response.ok) {
    throw new Error(parsed.error ?? `Duel API error: ${response.status}`);
  }
  return parsed as T;
}
