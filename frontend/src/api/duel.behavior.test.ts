import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BreedId, DuelGuess, DuelPhase, DuelSnapshot } from "./types";

declare const process: { cwd(): string };

const SESSION_KEY = "dogguessr:duelSessions:v1";
const ROOM_ID = "ABC123";
const PLAYER_ID = "p1";
const PLAYER_TOKEN = "token-p1";
const OPPONENT_ID = "p2";
const SERVER_NOW = "2026-01-01T00:00:00.000Z";
const ROUND_STARTS_AT = "2026-01-01T00:00:03.000Z";
const SECOND_DEADLINE_AT = "2026-01-01T00:00:18.000Z";
const REVEALED_AT = "2026-01-01T00:00:08.000Z";
const ANSWERS = [
  "Affenpinscher",
  "Basenji",
  "Beagle",
  "Border Collie",
  "Boxer",
  "Chihuahua",
  "Dachshund"
];
const MY_GUESS = "Affenpinscher";
const OPPONENT_GUESS = "Basenji";

type DuelRequest = {
  path: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
};

type DuelFetchHandler = (request: DuelRequest) => unknown | Promise<unknown>;

let duelRequests: DuelRequest[];
let duelFetchHandler: DuelFetchHandler;

describe("duel api behavior", () => {
  beforeEach(() => {
    duelRequests = [];
    duelFetchHandler = ({ path }) => {
      throw new Error(`Unhandled duel request: ${path}`);
    };
    installStorage();
    installWindow("/");
    installCrypto();
    installFetch();
    vi.resetModules();
  });

  it("creates a room with 7 unique answers, stores the session, pushes the room route, and projects the view", async () => {
    const pushedRoutes: string[] = [];
    installWindow("/", pushedRoutes);
    duelFetchHandler = (request) => {
      expect(request.path).toBe("/rooms");
      expect(request.method).toBe("POST");
      const body = request.body as { answerBreedIds: BreedId[] };
      expect(body.answerBreedIds).toHaveLength(7);
      expect(new Set(body.answerBreedIds).size).toBe(7);
      return sessionResponse({
        snapshot: snapshot({ phase: "waiting", players: [{ id: PLAYER_ID, slot: 0 }], answers: body.answerBreedIds })
      });
    };
    const { duelApi } = await import("./duel");

    const view = await duelApi.createRoom();

    expect(duelRequests.map((request) => request.path)).toContain("/rooms");
    expect(readSessions()).toEqual({ [ROOM_ID]: { playerId: PLAYER_ID, playerToken: PLAYER_TOKEN } });
    expect(pushedRoutes).toEqual([`/${ROOM_ID}`]);
    expect(view).toMatchObject({
      mode: "duel",
      roomId: ROOM_ID,
      gameId: `duel:${ROOM_ID}`,
      playerId: PLAYER_ID,
      opponentPlayerId: null,
      phase: "waiting",
      status: "waiting",
      myTotalScore: 0,
      opponentTotalScore: 0,
      maxScore: 700,
      deadlineAt: null,
      roundStartsAt: null,
      waitingForOpponent: true,
      waitingForNext: false,
      opponentReadyForNext: false,
      pressure: false
    });
    expect(view.round).toMatchObject({
      index: 1,
      total: 7,
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
    });
    expect(view.round?.answerImage.breedId).toBe((duelRequests.find((request) => request.path === "/rooms")?.body as { answerBreedIds: string[] }).answerBreedIds[0]);
    expect(view.map.tiles.length).toBeGreaterThan(100);
  });

  it("restores from a 6-character path, rejoins with stored credentials, and dedupes pending joins", async () => {
    installWindow(`/${ROOM_ID}`);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ [ROOM_ID]: { playerId: PLAYER_ID, playerToken: PLAYER_TOKEN } }));
    let resolveJoin: () => void = () => {};
    const joinGate = new Promise<void>((resolve) => {
      resolveJoin = resolve;
    });
    duelFetchHandler = async (request) => {
      expect(request.path).toBe(`/rooms/${ROOM_ID}/join`);
      await joinGate;
      return sessionResponse({
        snapshot: snapshot({ phase: "countdown", players: twoPlayers(), roundStartsAt: ROUND_STARTS_AT })
      });
    };
    const { duelApi } = await import("./duel");

    const restoredPromise = duelApi.restoreFromPath();
    const joinedPromise = duelApi.joinRoom(ROOM_ID);
    await Promise.resolve();
    expect(duelRequests).toHaveLength(1);
    expect(duelRequests[0].body).toEqual({ playerId: PLAYER_ID, playerToken: PLAYER_TOKEN });

    resolveJoin();
    const [restored, joined] = await Promise.all([restoredPromise, joinedPromise]);

    expect(restored?.phase).toBe("countdown");
    expect(joined).toEqual(restored);
    expect(readSessions()).toEqual({ [ROOM_ID]: { playerId: PLAYER_ID, playerToken: PLAYER_TOKEN } });
  });

  it("parses only bare 6-character room ids from the current path", async () => {
    const { duelApi } = await import("./duel");

    installWindow("/ABC123");
    expect(duelApi.roomIdFromPath()).toBe("ABC123");
    installWindow("//ABC123//");
    expect(duelApi.roomIdFromPath()).toBe("ABC123");
    installWindow("/abc12");
    expect(duelApi.roomIdFromPath()).toBeNull();
    installWindow("/abc1234");
    expect(duelApi.roomIdFromPath()).toBeNull();
    installWindow("/abc-12");
    expect(duelApi.roomIdFromPath()).toBeNull();
    installWindow("/rooms/ABC123");
    expect(duelApi.roomIdFromPath()).toBeNull();
  });

  it("uses auth headers for state changes, submits the selected breed with a client action id, and posts ready-next without a body", async () => {
    const states = [
      snapshot({ phase: "guessing", players: twoPlayers() }),
      snapshot({
        phase: "guessing",
        players: twoPlayers(),
        rounds: [round({ guesses: { [PLAYER_ID]: guess(MY_GUESS, "uuid-1") } })]
      }),
      snapshot({
        phase: "revealed",
        players: twoPlayers(),
        readyNextPlayerIds: [PLAYER_ID],
        rounds: [round({ revealedAt: REVEALED_AT, guesses: { [PLAYER_ID]: guess(MY_GUESS, "uuid-1"), [OPPONENT_ID]: guess(OPPONENT_GUESS, "opponent-action") } })]
      }),
      snapshot({
        phase: "countdown",
        players: twoPlayers(),
        currentRoundIndex: 1,
        roundStartsAt: ROUND_STARTS_AT,
        rounds: [round({ revealedAt: REVEALED_AT, guesses: { [PLAYER_ID]: guess(MY_GUESS, "uuid-1"), [OPPONENT_ID]: guess(OPPONENT_GUESS, "opponent-action") } }), round({ index: 1, answerBreedId: ANSWERS[1] })]
      })
    ];
    duelFetchHandler = (request) => {
      if (request.path === `/rooms/${ROOM_ID}/join`) {
        return sessionResponse({ snapshot: states[0] });
      }
      if (request.path === `/rooms/${ROOM_ID}`) {
        return states[0];
      }
      if (request.path === `/rooms/${ROOM_ID}/guess`) {
        return states[1];
      }
      if (request.path === `/rooms/${ROOM_ID}/ready-next`) {
        return states[3];
      }
      throw new Error(`Unhandled duel request: ${request.path}`);
    };
    const { duelApi } = await import("./duel");
    await duelApi.joinRoom(ROOM_ID);

    const selected = await duelApi.selectBreed(MY_GUESS);
    expect(selected.round?.selectedBreedId).toBe(MY_GUESS);
    const stateView = await duelApi.getState();
    const guessed = await duelApi.submitGuess();
    const next = await duelApi.readyNext();

    expect(stateView.round?.selectedBreedId).toBe(MY_GUESS);
    const getRequest = duelRequests.find((request) => request.path === `/rooms/${ROOM_ID}`)!;
    const guessRequest = duelRequests.find((request) => request.path === `/rooms/${ROOM_ID}/guess`)!;
    const readyRequest = duelRequests.find((request) => request.path === `/rooms/${ROOM_ID}/ready-next`)!;
    expect(getRequest.method).toBe("GET");
    expect(guessRequest.method).toBe("POST");
    expect(readyRequest.method).toBe("POST");
    for (const request of [getRequest, guessRequest, readyRequest]) {
      expect(request.headers["Content-Type"]).toBe("application/json");
      expect(request.headers["X-Dogguessr-Player-Id"]).toBe(PLAYER_ID);
      expect(request.headers["X-Dogguessr-Player-Token"]).toBe(PLAYER_TOKEN);
    }
    expect(guessRequest.body).toEqual({ breedId: MY_GUESS, clientActionId: "uuid-1" });
    expect(readyRequest.body).toBeNull();
    expect(guessed.round?.myGuessBreed?.id).toBe(MY_GUESS);
    expect(next.phase).toBe("countdown");
    expect(next.round?.index).toBe(2);
    expect(next.history).toHaveLength(1);
  });

  it("projects waiting, countdown, guessing pressure, revealed, and finished snapshots into DuelViewState", async () => {
    const projections = [
      snapshot({ phase: "waiting", players: [{ id: PLAYER_ID, slot: 0 }] }),
      snapshot({ phase: "countdown", players: twoPlayers(), roundStartsAt: ROUND_STARTS_AT }),
      snapshot({
        phase: "guessing",
        players: twoPlayers(),
        rounds: [round({ firstGuessPlayerId: OPPONENT_ID, secondDeadlineAt: SECOND_DEADLINE_AT, guesses: { [OPPONENT_ID]: guess(OPPONENT_GUESS, "opponent-action") } })]
      }),
      snapshot({
        phase: "revealed",
        players: twoPlayers(),
        readyNextPlayerIds: [PLAYER_ID, OPPONENT_ID],
        rounds: [round({ revealedAt: REVEALED_AT, guesses: { [PLAYER_ID]: guess(MY_GUESS, "uuid-1"), [OPPONENT_ID]: guess(OPPONENT_GUESS, "opponent-action") } })]
      }),
      snapshot({
        phase: "finished",
        players: twoPlayers(),
        currentRoundIndex: 6,
        readyNextPlayerIds: [PLAYER_ID, OPPONENT_ID],
        rounds: ANSWERS.map((answerBreedId, index) => round({
          index,
          answerBreedId,
          revealedAt: REVEALED_AT,
          guesses: {
            [PLAYER_ID]: guess(answerBreedId, `mine-${index}`),
            [OPPONENT_ID]: guess(index === 0 ? null : answerBreedId, `theirs-${index}`, index === 0)
          }
        }))
      })
    ];
    let projectionIndex = 0;
    duelFetchHandler = (request) => {
      if (request.path === `/rooms/${ROOM_ID}/join`) {
        return sessionResponse({ snapshot: projections[projectionIndex++] });
      }
      if (request.path === `/rooms/${ROOM_ID}`) {
        return projections[projectionIndex++];
      }
      throw new Error(`Unhandled duel request: ${request.path}`);
    };
    const { duelApi } = await import("./duel");

    const waiting = await duelApi.joinRoom(ROOM_ID);
    const countdown = await duelApi.getState();
    const pressure = await duelApi.getState();
    const revealed = await duelApi.getState();
    const finished = await duelApi.getState();

    expect(waiting).toMatchObject({ phase: "waiting", status: "waiting", waitingForOpponent: true, pressure: false, deadlineAt: null, roundStartsAt: null });
    expect(countdown).toMatchObject({ phase: "countdown", status: "countdown", waitingForOpponent: false, pressure: false, deadlineAt: null, roundStartsAt: ROUND_STARTS_AT });
    expect(pressure).toMatchObject({ phase: "guessing", status: "guessing", waitingForOpponent: false, pressure: true, deadlineAt: SECOND_DEADLINE_AT });
    expect(pressure.round).toMatchObject({ opponentGuessBreed: null, opponentGuessImage: null, opponentScore: null, opponentTimedOut: false });
    expect(revealed).toMatchObject({ phase: "revealed", status: "revealed", waitingForNext: true, opponentReadyForNext: true, pressure: false, deadlineAt: null });
    expect(revealed.history).toHaveLength(1);
    expect(revealed.round).toMatchObject({ answerBreed: { id: ANSWERS[0] }, myGuessBreed: { id: MY_GUESS }, opponentGuessBreed: { id: OPPONENT_GUESS }, myScore: 100 });
    expect(finished).toMatchObject({ phase: "finished", status: "finished", maxScore: 700, waitingForNext: false, opponentReadyForNext: false, deadlineAt: null });
    expect(finished.history).toHaveLength(7);
    expect(finished.round?.index).toBe(7);
    expect(finished.myTotalScore).toBe(700);
    expect(finished.opponentTotalScore).toBe(600);
    expect(finished.history[0]).toMatchObject({ myScore: 100, opponentScore: 0, opponentTimedOut: true });
  });

  it("hides opponent guess details before reveal and shows them after reveal", async () => {
    const hiddenGuess = round({
      guesses: {
        [PLAYER_ID]: guess(MY_GUESS, "mine"),
        [OPPONENT_ID]: guess(OPPONENT_GUESS, "theirs")
      }
    });
    const revealedGuess = { ...hiddenGuess, revealedAt: REVEALED_AT };
    const states = [
      snapshot({ phase: "guessing", players: twoPlayers(), rounds: [hiddenGuess] }),
      snapshot({ phase: "revealed", players: twoPlayers(), rounds: [revealedGuess] })
    ];
    let index = 0;
    duelFetchHandler = (request) => {
      if (request.path === `/rooms/${ROOM_ID}/join`) {
        return sessionResponse({ snapshot: states[index++] });
      }
      if (request.path === `/rooms/${ROOM_ID}`) {
        return states[index++];
      }
      throw new Error(`Unhandled duel request: ${request.path}`);
    };
    const { duelApi } = await import("./duel");

    const beforeReveal = await duelApi.joinRoom(ROOM_ID);
    const afterReveal = await duelApi.getState();

    expect(beforeReveal.round).toMatchObject({
      myGuessBreed: { id: MY_GUESS },
      myGuessImage: { breedId: MY_GUESS },
      opponentGuessBreed: null,
      opponentGuessImage: null,
      myScore: null,
      opponentScore: null
    });
    expect(afterReveal.round).toMatchObject({
      myGuessBreed: { id: MY_GUESS },
      myGuessImage: { breedId: MY_GUESS },
      opponentGuessBreed: { id: OPPONENT_GUESS },
      opponentGuessImage: { breedId: OPPONENT_GUESS },
      myScore: 100
    });
    expect(afterReveal.round?.opponentScore).toBeGreaterThanOrEqual(0);
    expect(afterReveal.history[0].opponentGuessImage?.breedId).toBe(OPPONENT_GUESS);
  });

  it("keeps scoring, image, totals, history, deadline, waiting, and ready flags aligned with shared client data", async () => {
    const states = [
      snapshot({
        phase: "revealed",
        players: twoPlayers(),
        readyNextPlayerIds: [OPPONENT_ID],
        rounds: [
          round({
            revealedAt: REVEALED_AT,
            guesses: {
              [PLAYER_ID]: guess(ANSWERS[0], "mine-exact"),
              [OPPONENT_ID]: guess(null, "opponent-timeout", true)
            }
          })
        ]
      }),
      snapshot({
        phase: "guessing",
        players: twoPlayers(),
        rounds: [
          round({
            firstGuessPlayerId: PLAYER_ID,
            secondDeadlineAt: SECOND_DEADLINE_AT,
            guesses: { [PLAYER_ID]: guess(MY_GUESS, "mine-first") }
          })
        ]
      })
    ];
    let index = 0;
    duelFetchHandler = (request) => {
      if (request.path === `/rooms/${ROOM_ID}/join`) {
        return sessionResponse({ snapshot: states[index++] });
      }
      if (request.path === `/rooms/${ROOM_ID}`) {
        return states[index++];
      }
      throw new Error(`Unhandled duel request: ${request.path}`);
    };
    const { duelApi } = await import("./duel");

    const revealed = await duelApi.joinRoom(ROOM_ID);
    const guessingAfterMyFirstGuess = await duelApi.getState();

    expect(revealed.myTotalScore).toBe(100);
    expect(revealed.opponentTotalScore).toBe(0);
    expect(revealed.history).toHaveLength(1);
    expect(revealed.history[0]).toMatchObject({
      index: 1,
      answerBreed: { id: ANSWERS[0] },
      answerImage: { breedId: ANSWERS[0] },
      myGuessBreed: { id: ANSWERS[0] },
      myGuessImage: { breedId: ANSWERS[0] },
      opponentGuessBreed: null,
      opponentGuessImage: null,
      myScore: 100,
      opponentScore: 0,
      myTimedOut: false,
      opponentTimedOut: true
    });
    expect(revealed).toMatchObject({
      maxScore: 700,
      deadlineAt: null,
      waitingForOpponent: false,
      waitingForNext: false,
      opponentReadyForNext: true,
      pressure: false
    });
    expect(guessingAfterMyFirstGuess).toMatchObject({
      deadlineAt: null,
      waitingForOpponent: false,
      waitingForNext: false,
      opponentReadyForNext: false,
      pressure: false
    });
    expect(guessingAfterMyFirstGuess.round).toMatchObject({
      myGuessBreed: { id: MY_GUESS },
      opponentGuessBreed: null,
      myScore: null,
      opponentScore: null
    });
  });

  it("keeps stored sessions when clearSession only clears the active in-memory session", async () => {
    duelFetchHandler = (request) => {
      if (request.path === `/rooms/${ROOM_ID}/join`) {
        return sessionResponse({ snapshot: snapshot({ phase: "waiting", players: [{ id: PLAYER_ID, slot: 0 }] }) });
      }
      throw new Error(`Unhandled duel request: ${request.path}`);
    };
    const { duelApi } = await import("./duel");
    await duelApi.joinRoom(ROOM_ID);

    duelApi.clearSession();

    expect(readSessions()).toEqual({ [ROOM_ID]: { playerId: PLAYER_ID, playerToken: PLAYER_TOKEN } });
    await expect(duelApi.getState()).rejects.toThrow("Duel session is not active");
  });
});

