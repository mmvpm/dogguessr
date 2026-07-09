import type { BreedId, BreedInfo, BreedSuggestResponse, GameSettings, GameViewState, ImageRef, MapLayout } from "./types";
import { suggest } from "./breedSearch";
import { loadGameData, pickImage, requireBreed } from "./gameData";
import { calculateScore, getSimilarity } from "./scoring";
import {
  clearSoloGame,
  createSoloGame,
  getSoloGame,
  nextSoloRound,
  restoreSoloGame,
  selectSoloBreed,
  submitSoloGuess
} from "./soloGame";

/** Public facade for solo-game operations used by React screens. */
export const api = {
  async suggestBreeds(query: string): Promise<BreedSuggestResponse> {
    const data = await loadGameData();
    return { query, suggestions: suggest(data.searchEntries, query) };
  },

  createGame(settings: GameSettings): Promise<GameViewState> {
    return createSoloGame(settings);
  },

  restoreGame(): Promise<GameViewState | null> {
    return restoreSoloGame();
  },

  getGame(gameId: string): Promise<GameViewState> {
    return getSoloGame(gameId);
  },

  selectBreed(gameId: string, breedId: BreedId | null): Promise<GameViewState> {
    return selectSoloBreed(gameId, breedId);
  },

  submitGuess(gameId: string): Promise<GameViewState> {
    return submitSoloGuess(gameId);
  },

  nextRound(gameId: string): Promise<GameViewState> {
    return nextSoloRound(gameId);
  },

  clearGame(): void {
    clearSoloGame();
  }
};

/** Shares the static map and breed ids with modes that keep their own state. */
export async function getSharedGameData(): Promise<{ map: MapLayout; breedIds: BreedId[] }> {
  const data = await loadGameData();
  return {
    map: data.map,
    breedIds: data.catalog.map((record) => record.id)
  };
}

/** Samples answer breed ids for duel rooms using the same catalog as solo mode. */
export async function makeDuelAnswerBreedIds(roundCount: number): Promise<BreedId[]> {
  const data = await loadGameData();
  return sample(data.catalog.map((record) => record.id), roundCount);
}

/** Resolves a breed id into display metadata for UI projection. */
export async function getBreedInfo(breedId: BreedId): Promise<BreedInfo> {
  const data = await loadGameData();
  return requireBreed(data, breedId);
}

/** Resolves a deterministic image for UI projection. */
export async function getBreedImage(breedId: BreedId, seed: string): Promise<ImageRef> {
  const data = await loadGameData();
  return pickImage(data, breedId, seed);
}

/** Scores one guess against one answer for non-solo modes. */
export async function getBreedScore(guessBreedId: BreedId | null, answerBreedId: BreedId): Promise<{ score: number; similarity: number | null }> {
  if (!guessBreedId) {
    return { score: 0, similarity: null };
  }
  const data = await loadGameData();
  const similarity = getSimilarity(data, guessBreedId, answerBreedId);
  return {
    score: calculateScore(data, guessBreedId, answerBreedId, similarity),
    similarity
  };
}

/** Returns every catalog breed with its size, similarity and score against an answer, for bot perception. */
export async function getBreedScoreCandidates(answerBreedId: BreedId): Promise<{ breedId: BreedId; size: string; score: number; similarity: number }[]> {
  const data = await loadGameData();
  return data.catalog.map((record) => {
    const similarity = record.id === answerBreedId ? 1 : getSimilarity(data, record.id, answerBreedId);
    return {
      breedId: record.id,
      size: record.size,
      score: record.id === answerBreedId ? 100 : calculateScore(data, record.id, answerBreedId, similarity),
      similarity
    };
  });
}

function sample<T>(items: T[], count: number): T[] {
  const pool = [...items];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, count);
}
