import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Home } from "lucide-react";
import { duelApi } from "../api/duel";
import type { BreedId, DuelHistoryResult, DuelViewState, GameViewState, ImageRef } from "../api/types";
import type { FeedbackVisiblePhoto } from "../api/feedback";
import { BreedMap } from "./BreedMap";
import { BreedLegend, BreedSearchBox, DogGalleryPanel, Timer, type GalleryPhoto, type ImageScale } from "./GameChrome";
import { formatBreedName, useI18n } from "../i18n";

/** Renders the full duel play flow for one projected duel view state. */
export function DuelGameScreen({
  duel,
  error,
  imageScale,
  activePhoto,
  focusTarget,
  isMobile,
  pressureFlashKey,
  onRunDuel,
  onHome,
  onFocusTarget,
  onFocusConsumed,
  onImageScale,
  onActivePhoto,
  canReport,
  reportedImageIds,
  onReportPhoto
}: {
  duel: DuelViewState;
  error: string | null;
  imageScale: ImageScale;
  activePhoto: GalleryPhoto;
  focusTarget: string | null;
  isMobile: boolean;
  pressureFlashKey: number;
  onRunDuel: (action: () => Promise<DuelViewState>) => void;
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
  const displayGame = duelToGameView(duel);
  const round = duel.round;
  const [countdownId, setCountdownId] = useState<string | null>(null);
  const seenCountdownIdRef = useRef<string | null>(null);
  const finishCountdown = useCallback(() => setCountdownId(null), []);

  useEffect(() => {
    if (duel.phase !== "countdown" || !duel.roundStartsAt || seenCountdownIdRef.current === duel.roundStartsAt) {
      return;
    }
    seenCountdownIdRef.current = duel.roundStartsAt;
    setCountdownId(duel.roundStartsAt);
  }, [duel.phase, duel.roundStartsAt]);

  if (duel.status === "finished") {
    return <DuelFinalScreen duel={duel} onHome={onHome} />;
  }

  if (!round) {
    return null;
  }

  const canGuess = duel.phase === "guessing" && !round.myGuessBreed && !countdownId;

  const selectBreed = (breedId: BreedId) => {
    if (!canGuess) {
      return;
    }
    void onRunDuel(() => duelApi.selectBreed(breedId));
  };

  const selectBreedFromSearch = (breedId: BreedId) => {
    if (!canGuess) {
      return;
    }
    onFocusTarget(`${duel.gameId}:${round.index}:${breedId}:${Date.now()}`);
    void onRunDuel(() => duelApi.selectBreed(breedId));
  };

  const submitGuess = () => void onRunDuel(() => duelApi.submitGuess());
  const nextRound = () => {
    onImageScale("normal");
    onActivePhoto("answer");
    void onRunDuel(() => duelApi.readyNext());
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
    <main className="app game-screen duel-screen">
      <BreedMap
        game={displayGame}
        onSelect={selectBreed}
        focusTarget={focusTarget}
        onFocusConsumed={onFocusConsumed}
        opponentBreedId={round.opponentGuessBreed?.id ?? null}
        opponentScore={round.opponentScore}
      />
      <header className="hud">
        <div className="hud-left">
          <BreedLegend items={duel.map.legend} />
          <div className="round-badge">
            <span className="round-label">{copy.common.round}</span>
            <span>{round.index}/{round.total}</span>
          </div>
          {duel.deadlineAt || isMobile ? <Timer game={displayGame} onTimeout={submitGuess} /> : null}
        </div>
        <div className="hud-center">
          {canGuess ? <BreedSearchBox onPick={selectBreedFromSearch} /> : null}
        </div>
        <div className="hud-right">
          <DuelScore duel={duel} />
          <button className="home-button" type="button" title={copy.common.home} aria-label={copy.common.home} onClick={onHome}>
            <Home size={22} />
          </button>
        </div>
      </header>
      <DogGalleryPanel
        phase={displayGame.status}
        answerImage={round.answerImage}
        guessImage={round.myGuessImage}
        activePhoto={activePhoto}
        onActivePhotoChange={onActivePhoto}
        scale={imageScale}
        isMobile={isMobile}
        onScale={changeImageScale}
        canReport={canReport}
        reportedImageIds={reportedImageIds}
        onReportPhoto={onReportPhoto}
      />
      {canGuess && round.selectedBreedId ? (
        <button className="primary-button bottom-action" onClick={submitGuess}>{copy.common.guess}</button>
      ) : null}
      {duel.waitingForOpponentGuessDeadlineAt ? (
        <div className="bottom-action-stack">
          <OpponentGuessWaitingNote deadlineAt={duel.waitingForOpponentGuessDeadlineAt} />
          <button className="primary-button bottom-action" disabled>{copy.common.next}</button>
        </div>
      ) : null}
      {duel.phase === "revealed" ? (
        <div className="bottom-action-stack">
          {duel.waitingForNext ? <OpponentWaitingNote autoNextAt={duel.revealedAutoNextAt} /> : null}
          {duel.opponentReadyForNext && !duel.waitingForNext ? <OpponentReadyNote autoNextAt={duel.revealedAutoNextAt} /> : null}
          <button className="primary-button bottom-action" disabled={duel.waitingForNext} onClick={nextRound}>
            {duel.waitingForNext ? copy.duel.waitingForOpponent : copy.common.next}
          </button>
        </div>
      ) : null}
      {duel.waitingForOpponent ? <DuelWaitingOverlay duel={duel} onHome={onHome} /> : null}
      {countdownId ? <DuelCountdownOverlay key={countdownId} onComplete={finishCountdown} /> : null}
      {pressureFlashKey > 0 ? <DuelPressureFlash key={pressureFlashKey} /> : null}
      {duel.phase === "revealed" && (round.myScore ?? 0) > (round.opponentScore ?? 0) ? <DuelRoundWinEffect /> : null}
      {error ? <div className="error-toast">{error}</div> : null}
    </main>
  );
}

function OpponentGuessWaitingNote({ deadlineAt }: { deadlineAt: string }) {
  const [now, setNow] = useState(Date.now());
  const { copy } = useI18n();
  const remainingSeconds = Math.max(0, Math.ceil((new Date(deadlineAt).getTime() - now) / 1000));

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [deadlineAt]);

  return (
    <div className="opponent-ready-note">
      {copy.duel.waitingForOpponent}: {remainingSeconds}
    </div>
  );
}

