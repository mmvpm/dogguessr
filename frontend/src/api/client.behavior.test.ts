import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

declare const process: { cwd(): string };

const GAME_KEY = "dogguessr:activeGame:v1";

type SavedGame = {
  id: string;
  settings: { unlimitedTime: boolean; secondsPerRound: number; roundCount: number };
  answerBreedIds: string[];
  currentRound: {
    index: number;
    answerBreedId: string;
    answerImage: { id: string; url: string; breedId: string };
    startedAt: string;
    deadlineAt: string | null;
    selectedBreedId: string | null;
    revealed: unknown | null;
  };
  history: unknown[];
};

type RootMap = {
  tileWidth: number;
  tileHeight: number;
  columnGap: number;
  rowGap: number;
  tiles: { breedId: string; label: string; color: string; gridColumn: number; gridRow: number; maxDistance: number }[];
};

type ManifestEntry = string[] | { folder: string; files: string[] };

describe("static solo frontend api behavior", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    installStorage();
    installStaticFetch();
    installCrypto("game-1");
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads and normalizes static map, catalog, legend, images, and missing fetch failures", async () => {
    const { getSharedGameData, getBreedInfo, getBreedImage } = await import("./client");
    const shared = await getSharedGameData();
    const affenpinscher = await getBreedInfo("Affenpinscher");
    const encodedImage = await getBreedImage("Affenpinscher", "seed/with spaces");

    expect(shared.breedIds.slice(0, 5)).toEqual([
      "Affenpinscher",
      "Afghan Hound",
      "African Hunting Dog",
      "African Wild Dog",
      "Aidi"
    ]);
    expect(shared.map.tiles[0]).toMatchObject({
      breedId: "Affenpinscher",
      label: "Аффенпинчер",
      maxDistance: 2770.72698
    });
    expect(shared.map.legend.map((item) => item.group)).toEqual([
      "shepherd",
      "collie",
      "corgi",
      "hound",
      "segugio",
      "podenco",
      "pointer",
      "setter",
      "retriever",
      "spaniel",
      "terrier",
      "pinscher",
      "schnauzer",
      "griffon",
      "spitz",
      "laika",
      "wolf",
      "mastiff",
      "bulldog",
      "poodle",
      "other"
    ]);
    expect(affenpinscher).toMatchObject({
      id: "Affenpinscher",
      en: "Affenpinscher",
      ru: "Аффенпинчер",
      group: "pinscher",
      color: "#FBCFE8"
    });
    expect(encodedImage).toMatchObject({ breedId: "Affenpinscher" });
    expect(encodedImage.id).toMatch(/^Affenpinscher\/Image_/);
    expect(encodedImage.url).toMatch(/^\/dataset\/Affenpinscher\/Image_/);
    expect(encodedImage.url).not.toContain(" ");

    vi.resetModules();
    installFailingFetch("/dataset.csv", 503);
    const failingClient = await import("./client");
    await expect(failingClient.getSharedGameData()).rejects.toThrow("Cannot load /dataset.csv: 503");
  });

  it("keeps breed search semantics for ru/en, yo/e, compact tokens, ordering, and empty query", async () => {
    const { api } = await import("./client");

    expect((await api.suggestBreeds("  ")).suggestions).toEqual([]);
    expect((await api.suggestBreeds("кор")).suggestions.slice(0, 3).map((item) => item.label)).toEqual([
      "Корги",
      "Вельш корги (пемброк)",
      "Вельш Корги Пемброк"
    ]);
    expect((await api.suggestBreeds("фокс терьер")).suggestions.slice(0, 2).map((item) => item.label)).toEqual([
      "Гладкошёрстный фокстерьер",
      "Жесткошёрстный фокстерьер"
    ]);
    expect((await api.suggestBreeds("гладкошерстный фокстерьер")).suggestions[0]).toMatchObject({
      label: "Гладкошёрстный фокстерьер",
      match: "ru"
    });
    expect((await api.suggestBreeds("black russian")).suggestions[0]).toMatchObject({
      label: "Чёрный русский терьер",
      match: "en"
    });
    expect((await api.suggestBreeds("черныйрус")).suggestions[0].label).toBe("Чёрный русский терьер");
  });

  it("creates, restores, selects, submits, advances, finishes, and persists the active game shape", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { api } = await import("./client");
    let game = await api.createGame({ unlimitedTime: true, secondsPerRound: 180, roundCount: 5 });
    let persisted = savedGame();

    expect(game.status).toBe("guessing");
    expect(game.deadlineAt).toBeNull();
    expect(game.maxScore).toBe(500);
    expect(game.round).toMatchObject({ index: 1, total: 5, phase: "guessing", selectedBreedId: null });
    expect(new Set(persisted.answerBreedIds).size).toBe(5);
    expect(persisted).toEqual({
      id: game.gameId,
      settings: { unlimitedTime: true, secondsPerRound: 180, roundCount: 5 },
      answerBreedIds: persisted.answerBreedIds,
      currentRound: persisted.currentRound,
      history: []
    });

    game = await api.selectBreed(game.gameId, persisted.answerBreedIds[1]);
    expect(game.round?.selectedBreedId).toBe(persisted.answerBreedIds[1]);
    expect(savedGame().currentRound.selectedBreedId).toBe(persisted.answerBreedIds[1]);

    game = await api.selectBreed(game.gameId, null);
    expect(game.round?.selectedBreedId).toBeNull();

    game = await api.selectBreed(game.gameId, persisted.currentRound.answerBreedId);
    game = await api.submitGuess(game.gameId);
    expect(game.status).toBe("revealed");
    expect(game.round).toMatchObject({ phase: "revealed", score: 100, timedOut: false });
    expect(game.totalScore).toBe(100);

    const afterResubmit = await api.submitGuess(game.gameId);
    expect(afterResubmit.history).toHaveLength(0);
    expect(afterResubmit.round?.score).toBe(100);

    await expect(api.selectBreed(game.gameId, persisted.answerBreedIds[1])).resolves.toMatchObject({
      round: { selectedBreedId: persisted.currentRound.answerBreedId }
    });

    for (let nextIndex = 2; nextIndex <= 5; nextIndex += 1) {
      game = await api.nextRound(game.gameId);
      expect(game.round?.index).toBe(nextIndex);
      persisted = savedGame();
      game = await api.selectBreed(game.gameId, persisted.currentRound.answerBreedId);
      game = await api.submitGuess(game.gameId);
    }

    game = await api.nextRound(game.gameId);
    expect(game).toMatchObject({ status: "finished", round: null, totalScore: 500, maxScore: 500 });
    expect(game.history).toHaveLength(5);
    expect(savedGame().history).toHaveLength(5);

    vi.resetModules();
    const restored = await (await import("./client")).api.restoreGame();
    expect(restored).toMatchObject({ gameId: game.gameId, status: "finished", round: null, totalScore: 500 });
  });

  it("reveals timed-out solo rounds with selected and missing guesses", async () => {
    installCrypto("timeout-with-selection");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const { api } = await import("./client");

    let game = await api.createGame({ unlimitedTime: false, secondsPerRound: 30, roundCount: 5 });
    const firstSaved = savedGame();
    game = await api.selectBreed(game.gameId, firstSaved.currentRound.answerBreedId);
    vi.setSystemTime(new Date("2026-01-01T00:00:30.000Z"));
    game = await api.getGame(game.gameId);

    expect(game.status).toBe("revealed");
    expect(game.deadlineAt).toBeNull();
    expect(game.round).toMatchObject({ score: 100, timedOut: true, selectedBreedId: firstSaved.currentRound.answerBreedId });
    expect(game.round?.guessImage).not.toBeNull();

    game = await api.nextRound(game.gameId);
    expect(game.status).toBe("guessing");
    vi.setSystemTime(new Date(new Date(game.deadlineAt!).getTime() + 1));
    game = await api.restoreGame() as typeof game;

    expect(game.status).toBe("revealed");
    expect(game.round).toMatchObject({ score: 0, similarity: null, timedOut: true, selectedBreedId: null });
    expect(game.round?.guessBreed).toBeNull();
    expect(game.round?.guessImage).toBeNull();
  });

  it("keeps scoring contracts for exact, no guess, top30 blend, non-top30 distance, and 99 max incorrect", async () => {
    const { getBreedScore } = await import("./client");
    const map = await loadRootJson<RootMap>("/breed_map.json");
    const similarities = parseSimilarityCsv(await loadRootText("/breed-similarity.csv"));

    const answerBreedId = "Affenpinscher";
    const topGuessBreedId = topSimilarBreeds(similarities, answerBreedId).find((breedId) => breedId !== answerBreedId)!;
    const nonTopGuessBreedId = map.tiles.find((tile) => !topSimilarBreeds(similarities, answerBreedId).includes(tile.breedId))!.breedId;
    const highestWrong = findHighestIncorrectPair(map, similarities);

    await expect(getBreedScore(answerBreedId, answerBreedId)).resolves.toEqual({ score: 100, similarity: 1 });
    await expect(getBreedScore(null, answerBreedId)).resolves.toEqual({ score: 0, similarity: null });

    const topSimilarity = similarities.get(`${topGuessBreedId}\0${answerBreedId}`)!;
    await expect(getBreedScore(topGuessBreedId, answerBreedId)).resolves.toEqual({
      score: Math.min(99, Math.floor((invDistance(map, topGuessBreedId, answerBreedId) + Math.round(topSimilarity * 100)) / 2)),
      similarity: topSimilarity
    });

    await expect(getBreedScore(nonTopGuessBreedId, answerBreedId)).resolves.toEqual({
      score: invDistance(map, nonTopGuessBreedId, answerBreedId),
      similarity: similarities.get(`${nonTopGuessBreedId}\0${answerBreedId}`)!
    });

    const cappedWrong = await getBreedScore(highestWrong.guessBreedId, highestWrong.answerBreedId);
    expect(cappedWrong.score).toBe(highestWrong.score);
    expect(cappedWrong.score).toBeLessThanOrEqual(99);
    expect(cappedWrong.score).toBeLessThan(100);
    expect(cappedWrong.similarity).toBe(similarities.get(`${highestWrong.guessBreedId}\0${highestWrong.answerBreedId}`)!);
  });

  it("uses seeded answer and guess images and keeps them stable after restore", async () => {
    installCrypto("image-seed-game");
    const { api, getBreedImage } = await import("./client");
    const manifest = await loadRootJson<Record<string, ManifestEntry>>("/image_manifest.json");
    let game = await api.createGame({ unlimitedTime: true, secondsPerRound: 180, roundCount: 5 });
    const persisted = savedGame();
    const answerBreedId = persisted.currentRound.answerBreedId;
    const answerImages = manifestEntry(answerBreedId, manifest[answerBreedId]);

    expect(game.round?.answerImage.id).toBe(expectedImageId(answerBreedId, `${game.gameId}:0`, answerImages));
    await expect(getBreedImage(answerBreedId, `${game.gameId}:0`)).resolves.toEqual(game.round?.answerImage);

    const guessBreedId = Object.keys(manifest).find((breedId) => breedId !== answerBreedId && manifestEntry(breedId, manifest[breedId]).files.length > 1)!;
    const guessImages = manifestEntry(guessBreedId, manifest[guessBreedId]);
    game = await api.selectBreed(game.gameId, guessBreedId);
    game = await api.submitGuess(game.gameId);

    expect(game.round?.guessImage?.id).toBe(expectedImageId(guessBreedId, `${game.gameId}:1:guess`, guessImages));
    vi.resetModules();
    const restored = await (await import("./client")).api.restoreGame();
    expect(restored?.round?.answerImage).toEqual(game.round?.answerImage);
    expect(restored?.round?.guessImage).toEqual(game.round?.guessImage);
  });

  it("keeps current settings validation behavior", async () => {
    const { api } = await import("./client");

    await expect(api.createGame({ unlimitedTime: true, secondsPerRound: 180, roundCount: 4 })).rejects.toThrow(
      "Round count must be between 5 and 20"
    );
    await expect(api.createGame({ unlimitedTime: true, secondsPerRound: 180, roundCount: 21 })).rejects.toThrow(
      "Round count must be between 5 and 20"
    );
    await expect(api.createGame({ unlimitedTime: true, secondsPerRound: 29, roundCount: 5 })).rejects.toThrow(
      "Seconds per round must be between 30 and 300, with step 30"
    );
    await expect(api.createGame({ unlimitedTime: true, secondsPerRound: 45, roundCount: 5 })).rejects.toThrow(
      "Seconds per round must be between 30 and 300, with step 30"
    );
    await expect(api.createGame({ unlimitedTime: true, secondsPerRound: 301, roundCount: 5 })).rejects.toThrow(
      "Seconds per round must be between 30 and 300, with step 30"
    );

    const valid = await api.createGame({ unlimitedTime: false, secondsPerRound: 300, roundCount: 20 });
    expect(valid.settings).toEqual({ unlimitedTime: false, secondsPerRound: 300, roundCount: 20 });
    expect(valid.maxScore).toBe(2000);
  });
});

