import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampViewport,
  classifyWheel,
  fitBounds,
  getMinScale,
  panViewport,
  pinchScaleFactor,
  zoomAtPoint,
  type Point,
  type Size,
  type Viewport
} from "./mapViewport";

declare const process: { cwd(): string };

const viewportSize: Size = { width: 1000, height: 800 };
const contentSize: Size = { width: 3000, height: 2200 };

function mapPoint(viewport: Viewport, point: Point): Point {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale
  };
}

describe("map viewport", () => {
  it("keeps the map point under cursor while zooming", () => {
    const before: Viewport = { x: -520, y: -340, scale: 0.8 };
    const cursor = { x: 430, y: 290 };
    const expected = mapPoint(before, cursor);

    const after = zoomAtPoint(before, cursor, 1.05, viewportSize, contentSize);

    expect(mapPoint(after, cursor).x).toBeCloseTo(expected.x, 6);
    expect(mapPoint(after, cursor).y).toBeCloseTo(expected.y, 6);
  });

  it("allows panning beyond the top-left edge with a bounded margin", () => {
    const result = panViewport(
      { x: 0, y: 0, scale: 1 },
      { x: 260, y: 220 },
      viewportSize,
      contentSize
    );

    expect(result.x).toBeGreaterThan(0);
    expect(result.y).toBeGreaterThan(0);
    expect(result.x).toBeLessThanOrEqual(260);
    expect(result.y).toBeLessThanOrEqual(220);
  });

  it("keeps zoom-out low enough to fit the full map", () => {
    const minScale = getMinScale(viewportSize, contentSize);

    expect(contentSize.width * minScale).toBeLessThanOrEqual(viewportSize.width);
    expect(contentSize.height * minScale).toBeLessThanOrEqual(viewportSize.height);
  });

  it("fits selected bounds into viewport", () => {
    const result = fitBounds(
      { left: 900, top: 700, right: 1600, bottom: 1050 },
      viewportSize,
      contentSize
    );
    const left = result.x + 900 * result.scale;
    const right = result.x + 1600 * result.scale;
    const top = result.y + 700 * result.scale;
    const bottom = result.y + 1050 * result.scale;

    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(viewportSize.width);
    expect(bottom).toBeLessThanOrEqual(viewportSize.height);
  });

  it("classifies pinch, trackpad pan, and mouse wheel separately", () => {
    expect(classifyWheel({ ctrlKey: true, deltaMode: 0, deltaX: 0, deltaY: -18 }).kind).toBe("pinchZoom");
    expect(classifyWheel({ ctrlKey: false, deltaMode: 0, deltaX: 3.5, deltaY: 18 }).kind).toBe("trackpadPan");
    expect(classifyWheel({ ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: -100 }).kind).toBe("mouseWheelZoom");
    expect(classifyWheel({ ctrlKey: false, deltaMode: 1, deltaX: 0, deltaY: 3 }).kind).toBe("mouseWheelZoom");
  });

  it("uses a moderately stronger pinch zoom factor", () => {
    expect(pinchScaleFactor(-100)).toBeCloseTo(Math.exp(0.3), 6);
    expect(pinchScaleFactor(100)).toBeCloseTo(Math.exp(-0.3), 6);
  });

  it("clamps scale but preserves bounded overscroll", () => {
    const result = clampViewport({ x: 1000, y: 1000, scale: 99 }, viewportSize, contentSize);

    expect(result.scale).toBeLessThan(99);
    expect(result.x).toBeGreaterThan(0);
    expect(result.y).toBeGreaterThan(0);
  });
});