function sessionResponse({ snapshot, roomId = ROOM_ID, playerId = PLAYER_ID, playerToken = PLAYER_TOKEN }: {
  snapshot: DuelSnapshot;
  roomId?: string;
  playerId?: string;
  playerToken?: string;
}) {
  return { roomId, playerId, playerToken, snapshot };
}

function snapshot({
  roomId = ROOM_ID,
  phase,
  players,
  currentRoundIndex = 0,
  roundStartsAt = null,
  rounds,
  readyNextPlayerIds = [],
  serverNow = SERVER_NOW,
  answers = ANSWERS
}: {
  roomId?: string;
  phase: DuelPhase;
  players: DuelSnapshot["players"];
  currentRoundIndex?: number;
  roundStartsAt?: string | null;
  rounds?: DuelSnapshot["rounds"];
  readyNextPlayerIds?: string[];
  serverNow?: string;
  answers?: BreedId[];
}): DuelSnapshot {
  return {
    roomId,
    version: 1,
    phase,
    players,
    currentRoundIndex,
    roundStartsAt,
    rounds: rounds ?? answers.map((answerBreedId, index) => round({ index, answerBreedId })),
    readyNextPlayerIds,
    serverNow
  };
}

function round({
  index = 0,
  answerBreedId = ANSWERS[index],
  firstGuessPlayerId = null,
  secondDeadlineAt = null,
  revealedAt = null,
  guesses = {}
}: {
  index?: number;
  answerBreedId?: BreedId;
  firstGuessPlayerId?: string | null;
  secondDeadlineAt?: string | null;
  revealedAt?: string | null;
  guesses?: Record<string, DuelGuess>;
} = {}): DuelSnapshot["rounds"][number] {
  return { index, answerBreedId, firstGuessPlayerId, secondDeadlineAt, revealedAt, guesses };
}