function OpponentReadyNote({ autoNextAt }: { autoNextAt: string | null }) {
  const [now, setNow] = useState(Date.now());
  const { copy } = useI18n();
  const remainingSeconds = autoNextAt
    ? Math.max(0, Math.ceil((new Date(autoNextAt).getTime() - now) / 1000))
    : null;

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [autoNextAt]);

  return (
    <div className="opponent-ready-note">
      {remainingSeconds === null ? copy.duel.opponentReady : `${copy.duel.opponentReady}: ${remainingSeconds}`}
    </div>
  );
}

function OpponentWaitingNote({ autoNextAt }: { autoNextAt: string | null }) {
  const [now, setNow] = useState(Date.now());
  const { copy } = useI18n();
  const remainingSeconds = autoNextAt
    ? Math.max(0, Math.ceil((new Date(autoNextAt).getTime() - now) / 1000))
    : null;

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [autoNextAt]);

  return (
    <div className="opponent-ready-note">
      {remainingSeconds === null ? copy.duel.waitingForOpponent : `${copy.duel.waitingForOpponent}: ${remainingSeconds}`}
    </div>
  );
}

function DuelScore({ duel }: { duel: DuelViewState }) {
  const { copy } = useI18n();
  return (
    <div className="score duel-score">
      <span className="score-label">{copy.common.scoreColon}</span>
      <span className="score-value">{duel.myTotalScore}</span>
      <span className="duel-score-vs">vs</span>
      <span className="duel-score-opponent">{duel.opponentTotalScore}</span>
    </div>
  );
}

