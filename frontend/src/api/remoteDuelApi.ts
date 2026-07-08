import { makeDuelAnswerBreedIds } from "./client";
import { DUEL_ROUNDS } from "./duelConstants";
import { projectDuelView } from "./duelProjection";
import {
  clearActiveSession,
  getSelectedBreed,
  readStoredSession,
  requireActiveSession,
  setActiveSession,
  setSelectedBreed
} from "./duelSession";
import { requestAuthenticatedCommand, requestSession, requestSnapshot } from "./duelTransport";
import type { BreedId, DuelViewState } from "./types";

const pendingJoinByRoom = new Map<string, Promise<DuelViewState>>();

export type DuelApiImpl = {
  roomIdFromPath(): string | null;
  createRoom(): Promise<DuelViewState>;
  findPublicMatch(): Promise<DuelViewState>;
  joinRoom(roomId: string): Promise<DuelViewState>;
  restoreFromPath(): Promise<DuelViewState | null>;
  getState(): Promise<DuelViewState>;
  selectBreed(breedId: BreedId | null): Promise<DuelViewState>;
  submitGuess(): Promise<DuelViewState>;
  readyNext(): Promise<DuelViewState>;
  heartbeatWaitingRoom(): Promise<DuelViewState>;
  leaveRoom(): Promise<void>;
  clearSession(): void;
};

/** Creates the server-backed duel implementation used by the public facade. */
export function createRemoteDuelApi(): DuelApiImpl {
  return {
    roomIdFromPath(): string | null {
      const roomId = window.location.pathname.replace(/^\/+|\/+$/g, "");
      return /^[A-Za-z0-9]{6}$/.test(roomId) ? roomId : null;
    },

    async createRoom(): Promise<DuelViewState> {
      const answerBreedIds = await makeDuelAnswerBreedIds(DUEL_ROUNDS);
      const session = await requestSession("/rooms", {
        method: "POST",
        body: JSON.stringify({ answerBreedIds })
      });
      setActiveSession(session);
      window.history.pushState(null, "", `/${session.roomId}`);
      return projectDuelView(session.snapshot, session.playerId);
    },

    async findPublicMatch(): Promise<DuelViewState> {
      const answerBreedIds = await makeDuelAnswerBreedIds(DUEL_ROUNDS);
      const session = await requestSession("/matchmaking/public", {
        method: "POST",
        body: JSON.stringify({ answerBreedIds })
      });
      setActiveSession(session);
      window.history.pushState(null, "", `/${session.roomId}`);
      return projectDuelView(session.snapshot, session.playerId);
    },

    async joinRoom(roomId: string): Promise<DuelViewState> {
      const pending = pendingJoinByRoom.get(roomId);
      if (pending) {
        return pending;
      }

      const joining = joinRoomOnce(roomId).finally(() => {
        pendingJoinByRoom.delete(roomId);
      });
      pendingJoinByRoom.set(roomId, joining);
      return joining;
    },

    async restoreFromPath(): Promise<DuelViewState | null> {
      const roomId = this.roomIdFromPath();
      if (!roomId) {
        return null;
      }
      return this.joinRoom(roomId);
    },

    async getState(): Promise<DuelViewState> {
      const session = requireActiveSession();
      const snapshot = await requestSnapshot(`/rooms/${session.roomId}`, { method: "GET" }, session);
      setActiveSession({ ...session, snapshot });
      return projectDuelView(snapshot, session.playerId);
    },

    async selectBreed(breedId: BreedId | null): Promise<DuelViewState> {
      const session = requireActiveSession();
      setSelectedBreed(session.roomId, session.snapshot.currentRoundIndex, breedId, session.playerId);
      return projectDuelView(session.snapshot, session.playerId);
    },

    async submitGuess(): Promise<DuelViewState> {
      const session = requireActiveSession();
      const selectedBreedId = getSelectedBreed(session.roomId, session.snapshot.currentRoundIndex, session.playerId);
      const snapshot = await requestSnapshot(`/rooms/${session.roomId}/guess`, {
        method: "POST",
        body: JSON.stringify({
          breedId: selectedBreedId,
          clientActionId: makeClientActionId()
        })
      }, session);
      setActiveSession({ ...session, snapshot });
      return projectDuelView(snapshot, session.playerId);
    },

    async readyNext(): Promise<DuelViewState> {
      const session = requireActiveSession();
      const snapshot = await requestSnapshot(`/rooms/${session.roomId}/ready-next`, { method: "POST" }, session);
      setActiveSession({ ...session, snapshot });
      return projectDuelView(snapshot, session.playerId);
    },

    async heartbeatWaitingRoom(): Promise<DuelViewState> {
      const session = requireActiveSession();
      const snapshot = await requestSnapshot(`/rooms/${session.roomId}/heartbeat`, { method: "POST" }, session);
      setActiveSession({ ...session, snapshot });
      return projectDuelView(snapshot, session.playerId);
    },

    async leaveRoom(): Promise<void> {
      const session = requireActiveSession();
      await requestAuthenticatedCommand(`/rooms/${session.roomId}/leave`, { method: "POST" }, session);
      clearActiveSession();
    },

    clearSession(): void {
      clearActiveSession();
    }
  };
}

async function joinRoomOnce(roomId: string): Promise<DuelViewState> {
  const saved = readStoredSession(roomId);
  const session = await requestSession(`/rooms/${roomId}/join`, {
    method: "POST",
    body: JSON.stringify(saved ? { playerId: saved.playerId, playerToken: saved.playerToken } : {})
  });
  setActiveSession(session);
  return projectDuelView(session.snapshot, session.playerId);
}

function makeClientActionId(): string {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
