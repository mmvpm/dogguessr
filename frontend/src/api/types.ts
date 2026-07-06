export type BreedId = string;
export type GameStatus = "guessing" | "revealed" | "finished";
export type RoundPhase = "guessing" | "revealed";
export type DuelPhase = "waiting" | "countdown" | "guessing" | "revealed" | "finished";

export interface GameSettings {
  unlimitedTime: boolean;
  secondsPerRound: number;
  roundCount: number;
}

export interface BreedInfo {
  id: BreedId;
  en: string;
  ru: string;
  group: string;
  color: string;
}

export interface BreedSuggestion {
  breed: BreedInfo;
  label: string;
  match: "ru" | "en";
}

export interface BreedSuggestResponse {
  query: string;
  suggestions: BreedSuggestion[];
}

export interface ImageRef {
  id: string;
  url: string;
  breedId: BreedId;
}

export interface MapTile {
  breedId: BreedId;
  label: string;
  color: string;
  gridColumn: number;
  gridRow: number;
  maxDistance: number;
}

export interface MapLegendItem {
  group: string;
  label: string;
  color: string;
}

export interface MapLayout {
  tileWidth: number;
  tileHeight: number;
  columnGap: number;
  rowGap: number;
  columns: number;
  rows: number;
  tiles: MapTile[];
  legend: MapLegendItem[];
}

export interface RoundView {
  index: number;
  total: number;
  phase: RoundPhase;
  answerImage: ImageRef;
  selectedBreedId: BreedId | null;
  answerBreed: BreedInfo | null;
  guessBreed: BreedInfo | null;
  guessImage: ImageRef | null;
  score: number | null;
  similarity: number | null;
  timedOut: boolean;
}

export interface RoundResult {
  index: number;
  answerBreed: BreedInfo;
  answerImage: ImageRef;
  guessBreed: BreedInfo | null;
  guessImage: ImageRef | null;
  score: number;
  similarity: number | null;
  timedOut: boolean;
}

export interface GameViewState {
  gameId: string;
  status: GameStatus;
  settings: GameSettings;
  map: MapLayout;
  round: RoundView | null;
  history: RoundResult[];
  totalScore: number;
  maxScore: number;
  serverNow: string;
  deadlineAt: string | null;
}

export interface DuelPlayer {
  id: string;
  slot: 0 | 1;
}

export interface DuelGuess {
  breedId: BreedId | null;
  submittedAt: string;
  clientActionId: string;
  timedOut: boolean;
}

export interface DuelRoundSnapshot {
  index: number;
  answerBreedId: BreedId;
  firstGuessPlayerId: string | null;
  secondDeadlineAt: string | null;
  revealedAt: string | null;
  guesses: Record<string, DuelGuess>;
}

export interface DuelSnapshot {
  roomId: string;
  version: number;
  phase: DuelPhase;
  players: DuelPlayer[];
  currentRoundIndex: number;
  roundStartsAt: string | null;
  rounds: DuelRoundSnapshot[];
  readyNextPlayerIds: string[];
  serverNow: string;
}

export interface DuelSession {
  roomId: string;
  playerId: string;
  playerToken: string;
  snapshot: DuelSnapshot;
}

export interface DuelRoundView {
  index: number;
  total: number;
  answerImage: ImageRef;
  selectedBreedId: BreedId | null;
  answerBreed: BreedInfo | null;
  myGuessBreed: BreedInfo | null;
  myGuessImage: ImageRef | null;
  opponentGuessBreed: BreedInfo | null;
  opponentGuessImage: ImageRef | null;
  myScore: number | null;
  opponentScore: number | null;
  myTimedOut: boolean;
  opponentTimedOut: boolean;
}

export interface DuelHistoryResult {
  index: number;
  answerBreed: BreedInfo;
  answerImage: ImageRef;
  myGuessBreed: BreedInfo | null;
  myGuessImage: ImageRef | null;
  opponentGuessBreed: BreedInfo | null;
  opponentGuessImage: ImageRef | null;
  myScore: number;
  opponentScore: number;
  myTimedOut: boolean;
  opponentTimedOut: boolean;
}

export interface DuelViewState {
  mode: "duel";
  roomId: string;
  gameId: string;
  playerId: string;
  opponentPlayerId: string | null;
  phase: DuelPhase;
  status: GameStatus | "waiting" | "countdown";
  map: MapLayout;
  round: DuelRoundView | null;
  history: DuelHistoryResult[];
  myTotalScore: number;
  opponentTotalScore: number;
  maxScore: number;
  serverNow: string;
  deadlineAt: string | null;
  roundStartsAt: string | null;
  waitingForOpponent: boolean;
  waitingForNext: boolean;
  pressure: boolean;
}