function DuelWaitingOverlay({ duel, onHome }: { duel: DuelViewState; onHome: () => void }) {
  const [copied, setCopied] = useState(false);
  const { copy } = useI18n();
  const url = `${window.location.origin}/${duel.roomId}`;

  const handleCopy = () => {
    void navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="duel-blocking-overlay">
      <div className="duel-waiting-panel">
        <div className="duel-waiting-spinner" />
        <h2>{duel.visibility === "public" ? copy.duel.publicWaitingTitle : copy.duel.waitingTitle}</h2>
        <p>{duel.visibility === "public" ? copy.duel.publicSearch : copy.duel.shareLink}</p>
        {duel.visibility === "public" ? (
          <div className="public-waiting-actions">
            <button className="copy-button home-copy-button" type="button" onClick={onHome}>
              {copy.duel.cancelSearch}
            </button>
          </div>
        ) : (
          <div className="duel-room-code-box">
            <strong>{duel.roomId}</strong>
            <button className={`copy-button ${copied ? "copied" : ""}`} type="button" onClick={handleCopy}>
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? copy.duel.copied : copy.duel.copyLink}
            </button>
            <button className="copy-button home-copy-button" type="button" onClick={onHome}>
              {copy.common.home}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DuelCountdownOverlay({ onComplete }: { onComplete: () => void }) {
  const [count, setCount] = useState(3);

  useEffect(() => {
    const showTwo = window.setTimeout(() => setCount(2), 1000);
    const showOne = window.setTimeout(() => setCount(1), 2000);
    const finish = window.setTimeout(onComplete, 3000);
    return () => {
      window.clearTimeout(showTwo);
      window.clearTimeout(showOne);
      window.clearTimeout(finish);
    };
  }, [onComplete]);

  return (
    <div className="duel-countdown-overlay">
      <div className="countdown-ring" />
      <div className="countdown-number" key={count}>{count}</div>
    </div>
  );
}

function DuelPressureFlash() {
  return <div className="duel-pressure-flash" aria-hidden="true" />;
}

function DuelRoundWinEffect() {
  return <div className="duel-win-effect" aria-hidden="true" />;
}

function DuelFinalScreen({ duel, onHome }: { duel: DuelViewState; onHome: () => void }) {
  const { copy } = useI18n();
  const isDraw = duel.myTotalScore === duel.opponentTotalScore;
  const isWin = duel.myTotalScore > duel.opponentTotalScore;
  const resultText = isDraw ? copy.duel.draw : isWin ? copy.duel.win : copy.duel.loss;
  const resultClass = isDraw ? "draw" : isWin ? "win" : "loss";

  return (
    <main className="app final-screen duel-final-screen">
      <section className={`final-header ${resultClass}`}>
        <div className="final-score-label">{resultText}</div>
        <h1 className="duel-final-score">
          <span className="duel-final-my">{duel.myTotalScore}</span>
          <span className="duel-final-separator"> : </span>
          <span className="duel-final-opponent">{duel.opponentTotalScore}</span>
        </h1>
      </section>
      <section className="result-scroll duel-result-scroll">
        <div className="duel-result-list">
          {duel.history.map((result) => <DuelResultRow key={result.index} result={result} />)}
        </div>
        <button className="primary-button" onClick={onHome}>{copy.common.home}</button>
      </section>
    </main>
  );
}

function DuelResultRow({ result }: { result: DuelHistoryResult }) {
  const { copy, locale } = useI18n();
  const myWin = result.myScore > result.opponentScore;
  const oppWin = result.opponentScore > result.myScore;

  return (
    <article className="duel-result-row">
      <div className={`duel-result-side my-side ${myWin ? "winner" : ""}`}>
        <div className="duel-result-label">{copy.duel.myAnswer}</div>
        <div className="duel-result-score">+{result.myScore}</div>
        <DuelResultCell imageUrl={result.myGuessImage?.url ?? null} label={result.myGuessBreed ? formatBreedName(result.myGuessBreed, locale) : copy.common.noAnswer} muted={!result.myGuessImage} />
      </div>

      <div className="duel-result-center">
        <div className="duel-result-round">{copy.common.round} {result.index}</div>
        <DuelResultCell imageUrl={result.answerImage.url} label={formatBreedName(result.answerBreed, locale)} />
      </div>

      <div className={`duel-result-side opp-side ${oppWin ? "winner" : ""}`}>
        <div className="duel-result-label">{copy.duel.opponentAnswer}</div>
        <div className="duel-result-score">+{result.opponentScore}</div>
        <DuelResultCell imageUrl={result.opponentGuessImage?.url ?? null} label={result.opponentGuessBreed ? formatBreedName(result.opponentGuessBreed, locale) : copy.common.noAnswer} muted={!result.opponentGuessImage} />
      </div>
    </article>
  );
}

function DuelResultCell({ imageUrl, label, muted = false }: { imageUrl: string | null; label: string; muted?: boolean }) {
  const { copy } = useI18n();
  return (
    <div className={`duel-result-cell ${muted ? "muted" : ""}`}>
      <div className="result-image-wrapper">
        {imageUrl ? <img src={imageUrl} alt={label} /> : <div className="empty-image">{copy.common.noAnswer}</div>}
      </div>
      <strong>{label}</strong>
    </div>
  );
}

/** Adapts duel round projection to existing map/timer/gallery props without changing UI behavior. */
function duelToGameView(duel: DuelViewState): GameViewState {
  return {
    gameId: duel.gameId,
    status: duel.phase === "finished" ? "finished" : duel.phase === "revealed" ? "revealed" : "guessing",
    settings: {
      unlimitedTime: duel.deadlineAt === null,
      secondsPerRound: 15,
      roundCount: 7
    },
    map: duel.map,
    round: duel.round ? {
      index: duel.round.index,
      total: duel.round.total,
      phase: duel.phase === "revealed" ? "revealed" : "guessing",
      answerImage: duel.round.answerImage,
      selectedBreedId: duel.round.selectedBreedId,
      answerBreed: duel.round.answerBreed,
      guessBreed: duel.round.myGuessBreed,
      guessImage: duel.round.myGuessImage,
      score: duel.round.myScore,
      similarity: null,
      timedOut: duel.round.myTimedOut
    } : null,
    history: [],
    totalScore: duel.myTotalScore,
    maxScore: duel.maxScore,
    serverNow: duel.serverNow,
    deadlineAt: duel.deadlineAt
  };
}
