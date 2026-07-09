import { describe, expect, it } from "vitest";
import {
  buildDuelBotPerceptionFromData,
  calculateBotMapScore
} from "./duelBotPerception";
import type { BreedRecord, GameData } from "./gameData";
import type { BreedId, MapLayout } from "./types";

const map: MapLayout = {
  tileWidth: 1,
  tileHeight: 1,
  columnGap: 0,
  rowGap: 0,
  columns: 4,
  rows: 1,
  legend: [],
  tiles: [
    { breedId: "answer", label: "Answer", color: "#111111", gridColumn: 1, gridRow: 1, maxDistance: 2 },
    { breedId: "near", label: "Near", color: "#222222", gridColumn: 2, gridRow: 1, maxDistance: 2 },
    { breedId: "far", label: "Far", color: "#333333", gridColumn: 4, gridRow: 1, maxDistance: 2 }
  ]
};

const catalog = [
  breed("answer", "small"),
  breed("near", "small"),
  breed("far", "large")
];

const data: GameData = {
  map,
  catalog,
  catalogById: new Map(catalog.map((record) => [record.id, record])),
  searchEntries: [],
  similarities: new Map([["near\0answer", 1]]),
  topSimilarByBreed: new Map<BreedId, Set<BreedId>>([["answer", new Set(["near"])]]),
  imagesByBreed: new Map()
};

describe("duel bot perception", () => {
  it("scores candidates from map distance only, ignoring CSV similarity membership", () => {
    expect(calculateBotMapScore(data, "answer", "answer")).toBe(100);
    expect(calculateBotMapScore(data, "near", "answer")).toBe(49);
    expect(calculateBotMapScore(data, "far", "answer")).toBe(0);
  });

  it("builds selectable candidate perception with map-based similarity", () => {
    const perception = buildDuelBotPerceptionFromData(data, "answer", ["answer", "near"]);

    expect(perception.answerSize).toBe("small");
    expect(perception.isFamousAnswer).toBe(false);
    expect(perception.candidateBreeds).toEqual([
      { breedId: "answer", size: "small", score: 100, similarity: 1 },
      { breedId: "near", size: "small", score: 49, similarity: 0.49 }
    ]);
  });
});

function breed(id: BreedId, size: string): BreedRecord {
  return {
    id,
    en: id,
    ru: id,
    group: "test",
    color: "#000000",
    country: "test",
    size,
    coat: "test",
    muzzle: "test",
    ears: "test"
  };
}
