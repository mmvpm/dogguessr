import type { BreedId, BreedInfo, MapLegendItem, MapLayout, MapTile, ImageRef } from "./types";
import { buildSearchEntries, type SearchEntry } from "./breedSearch";
import { buildTopSimilarByBreed } from "./scoring";
import { normalizeText } from "./text";

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

export type BreedRecord = BreedInfo & {
  country: string;
  size: string;
  coat: string;
  muzzle: string;
  ears: string;
};

export type GameData = {
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

/** Loads and memoizes every static dataset file used by the client game engine. */
export async function loadGameData(): Promise<GameData> {
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
        topSimilarByBreed: buildTopSimilarByBreed(similarities, TOP_SIMILARITY_COUNT),
        imagesByBreed
      };
    });
  }
  return dataPromise;
}

/** Returns a known breed or fails fast when a persisted id no longer exists. */
export function requireBreed(data: GameData, breedId: BreedId): BreedRecord {
  const breed = data.catalogById.get(normalizeText(breedId));
  if (!breed) {
    throw new Error(`Unknown breed: ${breedId}`);
  }
  return breed;
}

/** Picks a deterministic image for a breed and seed so refreshes keep the same photo. */
export function pickImage(data: GameData, breedId: BreedId, seed: string): ImageRef {
  const images = data.imagesByBreed.get(normalizeText(breedId));
  if (!images?.files.length) {
    throw new Error(`Missing images for breed: ${breedId}`);
  }
  return imageRef(breedId, images.folder, images.files[hashString(`${breedId}:${seed}`) % images.files.length]);
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

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
