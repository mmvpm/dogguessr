import { describe, expect, it, vi } from "vitest";
import { breeds, makeDuel } from "../test/uiHarness";
import {
  createDuelBotMemory,
  makeDuelBotVisibleView,
  planDuelBotTurn,
  type DuelBotPerception
} from "./duelBot";
import type { DuelHistoryResult } from "./types";

const perception: DuelBotPerception = {
  candidateBreeds: [
    { breedId: breeds.corgi.id, size: "medium", score: 100, similarity: 1 },
    { breedId: breeds.akita.id, size: "medium", score: 48, similarity: 0.48 },
    { breedId: breeds.beagle.id, size: "small", score: 20, similarity: 0.2 }
  ],
  isFamousAnswer: false,
  answerSize: "medium"
};

function historyResult(index: number, botScore: number, playerScore: number): DuelHistoryResult {
  return {
    index,
    answerBreed: breeds.corgi,
    answerImage: { id: `answer-${index}`, url: `/answer-${index}.jpg`, breedId: breeds.corgi.id },
    myGuessBreed: breeds.akita,
    myGuessImage: { id: `bot-${index}`, url: `/bot-${index}.jpg`, breedId: breeds.akita.id },
    opponentGuessBreed: breeds.beagle,
    opponentGuessImage: { id: `player-${index}`, url: `/player-${index}.jpg`, breedId: breeds.beagle.id },
    myScore: botScore,
    opponentScore: playerScore,
    myTimedOut: false,
    opponentTimedOut: false
  };
}

