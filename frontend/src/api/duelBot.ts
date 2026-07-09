import { DUEL_ROUNDS } from "./duelConstants";
import { normalizeText } from "./text";
import type { BreedId, DuelViewState } from "./types";

// Target-based bot constants. Tunable knobs kept in one place for easy balancing.
const BOT_BASE_SKILL_MIN = 82;
const BOT_BASE_SKILL_MAX = 94;
const BOT_PANIC_MIN = 0;
const BOT_PANIC_MAX = 8;
const BOT_FAMOUS_SNIPE_CHANCE = 0.7;
const BOT_TARGET_MIN = 65;
const BOT_TARGET_MAX = 97;
const BOT_FIRST_TARGET_MIN = 80;
const BOT_FIRST_TARGET_MAX = 90;
const BOT_LAPSE_CHANCE = 0.06;
const BOT_LAPSE_MIN = 52;
const BOT_LAPSE_MAX = 68;
const BOT_FINAL_MIN = 50;
const BOT_FINAL_MAX = 99;
const BOT_THINK_MIN_MS = 8000;
const BOT_THINK_HIGH_MIN_MS = 15000;
const BOT_THINK_MAX_MS = 60000;
const BOT_PRESSURE_RESPONSE_MIN_MS = 2000;
const BOT_PRESSURE_RESPONSE_MAX_MS = 10000;
const BOT_SELECT_LEAD_MS = 2500;
const BOT_DEADLINE_PAD_MIN_MS = 1500;
const BOT_DEADLINE_PAD_MAX_MS = 2500;
const BOT_MIN_REACTION_MS = 1500;
const BOT_SCORE_WINDOW = 4;
const BOT_SCORE_WINDOW_MID = 8;
const BOT_SCORE_WINDOW_WIDE = 12;
const BOT_FAMOUS_MIN_SIMILARITY = 0.8;
const BOT_LOW_SCORE_THRESHOLD = 40;
const BOT_HIGH_SCORE_THRESHOLD = 90;
const BOT_READY_HIGH_MIN_MS = 3000;
const BOT_READY_HIGH_MAX_MS = 8000;
const BOT_READY_MID_MIN_MS = 7000;
const BOT_READY_MID_MAX_MS = 15000;
const BOT_READY_LOW_MIN_MS = 12000;
const BOT_READY_LOW_MAX_MS = 20000;

// A human only snipes 100 on breeds they know. These are the recognizable ones.
const FAMOUS_BREEDS_RAW: BreedId[] = [
  "German Shepherd",
  "Chihuahua",
  "Pug",
  "Husky",
  "Pomeranian",
  "Golden Retriever",
  "Labrador Retriever",
  "Rottweiler",
  "Beagle",
  "Dachshund",
  "Poodle",
  "Boxer",
  "Dalmatian",
  "Shiba Inu",
  "Chow Chow",
  "French Bulldog",
  "Pekingese",
  "Yorkshire Terrier",
  "Dobermann",
  "Great Dane",
  "Shih Tzu",
  "Border Collie"
];
const FAMOUS_BREEDS = new Set(FAMOUS_BREEDS_RAW.map(normalizeText));

export type DuelBotCommand =
  | { type: "selectBreed"; breedId: BreedId }
  | { type: "submitGuess" }
  | { type: "readyNext" };

export type DuelBotCandidate = {
  breedId: BreedId;
  size: string;
  score: number;
  similarity: number;
};

/** Local-only perception built outside the bot so raw answer ids stay out of bot logic. */
export type DuelBotPerception = {
  candidateBreeds: DuelBotCandidate[];
  isFamousAnswer: boolean;
  answerSize: string | null;
};

export type DuelBotMemory = {
  guessingRoundKey: string | null;
  selectedBreedId: BreedId | null;
  submitAtMs: number | null;
  selectAtMs: number | null;
  readyRoundKey: string | null;
  readyAtMs: number | null;
  baseSkill: number;
  panicIndex: number;
  chosenTargetScore: number | null;
  hitFamous: boolean;
  pressureApplied: boolean;
};

