import { describe, expect, it } from "vitest";
import { breeds, makeDuel } from "../test/uiHarness";
import {
  createDuelBotMemory,
  makeDuelBotVisibleView,
  planDuelBotTurn
} from "./duelBot";

describe("duel bot", () => {
  it("receives only visible duel fields instead of rendering metadata", () => {
    const visible = makeDuelBotVisibleView(makeDuel({
      deadlineAt: "2026-01-01T00:00:10.000Z",
      round: {
        ...makeDuel().round!,
        answerImage: { id: "secret", url: "/answer.jpg", breedId: breeds.akita.id }
      }
    }));

    expect(visible.deadlineAt).toBe("2026-01-01T00:00:10.000Z");
    expect(visible.selectableBreedIds).toEqual([breeds.akita.id, breeds.beagle.id, breeds.corgi.id]);
    expect(visible.round).toEqual({
      index: 1,
      selectedBreedId: null,
      myGuessBreedId: null
    });
    expect(Object.keys(visible.round ?? {})).not.toContain("answerImage");
  });

  it("plans random public-interface commands when the scheduled guess is due", () => {
    const visible = makeDuelBotVisibleView(makeDuel());
    const planned = planDuelBotTurn(visible, createDuelBotMemory(), 1_000, () => 0);
    const due = planDuelBotTurn(visible, planned.memory, 2_500, () => 0);

    expect(planned.commands).toEqual([]);
    expect(due.commands).toEqual([
      { type: "selectBreed", breedId: breeds.akita.id },
      { type: "submitGuess" }
    ]);
  });
});
