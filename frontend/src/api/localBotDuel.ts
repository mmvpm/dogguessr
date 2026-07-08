import { COUNTDOWN_MS, DUEL_ROUNDS, REVEALED_AUTO_NEXT_MS, SECOND_GUESS_MS, SERVER_TIMEOUT_GRACE_MS } from "./duelConstants";
import {
  createDuelBotMemory,
  makeDuelBotVisibleView,
  planDuelBotTurn,
  type DuelBotCommand,
  type DuelBotMemory
} from "./duelBot";
import { projectDuelView } from "./duelProjection";
import { getSelectedBreed, setSelectedBreed } from "./duelSession";
import type { BreedId, DuelGuess, DuelSnapshot, DuelViewState } from "./types";

const LOCAL_BOT_DUELS_KEY = "dogguessr:localBotDuels:v1";
const LOCAL_BOT_PLAYER_ID = "p2";

type LocalBotDuel = {
  roomId: string;
  playerId: string;
  botPlayerId: string;
  snapshot: DuelSnapshot;
  botMemory: DuelBotMemory;
};

let activeLocalBotDuel: LocalBotDuel | null = null;

/** Returns whether a local bot duel is currently active in memory. */
export function hasActiveLocalBotDuel(): boolean {
  return activeLocalBotDuel !== null;
}

/** Restores a local bot duel for a room path before the app tries backend rejoin. */
export async function restoreLocalBotDuel(roomId: string): Promise<DuelViewState | null> {
  const stored = readLocalBotDuels()[roomId] ?? null;
  if (!stored) {
    return null;
  }
  activeLocalBotDuel = stored;
  return getLocalBotDuelState();
}

/** Converts a public waiting snapshot into a persisted local duel against the frontend bot. */
export async function startLocalBotDuelFromWaitingSnapshot(snapshot: DuelSnapshot, playerId: string): Promise<DuelViewState> {
  const nowMs = Date.now();
  // Local bot duels intentionally keep the backend DuelSnapshot shape so the existing
  // projection remains responsible for hiding opponent guesses until reveal.
  const localSnapshot: DuelSnapshot = {
    ...snapshot,
    version: snapshot.version + 1,
    phase: "countdown",
    players: [
      snapshot.players.find((player) => player.id === playerId) ?? { id: playerId, slot: 0 },
      { id: LOCAL_BOT_PLAYER_ID, slot: 1 }
    ],
    roundStartsAt: isoFromMs(nowMs + COUNTDOWN_MS),
    readyNextPlayerIds: [],
    readyNextStartedAt: null,
    serverNow: isoFromMs(nowMs),
    rounds: snapshot.rounds.map((round) => ({
      ...round,
      firstGuessPlayerId: null,
      secondDeadlineAt: null,
      revealedAt: null,
      guesses: {}
    }))
  };

  activeLocalBotDuel = {
    roomId: snapshot.roomId,
    playerId,
    botPlayerId: LOCAL_BOT_PLAYER_ID,
    snapshot: localSnapshot,
    botMemory: createDuelBotMemory()
  };
  saveActiveLocalBotDuel();
  return getLocalBotDuelState();
}

/** Reads the current local bot duel after applying local timers and bot commands. */
export async function getLocalBotDuelState(): Promise<DuelViewState> {
  const duel = requireActiveLocalBotDuel();
  normalizeLocalSnapshot(duel, Date.now());
  await runBotTurn(duel);
  normalizeLocalSnapshot(duel, Date.now());
  saveActiveLocalBotDuel();
  return projectDuelView(duel.snapshot, duel.playerId);
}

/** Updates the local selected breed for the human player. */
export async function selectLocalBotDuelBreed(breedId: BreedId | null): Promise<DuelViewState> {
  const duel = requireActiveLocalBotDuel();
  normalizeLocalSnapshot(duel, Date.now());
  setSelectedBreed(duel.roomId, duel.snapshot.currentRoundIndex, breedId, duel.playerId);
  saveActiveLocalBotDuel();
  return projectDuelView(duel.snapshot, duel.playerId);
}

/** Submits the human player's local guess through the same state rules as a server duel. */
export async function submitLocalBotDuelGuess(): Promise<DuelViewState> {
  const duel = requireActiveLocalBotDuel();
  submitGuessForPlayer(duel, duel.playerId, Date.now());
  await runBotTurn(duel);
  normalizeLocalSnapshot(duel, Date.now());
  saveActiveLocalBotDuel();
  return projectDuelView(duel.snapshot, duel.playerId);
}