function guess(breedId: BreedId | null, clientActionId: string, timedOut = false): DuelGuess {
  return {
    breedId,
    submittedAt: timedOut ? SECOND_DEADLINE_AT : SERVER_NOW,
    clientActionId,
    timedOut
  };
}

function twoPlayers(): DuelSnapshot["players"] {
  return [{ id: PLAYER_ID, slot: 0 }, { id: OPPONENT_ID, slot: 1 }];
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

function installWindow(pathname: string, pushedRoutes: string[] = []): void {
  vi.stubGlobal("window", {
    location: { pathname },
    history: {
      pushState: (_state: unknown, _title: string, url?: string | URL | null) => {
        pushedRoutes.push(String(url));
      }
    }
  });
}

function installCrypto(): void {
  let sequence = 0;
  vi.stubGlobal("crypto", {
    randomUUID: () => {
      sequence += 1;
      return `uuid-${sequence}`;
    }
  });
}

function installFetch(): void {
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input.toString(), "http://localhost");
    const duelPath = url.searchParams.get("path");
    if (duelPath) {
      const request = {
        path: duelPath,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
        headers: normalizeHeaders(init?.headers)
      };
      duelRequests.push(request);
      return jsonResponse(await duelFetchHandler(request));
    }

    const staticBody = await readRootFile(url.pathname);
    return new Response(staticBody, { status: 200 });
  });
}

function normalizeHeaders(headers: RequestInit["headers"]): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers as Record<string, string>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function readSessions(): unknown {
  return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "{}");
}

async function readRootFile(pathname: string): Promise<BodyInit> {
  const fsModule = "node:fs/promises";
  const pathModule = "node:path";
  const { readFile } = await import(fsModule);
  const path = await import(pathModule);
  const candidates = [
    path.join(process.cwd(), pathname),
    path.join(process.cwd(), "..", pathname),
    path.join(process.cwd(), "..", "..", pathname)
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate);
    } catch {
      // Try the next likely Vitest cwd.
    }
  }
  throw new Error(`Cannot load static fixture: ${pathname}`);
}