type DuelBotVisibleView = {
  phase: DuelViewState["phase"];
  deadlineAt: string | null;
  waitingForNext: boolean;
  round: {
    index: number;
    selectedBreedId: BreedId | null;
    myGuessBreedId: BreedId | null;
    myScore: number | null;
  } | null;
  history: {
    myScore: number;
    opponentScore: number;
    myTimedOut: boolean;
    opponentTimedOut: boolean;
  }[];
  selectableBreedIds: BreedId[];
  myTotalScore: number;
  opponentTotalScore: number;
  isFamousAnswer: boolean;
  answerSize: string | null;
  candidateBreeds: DuelBotCandidate[];
};

/** Returns whether a breed is recognizable enough for a human-style 100-point snipe. */
export function isFamousBreed(breedId: BreedId): boolean {
  return FAMOUS_BREEDS.has(normalizeText(breedId));
}

/** Returns fresh bot memory with a randomized personality for one local duel. */
export function createDuelBotMemory(): DuelBotMemory {
  return {
    guessingRoundKey: null,
    selectedBreedId: null,
    submitAtMs: null,
    selectAtMs: null,
    readyRoundKey: null,
    readyAtMs: null,
    baseSkill: randomFloat(BOT_BASE_SKILL_MIN, BOT_BASE_SKILL_MAX),
    panicIndex: randomFloat(BOT_PANIC_MIN, BOT_PANIC_MAX),
    chosenTargetScore: null,
    hitFamous: false,
    pressureApplied: false
  };
}

/**
 * Strips DuelViewState down to fields a player can infer from the visible duel UI,
 * plus a local-only perception of candidate breeds. Bot logic must not receive raw
 * DuelViewState because it carries image metadata and answer data for rendering.
 */
export function makeDuelBotVisibleView(view: DuelViewState, perception: DuelBotPerception): DuelBotVisibleView {
  return {
    phase: view.phase,
    deadlineAt: view.deadlineAt,
    waitingForNext: view.waitingForNext,
    round: view.round ? {
      index: view.round.index,
      selectedBreedId: view.round.selectedBreedId,
      myGuessBreedId: view.round.myGuessBreed?.id ?? null,
      myScore: view.round.myScore
    } : null,
    history: view.history.map((result) => ({
      myScore: result.myScore,
      opponentScore: result.opponentScore,
      myTimedOut: result.myTimedOut,
      opponentTimedOut: result.opponentTimedOut
    })),
    selectableBreedIds: view.map.tiles.map((tile) => tile.breedId),
    myTotalScore: view.myTotalScore,
    opponentTotalScore: view.opponentTotalScore,
    isFamousAnswer: perception.isFamousAnswer,
    answerSize: perception.answerSize,
    candidateBreeds: perception.candidateBreeds
  };
}

/** Plans the next public-interface command for the bot from only visible duel state. */
export function planDuelBotTurn(
  view: DuelBotVisibleView,
  memory: DuelBotMemory,
  nowMs: number,
  random: () => number = Math.random
): { memory: DuelBotMemory; commands: DuelBotCommand[] } {
  if (!view.round) {
    return { memory, commands: [] };
  }

  if (view.phase === "guessing" && !view.round.myGuessBreedId) {
    return planGuessingTurn(view, memory, nowMs, random);
  }

  if (view.phase === "revealed" && !view.waitingForNext) {
    return planReadyTurn(view, memory, nowMs, random);
  }

  return { memory, commands: [] };
}