/** Marks the human player ready for the next local duel round. */
export async function readyLocalBotDuelNext(): Promise<DuelViewState> {
  const duel = requireActiveLocalBotDuel();
  readyNextForPlayer(duel, duel.playerId, Date.now());
  await runBotTurn(duel);
  normalizeLocalSnapshot(duel, Date.now());
  saveActiveLocalBotDuel();
  return projectDuelView(duel.snapshot, duel.playerId);
}

/** Clears the active local bot duel and its refresh restore record. */
export function clearLocalBotDuel(): void {
  const roomId = activeLocalBotDuel?.roomId;
  activeLocalBotDuel = null;
  if (!roomId) {
    return;
  }
  const duels = readLocalBotDuels();
  delete duels[roomId];
  writeLocalBotDuels(duels);
}

async function runBotTurn(duel: LocalBotDuel): Promise<void> {
  if (duel.snapshot.phase === "finished") {
    return;
  }

  // The bot receives a projection as the opponent player, then a sanitized visible view.
  // This is the only intentional dependency between local state and bot logic.
  const botView = makeDuelBotVisibleView(await projectDuelView(duel.snapshot, duel.botPlayerId));
  const planned = planDuelBotTurn(botView, duel.botMemory, Date.now());
  duel.botMemory = planned.memory;
  for (const command of planned.commands) {
    applyBotCommand(duel, command, Date.now());
  }
}

function applyBotCommand(duel: LocalBotDuel, command: DuelBotCommand, nowMs: number): void {
  if (command.type === "selectBreed") {
    setSelectedBreed(duel.roomId, duel.snapshot.currentRoundIndex, command.breedId, duel.botPlayerId);
  } else if (command.type === "submitGuess") {
    submitGuessForPlayer(duel, duel.botPlayerId, nowMs);
  } else {
    readyNextForPlayer(duel, duel.botPlayerId, nowMs);
  }
}

function submitGuessForPlayer(duel: LocalBotDuel, playerId: string, nowMs: number): void {
  normalizeLocalSnapshot(duel, nowMs);
  if (duel.snapshot.phase !== "guessing") {
    return;
  }

  const round = currentRound(duel.snapshot);
  if (round.guesses[playerId]) {
    return;
  }

  const deadlineMs = round.secondDeadlineAt ? new Date(round.secondDeadlineAt).getTime() : null;
  const timedOut = deadlineMs !== null && nowMs >= deadlineMs;
  const submittedAtMs = timedOut && deadlineMs !== null ? deadlineMs : nowMs;
  round.guesses[playerId] = {
    breedId: getSelectedBreed(duel.roomId, round.index, playerId),
    submittedAt: isoFromMs(submittedAtMs),
    clientActionId: makeLocalActionId(playerId, round.index, submittedAtMs),
    timedOut
  };

  if (!round.firstGuessPlayerId) {
    round.firstGuessPlayerId = playerId;
    round.secondDeadlineAt = isoFromMs(nowMs + SECOND_GUESS_MS);
  } else if (Object.keys(round.guesses).length >= duel.snapshot.players.length || timedOut) {
    revealRound(duel.snapshot, submittedAtMs);
  }
  touchSnapshot(duel.snapshot, nowMs);
}

function readyNextForPlayer(duel: LocalBotDuel, playerId: string, nowMs: number): void {
  normalizeLocalSnapshot(duel, nowMs);
  if (duel.snapshot.phase !== "revealed" || duel.snapshot.readyNextPlayerIds.includes(playerId)) {
    return;
  }

  if (!duel.snapshot.readyNextPlayerIds.length) {
    duel.snapshot.readyNextStartedAt = isoFromMs(nowMs);
  }
  duel.snapshot.readyNextPlayerIds = [...duel.snapshot.readyNextPlayerIds, playerId].sort();
  if (duel.snapshot.readyNextPlayerIds.length >= duel.snapshot.players.length) {
    advanceAfterReveal(duel.snapshot, nowMs);
  }
  touchSnapshot(duel.snapshot, nowMs);
}