function installStorage(): void {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear()
  });
}

function installCrypto(uuid: string): void {
  vi.stubGlobal("crypto", {
    randomUUID: () => uuid
  });
}

function installStaticFetch(): void {
  vi.stubGlobal("fetch", async (url: string) => {
    const pathname = new URL(url, "http://localhost").pathname;
    return new Response(await loadRootText(pathname), { status: 200 });
  });
}

function installFailingFetch(failingPath: string, status: number): void {
  vi.stubGlobal("fetch", async (url: string) => {
    const pathname = new URL(url, "http://localhost").pathname;
    if (pathname === failingPath) {
      return new Response("", { status });
    }
    return new Response(await loadRootText(pathname), { status: 200 });
  });
}

function savedGame(): SavedGame {
  return JSON.parse(localStorage.getItem(GAME_KEY) ?? "{}") as SavedGame;
}

async function loadRootJson<T>(path: string): Promise<T> {
  return JSON.parse(await loadRootText(path)) as T;
}

async function loadRootText(path: string): Promise<string> {
  const fsModule = "node:fs/promises";
  const { readFile } = await import(fsModule);
  return readFile(`${process.cwd()}/..${path}`, "utf8");
}

function parseSimilarityCsv(csv: string): Map<string, number> {
  const similarities = new Map<string, number>();
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [breed1, breed2, similarity] = line.split(",");
    similarities.set(`${breed1.normalize("NFC")}\0${breed2.normalize("NFC")}`, Number(similarity));
  }
  return similarities;
}

