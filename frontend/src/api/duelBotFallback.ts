import { PUBLIC_BOT_FALLBACK_MS } from "./duelConstants";
import { projectDuelView } from "./duelProjection";
import { clearActiveSession, requireActiveSession, setActiveSession } from "./duelSession";
import { requestAuthenticatedCommand, requestSnapshot } from "./duelTransport";
import {
  clearLocalBotDuel,
  getLocalBotDuelState,
  hasActiveLocalBotDuel,
  readyLocalBotDuelNext,
  restoreLocalBotDuel,
  selectLocalBotDuelBreed,
  startLocalBotDuelFromWaitingSnapshot,
  submitLocalBotDuelGuess
} from "./localBotDuel";
import type { DuelApiImpl } from "./remoteDuelApi";
import type { DuelViewState } from "./types";

type LeaveRoomResponse = {
  left: boolean;
  leftQueue?: boolean;
};

/** Decorates a server-backed duel API with the public-matchmaking bot fallback. */
export function withBotFallback(remote: DuelApiImpl): DuelApiImpl {
  let publicWaitingStartedAtMs: number | null = null;

  const resetFallback = () => {
    clearLocalBotDuel();
    publicWaitingStartedAtMs = null;
  };

  const rememberPublicWaiting = (view: DuelViewState) => {
    if (view.visibility === "public" && view.phase === "waiting") {
      publicWaitingStartedAtMs ??= Date.now();
    } else {
      publicWaitingStartedAtMs = null;
    }
  };

  const shouldStartLocalBotDuel = (view: DuelViewState) => view.visibility === "public" &&
    view.phase === "waiting" &&
    publicWaitingStartedAtMs !== null &&
    Date.now() - publicWaitingStartedAtMs >= PUBLIC_BOT_FALLBACK_MS;

  const startLocalBotDuelAfterLeavingQueue = async () => {
    const session = requireActiveSession();
    const left = await requestAuthenticatedCommand<LeaveRoomResponse>(`/rooms/${session.roomId}/leave`, { method: "POST" }, session);
    // leftQueue confirms the server still saw this room in public waiting state.
    // Without it, a real player could join between polling and the fallback leave call.
    if (!left.leftQueue) {
      const snapshot = await requestSnapshot(`/rooms/${session.roomId}`, { method: "GET" }, session);
      setActiveSession({ ...session, snapshot });
      publicWaitingStartedAtMs = null;
      return projectDuelView(snapshot, session.playerId);
    }
    clearActiveSession();
    publicWaitingStartedAtMs = null;
    return startLocalBotDuelFromWaitingSnapshot(session.snapshot, session.playerId);
  };

  return {
    roomIdFromPath: () => remote.roomIdFromPath(),

    async createRoom() {
      resetFallback();
      return remote.createRoom();
    },

    async findPublicMatch() {
      resetFallback();
      const view = await remote.findPublicMatch();
      rememberPublicWaiting(view);
      return view;
    },

    async joinRoom(roomId) {
      resetFallback();
      return remote.joinRoom(roomId);
    },

    async restoreFromPath() {
      const roomId = remote.roomIdFromPath();
      if (!roomId) {
        return null;
      }
      const local = await restoreLocalBotDuel(roomId);
      if (local) {
        clearActiveSession();
        publicWaitingStartedAtMs = null;
        return local;
      }
      return remote.restoreFromPath();
    },

    async getState() {
      if (hasActiveLocalBotDuel()) {
        return getLocalBotDuelState();
      }
      const view = await remote.getState();
      if (shouldStartLocalBotDuel(view)) {
        return startLocalBotDuelAfterLeavingQueue();
      }
      rememberPublicWaiting(view);
      return view;
    },

    selectBreed: (breedId) => hasActiveLocalBotDuel()
      ? selectLocalBotDuelBreed(breedId)
      : remote.selectBreed(breedId),

    submitGuess: () => hasActiveLocalBotDuel()
      ? submitLocalBotDuelGuess()
      : remote.submitGuess(),

    readyNext: () => hasActiveLocalBotDuel()
      ? readyLocalBotDuelNext()
      : remote.readyNext(),

    heartbeatWaitingRoom: () => hasActiveLocalBotDuel()
      ? getLocalBotDuelState()
      : remote.heartbeatWaitingRoom(),

    async leaveRoom() {
      if (hasActiveLocalBotDuel()) {
        clearLocalBotDuel();
        return;
      }
      return remote.leaveRoom();
    },

    clearSession() {
      resetFallback();
      remote.clearSession();
    }
  };
}
