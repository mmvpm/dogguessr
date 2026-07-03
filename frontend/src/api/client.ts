import type {
  BreedId,
  BreedInfo,
  BreedSuggestResponse,
  BreedSuggestion,
  GameSettings,
  GameStatus,
  GameViewState,
  ImageRef,
  MapLegendItem,
  MapLayout,
  MapTile,
  RoundResult,
  RoundView
} from "./types";

const MAX_ROUND_SCORE = 100;
const MAX_INCORRECT_SCORE = 99;
const GAME_KEY = "dogguessr:activeGame:v1";
const TOP_SIMILARITY_COUNT = 30;

const GROUP_LABELS: Record<string, string> = {
  bulldog: "Бульдоги",
  collie: "Колли",
  corgi: "Корги",
  griffon: "Гриффоны",
  hound: "Гончие",
  laika: "Лайки",
  mastiff: "Мастифы",
  other: "Другие",
  pinscher: "Пинчеры",
  podenco: "Поденко",
  pointer: "Легавые",
  poodle: "Пудели",
  retriever: "Ретриверы",
  schnauzer: "Шнауцеры",
  segugio: "Сегуджио",
  setter: "Сеттеры",
  shepherd: "Овчарки",
  spaniel: "Спаниели",
  spitz: "Шпицы",
  terrier: "Терьеры",
  wolf: "Волчьи собаки"
};

const GROUP_ORDER = [
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
];

type BreedRecord = BreedInfo & {
  country: string;
  size: string;
  coat: string;
  muzzle: string;
  ears: string;
};

type SearchEntry = {
  record: BreedRecord;
  ru: string;
  en: string;
  ruTokens: string[];
  enTokens: string[];
  ruCompact: string;
  enCompact: string;
};

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

type GameData = {
  map: MapLayout;
  catalog: BreedRecord[];
  catalogById: Map<BreedId, BreedRecord>;
  searchEntries: SearchEntry[];
  similarities: Map<string, number>;
  topSimilarByBreed: Map<BreedId, Set<BreedId>>;
  imagesByBreed: Map<BreedId, BreedImages>;
};

type RawMapLayout = Omit<MapLayout, "legend" | "tiles"> & {
  legend?: MapLegendItem[];
  tiles: RawMapTile[];
};

type RawMapTile = Omit<MapTile, "maxDistance"> & {
  maxDistance?: number;
};

type BreedImages = {
  folder: string;
  files: string[];
};

type ImageManifest = Record<string, string[] | BreedImages>;

let dataPromise: Promise<GameData> | null = null;
let game: LocalGame | null = null;

