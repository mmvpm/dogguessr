import {
  getBreedImage,
  getBreedInfo,
  getBreedScore,
  getSharedGameData
} from "./client";
import { DUEL_ROUNDS, REVEALED_AUTO_NEXT_MS } from "./duelConstants";
import { getSelectedBreed } from "./duelSession";
import type {
  BreedId,
  DuelGuess,
  DuelHistoryResult,
  DuelSnapshot,
  DuelViewState
} from "./types";

/** Projects the backend room snapshot into the UI-oriented duel view state. */
export async function projectDuelView(snapshot: DuelSnapshot, playerId: string): Promise<DuelViewState> {
  const shared = await getSharedGameData();
  const opponent = snapshot.players.find((player) => player.id !== playerId) ?? null;
  const currentRound = snapshot.rounds[snapshot.currentRoundIndex] ?? null;
  const history: DuelHistoryResult[] = [];

  for (const round of snapshot.rounds) {
    if (!round.revealedAt) {
      continue;
    }
    history.push(await makeHistoryResult(snapshot.roomId, playerId, opponent?.id ?? null, round));
  }

  const round = currentRound
    ? await makeRoundView(snapshot.roomId, playerId, opponent?.id ?? null, currentRound, snapshot.phase !== "revealed" && snapshot.phase !== "finished")
    : null;

  const pressure = Boolean(
    snapshot.phase === "guessing" &&
    currentRound?.firstGuessPlayerId &&
    currentRound.firstGuessPlayerId !== playerId &&
    !currentRound.guesses[playerId]
  );
  const waitingForOpponentGuessDeadlineAt = snapshot.phase === "guessing" &&
    currentRound?.secondDeadlineAt &&
    currentRound.guesses[playerId] &&
    opponent?.id &&
    !currentRound.guesses[opponent.id]
    ? currentRound.secondDeadlineAt
    : null;

  return {
    mode: "duel",
    roomId: snapshot.roomId,
    gameId: `duel:${snapshot.roomId}`,
    playerId,
    opponentPlayerId: opponent?.id ?? null,
    visibility: snapshot.visibility,
    phase: snapshot.phase,
    status: snapshot.phase === "waiting" || snapshot.phase === "countdown" ? snapshot.phase : snapshot.phase === "finished" ? "finished" : snapshot.phase,
    map: shared.map,
    round,
    history,
    myTotalScore: history.reduce((sum, result) => sum + result.myScore, 0),
    opponentTotalScore: history.reduce((sum, result) => sum + result.opponentScore, 0),
    maxScore: DUEL_ROUNDS * 100,
    serverNow: snapshot.serverNow,
    deadlineAt: pressure ? currentRound?.secondDeadlineAt ?? null : null,
    waitingForOpponentGuessDeadlineAt,
    roundStartsAt: snapshot.roundStartsAt,
    revealedAutoNextAt: snapshot.phase === "revealed" && snapshot.readyNextStartedAt
      ? isoWithOffset(snapshot.readyNextStartedAt, REVEALED_AUTO_NEXT_MS)
      : null,
    waitingForOpponent: snapshot.phase === "waiting",
    waitingForNext: snapshot.phase === "revealed" && snapshot.readyNextPlayerIds.includes(playerId),
    opponentReadyForNext: Boolean(opponent?.id && snapshot.phase === "revealed" && snapshot.readyNextPlayerIds.includes(opponent.id)),
    pressure
  };
}

async function makeRoundView(
  roomId: string,
  playerId: string,
  opponentPlayerId: string | null,
  round: DuelSnapshot["rounds"][number],
  hideAnswer: boolean
) {
  const myGuess = round.guesses[playerId] ?? null;
  const opponentGuess = opponentPlayerId ? round.guesses[opponentPlayerId] ?? null : null;
  const revealed = Boolean(round.revealedAt);
  const answerImage = await getBreedImage(round.answerBreedId, `${roomId}:${round.index}:answer`);
  const myScore = await scoreGuess(myGuess, round.answerBreedId);
  const opponentScore = revealed ? await scoreGuess(opponentGuess, round.answerBreedId) : 0;

  return {
    index: round.index + 1,
    total: DUEL_ROUNDS,
    answerImage,
    selectedBreedId: getSelectedBreed(roomId, round.index, playerId),
    answerBreed: hideAnswer ? null : await getBreedInfo(round.answerBreedId),
    myGuessBreed: myGuess?.breedId ? await getBreedInfo(myGuess.breedId) : null,
    myGuessImage: myGuess?.breedId ? await getBreedImage(myGuess.breedId, `${roomId}:${round.index}:${playerId}:guess`) : null,
    opponentGuessBreed: revealed && opponentGuess?.breedId ? await getBreedInfo(opponentGuess.breedId) : null,
    opponentGuessImage: revealed && opponentGuess?.breedId && opponentPlayerId ? await getBreedImage(opponentGuess.breedId, `${roomId}:${round.index}:${opponentPlayerId}:guess`) : null,
    myScore: revealed ? myScore : null,
    opponentScore: revealed ? opponentScore : null,
    myTimedOut: Boolean(myGuess?.timedOut),
    opponentTimedOut: Boolean(opponentGuess?.timedOut)
  };
}

async function makeHistoryResult(
  roomId: string,
  playerId: string,
  opponentPlayerId: string | null,
  round: DuelSnapshot["rounds"][number]
): Promise<DuelHistoryResult> {
  const view = await makeRoundView(roomId, playerId, opponentPlayerId, round, false);
  return {
    index: view.index,
    answerBreed: view.answerBreed!,
    answerImage: view.answerImage,
    myGuessBreed: view.myGuessBreed,
    myGuessImage: view.myGuessImage,
    opponentGuessBreed: view.opponentGuessBreed,
    opponentGuessImage: view.opponentGuessImage,
    myScore: view.myScore ?? 0,
    opponentScore: view.opponentScore ?? 0,
    myTimedOut: view.myTimedOut,
    opponentTimedOut: view.opponentTimedOut
  };
}

async function scoreGuess(guess: DuelGuess | null, answerBreedId: BreedId): Promise<number> {
  return (await getBreedScore(guess?.breedId ?? null, answerBreedId)).score;
}

function isoWithOffset(iso: string, offsetMs: number): string {
  return new Date(new Date(iso).getTime() + offsetMs).toISOString();
}
