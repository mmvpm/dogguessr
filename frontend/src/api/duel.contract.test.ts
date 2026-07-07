import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelSnapshot } from "./types";

const sharedMap = {
  tileWidth: 1,
  tileHeight: 1,
  columnGap: 0,
  rowGap: 0,
  columns: 1,
  rows: 1,
  tiles: [],
  legend: []
};

vi.mock("./client", () => ({
  getSharedGameData: vi.fn(async () => ({ map: sharedMap })),
  makeDuelAnswerBreedIds: vi.fn(async (count: number) => answerIds.slice(0, count)),
  getBreedInfo: vi.fn(async (id: string) => ({ id, en: id, ru: id, group: "test", color: "#000000" })),
  getBreedImage: vi.fn(async (breedId: string, seed: string) => ({ id: `${breedId}:${seed}`, url: `/dataset/${breedId}.jpg`, breedId })),
  getBreedScore: vi.fn(async (guessBreedId: string | null, answerBreedId: string) => ({
    score: guessBreedId === answerBreedId ? 100 : guessBreedId ? 37 : 0,
    similarity: guessBreedId ? 0.37 : null
  }))
}));

describe("duel api protocol contract", () => {
  beforeEach(() => {
    vi.resetModules();
    installStorage();
    installBrowserGlobals();
    installCrypto();
  });

  it("creates rooms through query-path routing, stores the session, and projects waiting snapshot fields", async () => {
    const requests = installDuelFetch([
      sessionResponse("abc123", "p1", "token-p1", snapshot({ phase: "waiting", players: [{ id: "p1", slot: 0 }] }))
    ]);
    const { duelApi } = await import("./duel");

    const view = await duelApi.createRoom();

    expect(requests).toHaveLength(1);
    expect(requests[0].url.searchParams.get("path")).toBe("/rooms");
    expect(requests[0].init.method).toBe("POST");
    expect(requests[0].init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(requests[0].init.body as string)).toEqual({ answerBreedIds: answerIds });
    expect(historyPushedTo).toBe("/abc123");
    expect(JSON.parse(localStorage.getItem("dogguessr:duelSessions:v1") ?? "{}")).toEqual({
      abc123: { playerId: "p1", playerToken: "token-p1" }
    });
    expect(view).toMatchObject({
      mode: "duel",
      roomId: "abc123",
      gameId: "duel:abc123",
      playerId: "p1",
      opponentPlayerId: null,
      phase: "waiting",
      status: "waiting",
      waitingForOpponent: true,
      waitingForNext: false,
      opponentReadyForNext: false,
      pressure: false,
      deadlineAt: null,
      roundStartsAt: null,
      serverNow: "2026-01-01T00:00:00.000Z",
      maxScore: 700
    });
  });

  it("reuses stored player credentials on join and sends session headers for poll, guess, and ready-next", async () => {
    localStorage.setItem("dogguessr:duelSessions:v1", JSON.stringify({
      abc123: { playerId: "p1", playerToken: "token-p1" }
    }));
    const requests = installDuelFetch([
      sessionResponse("abc123", "p1", "token-p1", snapshot({ phase: "countdown", players: twoPlayers(), roundStartsAt: "2026-01-01T00:00:03.000Z" })),
      snapshot({ phase: "guessing", players: twoPlayers() }),
      snapshot({
        phase: "guessing",
        players: twoPlayers(),
        rounds: [round({ guesses: { p1: guess("Affenpinscher", "client-action-1") }, firstGuessPlayerId: "p1", secondDeadlineAt: "2026-01-01T00:00:20.000Z" })]
      }),
      snapshot({ phase: "revealed", players: twoPlayers(), readyNextPlayerIds: ["p1"] })
    ]);
    const { duelApi } = await import("./duel");

    await duelApi.joinRoom("abc123");
    await duelApi.getState();
    await duelApi.selectBreed("Affenpinscher");
    await duelApi.submitGuess();
    const readyView = await duelApi.readyNext();

    expect(requests.map((request) => request.url.searchParams.get("path"))).toEqual([
      "/rooms/abc123/join",
      "/rooms/abc123",
      "/rooms/abc123/guess",
      "/rooms/abc123/ready-next"
    ]);
    expect(JSON.parse(requests[0].init.body as string)).toEqual({ playerId: "p1", playerToken: "token-p1" });
    for (const request of requests.slice(1)) {
      expect(request.init.headers).toMatchObject({
        "Content-Type": "application/json",
        "X-Dogguessr-Player-Id": "p1",
        "X-Dogguessr-Player-Token": "token-p1"
      });
    }
    expect(JSON.parse(requests[2].init.body as string)).toEqual({
      breedId: "Affenpinscher",
      clientActionId: "client-action-1"
    });
    expect(readyView.waitingForNext).toBe(true);
  });

  it("projects all backend phase values expected by DuelPhase without remapping them away", async () => {
    const cases = [
      { phase: "waiting", status: "waiting" },
      { phase: "countdown", status: "countdown" },
      { phase: "guessing", status: "guessing" },
      { phase: "revealed", status: "revealed" },
      { phase: "finished", status: "finished" }
    ] as const;

    for (const item of cases) {
      vi.resetModules();
      installStorage();
      installBrowserGlobals();
      installCrypto();
      installDuelFetch([
        sessionResponse("abc123", "p1", "token-p1", snapshot({
          phase: item.phase,
          players: twoPlayers(),
          ...(item.phase === "revealed" || item.phase === "finished" ? { rounds: [revealedRound()] } : {})
        }))
      ]);
      const { duelApi } = await import("./duel");

      const view = await duelApi.joinRoom("abc123");

      expect(view.phase).toBe(item.phase);
      expect(view.status).toBe(item.status);
    }
  });

  it("keeps opponent guess hidden before reveal and visible after reveal in frontend view", async () => {
    const requests = installDuelFetch([
      sessionResponse("abc123", "p2", "token-p2", snapshot({
        phase: "guessing",
        players: twoPlayers(),
        rounds: [round({ firstGuessPlayerId: "p1", secondDeadlineAt: "2026-01-01T00:00:20.000Z", guesses: {} })]
      })),
      snapshot({
        phase: "revealed",
        players: twoPlayers(),
        rounds: [revealedRound()]
      })
    ]);
    const { duelApi } = await import("./duel");

    const hidden = await duelApi.joinRoom("abc123");
    const revealed = await duelApi.getState();

    expect(requests).toHaveLength(2);
    expect(hidden.pressure).toBe(true);
    expect(hidden.deadlineAt).toBe("2026-01-01T00:00:20.000Z");
    expect(hidden.round?.opponentGuessBreed).toBeNull();
    expect(hidden.round?.opponentScore).toBeNull();
    expect(revealed.round?.answerBreed?.id).toBe("Affenpinscher");
    expect(revealed.round?.myGuessBreed?.id).toBe("Akita");
    expect(revealed.round?.opponentGuessBreed?.id).toBe("Affenpinscher");
    expect(revealed.round?.myScore).toBe(37);
    expect(revealed.round?.opponentScore).toBe(100);
  });

  it("throws backend error text for failed authenticated requests", async () => {
    installDuelFetch([
      sessionResponse("abc123", "p1", "token-p1", snapshot({ phase: "guessing", players: twoPlayers() })),
      { status: 403, body: { error: "Invalid player session" } }
    ]);
    const { duelApi } = await import("./duel");

    await duelApi.joinRoom("abc123");

    await expect(duelApi.getState()).rejects.toThrow("Invalid player session");
  });
});