function planGuessingTurn(
  view: DuelBotVisibleView,
  memory: DuelBotMemory,
  nowMs: number,
  random: () => number
): { memory: DuelBotMemory; commands: DuelBotCommand[] } {
  const roundKey = `guess:${view.round!.index}`;
  let next = memory.guessingRoundKey === roundKey
    ? { ...memory }
    : planNewGuessingRound(view, memory, random, nowMs);

  // Pressure appears when the human guesses first. If the bot has not committed to a
  // breed yet, it gets a small accuracy penalty and answers shortly after the player.
  if (view.deadlineAt !== null && !next.pressureApplied) {
    next = reactToPressure(next, view, random, nowMs);
  }

  if (!next.selectedBreedId) {
    return { memory: next, commands: [] };
  }

  const commands: DuelBotCommand[] = [];
  let selectedBreedId = view.round!.selectedBreedId;
  if (next.selectAtMs !== null && nowMs >= next.selectAtMs && view.round!.selectedBreedId !== next.selectedBreedId) {
    commands.push({ type: "selectBreed", breedId: next.selectedBreedId });
    selectedBreedId = next.selectedBreedId;
  }
  if (next.submitAtMs !== null && nowMs >= next.submitAtMs) {
    if (selectedBreedId !== next.selectedBreedId) {
      commands.push({ type: "selectBreed", breedId: next.selectedBreedId });
    }
    commands.push({ type: "submitGuess" });
  }
  return { memory: next, commands };
}

function planNewGuessingRound(
  view: DuelBotVisibleView,
  memory: DuelBotMemory,
  random: () => number,
  nowMs: number
): DuelBotMemory {
  const candidates = view.candidateBreeds;
  let selectedBreedId: BreedId | null = null;
  let chosenTargetScore: number | null = null;
  let hitFamous = false;

  // Recognizable breeds occasionally get a human-style exact snipe instead of a target pick.
  if (view.isFamousAnswer && random() < BOT_FAMOUS_SNIPE_CHANCE) {
    const answerCandidate = candidates.find((candidate) => candidate.score >= 100) ?? null;
    if (answerCandidate) {
      selectedBreedId = answerCandidate.breedId;
      chosenTargetScore = 100;
      hitFamous = true;
    }
  }

  if (!selectedBreedId) {
    chosenTargetScore = computeTargetScore(view, memory, random);
    selectedBreedId = pickBreedForTarget(candidates, chosenTargetScore, view.answerSize, random);
  }

  const thinkMs = computeThinkTime(chosenTargetScore ?? BOT_TARGET_MIN, random);
  let submitAtMs = nowMs + thinkMs;
  const deadlineMs = view.deadlineAt ? new Date(view.deadlineAt).getTime() : null;
  if (deadlineMs !== null) {
    const pressureSubmitAtMs = nowMs + randomInt(BOT_PRESSURE_RESPONSE_MIN_MS, BOT_PRESSURE_RESPONSE_MAX_MS, random);
    submitAtMs = Math.min(pressureSubmitAtMs, deadlineMs - randomInt(BOT_DEADLINE_PAD_MIN_MS, BOT_DEADLINE_PAD_MAX_MS, random));
  }
  submitAtMs = Math.max(submitAtMs, nowMs + BOT_MIN_REACTION_MS);
  const selectAtMs = submitAtMs - BOT_SELECT_LEAD_MS;

  return {
    ...memory,
    guessingRoundKey: `guess:${view.round!.index}`,
    selectedBreedId,
    submitAtMs,
    selectAtMs,
    chosenTargetScore,
    hitFamous,
    pressureApplied: view.deadlineAt !== null,
    readyRoundKey: null,
    readyAtMs: null
  };
}

