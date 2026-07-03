export type BreedId = string;
export type GameStatus = "guessing" | "revealed" | "finished";
export type RoundPhase = "guessing" | "revealed";

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
