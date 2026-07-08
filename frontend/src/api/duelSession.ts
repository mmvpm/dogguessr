import type { BreedId, DuelSession } from "./types";

const SESSION_KEY = "dogguessr:duelSessions:v1";

type StoredSession = {
  playerId: string;
  playerToken: string;
};

let activeSession: DuelSession | null = null;
const selectedByRoomRound = new Map<string, BreedId | null>();

/** Stores the active duel credentials and persists them for refresh/rejoin. */
export function setActiveSession(session: DuelSession): void {
  activeSession = session;
  saveStoredSession(session.roomId, {
    playerId: session.playerId,
    playerToken: session.playerToken
  });
}

/** Reads the active in-memory duel session or fails before making authenticated calls. */
export function requireActiveSession(): DuelSession {
  if (!activeSession) {
    throw new Error("Duel session is not active");
  }
  return activeSession;
}

/** Clears only in-memory duel state, preserving stored credentials like before. */
export function clearActiveSession(): void {
  activeSession = null;
}

/** Reads persisted credentials for a room so refresh can rejoin the same player slot. */
export function readStoredSession(roomId: string): StoredSession | null {
  try {
    const sessions = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "{}") as Record<string, StoredSession>;
    return sessions[roomId] ?? null;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

/** Returns the currently selected breed for a room round, if any. */
export function getSelectedBreed(roomId: string, roundIndex: number, playerId = "default"): BreedId | null {
  return selectedByRoomRound.get(selectionKey(roomId, roundIndex, playerId)) ?? null;
}

/** Stores the currently selected breed for a room round in memory. */
export function setSelectedBreed(roomId: string, roundIndex: number, breedId: BreedId | null, playerId = "default"): void {
  selectedByRoomRound.set(selectionKey(roomId, roundIndex, playerId), breedId);
}

function saveStoredSession(roomId: string, session: StoredSession): void {
  const sessions = readStoredSessions();
  sessions[roomId] = session;
  localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
}

function readStoredSessions(): Record<string, StoredSession> {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "{}") as Record<string, StoredSession>;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return {};
  }
}

function selectionKey(roomId: string, roundIndex: number, playerId: string): string {
  return `${roomId}:${roundIndex}:${playerId}`;
}