function reactToPressure(
  memory: DuelBotMemory,
  view: DuelBotVisibleView,
  random: () => number,
  nowMs: number
): DuelBotMemory {
  const deadlineMs = view.deadlineAt ? new Date(view.deadlineAt).getTime() : null;
  if (deadlineMs === null) {
    return memory;
  }
  const breedLocked = memory.selectedBreedId !== null && view.round?.selectedBreedId === memory.selectedBreedId;
  const target = clampInt((memory.chosenTargetScore ?? BOT_TARGET_MIN) - memory.panicIndex, BOT_FINAL_MIN, BOT_FINAL_MAX);
  const pressureSubmitAtMs = nowMs + randomInt(BOT_PRESSURE_RESPONSE_MIN_MS, BOT_PRESSURE_RESPONSE_MAX_MS, random);
  const deadlineSubmitAtMs = deadlineMs - randomInt(BOT_DEADLINE_PAD_MIN_MS, BOT_DEADLINE_PAD_MAX_MS, random);
  const submitAtMs = Math.max(Math.min(pressureSubmitAtMs, deadlineSubmitAtMs), nowMs + BOT_MIN_REACTION_MS);
  let selectedBreedId = memory.selectedBreedId;
  if (!breedLocked) {
    const repicked = pickBreedForTarget(view.candidateBreeds, target, view.answerSize, random);
    if (repicked) {
      selectedBreedId = repicked;
    }
  }
  return {
    ...memory,
    chosenTargetScore: target,
    selectedBreedId,
    submitAtMs,
    selectAtMs: submitAtMs - BOT_SELECT_LEAD_MS,
    pressureApplied: true
  };
}

function computeTargetScore(view: DuelBotVisibleView, memory: DuelBotMemory, random: () => number): number {
  if (view.round!.index === 1 || view.history.length === 0) {
    return randomInt(BOT_FIRST_TARGET_MIN, BOT_FIRST_TARGET_MAX, random);
  }

  if (random() > 1 - BOT_LAPSE_CHANCE) {
    return randomInt(BOT_LAPSE_MIN, BOT_LAPSE_MAX, random);
  }

  const player = analyzePlayerHistory(view);
  const targetFromSkill = targetForPlayerSkill(player, memory, random);
  const delta = view.opponentTotalScore - view.myTotalScore;
  const roundsLeft = DUEL_ROUNDS - (view.round!.index - 1);
  const catchUp = delta > 0
    ? Math.min(22, Math.ceil(delta / Math.max(1, roundsLeft)))
    : -Math.min(10, Math.ceil(Math.abs(delta) / (roundsLeft + 2)));
  const target = clampInt(targetFromSkill + catchUp, BOT_TARGET_MIN, BOT_TARGET_MAX);
  const pressured = view.deadlineAt !== null ? target - memory.panicIndex : target;
  return clampInt(pressured, BOT_FINAL_MIN, BOT_FINAL_MAX);
}

function analyzePlayerHistory(view: DuelBotVisibleView): {
  average: number;
  last: number;
  high80Rate: number;
  high90Rate: number;
} {
  const scores = view.history.map((result) => result.opponentScore);
  const total = scores.reduce((sum, score) => sum + score, 0);
  return {
    average: total / scores.length,
    last: scores[scores.length - 1] ?? 0,
    high80Rate: scores.filter((score) => score >= 80).length / scores.length,
    high90Rate: scores.filter((score) => score >= 90).length / scores.length
  };
}

function targetForPlayerSkill(
  player: { average: number; last: number; high80Rate: number; high90Rate: number },
  memory: DuelBotMemory,
  random: () => number
): number {
  if (player.average >= 90 || player.last >= 90 || player.high90Rate >= 0.5) {
    return randomInt(88, 98, random);
  }
  if (player.average >= 80 || player.last >= 85 || player.high80Rate >= 0.5) {
    return clampInt(Math.round(player.average) + randomInt(-2, 8, random), 85, 97);
  }
  if (player.average >= 70) {
    return clampInt(Math.round(player.average) + randomInt(4, 12, random), 78, 92);
  }
  if (player.average >= 55) {
    return clampInt(Math.round(player.average) + randomInt(8, 16, random), 70, 86);
  }
  return clampInt(Math.round((memory.baseSkill + player.average) / 2), BOT_TARGET_MIN, 80);
}