const answerIds = ["Affenpinscher", "Akita", "Basenji", "Beagle", "Boxer", "Briard", "Chow Chow"];
let historyPushedTo: string | null = null;

type FetchResponse = DuelSnapshot | { status: number; body: unknown } | {
  roomId: string;
  playerId: string;
  playerToken: string;
  snapshot: DuelSnapshot;
};

function installDuelFetch(responses: FetchResponse[]) {
  const requests: { url: URL; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url: new URL(url), init });
    const next = responses.shift();
    if (!next) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    if ("status" in next) {
      return new Response(JSON.stringify(next.body), { status: next.status });
    }
    return new Response(JSON.stringify(next), { status: 200 });
  }));
  return requests;
}

function sessionResponse(roomId: string, playerId: string, playerToken: string, duelSnapshot: DuelSnapshot) {
  return { roomId, playerId, playerToken, snapshot: duelSnapshot };
}

function snapshot(overrides: Partial<DuelSnapshot>): DuelSnapshot {
  return {
    roomId: "abc123",
    version: 1,
    phase: "waiting",
    players: [{ id: "p1", slot: 0 }],
    currentRoundIndex: 0,
    roundStartsAt: null,
    rounds: [round()],
    readyNextPlayerIds: [],
    serverNow: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function round(overrides: Partial<DuelSnapshot["rounds"][number]> = {}): DuelSnapshot["rounds"][number] {
  return {
    index: 0,
    answerBreedId: "Affenpinscher",
    firstGuessPlayerId: null,
    secondDeadlineAt: null,
    revealedAt: null,
    guesses: {},
    ...overrides
  };
}

function revealedRound(): DuelSnapshot["rounds"][number] {
  return round({
    firstGuessPlayerId: "p1",
    secondDeadlineAt: "2026-01-01T00:00:20.000Z",
    revealedAt: "2026-01-01T00:00:10.000Z",
    guesses: {
      p1: guess("Affenpinscher", "p1-r0"),
      p2: guess("Akita", "p2-r0")
    }
  });
}

function guess(breedId: string | null, clientActionId: string) {
  return {
    breedId,
    submittedAt: "2026-01-01T00:00:05.000Z",
    clientActionId,
    timedOut: breedId === null
  };
}

function twoPlayers(): DuelSnapshot["players"] {
  return [{ id: "p1", slot: 0 }, { id: "p2", slot: 1 }];
}

function installStorage(): void {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear()
  });
}

function installBrowserGlobals(): void {
  historyPushedTo = null;
  vi.stubGlobal("window", {
    location: { pathname: "/" },
    history: {
      pushState: (_state: unknown, _title: string, url: string) => {
        historyPushedTo = url;
      }
    }
  });
}

function installCrypto(): void {
  vi.stubGlobal("crypto", {
    randomUUID: () => "client-action-1"
  });
}
