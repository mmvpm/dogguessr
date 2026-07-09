import { loadGameData, type GameData } from "./gameData";
import { normalizeText } from "./text";
import type { DuelBotPerception } from "./duelBot";
import { isFamousBreed } from "./duelBot";
import type { BreedId, MapLayout, MapTile } from "./types";

const MAX_BOT_MAP_SCORE = 99;

/** Builds local bot perception from map geometry only, without CSV similarity blending. */
export async function buildDuelBotPerception(answerBreedId: BreedId, selectableBreedIds: BreedId[]): Promise<DuelBotPerception> {
  const data = await loadGameData();
  return buildDuelBotPerceptionFromData(data, answerBreedId, selectableBreedIds);
}

/** Builds local bot perception from already-loaded game data. */
export function buildDuelBotPerceptionFromData(
  data: GameData,
  answerBreedId: BreedId,
  selectableBreedIds: BreedId[]
): DuelBotPerception {
  const selectable = new Set(selectableBreedIds.map(normalizeText));
  const answerRecord = data.catalogById.get(normalizeText(answerBreedId)) ?? null;
  const candidateBreeds = data.catalog
    .filter((record) => selectable.has(normalizeText(record.id)))
    .map((record) => {
      const score = normalizeText(record.id) === normalizeText(answerBreedId)
        ? 100
        : calculateMapOnlyScore(data, record.id, answerBreedId);
      return {
        breedId: record.id,
        size: record.size,
        score,
        similarity: score / 100
      };
    });

  return {
    candidateBreeds,
    isFamousAnswer: isFamousBreed(answerBreedId),
    answerSize: answerRecord?.size ?? null
  };
}

/** Returns the bot's map-only score for a candidate answer pair. */
export function calculateBotMapScore(data: GameData, guessBreedId: BreedId, answerBreedId: BreedId): number {
  if (normalizeText(guessBreedId) === normalizeText(answerBreedId)) {
    return 100;
  }
  return calculateMapOnlyScore(data, guessBreedId, answerBreedId);
}

function calculateMapOnlyScore(data: GameData, guessBreedId: BreedId, answerBreedId: BreedId): number {
  const guessTile = requireTile(data.map, guessBreedId);
  const answerTile = requireTile(data.map, answerBreedId);
  if (answerTile.maxDistance <= 0) {
    return 0;
  }
  const distance = tileDistance(data.map, guessTile, answerTile);
  return clampInt(Math.floor(((answerTile.maxDistance - distance) / answerTile.maxDistance) * MAX_BOT_MAP_SCORE), 0, MAX_BOT_MAP_SCORE);
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

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
