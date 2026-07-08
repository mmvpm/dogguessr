import type { BreedId, DuelViewState } from "./types";

const BOT_MIN_GUESS_DELAY_MS = 1500;
const BOT_MAX_GUESS_DELAY_MS = 8000;
const BOT_MIN_READY_DELAY_MS = 800;
const BOT_MAX_READY_DELAY_MS = 2500;
const BOT_DEADLINE_PADDING_MS = 400;

export type DuelBotCommand =
  | { type: "selectBreed"; breedId: BreedId }
  | { type: "submitGuess" }
  | { type: "readyNext" };

export type DuelBotMemory = {
  guessingRoundKey: string | null;
  selectedBreedId: BreedId | null;
  submitAtMs: number | null;
  readyRoundKey: string | null;
  readyAtMs: number | null;
};

type DuelBotVisibleView = {
  phase: DuelViewState["phase"];
  deadlineAt: string | null;
  waitingForNext: boolean;
  round: {
    index: number;
    selectedBreedId: BreedId | null;
    myGuessBreedId: BreedId | null;
  } | null;
  selectableBreedIds: BreedId[];
};

/** Returns fresh empty bot memory for a local duel opponent. */
export function createDuelBotMemory(): DuelBotMemory {
  return {
    guessingRoundKey: null,
    selectedBreedId: null,
    submitAtMs: null,
    readyRoundKey: null,
    readyAtMs: null
  };
}

/**
 * Strips DuelViewState down to fields a player can infer from the visible duel UI.
 * DuelViewState carries image metadata for rendering, so bot logic must not receive it directly.
 */
export function makeDuelBotVisibleView(view: DuelViewState): DuelBotVisibleView {
  return {
    phase: view.phase,
    deadlineAt: view.deadlineAt,
    waitingForNext: view.waitingForNext,
    round: view.round ? {
      index: view.round.index,
      selectedBreedId: view.round.selectedBreedId,
      myGuessBreedId: view.round.myGuessBreed?.id ?? null
    } : null,
    selectableBreedIds: view.map.tiles.map((tile) => tile.breedId)
  };
}

/** Plans the next public-interface command for the MVP bot from only visible duel state. */
export function planDuelBotTurn(
  view: DuelBotVisibleView,
  memory: DuelBotMemory,
  nowMs: number,
  random: () => number = Math.random
): { memory: DuelBotMemory; commands: DuelBotCommand[] } {
  if (!view.round) {
    return { memory: createDuelBotMemory(), commands: [] };
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
  let next = memory.guessingRoundKey === roundKey ? { ...memory } : {
    ...createDuelBotMemory(),
    guessingRoundKey: roundKey,
    selectedBreedId: pickRandom(view.selectableBreedIds, random),
    submitAtMs: nowMs + randomInt(BOT_MIN_GUESS_DELAY_MS, BOT_MAX_GUESS_DELAY_MS, random)
  };

  if (!next.selectedBreedId) {
    return { memory: next, commands: [] };
  }

  const deadlineMs = view.deadlineAt ? new Date(view.deadlineAt).getTime() : null;
  if (deadlineMs !== null && next.submitAtMs !== null) {
    next.submitAtMs = Math.min(next.submitAtMs, Math.max(nowMs, deadlineMs - BOT_DEADLINE_PADDING_MS));
  }

  if (next.submitAtMs === null || nowMs < next.submitAtMs) {
    return { memory: next, commands: [] };
  }

  const commands: DuelBotCommand[] = [];
  if (view.round!.selectedBreedId !== next.selectedBreedId) {
    commands.push({ type: "selectBreed", breedId: next.selectedBreedId });
  }
  commands.push({ type: "submitGuess" });
  return { memory: next, commands };
}

function planReadyTurn(
  view: DuelBotVisibleView,
  memory: DuelBotMemory,
  nowMs: number,
  random: () => number
): { memory: DuelBotMemory; commands: DuelBotCommand[] } {
  const roundKey = `ready:${view.round!.index}`;
  const next = memory.readyRoundKey === roundKey ? { ...memory } : {
    ...memory,
    readyRoundKey: roundKey,
    readyAtMs: nowMs + randomInt(BOT_MIN_READY_DELAY_MS, BOT_MAX_READY_DELAY_MS, random)
  };

  return next.readyAtMs !== null && nowMs >= next.readyAtMs
    ? { memory: next, commands: [{ type: "readyNext" }] }
    : { memory: next, commands: [] };
}

function pickRandom<T>(items: T[], random: () => number): T | null {
  return items.length ? items[Math.floor(random() * items.length)] : null;
}

function randomInt(min: number, max: number, random: () => number): number {
  return Math.floor(min + random() * (max - min + 1));
}
