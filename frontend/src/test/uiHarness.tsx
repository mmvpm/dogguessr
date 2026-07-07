import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type React from "react";
import type {
  BreedInfo,
  DuelViewState,
  GameViewState,
  MapLayout,
  RoundResult
} from "../api/types";

export const breeds = {
  akita: breed("akita", "Акита-ину", "Akita Inu", "spitz", "#f59e0b"),
  beagle: breed("beagle", "Бигль", "Beagle", "hound", "#22c55e"),
  corgi: breed("corgi", "Вельш-корги", "Welsh Corgi", "corgi", "#60a5fa")
};

export const testMap: MapLayout = {
  tileWidth: 96,
  tileHeight: 56,
  columnGap: 12,
  rowGap: 12,
  columns: 3,
  rows: 1,
  legend: [
    { group: "spitz", label: "Шпицы", color: breeds.akita.color },
    { group: "hound", label: "Гончие", color: breeds.beagle.color },
    { group: "corgi", label: "Корги", color: breeds.corgi.color }
  ],
  tiles: [
    { breedId: breeds.akita.id, label: breeds.akita.ru, color: breeds.akita.color, gridColumn: 1, gridRow: 1, maxDistance: 2 },
    { breedId: breeds.beagle.id, label: breeds.beagle.ru, color: breeds.beagle.color, gridColumn: 2, gridRow: 1, maxDistance: 2 },
    { breedId: breeds.corgi.id, label: breeds.corgi.ru, color: breeds.corgi.color, gridColumn: 3, gridRow: 1, maxDistance: 2 }
  ]
};

export function makeGame(overrides: Partial<GameViewState> = {}): GameViewState {
  return {
    gameId: "solo-game",
    status: "guessing",
    settings: { unlimitedTime: false, secondsPerRound: 180, roundCount: 10 },
    map: testMap,
    round: {
      index: 2,
      total: 10,
      phase: "guessing",
      answerImage: image("answer", breeds.akita),
      selectedBreedId: null,
      answerBreed: null,
      guessBreed: null,
      guessImage: null,
      score: null,
      similarity: null,
      timedOut: false
    },
    history: [],
    totalScore: 120,
    maxScore: 1000,
    serverNow: "2026-07-07T10:00:00.000Z",
    deadlineAt: "2026-07-07T10:03:00.000Z",
    ...overrides
  };
}

export function makeRevealedGame(overrides: Partial<GameViewState> = {}): GameViewState {
  return makeGame({
    status: "revealed",
    round: {
      index: 2,
      total: 10,
      phase: "revealed",
      answerImage: image("answer", breeds.akita),
      selectedBreedId: breeds.beagle.id,
      answerBreed: breeds.akita,
      guessBreed: breeds.beagle,
      guessImage: image("guess", breeds.beagle),
      score: 42,
      similarity: null,
      timedOut: false
    },
    ...overrides
  });
}

export function makeFinishedGame(overrides: Partial<GameViewState> = {}): GameViewState {
  const history: RoundResult[] = [
    {
      index: 1,
      answerBreed: breeds.akita,
      answerImage: image("answer-1", breeds.akita),
      guessBreed: breeds.beagle,
      guessImage: image("guess-1", breeds.beagle),
      score: 42,
      similarity: null,
      timedOut: false
    },
    {
      index: 2,
      answerBreed: breeds.corgi,
      answerImage: image("answer-2", breeds.corgi),
      guessBreed: null,
      guessImage: null,
      score: 0,
      similarity: null,
      timedOut: true
    }
  ];
  return makeGame({
    status: "finished",
    round: null,
    history,
    totalScore: 42,
    maxScore: 200,
    ...overrides
  });
}

export function makeDuel(overrides: Partial<DuelViewState> = {}): DuelViewState {
  return {
    mode: "duel",
    roomId: "ABC123",
    gameId: "duel:ABC123",
    playerId: "me",
    opponentPlayerId: "opponent",
    phase: "guessing",
    status: "guessing",
    map: testMap,
    round: {
      index: 1,
      total: 7,
      answerImage: image("duel-answer", breeds.akita),
      selectedBreedId: null,
      answerBreed: null,
      myGuessBreed: null,
      myGuessImage: null,
      opponentGuessBreed: null,
      opponentGuessImage: null,
      myScore: null,
      opponentScore: null,
      myTimedOut: false,
      opponentTimedOut: false
    },
    history: [],
    myTotalScore: 100,
    opponentTotalScore: 80,
    maxScore: 700,
    serverNow: "2026-07-07T10:00:00.000Z",
    deadlineAt: null,
    roundStartsAt: null,
    waitingForOpponent: false,
    waitingForNext: false,
    opponentReadyForNext: false,
    pressure: false,
    ...overrides
  };
}

export function makeRevealedDuel(overrides: Partial<DuelViewState> = {}): DuelViewState {
  return makeDuel({
    phase: "revealed",
    status: "revealed",
    round: {
      index: 1,
      total: 7,
      answerImage: image("duel-answer", breeds.akita),
      selectedBreedId: breeds.beagle.id,
      answerBreed: breeds.akita,
      myGuessBreed: breeds.beagle,
      myGuessImage: image("duel-my-guess", breeds.beagle),
      opponentGuessBreed: breeds.corgi,
      opponentGuessImage: image("duel-opponent-guess", breeds.corgi),
      myScore: 42,
      opponentScore: 25,
      myTimedOut: false,
      opponentTimedOut: false
    },
    ...overrides
  });
}

export function makeFinishedDuel(overrides: Partial<DuelViewState> = {}): DuelViewState {
  return makeDuel({
    phase: "finished",
    status: "finished",
    round: null,
    history: [
      {
        index: 1,
        answerBreed: breeds.akita,
        answerImage: image("duel-answer-1", breeds.akita),
        myGuessBreed: breeds.beagle,
        myGuessImage: image("duel-my-1", breeds.beagle),
        opponentGuessBreed: null,
        opponentGuessImage: null,
        myScore: 42,
        opponentScore: 0,
        myTimedOut: false,
        opponentTimedOut: true
      }
    ],
    myTotalScore: 42,
    opponentTotalScore: 0,
    ...overrides
  });
}

export async function renderApp(element: React.ReactElement): Promise<{ container: HTMLDivElement; unmount: () => Promise<void> }> {
  const container = document.createElement("div");
  document.body.append(container);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
  await flushEffects();
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root?.unmount();
      });
      container.remove();
    }
  };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  });
}

export async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

export async function changeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export function buttonByText(container: ParentNode, text: string): HTMLButtonElement {
  const button = allButtons(container).find((candidate) => candidate.textContent?.trim() === text);
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

export function queryButtonByText(container: ParentNode, text: string): HTMLButtonElement | null {
  return allButtons(container).find((candidate) => candidate.textContent?.trim() === text) ?? null;
}

export function inputByLabel(label: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) {
    throw new Error(`Input not found: ${label}`);
  }
  return input;
}

export function expectText(container: ParentNode, text: string): void {
  if (!container.textContent?.includes(text)) {
    throw new Error(`Text not found: ${text}`);
  }
}

function allButtons(container: ParentNode): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
}

function breed(id: string, ru: string, en: string, group: string, color: string): BreedInfo {
  return { id, ru, en, group, color };
}

function image(id: string, breed: BreedInfo) {
  return {
    id,
    url: `/dataset/${breed.id}/${id}.jpg`,
    breedId: breed.id
  };
}