function computeThinkTime(targetScore: number, random: () => number): number {
  // Harder targets need more scanning; easy guesses are clicked sooner.
  const minMs = targetScore > 70 ? BOT_THINK_HIGH_MIN_MS : BOT_THINK_MIN_MS;
  return randomInt(minMs, BOT_THINK_MAX_MS, random);
}

function pickBreedForTarget(
  candidates: DuelBotCandidate[],
  target: number,
  answerSize: string | null,
  random: () => number
): BreedId | null {
  if (!candidates.length) {
    return null;
  }
  // Never hand out a 100 through the target path; exact answers only come from famous snipes.
  // Famous breeds are also blocked as wrong answers unless the raw visual similarity is high.
  const wrong = candidates.filter((candidate) => candidate.score < 100 && !isWeakFamousCandidate(candidate));
  const tryWindow = (window: number, requireSize: boolean): BreedId | null => {
    const pool = wrong.filter((candidate) =>
      Math.abs(candidate.score - target) <= window &&
      (!requireSize || !answerSize || candidate.size === answerSize)
    );
    return pool.length ? pool[Math.floor(random() * pool.length)].breedId : null;
  };
  return (
    tryWindow(BOT_SCORE_WINDOW, true) ??
    tryWindow(BOT_SCORE_WINDOW_MID, true) ??
    tryWindow(BOT_SCORE_WINDOW_WIDE, true) ??
    tryWindow(BOT_SCORE_WINDOW_WIDE, false) ??
    pickNearest(wrong, target, answerSize, true) ??
    pickNearest(wrong, target, answerSize, false)
  );
}

function isWeakFamousCandidate(candidate: DuelBotCandidate): boolean {
  return isFamousBreed(candidate.breedId) && candidate.similarity < BOT_FAMOUS_MIN_SIMILARITY;
}

function pickNearest(
  candidates: DuelBotCandidate[],
  target: number,
  answerSize: string | null,
  requireSize: boolean
): BreedId | null {
  const pool = candidates.filter((candidate) => !requireSize || !answerSize || candidate.size === answerSize);
  if (!pool.length) {
    return null;
  }
  const ranked = [...pool].sort((left, right) => {
    const leftDistance = Math.abs(left.score - target);
    const rightDistance = Math.abs(right.score - target);
    return leftDistance - rightDistance || right.score - left.score;
  });
  return ranked[0].breedId;
}

function planReadyTurn(
  view: DuelBotVisibleView,
  memory: DuelBotMemory,
  nowMs: number,
  random: () => number
): { memory: DuelBotMemory; commands: DuelBotCommand[] } {
  const roundKey = `ready:${view.round!.index}`;
  if (memory.readyRoundKey !== roundKey) {
    const score = view.round?.myScore ?? 0;
    const [minMs, maxMs] = readyDelayRange(score);
    return {
      memory: {
        ...memory,
        readyRoundKey: roundKey,
        readyAtMs: nowMs + randomInt(minMs, maxMs, random)
      },
      commands: []
    };
  }

  const next = { ...memory };
  return next.readyAtMs !== null && nowMs >= next.readyAtMs
    ? { memory: next, commands: [{ type: "readyNext" }] }
    : { memory: next, commands: [] };
}

function readyDelayRange(score: number): [number, number] {
  if (score >= BOT_HIGH_SCORE_THRESHOLD) {
    return [BOT_READY_HIGH_MIN_MS, BOT_READY_HIGH_MAX_MS];
  }
  if (score < BOT_LOW_SCORE_THRESHOLD) {
    return [BOT_READY_LOW_MIN_MS, BOT_READY_LOW_MAX_MS];
  }
  return [BOT_READY_MID_MIN_MS, BOT_READY_MID_MAX_MS];
}

function randomFloat(min: number, max: number, random: () => number = Math.random): number {
  return min + random() * (max - min);
}

function randomInt(min: number, max: number, random: () => number): number {
  return Math.floor(min + random() * (max - min + 1));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
