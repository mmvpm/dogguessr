import {
  getBreedImage,
  getBreedInfo,
  getBreedScore,
  getSharedGameData,
  makeDuelAnswerBreedIds
} from "./client";
import type {
  BreedId,
  DuelGuess,
  DuelHistoryResult,
  DuelSession,
  DuelSnapshot,
  DuelViewState
} from "./types";

const DUEL_ROUNDS = 7;
const SESSION_KEY = "dogguessr:duelSessions:v1";
const API_BASE = "https://functions.yandexcloud.net/d4ec787bcv63t735518s".replace(/\/$/, "");

type StoredSession = {
  playerId: string;
  playerToken: string;
};

type ApiSessionResponse = {
  roomId: string;
  playerId: string;
  playerToken: string;
  snapshot: DuelSnapshot;
};

let activeSession: DuelSession | null = null;
const pendingJoinByRoom = new Map<string, Promise<DuelViewState>>();
const selectedByRoomRound = new Map<string, BreedId | null>();

export const duelApi = {
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
    activeSession = { ...session, snapshot };
    return projectDuelView(snapshot, session.playerId);
  },

  async selectBreed(breedId: BreedId | null): Promise<DuelViewState> {
    const session = requireActiveSession();
    setSelectedBreed(session.roomId, session.snapshot.currentRoundIndex, breedId);
    return projectDuelView(session.snapshot, session.playerId);
  },

  async submitGuess(): Promise<DuelViewState> {
    const session = requireActiveSession();
    const selectedBreedId = getSelectedBreed(session.roomId, session.snapshot.currentRoundIndex);
    const snapshot = await requestSnapshot(`/rooms/${session.roomId}/guess`, {
      method: "POST",
      body: JSON.stringify({
        breedId: selectedBreedId,
        clientActionId: makeClientActionId()
      })
    }, session);
    activeSession = { ...session, snapshot };
    return projectDuelView(snapshot, session.playerId);
  },

  async readyNext(): Promise<DuelViewState> {
    const session = requireActiveSession();
    const snapshot = await requestSnapshot(`/rooms/${session.roomId}/ready-next`, { method: "POST" }, session);
    activeSession = { ...session, snapshot };
    return projectDuelView(snapshot, session.playerId);
  },

  clearSession(): void {
    activeSession = null;
  }
};

async function joinRoomOnce(roomId: string): Promise<DuelViewState> {
  const saved = readStoredSession(roomId);
  const session = await requestSession(`/rooms/${roomId}/join`, {
    method: "POST",
    body: JSON.stringify(saved ? { playerId: saved.playerId, playerToken: saved.playerToken } : {})
  });
  setActiveSession(session);
  return projectDuelView(session.snapshot, session.playerId);
}

async function projectDuelView(snapshot: DuelSnapshot, playerId: string): Promise<DuelViewState> {
  const shared = await getSharedGameData();
  const opponent = snapshot.players.find((player) => player.id !== playerId) ?? null;
  const currentRound = snapshot.rounds[snapshot.currentRoundIndex] ?? null;
  const history: DuelHistoryResult[] = [];

  for (const round of snapshot.rounds) {
    if (!round.revealedAt) {
      continue;
    }
    history.push(await makeHistoryResult(snapshot.roomId, playerId, opponent?.id ?? null, round));
  }

  const round = currentRound
    ? await makeRoundView(snapshot.roomId, playerId, opponent?.id ?? null, currentRound, snapshot.phase !== "revealed" && snapshot.phase !== "finished")
    : null;

  const pressure = Boolean(
    snapshot.phase === "guessing" &&
    currentRound?.firstGuessPlayerId &&
    currentRound.firstGuessPlayerId !== playerId &&
    !currentRound.guesses[playerId]
  );

  return {
    mode: "duel",
    roomId: snapshot.roomId,
    gameId: `duel:${snapshot.roomId}`,
    playerId,
    opponentPlayerId: opponent?.id ?? null,
    phase: snapshot.phase,
    status: snapshot.phase === "waiting" || snapshot.phase === "countdown" ? snapshot.phase : snapshot.phase === "finished" ? "finished" : snapshot.phase,
    map: shared.map,
    round,
    history,
    myTotalScore: history.reduce((sum, result) => sum + result.myScore, 0),
    opponentTotalScore: history.reduce((sum, result) => sum + result.opponentScore, 0),
    maxScore: DUEL_ROUNDS * 100,
    serverNow: snapshot.serverNow,
    deadlineAt: pressure ? currentRound?.secondDeadlineAt ?? null : null,
    roundStartsAt: snapshot.roundStartsAt,
    waitingForOpponent: snapshot.phase === "waiting",
    waitingForNext: snapshot.phase === "revealed" && snapshot.readyNextPlayerIds.includes(playerId),
    pressure
  };
}

