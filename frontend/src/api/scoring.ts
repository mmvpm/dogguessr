import type { BreedId, MapLayout, MapTile } from "./types";
import type { GameData } from "./gameData";
import { normalizeText } from "./text";

export const MAX_ROUND_SCORE = 100;
export const MAX_INCORRECT_SCORE = 99;

/** Builds the per-answer shortlist that enables similarity blending in scoring. */
export function buildTopSimilarByBreed(similarities: Map<string, number>, count: number): Map<BreedId, Set<BreedId>> {
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
        .slice(0, count)
        .map((item) => item.breedId)
    )
  ]));
}

/** Returns the raw dataset similarity for a directed guess-answer pair. */
export function getSimilarity(data: GameData, breed1: BreedId, breed2: BreedId): number {
  const similarity = data.similarities.get(`${normalizeText(breed1)}\0${normalizeText(breed2)}`);
  if (similarity === undefined) {
    throw new Error(`Missing similarity for ${breed1} -> ${breed2}`);
  }
  return similarity;
}

/** Converts map distance and optional top-similarity membership into the round score. */
export function calculateScore(data: GameData, guessBreedId: BreedId, answerBreedId: BreedId, similarity: number): number {
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

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