describe("duel bot", () => {
  it("receives only visible duel fields instead of rendering metadata", () => {
    const visible = makeDuelBotVisibleView(
      makeDuel({
        deadlineAt: "2026-01-01T00:00:10.000Z",
        round: {
          ...makeDuel().round!,
          answerImage: { id: "secret", url: "/answer.jpg", breedId: breeds.akita.id }
        }
      }),
      perception
    );

    expect(visible.deadlineAt).toBe("2026-01-01T00:00:10.000Z");
    expect(visible.selectableBreedIds).toEqual([breeds.akita.id, breeds.beagle.id, breeds.corgi.id]);
    expect(visible.round).toEqual({
      index: 1,
      selectedBreedId: null,
      myGuessBreedId: null,
      myScore: null
    });
    expect(Object.keys(visible.round ?? {})).not.toContain("answerImage");
  });

  it("plans select and submit commands when the scheduled guess is due", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const visible = makeDuelBotVisibleView(makeDuel(), perception);

    // First-round target is 80, so high-target thinkTime is 15s: selectAt=13500, submitAt=16000.
    const planned = planDuelBotTurn(visible, createDuelBotMemory(), 1_000, () => 0);
    expect(planned.commands).toEqual([]);

    // At select time: only selectBreed
    const selectDue = planDuelBotTurn(visible, planned.memory, 14_000, () => 0);
    expect(selectDue.commands).toEqual([
      { type: "selectBreed", breedId: breeds.akita.id }
    ]);

    // At submit time: only submitGuess (select already emitted)
    const selectedVisible = makeDuelBotVisibleView(makeDuel({
      round: {
        ...makeDuel().round!,
        selectedBreedId: breeds.akita.id
      }
    }), perception);
    const submitDue = planDuelBotTurn(selectedVisible, selectDue.memory, 16_500, () => 0);
    expect(submitDue.commands).toEqual([
      { type: "submitGuess" }
    ]);

    // When polled late (both due at once): select + submit together
    const latePlanned = planDuelBotTurn(visible, createDuelBotMemory(), 1_000, () => 0);
    const lateDue = planDuelBotTurn(visible, latePlanned.memory, 16_500, () => 0);
    expect(lateDue.commands).toEqual([
      { type: "selectBreed", breedId: breeds.akita.id },
      { type: "submitGuess" }
    ]);

    vi.restoreAllMocks();
  });

  it("does not choose a famous breed as a wrong answer when raw similarity is below 80 percent", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const visible = makeDuelBotVisibleView(makeDuel(), {
      candidateBreeds: [
        { breedId: breeds.corgi.id, size: "medium", score: 100, similarity: 1 },
        { breedId: "Dalmatian", size: "medium", score: 35, similarity: 0.5 },
        { breedId: breeds.beagle.id, size: "medium", score: 35, similarity: 0.35 }
      ],
      isFamousAnswer: false,
      answerSize: "medium"
    });

    const planned = planDuelBotTurn(visible, createDuelBotMemory(), 1_000, () => 0);
    const due = planDuelBotTurn(visible, planned.memory, 17_000, () => 0);

    expect(due.commands).toEqual([
      { type: "selectBreed", breedId: breeds.beagle.id },
      { type: "submitGuess" }
    ]);

    vi.restoreAllMocks();
  });

  it("starts the first round with a strong 80-plus target", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const visible = makeDuelBotVisibleView(makeDuel(), {
      candidateBreeds: [
        { breedId: breeds.corgi.id, size: "medium", score: 100, similarity: 1 },
        { breedId: breeds.akita.id, size: "medium", score: 52, similarity: 0.52 },
        { breedId: breeds.beagle.id, size: "medium", score: 82, similarity: 0.82 }
      ],
      isFamousAnswer: false,
      answerSize: "medium"
    });

    const planned = planDuelBotTurn(visible, createDuelBotMemory(), 1_000, () => 0);
    const due = planDuelBotTurn(visible, planned.memory, 17_000, () => 0);

    expect(due.commands).toEqual([
      { type: "selectBreed", breedId: breeds.beagle.id },
      { type: "submitGuess" }
    ]);

    vi.restoreAllMocks();
  });

  it("raises its target when a strong player is ahead in the duel", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const visible = makeDuelBotVisibleView(makeDuel({
      myTotalScore: 80,
      opponentTotalScore: 180,
      history: [
        historyResult(1, 80, 90)
      ],
      round: {
        ...makeDuel().round!,
        index: 2
      }
    }), {
      candidateBreeds: [
        { breedId: breeds.corgi.id, size: "medium", score: 100, similarity: 1 },
        { breedId: breeds.akita.id, size: "medium", score: 48, similarity: 0.48 },
        { breedId: breeds.beagle.id, size: "medium", score: 96, similarity: 0.96 }
      ],
      isFamousAnswer: false,
      answerSize: "medium"
    });

    const planned = planDuelBotTurn(visible, createDuelBotMemory(), 1_000, () => 0);
    const due = planDuelBotTurn(visible, planned.memory, 17_000, () => 0);

    expect(due.commands).toEqual([
      { type: "selectBreed", breedId: breeds.beagle.id },
      { type: "submitGuess" }
    ]);

    vi.restoreAllMocks();
  });

  it("falls back to the nearest score candidate instead of a random weak answer", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const visible = makeDuelBotVisibleView(makeDuel(), {
      candidateBreeds: [
        { breedId: breeds.corgi.id, size: "medium", score: 100, similarity: 1 },
        { breedId: breeds.akita.id, size: "medium", score: 88, similarity: 0.88 },
        { breedId: breeds.beagle.id, size: "medium", score: 20, similarity: 0.2 }
      ],
      isFamousAnswer: false,
      answerSize: "medium"
    });

    const planned = planDuelBotTurn(visible, createDuelBotMemory(), 1_000, () => 0);
    const due = planDuelBotTurn(visible, planned.memory, 17_000, () => 0);

    expect(due.commands).toEqual([
      { type: "selectBreed", breedId: breeds.akita.id },
      { type: "submitGuess" }
    ]);

    vi.restoreAllMocks();
  });

  it("answers within 2 to 10 seconds after the player has submitted first", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const visible = makeDuelBotVisibleView(makeDuel(), perception);
    const planned = planDuelBotTurn(visible, createDuelBotMemory(), 1_000, () => 0);
    const pressureVisible = makeDuelBotVisibleView(makeDuel({
      deadlineAt: "1970-01-01T00:00:17.000Z"
    }), perception);

    const pressured = planDuelBotTurn(pressureVisible, planned.memory, 2_000, () => 0);
    expect(pressured.memory.submitAtMs).toBe(4_000);
    expect(pressured.commands).toEqual([
      { type: "selectBreed", breedId: breeds.akita.id }
    ]);

    const selectedPressureVisible = makeDuelBotVisibleView(makeDuel({
      deadlineAt: "1970-01-01T00:00:17.000Z",
      round: {
        ...makeDuel().round!,
        selectedBreedId: breeds.akita.id
      }
    }), perception);
    const due = planDuelBotTurn(selectedPressureVisible, pressured.memory, 4_000, () => 0);
    expect(due.commands).toEqual([
      { type: "submitGuess" }
    ]);

    vi.restoreAllMocks();
  });
});
