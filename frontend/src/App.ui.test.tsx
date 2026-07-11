// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { api } from "./api/client";
import { duelApi } from "./api/duel";
import { isFeedbackConfigured, sendFeedback } from "./api/feedback";
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
    findPublicMatch: vi.fn(),
    joinRoom: vi.fn(),
    getState: vi.fn(),
    selectBreed: vi.fn(),
    submitGuess: vi.fn(),
    readyNext: vi.fn(),
    heartbeatWaitingRoom: vi.fn(),
    leaveRoom: vi.fn(),
    clearSession: vi.fn()
  }
}));

vi.mock("./api/feedback", () => ({
  isFeedbackConfigured: vi.fn(),
  sendFeedback: vi.fn()
}));

describe("App UI contracts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T10:00:00.000Z"));
    installMemoryStorage();
    window.history.replaceState(null, "", "/");
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["ru-RU"]
    });
    Object.defineProperty(navigator, "language", {
      configurable: true,
      value: "ru-RU"
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn() }
    });
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    });
    vi.mocked(isFeedbackConfigured).mockReturnValue(false);
    vi.mocked(sendFeedback).mockResolvedValue();
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
    expect(container.querySelector(".start-menu-hud")).toBeTruthy();
    expect(container.querySelectorAll(".start-menu-hud button")).toHaveLength(3);
    expect(container.querySelector<HTMLButtonElement>("button[aria-label='Выключить звуковые эффекты']")?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector<HTMLButtonElement>("button[aria-label='Выключить музыку']")?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector<HTMLButtonElement>("button[aria-label='Switch to English']")?.textContent).toBe("🇷🇺");
    expectText(container, "Угадай породу собаки по фото");
    expectText(container, "Одиночная игра");
    expectText(container, "ДУЭЛЬ");
    expect(buttonByText(container, "Начать").disabled).toBe(false);
    expect(buttonByText(container, "Играть онлайн").disabled).toBe(false);
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

    const effectsToggle = container.querySelector<HTMLButtonElement>("button[aria-label='Выключить звуковые эффекты']");
    if (!effectsToggle) {
      throw new Error("Effects toggle not found");
    }
    await click(effectsToggle);
    expect(container.querySelector<HTMLButtonElement>("button[aria-label='Включить звуковые эффекты']")?.getAttribute("aria-pressed")).toBe("false");
    expect(localStorage.getItem("dogguessr:audio:v1")).toBe(JSON.stringify({ effectsEnabled: false, musicEnabled: true }));

    await unmount();
  });

  it("detects English browser language and toggles the persisted language from the main menu", async () => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["en-US"]
    });
    Object.defineProperty(navigator, "language", {
      configurable: true,
      value: "en-US"
    });
    const { container, unmount } = await renderApp(<App />);

    expectText(container, "Guess the dog breed from a photo");
    expectText(container, "Solo game");
    expect(buttonByText(container, "Start")).toBeTruthy();
    expect(inputByLabel("Room code").getAttribute("placeholder")).toBe("Room code");
    expect(container.querySelector(".start-menu-hud .language-toggle")).toBeTruthy();
    expect(container.querySelector(".start-panel .language-toggle")).toBeNull();

    const toggle = container.querySelector<HTMLButtonElement>("button[aria-label='Переключить на русский']");
    expect(toggle?.textContent).toBe("🇬🇧");
    if (!toggle) {
      throw new Error("Language toggle not found");
    }
    await click(toggle);

    expectText(container, "Угадай породу собаки по фото");
    expect(localStorage.getItem("dogguessr:locale:v1")).toBe("ru");

    await unmount();
  });

  it("sends a general start-screen feedback message when feedback is configured", async () => {
    vi.mocked(isFeedbackConfigured).mockReturnValue(true);
    const { container, unmount } = await renderApp(<App />);

    await click(buttonByText(container, "Написать разработчику"));
    expect(buttonByText(container, "Отправить").disabled).toBe(true);

    const textarea = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Сообщение разработчику']");
    if (!textarea) {
      throw new Error("Feedback textarea not found");
    }
    await changeInput(textarea, "  Привет разработчику  ");
    await click(buttonByText(container, "Отправить"));

    expect(sendFeedback).toHaveBeenCalledWith(expect.objectContaining({
      kind: "message",
      mode: "start",
      message: "Привет разработчику"
    }));

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
    expectText(container, "Акита-ину");
    expectText(container, "Бигль");
    expect(inputByLabel("Найти породу")).toBeTruthy();
    expectText(container, "Угадай породу");
    expect(queryButtonByText(container, "Угадать")).toBeNull();
    expect(queryButtonByText(container, "Дальше")).toBeNull();
    expect(container.querySelector(".dog-panel.scale-normal")).toBeTruthy();

    await unmount();
  });

  it("uses English breed labels in English UI while keeping Russian search matches working", async () => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["en-US"]
    });
    Object.defineProperty(navigator, "language", {
      configurable: true,
      value: "en-US"
    });
    mockSolo(makeFinishedGame());

    const { container, unmount } = await renderApp(<App />);

    expectText(container, "Final score");
    expectText(container, "Akita Inu");
    expectText(container, "Beagle");
    expect(container.textContent).not.toContain("Акита-ину");
    expect(container.textContent).not.toContain("Бигль");

    await unmount();

    mockSolo(makeGame());
    vi.mocked(api.suggestBreeds).mockResolvedValue({
      query: "ак",
      suggestions: [{ breed: breeds.akita, label: breeds.akita.ru, match: "ru" }]
    });
    const rendered = await renderApp(<App />);
    const search = inputByLabel("Find a breed");
    await changeInput(search, "ак");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(230);
      await Promise.resolve();
    });

    expectText(rendered.container, "Akita Inu");
    expect(rendered.container.querySelector(".breed-suggestions small")).toBeNull();
    expect(rendered.container.textContent).not.toContain("Акита-ину");

    await rendered.unmount();
  });

  it("sends a one-click solo image report with the visible answer image id", async () => {
    vi.mocked(isFeedbackConfigured).mockReturnValue(true);
    const solo = makeGame();
    mockSolo(solo);

    const { container, unmount } = await renderApp(<App />);

    const report = container.querySelector<HTMLButtonElement>("button[aria-label='Пожаловаться на фото']");
    if (!report) {
      throw new Error("Report button not found");
    }
    expect(report.closest(".dog-panel-header")).toBeTruthy();
    expect(report.closest(".dog-image-wrap")).toBeNull();
    expect(report.closest(".icon-actions")).toBeNull();
    await click(report);

    expect(sendFeedback).toHaveBeenCalledWith(expect.objectContaining({
      kind: "bad_image",
      mode: "solo",
      gameId: solo.gameId,
      roundIndex: solo.round?.index,
      phase: solo.status,
      image: solo.round?.answerImage,
      visiblePhoto: "answer"
    }));

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
    expectText(container, "Акита-ину");
    expectText(container, "Бигль");
    expect(buttonByText(container, "На главный экран")).toBeTruthy();
    expect(container.querySelector(".score-bar div")?.getAttribute("style")).toContain("width: 21%");

    await unmount();
  });

  it("locks private duel waiting overlay and copy controls", async () => {
    mockDuel(makeDuel({ phase: "waiting", status: "waiting", waitingForOpponent: true }));

    const { container, unmount } = await renderApp(<App />);

    expect(container.querySelector(".duel-screen")).toBeTruthy();
    expectText(container, "Ждем друга...");
    expectText(container, "Отправьте эту ссылку второму игроку:");
    expectText(container, "ABC123");
    expect(buttonByText(container, "Копировать ссылку")).toBeTruthy();
    expect(buttonByText(container, "На главный экран")).toBeTruthy();
    expect(document.querySelector("input[aria-label='Найти породу']")).toBeNull();
    expect(queryButtonByText(container, "Угадать")).toBeNull();

    await click(buttonByText(container, "Копировать ссылку"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/ABC123`);
    expectText(container, "Скопировано!");

    await click(buttonByText(container, "На главный экран"));
    expect(container.querySelector(".app.start-screen")).toBeTruthy();

    await unmount();
  });

  it("locks public duel waiting overlay without invite controls", async () => {
    mockDuel(makeDuel({
      visibility: "public",
      phase: "waiting",
      status: "waiting",
      waitingForOpponent: true
    }));

    const { container, unmount } = await renderApp(<App />);

    expectText(container, "Ищем соперника...");
    expectText(container, "Подключим первого свободного игрока");
    expect(buttonByText(container, "Отмена")).toBeTruthy();
    expect(buttonByText(container, "Отмена").parentElement?.className).toBe("public-waiting-actions");
    expect(container.textContent).not.toContain("Отправьте эту ссылку второму игроку:");
    expect(queryButtonByText(container, "Копировать ссылку")).toBeNull();
    expect(container.textContent).not.toContain("ABC123");

    await click(buttonByText(container, "Отмена"));
    expect(duelApi.leaveRoom).toHaveBeenCalled();
    expect(container.querySelector(".app.start-screen")).toBeTruthy();

    await unmount();
  });

  it("polls public waiting rooms before sending another heartbeat so found matches are visible", async () => {
    const waiting = makeDuel({
      visibility: "public",
      phase: "waiting",
      status: "waiting",
      waitingForOpponent: true
    });
    const countdown = makeDuel({
      visibility: "public",
      phase: "countdown",
      status: "countdown",
      waitingForOpponent: false,
      roundStartsAt: new Date(Date.now() + 2500).toISOString()
    });
    mockDuel(waiting);
    vi.mocked(duelApi.getState).mockResolvedValueOnce(countdown);

    const { container, unmount } = await renderApp(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
    });

    expect(duelApi.getState).toHaveBeenCalled();
    expect(duelApi.heartbeatWaitingRoom).not.toHaveBeenCalled();
    expect(container.querySelector(".duel-countdown-overlay")).toBeTruthy();

    await unmount();
  });

  it("locks duel countdown overlay without guess controls", async () => {
    mockDuel(makeDuel({
      phase: "countdown",
      status: "countdown",
      roundStartsAt: new Date(Date.now() + 200).toISOString()
    }));

    const { container, unmount } = await renderApp(<App />);

    expect(container.querySelector(".duel-countdown-overlay")).toBeTruthy();
    expect(container.querySelector(".countdown-ring")).toBeTruthy();
    expectText(container, "3");
    expect(document.querySelector("input[aria-label='Найти породу']")).toBeNull();
    expect(queryButtonByText(container, "Угадать")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expectText(container, "2");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expectText(container, "1");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(container.querySelector(".duel-countdown-overlay")).toBeNull();

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

  it("shows a disabled next action while waiting for opponent guess after my answer", async () => {
    mockDuel(makeDuel({
      waitingForOpponentGuessDeadlineAt: new Date(Date.now() + 15000).toISOString(),
      round: {
        ...makeDuel().round!,
        myGuessBreed: breeds.beagle,
        myGuessImage: null
      }
    }));

    const { container, unmount } = await renderApp(<App />);

    expectText(container, "Ждем соперника: 15");
    const next = buttonByText(container, "Дальше");
    expect(next.disabled).toBe(true);
    expect(queryButtonByText(container, "Угадать")).toBeNull();
    expect(document.querySelector("input[aria-label='Найти породу']")).toBeNull();

    await unmount();
  });

  it("locks duel revealed next states, opponent note, gallery tabs, and win effect", async () => {
    mockDuel(makeRevealedDuel({
      opponentReadyForNext: true,
      revealedAutoNextAt: new Date(Date.now() + 10000).toISOString()
    }));

    const { container, unmount } = await renderApp(<App />);

    expect(document.querySelector("input[aria-label='Найти породу']")).toBeNull();
    expectText(container, "Соперник готов: 10");
    expect(buttonByText(container, "Дальше").disabled).toBe(false);
    expect(buttonByText(container, "Правильный ответ")).toBeTruthy();
    expect(buttonByText(container, "Ваш ответ")).toBeTruthy();
    expect(container.querySelector(".duel-win-effect")).toBeTruthy();
    expect(container.querySelector(".opponent-arc-label")?.textContent).toBe("+25");
    expect(container.querySelector<HTMLButtonElement>("button[title='Вельш-корги']")?.textContent).toBe("Вельш-корги");

    await unmount();
  });

  it("shows the auto-advance countdown while waiting for the opponent after next", async () => {
    mockDuel(makeRevealedDuel({
      waitingForNext: true,
      opponentReadyForNext: false,
      revealedAutoNextAt: new Date(Date.now() + 15000).toISOString()
    }));

    const { container, unmount } = await renderApp(<App />);

    const waiting = buttonByText(container, "Ждем соперника");
    expect(waiting.disabled).toBe(true);
    expect(queryButtonByText(container, "Дальше")).toBeNull();
    expectText(container, "Ждем соперника: 15");
    expect(container.textContent).not.toContain("Соперник готов");

    await unmount();
  });

  it("opens the final duel result as soon as ready-next finishes the last round", async () => {
    mockDuel(makeRevealedDuel({
      round: {
        ...makeRevealedDuel().round!,
        index: 7,
        total: 7
      }
    }));
    vi.mocked(duelApi.readyNext).mockResolvedValue(makeFinishedDuel());

    const { container, unmount } = await renderApp(<App />);
    await click(buttonByText(container, "Дальше"));

    expect(duelApi.readyNext).toHaveBeenCalled();
    expect(container.querySelector(".duel-final-screen")).toBeTruthy();
    expect(queryButtonByText(container, "Ждем соперника")).toBeNull();

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
  vi.mocked(duelApi.heartbeatWaitingRoom).mockReset();
  vi.mocked(duelApi.leaveRoom).mockReset().mockResolvedValue();
  vi.mocked(api.restoreGame).mockReset().mockResolvedValue(null);
}

function mockSolo(game: GameViewState) {
  vi.mocked(duelApi.roomIdFromPath).mockReset().mockReturnValue(null);
  vi.mocked(duelApi.restoreFromPath).mockReset();
  vi.mocked(duelApi.heartbeatWaitingRoom).mockReset();
  vi.mocked(duelApi.leaveRoom).mockReset().mockResolvedValue();
  vi.mocked(api.restoreGame).mockReset().mockImplementation(async () => game);
  vi.mocked(api.getGame).mockReset().mockImplementation(async () => game);
}

function mockDuel(duel: DuelViewState) {
  vi.mocked(duelApi.roomIdFromPath).mockReset().mockReturnValue(duel.roomId);
  vi.mocked(api.restoreGame).mockReset();
  vi.mocked(duelApi.restoreFromPath).mockReset().mockImplementation(async () => duel);
  vi.mocked(duelApi.getState).mockReset().mockImplementation(async () => duel);
  vi.mocked(duelApi.heartbeatWaitingRoom).mockReset().mockImplementation(async () => duel);
  vi.mocked(duelApi.leaveRoom).mockReset().mockResolvedValue();
}