describe("static frontend game api", () => {
  beforeEach(() => {
    installStorage();
    installStaticFetch();
    vi.resetModules();
  });

  it("keeps breed search behavior after moving it to the frontend", async () => {
    const { api } = await import("./api/client");

    const corgi = await api.suggestBreeds("кор");
    const corgiLabels = corgi.suggestions.map((suggestion) => suggestion.label).filter((label) => label.toLocaleLowerCase("ru-RU").includes("корги"));
    expect(corgiLabels.length).toBeGreaterThanOrEqual(3);
    expect(corgi.suggestions.slice(0, corgiLabels.length).map((suggestion) => suggestion.label)).toEqual(corgiLabels);

    const foxTerrier = await api.suggestBreeds("фокс терьер");
    const foxTerrierLabels = foxTerrier.suggestions.slice(0, 5).map((suggestion) => suggestion.label);
    expect(foxTerrierLabels).toContain("Гладкошёрстный фокстерьер");
    expect(foxTerrierLabels).toContain("Жесткошёрстный фокстерьер");

    expect((await api.suggestBreeds("  ")).suggestions).toEqual([]);
    expect((await api.suggestBreeds("спаниель")).suggestions[0].match).toBe("ru");
  });

  it("finishes after the configured round count and stores unique answer breeds", async () => {
    const { api } = await import("./api/client");
    let game = await api.createGame({ unlimitedTime: true, secondsPerRound: 180, roundCount: 5 });
    const answers = savedGame().answerBreedIds;
    const legendGroups = game.map.legend.map((item) => item.group);

    expect(game.round?.total).toBe(5);
    expect(game.maxScore).toBe(500);
    expect(new Set(answers).size).toBe(5);
    expect(legendGroups.slice(0, 5)).toEqual(["shepherd", "collie", "corgi", "hound", "segugio"]);
    expect(legendGroups.at(-1)).toBe("other");

    for (let index = 0; index < 5; index += 1) {
      game = await api.selectBreed(game.gameId, savedGame().currentRound.answerBreedId);
      game = await api.submitGuess(game.gameId);
      game = await api.nextRound(game.gameId);
    }

    expect(game.status).toBe("finished");
    expect(game.round).toBeNull();
    expect(game.history).toHaveLength(5);
    expect(game.totalScore).toBe(500);
  });

  it("scores map distance directly outside answer top30 and blends it inside top30", async () => {
    const { api } = await import("./api/client");
    const map = await loadRootJson<{
      tileWidth: number;
      tileHeight: number;
      columnGap: number;
      rowGap: number;
      tiles: { breedId: string; gridColumn: number; gridRow: number; maxDistance: number }[];
    }>("/breed_map.json");
    const similarities = parseSimilarityCsv(await loadRootText("/breed-similarity.csv"));
    const answerBreedId = "Affenpinscher";
    const top30 = topSimilarBreeds(similarities, answerBreedId);
    const topGuessBreedId = top30.find((breedId) => breedId !== answerBreedId)!;
    const distantGuessBreedId = map.tiles.find((tile) => !top30.includes(tile.breedId))!.breedId;

    await api.createGame({ unlimitedTime: true, secondsPerRound: 180, roundCount: 5 });
    setCurrentAnswer(answerBreedId);
    let scoringApi = await reloadApi();
    let game = (await scoringApi.restoreGame())!;
    game = await scoringApi.selectBreed(game.gameId, topGuessBreedId);
    game = await scoringApi.submitGuess(game.gameId);

    const topInvDistance = invDistance(map, topGuessBreedId, answerBreedId);
    const topSimilarity = Math.round(similarities.get(`${topGuessBreedId}\0${answerBreedId}`)! * 100);
    expect(game.round?.score).toBe(Math.min(99, Math.floor((topInvDistance + topSimilarity) / 2)));

    game = await scoringApi.nextRound(game.gameId);
    setCurrentAnswer(answerBreedId);
    scoringApi = await reloadApi();
    game = (await scoringApi.restoreGame())!;
    game = await scoringApi.selectBreed(game.gameId, distantGuessBreedId);
    game = await scoringApi.submitGuess(game.gameId);

    expect(game.round?.score).toBe(invDistance(map, distantGuessBreedId, answerBreedId));
  });

  it("uses a seeded random image for the revealed guess breed", async () => {
    const { api } = await import("./api/client");
    const manifest = await loadRootJson<Record<string, string[] | { folder: string; files: string[] }>>("/image_manifest.json");
    let game = await api.createGame({ unlimitedTime: true, secondsPerRound: 180, roundCount: 5 });
    const current = savedGame();
    const roundIndex = game.round?.index ?? 1;
    const guessBreedId = Object.keys(manifest).find((breedId) => {
      const images = manifestEntry(breedId, manifest[breedId]);
      return images.files.length > 1 && imageIndex(breedId, `${current.id}:${roundIndex}:guess`, images.files.length) !== 0;
    });

    expect(guessBreedId).toBeTruthy();
    const images = manifestEntry(guessBreedId!, manifest[guessBreedId!]);
    const expectedFile = images.files[imageIndex(guessBreedId!, `${current.id}:${roundIndex}:guess`, images.files.length)];

    game = await api.selectBreed(game.gameId, guessBreedId!);
    game = await api.submitGuess(game.gameId);

    expect(game.round?.guessImage?.id).toBe(`${images.folder}/${expectedFile}`);
    expect(game.round?.guessImage?.id).not.toBe(`${images.folder}/${images.files[0]}`);

    const restoredApi = await reloadApi();
    const restored = await restoredApi.restoreGame();
    expect(restored?.round?.guessImage?.id).toBe(game.round?.guessImage?.id);
  });

  it("restores the active game from localStorage", async () => {
    const { api } = await import("./api/client");
    const started = await api.createGame({ unlimitedTime: true, secondsPerRound: 180, roundCount: 5 });

    vi.resetModules();
    const restoredApi = (await import("./api/client")).api;
    const restored = await restoredApi.restoreGame();

    expect(restored?.gameId).toBe(started.gameId);
    expect(restored?.round?.index).toBe(started.round?.index);
    expect(restored?.status).toBe("guessing");
  });

  it("reveals a zero-score timeout without a selected breed", async () => {
    const { api } = await import("./api/client");
    const started = await api.createGame({ unlimitedTime: false, secondsPerRound: 30, roundCount: 5 });
    expireSavedRound();
    api.clearGame();
    localStorage.setItem("dogguessr:activeGame:v1", JSON.stringify(expiredSavedGame));

    const restored = await api.restoreGame();

    expect(restored?.gameId).toBe(started.gameId);
    expect(restored?.status).toBe("revealed");
    expect(restored?.round?.score).toBe(0);
    expect(restored?.round?.guessImage).toBeNull();
    expect(restored?.round?.timedOut).toBe(true);
  });
});