function normalizeLocalSnapshot(duel: LocalBotDuel, nowMs: number): void {
  const snapshot = duel.snapshot;
  if (snapshot.phase === "countdown" && snapshot.roundStartsAt && nowMs >= new Date(snapshot.roundStartsAt).getTime()) {
    snapshot.phase = "guessing";
    snapshot.roundStartsAt = null;
    touchSnapshot(snapshot, nowMs);
  }

  if (snapshot.phase === "guessing") {
    const round = currentRound(snapshot);
    if (round.secondDeadlineAt && nowMs >= new Date(round.secondDeadlineAt).getTime() + SERVER_TIMEOUT_GRACE_MS) {
      for (const player of snapshot.players) {
        if (!round.guesses[player.id]) {
          round.guesses[player.id] = timeoutGuess(round, player.id);
        }
      }
      revealRound(snapshot, new Date(round.secondDeadlineAt).getTime());
      touchSnapshot(snapshot, nowMs);
    } else if (Object.keys(round.guesses).length >= snapshot.players.length) {
      revealRound(snapshot, nowMs);
      touchSnapshot(snapshot, nowMs);
    }
  }

  if (snapshot.phase === "revealed" && snapshot.readyNextPlayerIds.length && snapshot.readyNextStartedAt) {
    if (nowMs >= new Date(snapshot.readyNextStartedAt).getTime() + REVEALED_AUTO_NEXT_MS) {
      advanceAfterReveal(snapshot, nowMs);
      touchSnapshot(snapshot, nowMs);
    }
  }

  snapshot.serverNow = isoFromMs(nowMs);
}

function advanceAfterReveal(snapshot: DuelSnapshot, nowMs: number): void {
  if (snapshot.currentRoundIndex >= DUEL_ROUNDS - 1) {
    snapshot.phase = "finished";
    snapshot.roundStartsAt = null;
    snapshot.readyNextPlayerIds = [];
    snapshot.readyNextStartedAt = null;
    return;
  }
  snapshot.currentRoundIndex += 1;
  snapshot.phase = "countdown";
  snapshot.roundStartsAt = isoFromMs(nowMs + COUNTDOWN_MS);
  snapshot.readyNextPlayerIds = [];
  snapshot.readyNextStartedAt = null;
}

function revealRound(snapshot: DuelSnapshot, revealedAtMs: number): void {
  const round = currentRound(snapshot);
  if (round.revealedAt) {
    return;
  }
  round.revealedAt = isoFromMs(revealedAtMs);
  snapshot.phase = "revealed";
  snapshot.roundStartsAt = null;
  snapshot.readyNextPlayerIds = [];
  snapshot.readyNextStartedAt = null;
}

function timeoutGuess(round: DuelSnapshot["rounds"][number], playerId: string): DuelGuess {
  return {
    breedId: null,
    submittedAt: round.secondDeadlineAt ?? isoFromMs(Date.now()),
    clientActionId: `local-timeout:${round.index}:${playerId}`,
    timedOut: true
  };
}

function currentRound(snapshot: DuelSnapshot): DuelSnapshot["rounds"][number] {
  return snapshot.rounds[snapshot.currentRoundIndex];
}

function touchSnapshot(snapshot: DuelSnapshot, nowMs: number): void {
  snapshot.version += 1;
  snapshot.serverNow = isoFromMs(nowMs);
}

function requireActiveLocalBotDuel(): LocalBotDuel {
  if (!activeLocalBotDuel) {
    throw new Error("Local bot duel is not active");
  }
  return activeLocalBotDuel;
}

function saveActiveLocalBotDuel(): void {
  if (!activeLocalBotDuel) {
    return;
  }
  const duels = readLocalBotDuels();
  duels[activeLocalBotDuel.roomId] = activeLocalBotDuel;
  writeLocalBotDuels(duels);
}

function readLocalBotDuels(): Record<string, LocalBotDuel> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_BOT_DUELS_KEY) ?? "{}") as Record<string, LocalBotDuel>;
  } catch {
    localStorage.removeItem(LOCAL_BOT_DUELS_KEY);
    return {};
  }
}

function writeLocalBotDuels(duels: Record<string, LocalBotDuel>): void {
  localStorage.setItem(LOCAL_BOT_DUELS_KEY, JSON.stringify(duels));
}

function makeLocalActionId(playerId: string, roundIndex: number, nowMs: number): string {
  return `local:${playerId}:${roundIndex}:${nowMs.toString(36)}`;
}

function isoFromMs(value: number): string {
  return new Date(value).toISOString();
}
