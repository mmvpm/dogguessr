import type { BreedId, GameSettings, GameStatus, GameViewState, ImageRef, RoundResult, RoundView } from "./types";
import { loadGameData, pickImage, requireBreed, type GameData } from "./gameData";
import { calculateScore, getSimilarity, MAX_ROUND_SCORE } from "./scoring";

const GAME_KEY = "dogguessr:activeGame:v1";

type ActiveRound = {
  index: number;
  answerBreedId: BreedId;
  answerImage: ImageRef;
  startedAt: string;
  deadlineAt: string | null;
  selectedBreedId: BreedId | null;
  revealed: RoundResult | null;
};

type LocalGame = {
  id: string;
  settings: GameSettings;
  answerBreedIds: BreedId[];
  currentRound: ActiveRound;
  history: RoundResult[];
};

let game: LocalGame | null = null;

/** Creates a new solo game and saves the full client-side state. */
export async function createSoloGame(settings: GameSettings): Promise<GameViewState> {
  const data = await loadGameData();
  const now = new Date();
  const validSettings = validateSettings(settings);
  const answers = sample(data.catalog.map((record) => record.id), validSettings.roundCount);
  const gameId = makeGameId();
  const nextGame: LocalGame = {
    id: gameId,
    settings: validSettings,
    answerBreedIds: answers,
    currentRound: makeRound(data, gameId, validSettings, answers, 0, now),
    history: []
  };
  game = nextGame;
  saveGame();
  return view(data, nextGame, now);
}

/** Restores a solo game from localStorage and applies timeout reveal if needed. */
export async function restoreSoloGame(): Promise<GameViewState | null> {
  const data = await loadGameData();
  game = readGame();
  if (!game) {
    return null;
  }
  revealIfTimedOut(data, game, new Date());
  saveGame();
  return view(data, game, new Date());
}

/** Reads the active solo game by id and refreshes time-dependent state. */
export async function getSoloGame(gameId: string): Promise<GameViewState> {
  const data = await loadGameData();
  const current = requireGame(gameId);
  const now = new Date();
  revealIfTimedOut(data, current, now);
  saveGame();
  return view(data, current, now);
}

/** Updates the selected breed while the round is still guessable. */
export async function selectSoloBreed(gameId: string, breedId: BreedId | null): Promise<GameViewState> {
  const data = await loadGameData();
  const current = requireGame(gameId);
  const now = new Date();
  revealIfTimedOut(data, current, now);
  if (!current.currentRound.revealed) {
    if (breedId !== null) {
      requireBreed(data, breedId);
    }
    current.currentRound.selectedBreedId = breedId;
  }
  saveGame();
  return view(data, current, now);
}

/** Reveals the current solo round using the currently selected breed. */
export async function submitSoloGuess(gameId: string): Promise<GameViewState> {
  const data = await loadGameData();
  const current = requireGame(gameId);
  const now = new Date();
  revealRound(data, current, isTimedOut(current.currentRound, now));
  saveGame();
  return view(data, current, now);
}

/** Commits a revealed round to history and starts the next one when any remain. */
export async function nextSoloRound(gameId: string): Promise<GameViewState> {
  const data = await loadGameData();
  const current = requireGame(gameId);
  const now = new Date();
  revealIfTimedOut(data, current, now);
  if (!current.currentRound.revealed) {
    throw new Error("Cannot move to next round before reveal");
  }
  if (!current.history.some((result) => result.index === current.currentRound.revealed?.index)) {
    current.history.push(current.currentRound.revealed);
  }
  if (current.history.length < current.settings.roundCount) {
    current.currentRound = makeRound(
      data,
      current.id,
      current.settings,
      current.answerBreedIds,
      current.history.length,
      now
    );
  }
  saveGame();
  return view(data, current, now);
}

/** Clears only the solo game state owned by this module. */
export function clearSoloGame(): void {
  game = null;
  localStorage.removeItem(GAME_KEY);
}

function makeRound(
  data: GameData,
  gameId: string,
  settings: GameSettings,
  answers: BreedId[],
  index: number,
  now: Date
): ActiveRound {
  const answerBreedId = answers[index];
  return {
    index: index + 1,
    answerBreedId,
    answerImage: pickImage(data, answerBreedId, `${gameId}:${index}`),
    startedAt: now.toISOString(),
    deadlineAt: settings.unlimitedTime ? null : new Date(now.getTime() + settings.secondsPerRound * 1000).toISOString(),
    selectedBreedId: null,
    revealed: null
  };
}

