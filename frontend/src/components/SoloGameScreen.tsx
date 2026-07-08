import { Home } from "lucide-react";
import { api } from "../api/client";
import type { BreedId, GameViewState, ImageRef } from "../api/types";
import type { FeedbackVisiblePhoto } from "../api/feedback";
import { BreedMap } from "./BreedMap";
import {
  BreedLegend,
  BreedSearchBox,
  DogGalleryPanel,
  FinalScreen,
  Timer,
  type GalleryPhoto,
  type ImageScale
} from "./GameChrome";
import { useI18n } from "../i18n";

/** Renders the full solo play flow for one game view state. */
export function SoloGameScreen({
  game,
  error,
  imageScale,
  activePhoto,
  focusTarget,
  isMobile,
  onRun,
  onHome,
  onFocusTarget,
  onFocusConsumed,
  onImageScale,
  onActivePhoto,
  canReport,
  reportedImageIds,
  onReportPhoto
}: {
  game: GameViewState;
  error: string | null;
  imageScale: ImageScale;
  activePhoto: GalleryPhoto;
  focusTarget: string | null;
  isMobile: boolean;
  onRun: (action: () => Promise<GameViewState>) => void;
  onHome: () => void;
  onFocusTarget: (target: string | null) => void;
  onFocusConsumed: () => void;
  onImageScale: (scale: ImageScale | ((current: ImageScale) => ImageScale)) => void;
  onActivePhoto: (photo: GalleryPhoto) => void;
  canReport: boolean;
  reportedImageIds: Set<string>;
  onReportPhoto: (image: ImageRef, photo: FeedbackVisiblePhoto) => void;
}) {
  const { copy } = useI18n();

  if (game.status === "finished") {
    return <FinalScreen game={game} onHome={onHome} />;
  }

  const round = game.round;
  if (!round) {
    return null;
  }

  const selectBreed = (breedId: BreedId) => {
    if (game.status !== "guessing") {
      return;
    }
    void onRun(() => api.selectBreed(game.gameId, breedId));
  };

  const selectBreedFromSearch = (breedId: BreedId) => {
    if (game.status !== "guessing") {
      return;
    }
    onFocusTarget(`${game.gameId}:${round?.index}:${breedId}:${Date.now()}`);
    void onRun(() => api.selectBreed(game.gameId, breedId));
  };

  const submitGuess = () => void onRun(() => api.submitGuess(game.gameId));
  const nextRound = () => {
    onImageScale("normal");
    onActivePhoto("answer");
    void onRun(() => api.nextRound(game.gameId));
  };

  const changeImageScale = (direction: "up" | "down") => {
    onImageScale((current) => {
      if (direction === "up") {
        if (isMobile) {
          return "normal";
        }
        return current === "small" ? "normal" : "large";
      }
      return current === "large" ? "normal" : "small";
    });
  };

  return (
    <main className="app game-screen">
      <BreedMap
        game={game}
        onSelect={selectBreed}
        focusTarget={focusTarget}
        onFocusConsumed={onFocusConsumed}
      />
      <header className="hud">
        <div className="hud-left">
          <BreedLegend items={game.map.legend} />
          <div className="round-badge">
            <span className="round-label">{copy.common.round}</span>
            <span>{round.index}/{round.total}</span>
          </div>
          <Timer game={game} onTimeout={submitGuess} />
        </div>
        <div className="hud-center">
          {game.status === "guessing" ? <BreedSearchBox onPick={selectBreedFromSearch} /> : null}
        </div>
        <div className="hud-right">
          <div className="score">
            <span className="score-label">{copy.common.score}</span>
            <span className="score-value">{game.totalScore}</span>
          </div>
          <button className="home-button" type="button" title={copy.common.home} aria-label={copy.common.home} onClick={onHome}>
            <Home size={22} />
          </button>
        </div>
      </header>
      <DogGalleryPanel
        phase={game.status}
        answerImage={round.answerImage}
        guessImage={round.guessImage}
        activePhoto={activePhoto}
        onActivePhotoChange={onActivePhoto}
        scale={imageScale}
        isMobile={isMobile}
        onScale={changeImageScale}
        canReport={canReport}
        reportedImageIds={reportedImageIds}
        onReportPhoto={onReportPhoto}
      />
      {game.status === "guessing" && round.selectedBreedId ? (
        <button className="primary-button bottom-action" onClick={submitGuess}>{copy.common.guess}</button>
      ) : null}
      {game.status === "revealed" ? (
        <button className="primary-button bottom-action" onClick={nextRound}>{copy.common.next}</button>
      ) : null}
      {error ? <div className="error-toast">{error}</div> : null}
    </main>
  );
}