let expiredSavedGame: unknown;

function expireSavedRound(): void {
  const current = savedGame();
  current.currentRound.deadlineAt = new Date(Date.now() - 1000).toISOString();
  expiredSavedGame = current;
}

function savedGame(): {
  id: string;
  answerBreedIds: string[];
  currentRound: { index: number; answerBreedId: string; answerImage: { breedId: string }; deadlineAt: string | null };
} {
  return JSON.parse(localStorage.getItem("dogguessr:activeGame:v1") ?? "{}");
}

function setCurrentAnswer(answerBreedId: string): void {
  const current = savedGame();
  current.currentRound.answerBreedId = answerBreedId;
  current.currentRound.answerImage.breedId = answerBreedId;
  localStorage.setItem("dogguessr:activeGame:v1", JSON.stringify(current));
}

async function loadRootJson<T>(path: string): Promise<T> {
  return JSON.parse(await loadRootText(path)) as T;
}

async function reloadApi(): Promise<typeof import("./api/client").api> {
  vi.resetModules();
  return (await import("./api/client")).api;
}

async function loadRootText(path: string): Promise<string> {
  const fsModule = "node:fs/promises";
  const { readFile } = await import(fsModule);
  return readFile(`${process.cwd()}/../..${path}`, "utf8");
}

function parseSimilarityCsv(csv: string): Map<string, number> {
  const similarities = new Map<string, number>();
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [breed1, breed2, similarity] = line.split(",");
    similarities.set(`${breed1.normalize("NFC")}\0${breed2.normalize("NFC")}`, Number(similarity));
  }
  return similarities;
}

function manifestEntry(breedId: string, entry: string[] | { folder: string; files: string[] }): { folder: string; files: string[] } {
  return Array.isArray(entry) ? { folder: breedId, files: entry } : entry;
}

function imageIndex(breedId: string, seed: string, count: number): number {
  return hashString(`${breedId}:${seed}`) % count;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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

function invDistance(
  map: {
    tileWidth: number;
    tileHeight: number;
    columnGap: number;
    rowGap: number;
    tiles: { breedId: string; gridColumn: number; gridRow: number; maxDistance: number }[];
  },
  guessBreedId: string,
  answerBreedId: string
): number {
  const guess = map.tiles.find((tile) => tile.breedId === guessBreedId)!;
  const answer = map.tiles.find((tile) => tile.breedId === answerBreedId)!;
  const guessCenter = tileCenter(map, guess);
  const answerCenter = tileCenter(map, answer);
  const distance = Math.hypot(guessCenter.x - answerCenter.x, guessCenter.y - answerCenter.y);
  return Math.max(0, Math.min(99, Math.floor(((answer.maxDistance - distance) / answer.maxDistance) * 99)));
}

function tileCenter(
  map: { tileWidth: number; tileHeight: number; columnGap: number; rowGap: number },
  tile: { gridColumn: number; gridRow: number }
): Point {
  return {
    x: (tile.gridColumn - 1) * (map.tileWidth + map.columnGap) + map.tileWidth / 2,
    y: (tile.gridRow - 1) * (map.tileHeight + map.rowGap) + map.tileHeight / 2
  };
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

function installStaticFetch(): void {
  vi.stubGlobal("fetch", async (url: string) => {
    const pathname = new URL(url, "http://localhost").pathname;
    const fsModule = "node:fs/promises";
    const { readFile } = await import(fsModule);
    const filePath = `${process.cwd()}/../..${pathname}`;
    return new Response(await readFile(filePath));
  });
}