function topSimilarBreeds(similarities: Map<string, number>, answerBreedId: string): string[] {
  return [...similarities]
    .map(([key, similarity]) => {
      const [breed1, breed2] = key.split("\0");
      return breed1 === answerBreedId ? { breedId: breed2, similarity } : null;
    })
    .filter((item): item is { breedId: string; similarity: number } => item !== null)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 30)
    .map((item) => item.breedId);
}

function findHighestIncorrectPair(
  map: RootMap,
  similarities: Map<string, number>
): { answerBreedId: string; guessBreedId: string; score: number } {
  let highest: { answerBreedId: string; guessBreedId: string; score: number } | null = null;
  const topByAnswer = buildTopSimilarByAnswer(similarities);
  for (const answer of map.tiles) {
    const top = topByAnswer.get(answer.breedId)?.filter((breedId) => breedId !== answer.breedId) ?? [];
    for (const guessBreedId of top) {
      const similarity = similarities.get(`${guessBreedId}\0${answer.breedId}`);
      if (similarity === undefined) {
        continue;
      }
      const blendedScore = Math.min(
        99,
        Math.floor((invDistance(map, guessBreedId, answer.breedId) + Math.round(similarity * 100)) / 2)
      );
      if (!highest || blendedScore > highest.score) {
        highest = { answerBreedId: answer.breedId, guessBreedId, score: blendedScore };
      }
    }
  }
  if (!highest) {
    throw new Error("Expected fixture data to include an incorrect top30 pair");
  }
  return highest;
}