function revealIfTimedOut(data: GameData, current: LocalGame, now: Date): void {
  if (isTimedOut(current.currentRound, now)) {
    revealRound(data, current, true);
  }
}

function revealRound(data: GameData, current: LocalGame, timedOut: boolean): void {
  const round = current.currentRound;
  if (round.revealed) {
    return;
  }

  const answerBreed = requireBreed(data, round.answerBreedId);
  const guessBreed = round.selectedBreedId ? requireBreed(data, round.selectedBreedId) : null;
  const similarity = guessBreed ? getSimilarity(data, guessBreed.id, answerBreed.id) : null;
  const score = guessBreed ? calculateScore(data, guessBreed.id, answerBreed.id, similarity ?? 0) : 0;

  round.revealed = {
    index: round.index,
    answerBreed,
    answerImage: round.answerImage,
    guessBreed,
    guessImage: guessBreed ? pickImage(data, guessBreed.id, `${current.id}:${round.index}:guess`) : null,
    score,
    similarity,
    timedOut
  };
}

function view(data: GameData, current: LocalGame, now: Date): GameViewState {
  const round = current.currentRound;
  const finished = current.history.length >= current.settings.roundCount;
  const status: GameStatus = finished ? "finished" : round.revealed ? "revealed" : "guessing";

  return {
    gameId: current.id,
    status,
    settings: current.settings,
    map: data.map,
    round: finished ? null : roundView(round, current.settings.roundCount),
    history: current.history,
    totalScore: current.history.reduce((sum, result) => sum + result.score, 0) + (finished ? 0 : round.revealed?.score ?? 0),
    maxScore: current.settings.roundCount * MAX_ROUND_SCORE,
    serverNow: now.toISOString(),
    deadlineAt: finished || round.revealed ? null : round.deadlineAt
  };
}

function roundView(round: ActiveRound, total: number): RoundView {
  if (round.revealed) {
    return {
      index: round.index,
      total,
      phase: "revealed",
      answerImage: round.answerImage,
      selectedBreedId: round.selectedBreedId,
      answerBreed: round.revealed.answerBreed,
      guessBreed: round.revealed.guessBreed,
      guessImage: round.revealed.guessImage,
      score: round.revealed.score,
      similarity: round.revealed.similarity,
      timedOut: round.revealed.timedOut
    };
  }

  return {
    index: round.index,
    total,
    phase: "guessing",
    answerImage: round.answerImage,
    selectedBreedId: round.selectedBreedId,
    answerBreed: null,
    guessBreed: null,
    guessImage: null,
    score: null,
    similarity: null,
    timedOut: false
  };
}

function validateSettings(settings: GameSettings): GameSettings {
  if (settings.roundCount < 5 || settings.roundCount > 20) {
    throw new Error("Round count must be between 5 and 20");
  }
  if (settings.secondsPerRound < 30 || settings.secondsPerRound > 300 || settings.secondsPerRound % 30 !== 0) {
    throw new Error("Seconds per round must be between 30 and 300, with step 30");
  }
  return { ...settings };
}

function isTimedOut(round: ActiveRound, now: Date): boolean {
  return !round.revealed && round.deadlineAt !== null && now.getTime() >= new Date(round.deadlineAt).getTime();
}

function requireGame(gameId: string): LocalGame {
  if (!game) {
    game = readGame();
  }
  if (!game || game.id !== gameId) {
    throw new Error(`Unknown game: ${gameId}`);
  }
  return game;
}

function readGame(): LocalGame | null {
  try {
    const raw = localStorage.getItem(GAME_KEY);
    return raw ? JSON.parse(raw) as LocalGame : null;
  } catch {
    localStorage.removeItem(GAME_KEY);
    return null;
  }
}

function saveGame(): void {
  if (game) {
    localStorage.setItem(GAME_KEY, JSON.stringify(game));
  }
}

function makeGameId(): string {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function sample<T>(items: T[], count: number): T[] {
  const pool = [...items];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, count);
}