async function loadData(): Promise<GameData> {
  if (!dataPromise) {
    dataPromise = Promise.all([
      fetchJson<RawMapLayout>("/breed_map.json"),
      fetchText("/dataset.csv"),
      fetchText("/breed-similarity.csv"),
      fetchJson<ImageManifest>("/image_manifest.json")
    ]).then(([rawMap, datasetCsv, similarityCsv, imageManifest]) => {
      const mapWithoutLegend = normalizeMap(rawMap);
      const tileByBreed = new Map(mapWithoutLegend.tiles.map((tile) => [normalizeText(tile.breedId), tile]));
      const catalog = parseDataset(datasetCsv, tileByBreed);
      const catalogById = new Map(catalog.map((record) => [record.id, record]));
      const similarities = parseSimilarities(similarityCsv);
      const imagesByBreed = new Map(
        Object.entries(imageManifest).map(([breedId, entry]) => [normalizeText(breedId), normalizeImageManifestEntry(breedId, entry)])
      );

      for (const record of catalog) {
        if (!imagesByBreed.get(record.id)?.files.length) {
          throw new Error(`Missing images for breed: ${record.id}`);
        }
      }

      return {
        map: {
          ...mapWithoutLegend,
          legend: buildMapLegend(catalog)
        },
        catalog,
        catalogById,
        searchEntries: buildSearchEntries(catalog),
        similarities,
        topSimilarByBreed: buildTopSimilarByBreed(similarities),
        imagesByBreed
      };
    });
  }
  return dataPromise;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Cannot load ${path}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Cannot load ${path}: ${response.status}`);
  }
  return response.text();
}

export const api = {
  async suggestBreeds(query: string): Promise<BreedSuggestResponse> {
    const data = await loadData();
    return { query, suggestions: suggest(data.searchEntries, query) };
  },

  async createGame(settings: GameSettings): Promise<GameViewState> {
    const data = await loadData();
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
  },

  async restoreGame(): Promise<GameViewState | null> {
    const data = await loadData();
    game = readGame();
    if (!game) {
      return null;
    }
    revealIfTimedOut(data, game, new Date());
    saveGame();
    return view(data, game, new Date());
  },

  async getGame(gameId: string): Promise<GameViewState> {
    const data = await loadData();
    const current = requireGame(gameId);
    const now = new Date();
    revealIfTimedOut(data, current, now);
    saveGame();
    return view(data, current, now);
  },

  async selectBreed(gameId: string, breedId: BreedId | null): Promise<GameViewState> {
    const data = await loadData();
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
  },

  async submitGuess(gameId: string): Promise<GameViewState> {
    const data = await loadData();
    const current = requireGame(gameId);
    const now = new Date();
    revealRound(data, current, isTimedOut(current.currentRound, now));
    saveGame();
    return view(data, current, now);
  },

  async nextRound(gameId: string): Promise<GameViewState> {
    const data = await loadData();
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
  },

  clearGame(): void {
    game = null;
    localStorage.removeItem(GAME_KEY);
  }
};

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

function pickImage(data: GameData, breedId: BreedId, seed: string): ImageRef {
  const images = data.imagesByBreed.get(normalizeText(breedId));
  if (!images?.files.length) {
    throw new Error(`Missing images for breed: ${breedId}`);
  }
  return imageRef(breedId, images.folder, images.files[hashString(`${breedId}:${seed}`) % images.files.length]);
}

function imageRef(breedId: BreedId, folder: string, fileName: string): ImageRef {
  const id = `${folder}/${fileName}`;
  const url = `/dataset/${encodePathSegment(folder)}/${encodePathSegment(fileName)}`;
  return { id, url, breedId };
}

function normalizeImageManifestEntry(breedId: string, entry: string[] | BreedImages): BreedImages {
  return Array.isArray(entry) ? { folder: breedId, files: entry } : entry;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%2F/g, "/");
}

function normalizeMap(map: RawMapLayout): Omit<MapLayout, "legend"> {
  return {
    ...map,
    tiles: map.tiles.map((tile) => {
      if (typeof tile.maxDistance !== "number" || !Number.isFinite(tile.maxDistance)) {
        throw new Error(`Missing maxDistance for map tile: ${tile.breedId}`);
      }
      return {
        ...tile,
        breedId: normalizeText(tile.breedId),
        maxDistance: tile.maxDistance
      };
    })
  };
}

function getSimilarity(data: GameData, breed1: BreedId, breed2: BreedId): number {
  const similarity = data.similarities.get(`${normalizeText(breed1)}\0${normalizeText(breed2)}`);
  if (similarity === undefined) {
    throw new Error(`Missing similarity for ${breed1} -> ${breed2}`);
  }
  return similarity;
}

function calculateScore(data: GameData, guessBreedId: BreedId, answerBreedId: BreedId, similarity: number): number {
  const guessTile = requireTile(data.map, guessBreedId);
  const answerTile = requireTile(data.map, answerBreedId);
  if (guessTile.breedId === answerTile.breedId) {
    return MAX_ROUND_SCORE;
  }
  const invDistance = calculateInvDistance(data.map, guessTile, answerTile);
  if (!data.topSimilarByBreed.get(answerTile.breedId)?.has(guessTile.breedId)) {
    return invDistance;
  }
  return clampInt(Math.floor((invDistance + Math.round(similarity * 100)) / 2), 0, MAX_INCORRECT_SCORE);
}

function calculateInvDistance(map: MapLayout, guessTile: MapTile, answerTile: MapTile): number {
  if (answerTile.maxDistance <= 0) {
    return 0;
  }
  const distance = tileDistance(map, guessTile, answerTile);
  return clampInt(Math.floor(((answerTile.maxDistance - distance) / answerTile.maxDistance) * MAX_INCORRECT_SCORE), 0, MAX_INCORRECT_SCORE);
}

function tileDistance(map: MapLayout, left: MapTile, right: MapTile): number {
  const leftCenter = tileCenter(map, left);
  const rightCenter = tileCenter(map, right);
  return Math.hypot(leftCenter.x - rightCenter.x, leftCenter.y - rightCenter.y);
}

function tileCenter(map: MapLayout, tile: MapTile): { x: number; y: number } {
  return {
    x: (tile.gridColumn - 1) * (map.tileWidth + map.columnGap) + map.tileWidth / 2,
    y: (tile.gridRow - 1) * (map.tileHeight + map.rowGap) + map.tileHeight / 2
  };
}

function requireTile(map: MapLayout, breedId: BreedId): MapTile {
  const normalizedBreedId = normalizeText(breedId);
  const tile = map.tiles.find((candidate) => normalizeText(candidate.breedId) === normalizedBreedId);
  if (!tile) {
    throw new Error(`Missing map tile for breed: ${breedId}`);
  }
  return tile;
}

function parseDataset(csv: string, tileByBreed: Map<BreedId, { color: string }>): BreedRecord[] {
  return parseCsv(csv).slice(1).filter((row) => row.length >= 8).map((row) => {
    const id = normalizeText(row[0]);
    return {
      id,
      en: id,
      ru: normalizeText(row[1]),
      country: row[2],
      group: row[3].toLowerCase(),
      size: row[4],
      coat: row[5],
      muzzle: row[6],
      ears: row[7],
      color: tileByBreed.get(id)?.color ?? "#FFFFFF"
    };
  });
}

function parseSimilarities(csv: string): Map<string, number> {
  const similarities = new Map<string, number>();
  for (const row of parseCsv(csv).slice(1)) {
    if (row.length >= 3) {
      similarities.set(`${normalizeText(row[0])}\0${normalizeText(row[1])}`, Number(row[2]));
    }
  }
  return similarities;
}

function buildTopSimilarByBreed(similarities: Map<string, number>): Map<BreedId, Set<BreedId>> {
  const grouped = new Map<BreedId, { breedId: BreedId; similarity: number }[]>();
  for (const [key, similarity] of similarities) {
    const [breedId, similarBreedId] = key.split("\0");
    const group = grouped.get(breedId) ?? [];
    group.push({ breedId: similarBreedId, similarity });
    grouped.set(breedId, group);
  }
  return new Map([...grouped].map(([breedId, similarBreeds]) => [
    breedId,
    new Set(
      similarBreeds
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, TOP_SIMILARITY_COUNT)
        .map((item) => item.breedId)
    )
  ]));
}

function buildMapLegend(catalog: BreedRecord[]): MapLegendItem[] {
  const byGroup = new Map<string, MapLegendItem>();
  for (const record of catalog) {
    if (!byGroup.has(record.group)) {
      byGroup.set(record.group, {
        group: record.group,
        label: GROUP_LABELS[record.group] ?? record.group,
        color: record.color
      });
    }
  }
  return [...byGroup.values()].sort(compareLegendItems);
}

function compareLegendItems(left: MapLegendItem, right: MapLegendItem): number {
  const leftIndex = GROUP_ORDER.indexOf(left.group);
  const rightIndex = GROUP_ORDER.indexOf(right.group);
  if (leftIndex >= 0 || rightIndex >= 0) {
    return (leftIndex >= 0 ? leftIndex : GROUP_ORDER.length) - (rightIndex >= 0 ? rightIndex : GROUP_ORDER.length);
  }
  return left.label.localeCompare(right.label, "ru");
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function buildSearchEntries(catalog: BreedRecord[]): SearchEntry[] {
  return catalog.map((record) => ({
    record,
    ru: normalizeQuery(record.ru),
    en: normalizeQuery(record.en),
    ruTokens: normalizeQuery(record.ru).split(" "),
    enTokens: normalizeQuery(record.en).split(" "),
    ruCompact: compactQuery(record.ru),
    enCompact: compactQuery(record.en)
  }));
}

function suggest(entries: SearchEntry[], query: string): BreedSuggestion[] {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return [];
  }

  const compact = normalized.replaceAll(" ", "");
  const queryTokens = normalized.split(" ");
  return entries
    .map((entry) => {
      const ruScore = scoreText(normalized, compact, queryTokens, entry.ru, entry.ruTokens, entry.ruCompact);
      const enScore = scoreText(normalized, compact, queryTokens, entry.en, entry.enTokens, entry.enCompact);
      if (!ruScore && !enScore) {
        return null;
      }
      const match = ruScore && (!enScore || compareScore(ruScore, enScore) <= 0) ? "ru" : "en";
      const score = match === "ru" ? ruScore : enScore;
      return { entry, match, rank: [...score!, entry.record.ru.toLocaleLowerCase("ru-RU")] };
    })
    .filter((item): item is { entry: SearchEntry; match: "ru" | "en"; rank: (number | string)[] } => item !== null)
    .sort((left, right) => compareRank(left.rank, right.rank))
    .map(({ entry, match }) => ({ breed: entry.record, label: entry.record.ru, match }));
}

function scoreText(
  query: string,
  compact: string,
  queryTokens: string[],
  text: string,
  tokens: string[],
  textCompact: string
): [number, number, number, number] | null {
  if (query.includes(" ") && text.startsWith(query)) {
    return [0, 0, 0, text.length];
  }

  const tokenMatches = tokens
    .map((token, index) => token.startsWith(query) ? [token.length - query.length, index] : null)
    .filter((item): item is [number, number] => item !== null)
    .sort(compareScore);
  if (tokenMatches.length) {
    return [1, tokenMatches[0][0], tokenMatches[0][1], text.length];
  }

  const compactIndex = textCompact.indexOf(compact);
  if (compactIndex >= 0) {
    return [2, compactIndex, 0, text.length];
  }

  const sequencePosition = tokenSequencePosition(queryTokens, tokens);
  if (sequencePosition !== null) {
    return [3, sequencePosition, 0, text.length];
  }

  const textIndex = text.indexOf(query);
  if (textIndex >= 0) {
    return [4, textIndex, 0, text.length];
  }

  if (queryTokens.every((queryToken) => tokens.some((token) => token.includes(queryToken)))) {
    return [5, tokens.length, 0, text.length];
  }

  return null;
}

function tokenSequencePosition(queryTokens: string[], tokens: string[]): number | null {
  let startAt = 0;
  let firstPosition: number | null = null;

  for (const queryToken of queryTokens) {
    let found = false;
    for (let index = startAt; index < tokens.length; index += 1) {
      if (tokens[index].startsWith(queryToken) || tokens[index].includes(queryToken)) {
        firstPosition ??= index;
        startAt = index + 1;
        found = true;
        break;
      }
    }
    if (!found) {
      return null;
    }
  }
  return firstPosition;
}

function normalizeQuery(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[^0-9a-zа-я]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactQuery(value: string): string {
  return normalizeQuery(value).replaceAll(" ", "");
}

function normalizeText(value: string): string {
  return value.normalize("NFC");
}

function compareRank(left: (number | string)[], right: (number | string)[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === b) {
      continue;
    }
    return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "ru");
  }
  return left.length - right.length;
}

function compareScore(left: number[], right: number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return left.length - right.length;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sample<T>(items: T[], count: number): T[] {
  const pool = [...items];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, count);
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

function requireBreed(data: GameData, breedId: BreedId): BreedRecord {
  const breed = data.catalogById.get(normalizeText(breedId));
  if (!breed) {
    throw new Error(`Unknown breed: ${breedId}`);
  }
  return breed;
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

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