function buildTopSimilarByAnswer(similarities: Map<string, number>): Map<string, string[]> {
  const grouped = new Map<string, { breedId: string; similarity: number }[]>();
  for (const [key, similarity] of similarities) {
    const [answerBreedId, guessBreedId] = key.split("\0");
    const entries = grouped.get(answerBreedId) ?? [];
    entries.push({ breedId: guessBreedId, similarity });
    grouped.set(answerBreedId, entries);
  }
  return new Map(
    [...grouped].map(([answerBreedId, entries]) => [
      answerBreedId,
      entries
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, 30)
        .map((entry) => entry.breedId)
    ])
  );
}

function invDistance(map: RootMap, guessBreedId: string, answerBreedId: string): number {
  const guess = map.tiles.find((tile) => tile.breedId === guessBreedId);
  const answer = map.tiles.find((tile) => tile.breedId === answerBreedId);
  if (!guess || !answer || answer.maxDistance <= 0) {
    return 0;
  }
  const distance = Math.hypot(centerX(map, guess) - centerX(map, answer), centerY(map, guess) - centerY(map, answer));
  return Math.max(0, Math.min(99, Math.floor(((answer.maxDistance - distance) / answer.maxDistance) * 99)));
}

function centerX(map: RootMap, tile: RootMap["tiles"][number]): number {
  return (tile.gridColumn - 1) * (map.tileWidth + map.columnGap) + map.tileWidth / 2;
}

function centerY(map: RootMap, tile: RootMap["tiles"][number]): number {
  return (tile.gridRow - 1) * (map.tileHeight + map.rowGap) + map.tileHeight / 2;
}

function manifestEntry(breedId: string, entry: ManifestEntry): { folder: string; files: string[] } {
  return Array.isArray(entry) ? { folder: breedId, files: entry } : entry;
}

function expectedImageId(breedId: string, seed: string, images: { folder: string; files: string[] }): string {
  return `${images.folder}/${images.files[hashString(`${breedId}:${seed}`) % images.files.length]}`;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