async function makeRoundView(
  roomId: string,
  playerId: string,
  opponentPlayerId: string | null,
  round: DuelSnapshot["rounds"][number],
  hideAnswer: boolean
) {
  const myGuess = round.guesses[playerId] ?? null;
  const opponentGuess = opponentPlayerId ? round.guesses[opponentPlayerId] ?? null : null;
  const revealed = Boolean(round.revealedAt);
  const answerImage = await getBreedImage(round.answerBreedId, `${roomId}:${round.index}:answer`);
  const myScore = await scoreGuess(myGuess, round.answerBreedId);
  const opponentScore = revealed ? await scoreGuess(opponentGuess, round.answerBreedId) : 0;

  return {
    index: round.index + 1,
    total: DUEL_ROUNDS,
    answerImage,
    selectedBreedId: getSelectedBreed(roomId, round.index),
    answerBreed: hideAnswer ? null : await getBreedInfo(round.answerBreedId),
    myGuessBreed: myGuess?.breedId ? await getBreedInfo(myGuess.breedId) : null,
    myGuessImage: myGuess?.breedId ? await getBreedImage(myGuess.breedId, `${roomId}:${round.index}:${playerId}:guess`) : null,
    opponentGuessBreed: revealed && opponentGuess?.breedId ? await getBreedInfo(opponentGuess.breedId) : null,
    opponentGuessImage: revealed && opponentGuess?.breedId && opponentPlayerId ? await getBreedImage(opponentGuess.breedId, `${roomId}:${round.index}:${opponentPlayerId}:guess`) : null,
    myScore: revealed ? myScore : null,
    opponentScore: revealed ? opponentScore : null,
    myTimedOut: Boolean(myGuess?.timedOut),
    opponentTimedOut: Boolean(opponentGuess?.timedOut)
  };
}

async function makeHistoryResult(
  roomId: string,
  playerId: string,
  opponentPlayerId: string | null,
  round: DuelSnapshot["rounds"][number]
): Promise<DuelHistoryResult> {
  const view = await makeRoundView(roomId, playerId, opponentPlayerId, round, false);
  return {
    index: view.index,
    answerBreed: view.answerBreed!,
    answerImage: view.answerImage,
    myGuessBreed: view.myGuessBreed,
    myGuessImage: view.myGuessImage,
    opponentGuessBreed: view.opponentGuessBreed,
    opponentGuessImage: view.opponentGuessImage,
    myScore: view.myScore ?? 0,
    opponentScore: view.opponentScore ?? 0,
    myTimedOut: view.myTimedOut,
    opponentTimedOut: view.opponentTimedOut
  };
}

async function scoreGuess(guess: DuelGuess | null, answerBreedId: BreedId): Promise<number> {
  return (await getBreedScore(guess?.breedId ?? null, answerBreedId)).score;
}

async function requestSession(path: string, init: RequestInit): Promise<DuelSession> {
  const response = await request<ApiSessionResponse>(path, init);
  return {
    roomId: response.roomId,
    playerId: response.playerId,
    playerToken: response.playerToken,
    snapshot: response.snapshot
  };
}

async function requestSnapshot(path: string, init: RequestInit, session: DuelSession): Promise<DuelSnapshot> {
  return request<DuelSnapshot>(path, {
    ...init,
    headers: {
      ...init.headers,
      "X-Dogguessr-Player-Id": session.playerId,
      "X-Dogguessr-Player-Token": session.playerToken
    }
  });
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  if (!API_BASE) {
    throw new Error("Duel API is not configured");
  }

  const url = new URL(API_BASE);
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

function setActiveSession(session: DuelSession): void {
  activeSession = session;
  saveStoredSession(session.roomId, {
    playerId: session.playerId,
    playerToken: session.playerToken
  });
}

function requireActiveSession(): DuelSession {
  if (!activeSession) {
    throw new Error("Duel session is not active");
  }
  return activeSession;
}

function readStoredSession(roomId: string): StoredSession | null {
  try {
    const sessions = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "{}") as Record<string, StoredSession>;
    return sessions[roomId] ?? null;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
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

function getSelectedBreed(roomId: string, roundIndex: number): BreedId | null {
  return selectedByRoomRound.get(selectionKey(roomId, roundIndex)) ?? null;
}

function setSelectedBreed(roomId: string, roundIndex: number, breedId: BreedId | null): void {
  selectedByRoomRound.set(selectionKey(roomId, roundIndex), breedId);
}

function selectionKey(roomId: string, roundIndex: number): string {
  return `${roomId}:${roundIndex}`;
}

function makeClientActionId(): string {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
