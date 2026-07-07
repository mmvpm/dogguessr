// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { api } from "./api/client";
import { duelApi } from "./api/duel";
import {
  breeds,
  buttonByText,
  changeInput,
  click,
  expectText,
  inputByLabel,
  makeDuel,
  makeFinishedDuel,
  makeFinishedGame,
  makeGame,
  makeRevealedDuel,
  makeRevealedGame,
  queryButtonByText,
  renderApp
} from "./test/uiHarness";
import type { DuelViewState, GameViewState } from "./api/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./api/client", () => ({
  api: {
    restoreGame: vi.fn(),
    createGame: vi.fn(),
    getGame: vi.fn(),
    selectBreed: vi.fn(),
    submitGuess: vi.fn(),
    nextRound: vi.fn(),
    suggestBreeds: vi.fn(),
    clearGame: vi.fn()
  }
}));

vi.mock("./api/duel", () => ({
  duelApi: {
    roomIdFromPath: vi.fn(),
    restoreFromPath: vi.fn(),
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    getState: vi.fn(),
    selectBreed: vi.fn(),
    submitGuess: vi.fn(),
    readyNext: vi.fn(),
    clearSession: vi.fn()
  }
}));

describe("App UI contracts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T10:00:00.000Z"));
    installMemoryStorage();
    window.history.replaceState(null, "", "/");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn() }
    });
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    });
    mockStartScreen();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  it("locks start screen copy, actions, settings, and duel join disabled state", async () => {
    const { container, unmount } = await renderApp(<App />);

    expect(container.querySelector(".app.start-screen")).toBeTruthy();
    expect(container.querySelector(".start-background img")).toBeTruthy();
    expectText(container, "DogGuessr");
    expectText(container, "Угадай породу собаки по фото");
    expectText(container, "ДУЭЛЬ");
    expect(buttonByText(container, "Одиночная игра").disabled).toBe(false);
    expect(buttonByText(container, "Создать комнату").disabled).toBe(false);
    expect(buttonByText(container, "Войти").disabled).toBe(true);
    expect(inputByLabel("Код комнаты").getAttribute("maxlength")).toBe("6");
    expect(inputByLabel("Код комнаты").getAttribute("placeholder")).toBe("Код комнаты");
    expectText(container, "Секунд на вопрос");
    expectText(container, "180");
    expectText(container, "Раундов");
    expectText(container, "10");

    await changeInput(inputByLabel("Код комнаты"), "ABC123");
    expect(buttonByText(container, "Войти").disabled).toBe(false);

    await unmount();
  });

  it("shows start screen validation error without joining an invalid duel code", async () => {
    const { container, unmount } = await renderApp(<App />);

    await changeInput(inputByLabel("Код комнаты"), "ABC12");
    expect(buttonByText(container, "Войти").disabled).toBe(true);

    await changeInput(inputByLabel("Код комнаты"), "ABC123");
    await changeInput(inputByLabel("Код комнаты"), "ABC12!");
    await click(buttonByText(container, "Войти"));

    expectText(container, "Код комнаты должен быть из 6 символов");
    expect(duelApi.joinRoom).not.toHaveBeenCalled();

    await unmount();
  });

  it("locks solo guessing HUD, search, dog panel title, and hidden submit before selection", async () => {
    mockSolo(makeGame());

    const { container, unmount } = await renderApp(<App />);

    expect(container.querySelector(".app.game-screen")).toBeTruthy();
    expectText(container, "Легенда");
    expectText(container, "Раунд");
    expectText(container, "2/10");
    expectText(container, "Счет");
    expectText(container, "120");
    expect(inputByLabel("Найти породу")).toBeTruthy();
    expectText(container, "Угадай породу");
    expect(queryButtonByText(container, "Угадать")).toBeNull();
    expect(queryButtonByText(container, "Дальше")).toBeNull();
    expect(container.querySelector(".dog-panel.scale-normal")).toBeTruthy();

    await unmount();
  });

  it("shows solo submit only after a selected breed exists", async () => {
    const selected = makeGame({
      round: {
        ...makeGame().round!,
        selectedBreedId: breeds.beagle.id
      }
    });
    mockSolo(selected);
    vi.mocked(api.submitGuess).mockResolvedValue(makeRevealedGame());

    const { container, unmount } = await renderApp(<App />);

    expect(buttonByText(container, "Угадать").disabled).toBe(false);
    await click(buttonByText(container, "Угадать"));
    expect(api.submitGuess).toHaveBeenCalledWith("solo-game");

    await unmount();
  });

  it("locks solo revealed screen: no search, answer/guess tabs, arrows, and next button", async () => {
    mockSolo(makeRevealedGame());

    const { container, unmount } = await renderApp(<App />);

    expect(document.querySelector("input[aria-label='Найти породу']")).toBeNull();
    expect(queryButtonByText(container, "Угадать")).toBeNull();
    expect(buttonByText(container, "Дальше").disabled).toBe(false);
    expect(buttonByText(container, "Правильный ответ")).toBeTruthy();
    expect(buttonByText(container, "Ваш ответ")).toBeTruthy();
    expect(container.querySelector("button[title='Предыдущее фото']")).toBeTruthy();
    expect(container.querySelector("button[title='Следующее фото']")).toBeTruthy();
    expect(container.querySelector(".dog-panel.scale-small")).toBeTruthy();

    await unmount();
  });

  it("hides the solo guess gallery tab when there is no guess image", async () => {
    mockSolo(makeRevealedGame({
      round: {
        ...makeRevealedGame().round!,
        guessBreed: null,
        guessImage: null,
        timedOut: true
      }
    }));

    const { container, unmount } = await renderApp(<App />);

    expect(buttonByText(container, "Правильный ответ")).toBeTruthy();
    expect(queryButtonByText(container, "Ваш ответ")).toBeNull();
    expect(container.querySelector(".gallery-arrow")).toBeNull();

    await unmount();
  });

  it("locks solo final result labels, missed answer text, score bar, and home action", async () => {
    mockSolo(makeFinishedGame());

    const { container, unmount } = await renderApp(<App />);

    expect(container.querySelector(".final-screen")).toBeTruthy();
    expectText(container, "Итоговый счет");
    expectText(container, "42");
    expectText(container, "/ 200");
    expectText(container, "Правильный ответ");
    expectText(container, "Ваш ответ");
    expectText(container, "Время вышло");
    expectText(container, "Нет ответа");
    expect(buttonByText(container, "На главный экран")).toBeTruthy();
    expect(container.querySelector(".score-bar div")?.getAttribute("style")).toContain("width: 21%");

    await unmount();
  });

  it("locks duel waiting overlay and copy controls", async () => {
    mockDuel(makeDuel({ phase: "waiting", status: "waiting", waitingForOpponent: true }));

    const { container, unmount } = await renderApp(<App />);

    expect(container.querySelector(".duel-screen")).toBeTruthy();
    expectText(container, "Ожидание соперника...");
    expectText(container, "Отправьте эту ссылку второму игроку:");
    expectText(container, "ABC123");
    expect(buttonByText(container, "Копировать ссылку")).toBeTruthy();
    expect(document.querySelector("input[aria-label='Найти породу']")).toBeNull();
    expect(queryButtonByText(container, "Угадать")).toBeNull();

    await click(buttonByText(container, "Копировать ссылку"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/ABC123`);
    expectText(container, "Скопировано!");

    await unmount();
  });

  it("locks duel countdown overlay without guess controls", async () => {
    mockDuel(makeDuel({
      phase: "countdown",
      status: "countdown",
      roundStartsAt: new Date(Date.now() + 2500).toISOString()
    }));

    const { container, unmount } = await renderApp(<App />);

    expect(container.querySelector(".duel-countdown-overlay")).toBeTruthy();
    expect(container.querySelector(".countdown-ring")).toBeTruthy();
    expectText(container, "3");
    expect(document.querySelector("input[aria-label='Найти породу']")).toBeNull();
    expect(queryButtonByText(container, "Угадать")).toBeNull();

    await unmount();
  });

  it("locks duel guessing pressure state: timer, flash effect, search, score, and submit", async () => {
    mockDuel(makeDuel({
      pressure: true,
      deadlineAt: "2026-07-07T10:00:09.000Z",
      round: {
        ...makeDuel().round!,
        selectedBreedId: breeds.corgi.id
      }
    }));

    const { container, unmount } = await renderApp(<App />);

    expectText(container, "Счет:");
    expectText(container, "100");
    expectText(container, "vs");
    expectText(container, "80");
    expect(inputByLabel("Найти породу")).toBeTruthy();
    expect(buttonByText(container, "Угадать")).toBeTruthy();
    expect(container.querySelector(".duel-pressure-flash")).toBeTruthy();

    await unmount();
  });

  it("hides duel search and submit after my guess is already locked", async () => {
    mockDuel(makeDuel({
      round: {
        ...makeDuel().round!,
        selectedBreedId: breeds.beagle.id,
        myGuessBreed: breeds.beagle,
        myGuessImage: null
      }
    }));

    const { container, unmount } = await renderApp(<App />);

    expect(document.querySelector("input[aria-label='Найти породу']")).toBeNull();
    expect(queryButtonByText(container, "Угадать")).toBeNull();
    expectText(container, "Угадай породу");

    await unmount();
  });

  it("locks duel revealed next states, opponent note, gallery tabs, and win effect", async () => {
    mockDuel(makeRevealedDuel({ opponentReadyForNext: true }));

    const { container, unmount } = await renderApp(<App />);

    expect(document.querySelector("input[aria-label='Найти породу']")).toBeNull();
    expectText(container, "Соперник готов");
    expect(buttonByText(container, "Дальше").disabled).toBe(false);
    expect(buttonByText(container, "Правильный ответ")).toBeTruthy();
    expect(buttonByText(container, "Ваш ответ")).toBeTruthy();
    expect(container.querySelector(".duel-win-effect")).toBeTruthy();

    await unmount();
  });

  it("locks duel revealed waiting-for-next disabled action text", async () => {
    mockDuel(makeRevealedDuel({ waitingForNext: true, opponentReadyForNext: false }));

    const { container, unmount } = await renderApp(<App />);

    const waiting = buttonByText(container, "Ждем соперника");
    expect(waiting.disabled).toBe(true);
    expect(queryButtonByText(container, "Дальше")).toBeNull();
    expect(container.textContent).not.toContain("Соперник готов");

    await unmount();
  });

  it("locks duel final win layout, scores, history labels, and home action", async () => {
    mockDuel(makeFinishedDuel());

    const { container, unmount } = await renderApp(<App />);

    expect(container.querySelector(".duel-final-screen")).toBeTruthy();
    expect(container.querySelector(".final-header.win")).toBeTruthy();
    expectText(container, "Победа!");
    expectText(container, "42");
    expectText(container, " : ");
    expectText(container, "0");
    expectText(container, "Мой ответ");
    expectText(container, "Ответ соперника");
    expectText(container, "Раунд 1");
    expectText(container, "Нет ответа");
    expect(buttonByText(container, "На главный экран")).toBeTruthy();

    await unmount();
  });
});

function installMemoryStorage() {
  const entries = new Map<string, string>();
  const storage = {
    get length() {
      return entries.size;
    },
    clear: vi.fn(() => entries.clear()),
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(entries.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      entries.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      entries.set(key, String(value));
    })
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage
  });
}

function mockStartScreen() {
  vi.mocked(duelApi.roomIdFromPath).mockReset().mockReturnValue(null);
  vi.mocked(duelApi.restoreFromPath).mockReset();
  vi.mocked(api.restoreGame).mockReset().mockResolvedValue(null);
}

function mockSolo(game: GameViewState) {
  vi.mocked(duelApi.roomIdFromPath).mockReset().mockReturnValue(null);
  vi.mocked(duelApi.restoreFromPath).mockReset();
  vi.mocked(api.restoreGame).mockReset().mockImplementation(async () => game);
  vi.mocked(api.getGame).mockReset().mockImplementation(async () => game);
}

function mockDuel(duel: DuelViewState) {
  vi.mocked(duelApi.roomIdFromPath).mockReset().mockReturnValue(duel.roomId);
  vi.mocked(api.restoreGame).mockReset();
  vi.mocked(duelApi.restoreFromPath).mockReset().mockImplementation(async () => duel);
  vi.mocked(duelApi.getState).mockReset().mockImplementation(async () => duel);
}
