import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, Clock3, Home, List, Maximize2, Minimize2, Search, X, Copy, Check } from "lucide-react";
import { api } from "./api/client";
import { duelApi } from "./api/duel";
import type { BreedId, BreedSuggestion, DuelHistoryResult, DuelViewState, GameSettings, GameStatus, GameViewState, MapLegendItem, MapTile, RoundResult } from "./api/types";
import startBackgroundUrl from "./assets/start-bg.jpg";
import {
  clampViewport,
  classifyWheel,
  fitBounds,
  getMinScale,
  MAX_MAP_SCALE,
  panViewport,
  pinchScaleFactor,
  zoomAtPoint,
  type Point,
  type Size,
  type Viewport
} from "./mapViewport";

const DEFAULT_SETTINGS: GameSettings = {
  unlimitedTime: false,
  secondsPerRound: 3 * 60,
  roundCount: 10
};

const START_BG_SHIFT = 0.5;
const SETTINGS_KEY = "dogguessr:settings:v1";
const MAP_VIEWPORT_KEY = "dogguessr:mapViewport:v1";
const INITIAL_MAP_SCALE = 0.58;

type ImageScale = "small" | "normal" | "large";
type GalleryPhoto = "answer" | "guess";

export function App() {
  const [settings, setSettings] = useState<GameSettings>(() => readSettings());
  const [game, setGame] = useState<GameViewState | null>(null);
  const [duel, setDuel] = useState<DuelViewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duelCode, setDuelCode] = useState("");
  const [pressureFlashKey, setPressureFlashKey] = useState(0);
  const [imageScale, setImageScale] = useState<ImageScale>("normal");
  const [activePhoto, setActivePhoto] = useState<GalleryPhoto>("answer");
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [restoringGame, setRestoringGame] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const flashedPressureRoundRef = useRef<string | null>(null);
  const isMobile = useMediaQuery("(max-width: 760px)");

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    const restore = duelApi.roomIdFromPath()
      ? duelApi.restoreFromPath().then((restored) => {
        if (!cancelled && restored) {
          setDuel(restored);
        }
      })
      : api.restoreGame().then((restored) => {
        if (!cancelled && restored) {
          setGame(restored);
        }
      });

    restore
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Unknown error");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRestoringGame(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (game?.status === "revealed") {
      setImageScale("small");
      setActivePhoto("answer");
    }
  }, [game?.round?.index, game?.status]);

  useEffect(() => {
    if (isMobile && imageScale === "large") {
      setImageScale("normal");
    }
  }, [imageScale, isMobile]);

  const run = useCallback(async (action: () => Promise<GameViewState>) => {
    try {
      setError(null);
      setGame(await action());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error");
    }
  }, []);

  useEffect(() => {
    if (!game || game.status !== "guessing") {
      return;
    }
    const interval = window.setInterval(() => {
      void run(() => api.getGame(game.gameId));
    }, 5000);
    return () => window.clearInterval(interval);
  }, [game, run]);

  const runDuel = useCallback(async (action: () => Promise<DuelViewState>) => {
    try {
      setError(null);
      setDuel(await action());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error");
    }
  }, []);

  useEffect(() => {
    if (!duel || duel.phase === "finished") {
      return;
    }
    const intervalMs = duel.pressure ? 500 : 1000;
    const interval = window.setInterval(() => {
      void runDuel(() => duelApi.getState());
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, [duel, runDuel]);

  useEffect(() => {
    if (!duel?.pressure || !duel.round) {
      return;
    }
    const key = `${duel.roomId}:${duel.round.index}`;
    if (flashedPressureRoundRef.current === key) {
      return;
    }
    flashedPressureRoundRef.current = key;
    setPressureFlashKey((current) => current + 1);
  }, [duel]);

  const startGame = () => {
    setIsStarting(true);
    setImageScale("normal");
    setActivePhoto("answer");
    clearSavedMapViewport();
    void run(() => api.createGame(settings)).finally(() => setIsStarting(false));
  };

  const createDuel = () => {
    setIsStarting(true);
    setImageScale("normal");
    setActivePhoto("answer");
    clearSavedMapViewport();
    void runDuel(() => duelApi.createRoom()).finally(() => setIsStarting(false));
  };

  const joinDuel = () => {
    const roomId = duelCode.trim();
    if (!/^[A-Za-z0-9]{6}$/.test(roomId)) {
      setError("Код комнаты должен быть из 6 символов");
      return;
    }
    setIsStarting(true);
    setImageScale("normal");
    setActivePhoto("answer");
    clearSavedMapViewport();
    window.history.pushState(null, "", `/${roomId}`);
    void runDuel(() => duelApi.joinRoom(roomId)).finally(() => setIsStarting(false));
  };

  const goHome = () => {
    api.clearGame();
    duelApi.clearSession();
    clearSavedMapViewport();
    setFocusTarget(null);
    setImageScale("normal");
    setActivePhoto("answer");
    setGame(null);
    setDuel(null);
    window.history.pushState(null, "", "/");
  };

  if (restoringGame) {
    return <main className="app game-screen" />;
  }

  if (!game && !duel) {
    return (
      <main className="app start-screen">
        <StartBackground shift={START_BG_SHIFT} />
        <section className="start-panel">
          <div className="start-header">
            <h1 className="game-title">DogGuessr</h1>
            <p className="game-subtitle">Угадай породу собаки по фото</p>
          </div>
          <div className="start-actions">
            <button className="primary-button start-button" disabled={isStarting} onClick={startGame}>
              {isStarting ? <span className="spinner" /> : null}
              Одиночная игра
            </button>
            <div className="duel-section">
              <div className="duel-divider"><span>ДУЭЛЬ</span></div>
              <button className="primary-button duel-button" disabled={isStarting} onClick={createDuel}>
                {isStarting ? <span className="spinner" /> : null}
                Создать комнату
              </button>
              <div className="duel-join-row">
                <input
                  value={duelCode}
                  maxLength={6}
                  placeholder="Код комнаты"
                  aria-label="Код комнаты"
                  disabled={isStarting}
                  onChange={(event) => setDuelCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      joinDuel();
                    }
                  }}
                />
                <button type="button" disabled={isStarting || duelCode.length !== 6} onClick={joinDuel}>Войти</button>
              </div>
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-divider" />
            <label className="slider-row">
              <span>Секунд на вопрос</span>
              <strong>{settings.unlimitedTime ? "inf" : settings.secondsPerRound}</strong>
              <input
                type="range"
                min="30"
                max="330"
                step="30"
                value={settings.unlimitedTime ? 330 : settings.secondsPerRound}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setSettings((prev) => ({
                    ...prev,
                    unlimitedTime: value > 300,
                    secondsPerRound: value > 300 ? prev.secondsPerRound : value
                  }));
                }}
              />
            </label>
            <label className="slider-row">
              <span>Раундов</span>
              <strong>{settings.roundCount}</strong>
              <input
                type="range"
                min="5"
                max="20"
                step="1"
                value={settings.roundCount}
                onChange={(event) => setSettings((prev) => ({ ...prev, roundCount: Number(event.target.value) }))}
              />
            </label>
          </div>
        </section>
        {error ? <div className="error-toast">{error}</div> : null}
      </main>
    );
  }

  if (duel) {
    return (
      <DuelGameScreen
        duel={duel}
        error={error}
        imageScale={imageScale}
        activePhoto={activePhoto}
        focusTarget={focusTarget}
        isMobile={isMobile}
        pressureFlashKey={pressureFlashKey}
        onRunDuel={runDuel}
        onHome={goHome}
        onFocusTarget={setFocusTarget}
        onFocusConsumed={() => setFocusTarget(null)}
        onImageScale={setImageScale}
        onActivePhoto={setActivePhoto}
      />
    );
  }

  const soloGame = game;
  if (!soloGame) {
    return null;
  }

  if (soloGame.status === "finished") {
    return <FinalScreen game={soloGame} onHome={goHome} />;
  }

  const round = soloGame.round;
  if (!round) {
    return null;
  }

  const selectBreed = (breedId: BreedId) => {
    if (soloGame.status !== "guessing") {
      return;
    }
    void run(() => api.selectBreed(soloGame.gameId, breedId));
  };

  const selectBreedFromSearch = (breedId: BreedId) => {
    if (soloGame.status !== "guessing") {
      return;
    }
    setFocusTarget(`${soloGame.gameId}:${round?.index}:${breedId}:${Date.now()}`);
    void run(() => api.selectBreed(soloGame.gameId, breedId));
  };

  const submitGuess = () => void run(() => api.submitGuess(soloGame.gameId));
  const nextRound = () => {
    setImageScale("normal");
    setActivePhoto("answer");
    void run(() => api.nextRound(soloGame.gameId));
  };

  const changeImageScale = (direction: "up" | "down") => {
    setImageScale((current) => {
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
        game={soloGame}
        onSelect={selectBreed}
        focusTarget={focusTarget}
        onFocusConsumed={() => setFocusTarget(null)}
      />
      <header className="hud">
        <div className="hud-left">
          <BreedLegend items={soloGame.map.legend} />
          <div className="round-badge">
            <span className="round-label">Раунд</span>
            <span>{round.index}/{round.total}</span>
          </div>
          <Timer game={soloGame} onTimeout={submitGuess} />
        </div>
        <div className="hud-center">
          {soloGame.status === "guessing" ? <BreedSearchBox onPick={selectBreedFromSearch} /> : null}
        </div>
        <div className="hud-right">
          <div className="score">
            <span className="score-label">Счет</span>
            <span className="score-value">{soloGame.totalScore}</span>
          </div>
          <button className="home-button" type="button" title="На главный экран" aria-label="На главный экран" onClick={goHome}>
            <Home size={22} />
          </button>
        </div>
      </header>
      <DogGalleryPanel
        phase={soloGame.status}
        answerImageUrl={round.answerImage.url}
        guessImageUrl={round.guessImage?.url ?? null}
        activePhoto={activePhoto}
        onActivePhotoChange={setActivePhoto}
        scale={imageScale}
        isMobile={isMobile}
        onScale={changeImageScale}
      />
      {soloGame.status === "guessing" && round.selectedBreedId ? (
        <button className="primary-button bottom-action" onClick={submitGuess}>Угадать</button>
      ) : null}
      {soloGame.status === "revealed" ? (
        <button className="primary-button bottom-action" onClick={nextRound}>Дальше</button>
      ) : null}
      {error ? <div className="error-toast">{error}</div> : null}
    </main>
  );
}

function DuelGameScreen({
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
  onActivePhoto
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
}) {
  const displayGame = duelToGameView(duel);
  const round = duel.round;

  if (duel.status === "finished") {
    return <DuelFinalScreen duel={duel} onHome={onHome} />;
  }

  if (!round) {
    return null;
  }

  const canGuess = duel.phase === "guessing" && !round.myGuessBreed;

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
            <span className="round-label">Раунд</span>
            <span>{round.index}/{round.total}</span>
          </div>
          {duel.deadlineAt || isMobile ? <Timer game={displayGame} onTimeout={submitGuess} /> : null}
        </div>
        <div className="hud-center">
          {canGuess ? <BreedSearchBox onPick={selectBreedFromSearch} /> : null}
        </div>
        <div className="hud-right">
          <DuelScore duel={duel} />
          <button className="home-button" type="button" title="На главный экран" aria-label="На главный экран" onClick={onHome}>
            <Home size={22} />
          </button>
        </div>
      </header>
      <DogGalleryPanel
        phase={displayGame.status}
        answerImageUrl={round.answerImage.url}
        guessImageUrl={round.myGuessImage?.url ?? null}
        activePhoto={activePhoto}
        onActivePhotoChange={onActivePhoto}
        scale={imageScale}
        isMobile={isMobile}
        onScale={changeImageScale}
      />
      {canGuess && round.selectedBreedId ? (
        <button className="primary-button bottom-action" onClick={submitGuess}>Угадать</button>
      ) : null}
      {duel.phase === "revealed" ? (
        <button className="primary-button bottom-action" disabled={duel.waitingForNext} onClick={nextRound}>
          {duel.waitingForNext ? "Ждем соперника" : "Дальше"}
        </button>
      ) : null}
      {duel.waitingForOpponent ? <DuelWaitingOverlay roomId={duel.roomId} /> : null}
      {duel.phase === "countdown" && duel.roundStartsAt ? <DuelCountdownOverlay startsAt={duel.roundStartsAt} /> : null}
      {pressureFlashKey > 0 ? <DuelPressureFlash key={pressureFlashKey} /> : null}
      {duel.phase === "revealed" && (round.myScore ?? 0) > (round.opponentScore ?? 0) ? <DuelRoundWinEffect /> : null}
      {error ? <div className="error-toast">{error}</div> : null}
    </main>
  );
}

function DuelScore({ duel }: { duel: DuelViewState }) {
  return (
    <div className="score duel-score">
      <span className="score-label">Счет:</span>
      <span className="score-value">{duel.myTotalScore}</span>
      <span className="duel-score-vs">vs</span>
      <span className="duel-score-opponent">{duel.opponentTotalScore}</span>
    </div>
  );
}

function DuelWaitingOverlay({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/${roomId}`;

  const handleCopy = () => {
    void navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="duel-blocking-overlay">
      <div className="duel-waiting-panel">
        <div className="duel-waiting-spinner" />
        <h2>Ожидание соперника...</h2>
        <p>Отправьте эту ссылку второму игроку:</p>
        <div className="duel-room-code-box">
          <strong>{roomId}</strong>
          <button className={`copy-button ${copied ? "copied" : ""}`} type="button" onClick={handleCopy}>
            {copied ? <Check size={18} /> : <Copy size={18} />}
            {copied ? "Скопировано!" : "Копировать ссылку"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DuelCountdownOverlay({ startsAt }: { startsAt: string }) {
  const [now, setNow] = useState(Date.now());
  const remainingMs = new Date(startsAt).getTime() - now;
  const count = Math.max(1, Math.min(3, Math.ceil(remainingMs / 1000)));

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 80);
    return () => window.clearInterval(interval);
  }, [startsAt]);

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
  const isDraw = duel.myTotalScore === duel.opponentTotalScore;
  const isWin = duel.myTotalScore > duel.opponentTotalScore;
  const resultText = isDraw ? "Ничья" : isWin ? "Победа!" : "Поражение";
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
        <button className="primary-button" onClick={onHome}>На главный экран</button>
      </section>
    </main>
  );
}

function DuelResultRow({ result }: { result: DuelHistoryResult }) {
  const myWin = result.myScore > result.opponentScore;
  const oppWin = result.opponentScore > result.myScore;
  
  return (
    <article className="duel-result-row">
      <div className={`duel-result-side my-side ${myWin ? 'winner' : ''}`}>
        <div className="duel-result-label">Мой ответ</div>
        <div className="duel-result-score">+{result.myScore}</div>
        <DuelResultCell imageUrl={result.myGuessImage?.url ?? null} label={result.myGuessBreed?.ru ?? "Нет ответа"} muted={!result.myGuessImage} />
      </div>
      
      <div className="duel-result-center">
        <div className="duel-result-round">Раунд {result.index}</div>
        <DuelResultCell imageUrl={result.answerImage.url} label={result.answerBreed.ru} />
      </div>

      <div className={`duel-result-side opp-side ${oppWin ? 'winner' : ''}`}>
        <div className="duel-result-label">Ответ соперника</div>
        <div className="duel-result-score">+{result.opponentScore}</div>
        <DuelResultCell imageUrl={result.opponentGuessImage?.url ?? null} label={result.opponentGuessBreed?.ru ?? "Нет ответа"} muted={!result.opponentGuessImage} />
      </div>
    </article>
  );
}

function DuelResultCell({ imageUrl, label, muted = false }: { imageUrl: string | null; label: string; muted?: boolean }) {
  return (
    <div className={`duel-result-cell ${muted ? "muted" : ""}`}>
      <div className="result-image-wrapper">
        {imageUrl ? <img src={imageUrl} alt={label} /> : <div className="empty-image">Нет ответа</div>}
      </div>
      <strong>{label}</strong>
    </div>
  );
}

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

function StartBackground({ shift }: { shift: number }) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [position, setPosition] = useState("50% 50%");

  useEffect(() => {
    const image = imageRef.current;
    if (!image) {
      return;
    }

    const updatePosition = () => {
      setPosition(getCoverObjectPosition(
        { width: image.naturalWidth, height: image.naturalHeight },
        { width: window.innerWidth, height: window.innerHeight },
        shift
      ));
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [shift]);

  const updateLoadedImagePosition = () => {
    const image = imageRef.current;
    if (!image) {
      return;
    }
    setPosition(getCoverObjectPosition(
      { width: image.naturalWidth, height: image.naturalHeight },
      { width: window.innerWidth, height: window.innerHeight },
      shift
    ));
  };

  return (
    <div className="start-background" aria-hidden="true">
      <img ref={imageRef} src={startBackgroundUrl} style={{ objectPosition: position }} onLoad={updateLoadedImagePosition} />
    </div>
  );
}

function getCoverObjectPosition(image: Size, viewport: Size, shift: number) {
  const safeShift = clamp(shift, 0, 1) * 100;
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return "50% 50%";
  }

  const imageRatio = image.width / image.height;
  const viewportRatio = viewport.width / viewport.height;
  return imageRatio > viewportRatio ? `${safeShift}% 50%` : `50% ${100 - safeShift}%`;
}

function readSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const saved = JSON.parse(raw) as Partial<GameSettings>;
    return {
      unlimitedTime: Boolean(saved.unlimitedTime),
      secondsPerRound: typeof saved.secondsPerRound === "number" ? clamp(saved.secondsPerRound, 30, 300) : DEFAULT_SETTINGS.secondsPerRound,
      roundCount: typeof saved.roundCount === "number" ? clamp(saved.roundCount, 5, 20) : DEFAULT_SETTINGS.roundCount
    };
  } catch {
    localStorage.removeItem(SETTINGS_KEY);
    return DEFAULT_SETTINGS;
  }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (
    typeof window === "undefined" ? false : window.matchMedia(query).matches
  ));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia(query);
    const updateMatches = () => setMatches(media.matches);

    updateMatches();
    media.addEventListener("change", updateMatches);
    return () => media.removeEventListener("change", updateMatches);
  }, [query]);

  return matches;
}

function initialMapViewport(viewportSize: Size, contentSize: Size): Viewport {
  const scale = Math.max(getMinScale(viewportSize, contentSize), Math.min(INITIAL_MAP_SCALE, MAX_MAP_SCALE));
  return clampViewport(
    {
      scale,
      x: viewportSize.width / 2 - (contentSize.width * scale) / 2,
      y: viewportSize.height / 2 - (contentSize.height * scale) / 2
    },
    viewportSize,
    contentSize
  );
}

function readSavedMapViewport(gameId: string): Viewport | null {
  try {
    const raw = localStorage.getItem(MAP_VIEWPORT_KEY);
    const saved = raw ? JSON.parse(raw) as { gameId?: string; viewport?: Partial<Viewport> } : null;
    const viewport = saved?.gameId === gameId ? saved.viewport : null;
    if (
      typeof viewport?.x === "number" &&
      typeof viewport.y === "number" &&
      typeof viewport.scale === "number"
    ) {
      return { x: viewport.x, y: viewport.y, scale: viewport.scale };
    }
  } catch {
    localStorage.removeItem(MAP_VIEWPORT_KEY);
  }
  return null;
}

function saveMapViewport(gameId: string, viewport: Viewport): void {
  localStorage.setItem(MAP_VIEWPORT_KEY, JSON.stringify({ gameId, viewport }));
}

function clearSavedMapViewport(): void {
  localStorage.removeItem(MAP_VIEWPORT_KEY);
}

function BreedSearchBox({ onPick }: { onPick: (breedId: BreedId) => void }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<BreedSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);
  const listOpen = query.trim().length > 0;

  useEffect(() => {
    const trimmed = query.trim();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!trimmed) {
      setSuggestions([]);
      setActiveIndex(0);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    const timeoutId = window.setTimeout(() => {
      api.suggestBreeds(trimmed)
        .then((response) => {
          if (requestIdRef.current !== requestId) {
            return;
          }
          setSuggestions(response.suggestions);
          setActiveIndex(0);
        })
        .catch((caught) => {
          if (requestIdRef.current !== requestId) {
            return;
          }
          setSuggestions([]);
          setError(caught instanceof Error ? caught.message : "Ошибка поиска");
        })
        .finally(() => {
          if (requestIdRef.current === requestId) {
            setLoading(false);
          }
        });
    }, 220);

    return () => window.clearTimeout(timeoutId);
  }, [query]);

  const pickSuggestion = (suggestion: BreedSuggestion) => {
    setQuery("");
    setSuggestions([]);
    setActiveIndex(0);
    onPick(suggestion.breed.id);
  };

  const clearSearch = () => {
    requestIdRef.current += 1;
    setQuery("");
    setSuggestions([]);
    setActiveIndex(0);
    setLoading(false);
    setError(null);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setQuery("");
      setSuggestions([]);
      setActiveIndex(0);
      return;
    }

    if (!suggestions.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      pickSuggestion(suggestions[activeIndex]);
    }
  };

  return (
    <div className="breed-search">
      <Search size={19} />
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="Найти породу"
        aria-label="Найти породу"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {query ? (
        <button
          className="search-clear-button"
          type="button"
          title="Очистить поиск"
          aria-label="Очистить поиск"
          onMouseDown={(event) => event.preventDefault()}
          onClick={clearSearch}
        >
          <X size={18} />
        </button>
      ) : null}
      {listOpen ? (
        <div className="breed-suggestions" role="listbox">
          {loading ? <div className="breed-suggestion-state">Ищем...</div> : null}
          {error ? <div className="breed-suggestion-state error">{error}</div> : null}
          {!loading && !error && suggestions.length === 0 ? <div className="breed-suggestion-state">Ничего не найдено</div> : null}
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.breed.id}
              className={index === activeIndex ? "active" : ""}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pickSuggestion(suggestion)}
            >
              <span>{suggestion.label}</span>
              <small>{suggestion.breed.en}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Timer({ game, onTimeout }: { game: GameViewState; onTimeout: () => void }) {
  const [now, setNow] = useState(Date.now());
  const deadlineMs = game.deadlineAt ? new Date(game.deadlineAt).getTime() : null;
  const remainingSeconds = deadlineMs ? Math.max(0, Math.ceil((deadlineMs - now) / 1000)) : null;

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [game.gameId, game.round?.index]);

  useEffect(() => {
    if (game.status === "guessing" && deadlineMs && remainingSeconds === 0) {
      onTimeout();
    }
  }, [deadlineMs, game.status, onTimeout, remainingSeconds]);

  return (
    <div className={`timer ${remainingSeconds !== null && remainingSeconds <= 10 ? 'danger' : ''}`}>
      <Clock3 size={22} />
      <span>{remainingSeconds === null ? "∞" : formatSeconds(remainingSeconds)}</span>
    </div>
  );
}

function BreedLegend({ items }: { items: MapLegendItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  if (!items.length) {
    return null;
  }

  return (
    <div className="map-legend" ref={rootRef}>
      <button
        className="legend-button"
        type="button"
        aria-expanded={open}
        aria-label="Легенда групп пород"
        title="Легенда групп пород"
        onClick={() => setOpen((current) => !current)}
      >
        <List size={20} />
        <span>Легенда</span>
      </button>
      {open ? (
        <div className="legend-popover">
          {items.map((item) => (
            <div className="legend-row" key={item.group}>
              <span className="legend-swatch" style={{ background: item.color }} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DogGalleryPanel({
  phase,
  answerImageUrl,
  guessImageUrl,
  activePhoto,
  onActivePhotoChange,
  scale,
  isMobile,
  onScale
}: {
  phase: GameStatus;
  answerImageUrl: string;
  guessImageUrl: string | null;
  activePhoto: GalleryPhoto;
  onActivePhotoChange: (photo: GalleryPhoto) => void;
  scale: ImageScale;
  isMobile: boolean;
  onScale: (direction: "up" | "down") => void;
}) {
  const hasGuess = phase === "revealed" && Boolean(guessImageUrl);
  const visiblePhoto: GalleryPhoto = hasGuess ? activePhoto : "answer";
  const imageUrl = visiblePhoto === "guess" && guessImageUrl ? guessImageUrl : answerImageUrl;
  const title = phase === "revealed" ? (visiblePhoto === "guess" ? "Ваш ответ" : "Правильный ответ") : "Угадай породу";
  const togglePhoto = () => {
    if (!hasGuess) {
      return;
    }
    onActivePhotoChange(visiblePhoto === "answer" ? "guess" : "answer");
  };

  return (
    <aside className={`dog-panel right scale-${scale}`}>
      <div className="dog-panel-header">
        <div className="gallery-tabs">
          {phase === "revealed" ? (
            <>
              <button
                className={visiblePhoto === "answer" ? "active" : ""}
                onClick={() => onActivePhotoChange("answer")}
              >
                Правильный ответ
              </button>
              {hasGuess ? (
                <button
                  className={visiblePhoto === "guess" ? "active" : ""}
                  onClick={() => onActivePhotoChange("guess")}
                >
                  Ваш ответ
                </button>
              ) : null}
            </>
          ) : (
            <span>{title}</span>
          )}
        </div>
        <div className="icon-actions">
          <button title="Расширить" disabled={isMobile && scale === "normal"} onClick={() => onScale("up")}><Maximize2 size={18} /></button>
          <button title="Сжать" onClick={() => onScale("down")}><Minimize2 size={18} /></button>
        </div>
      </div>
      <div className="dog-image-wrap">
        {hasGuess ? (
          <>
            <button className="gallery-arrow left" title="Предыдущее фото" onClick={togglePhoto}>
              <ChevronLeft size={30} />
            </button>
            <button className="gallery-arrow right" title="Следующее фото" onClick={togglePhoto}>
              <ChevronRight size={30} />
            </button>
          </>
        ) : null}
        <img src={imageUrl} alt={title} />
      </div>
    </aside>
  );
}

function BreedMap({
  game,
  onSelect,
  focusTarget,
  onFocusConsumed,
  opponentBreedId = null,
  opponentScore = null
}: {
  game: GameViewState;
  onSelect: (breedId: BreedId) => void;
  focusTarget: string | null;
  onFocusConsumed: () => void;
  opponentBreedId?: BreedId | null;
  opponentScore?: number | null;
}) {
  const viewportRef = useRef<HTMLElement | null>(null);
  const fittedRoundRef = useRef<string | null>(null);
  const consumedFocusTargetRef = useRef<string | null>(null);
  const initializedViewportRef = useRef<string | null>(null);
  const touchPointersRef = useRef(new Map<number, Point>());
  const touchGestureRef = useRef<TouchGesture | null>(null);
  const suppressNextTileClickRef = useRef(false);
  const [viewport, setViewport] = useState<Viewport>({ x: 80, y: 96, scale: 1 });
  const [dragStart, setDragStart] = useState<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const layout = game.map;
  const mapWidth = layout.columns * layout.tileWidth + (layout.columns - 1) * layout.columnGap;
  const mapHeight = layout.rows * layout.tileHeight + (layout.rows - 1) * layout.rowGap;
  const contentSize = useMemo<Size>(() => ({ width: mapWidth, height: mapHeight }), [mapHeight, mapWidth]);
  const tileByBreed = useMemo(() => new Map(layout.tiles.map((tile) => [tile.breedId, tile])), [layout.tiles]);
  const round = game.round;
  const answerTile = round?.answerBreed ? tileByBreed.get(round.answerBreed.id) : null;
  const guessTile = round?.guessBreed ? tileByBreed.get(round.guessBreed.id) : null;
  const opponentTile = opponentBreedId ? tileByBreed.get(opponentBreedId) : null;
  const selectedTile = round?.selectedBreedId ? tileByBreed.get(round.selectedBreedId) : null;
  const arc = answerTile && guessTile ? getArc(layout, guessTile, answerTile, round?.score ?? 0) : null;
  const opponentArc = answerTile && opponentTile && opponentScore !== null ? getArc(layout, opponentTile, answerTile, opponentScore) : null;

  useLayoutEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) {
      return;
    }

    const initKey = `${game.gameId}:${layout.columns}:${layout.rows}`;
    if (initializedViewportRef.current === initKey) {
      return;
    }

    initializedViewportRef.current = initKey;
    const viewportSize = getElementSize(viewportElement);
    const savedViewport = readSavedMapViewport(game.gameId);
    if (savedViewport && game.status === "revealed") {
      fittedRoundRef.current = `${game.gameId}:${round?.index ?? "unknown"}`;
    }
    setViewport(savedViewport
      ? clampViewport(savedViewport, viewportSize, contentSize)
      : initialMapViewport(viewportSize, contentSize));
  }, [contentSize, game.gameId, game.status, layout.columns, layout.rows, round?.index]);

  useEffect(() => {
    if (initializedViewportRef.current) {
      saveMapViewport(game.gameId, viewport);
    }
  }, [game.gameId, viewport]);

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) {
      return;
    }

    const viewportSize = getElementSize(viewportElement);

    if (game.status !== "revealed") {
      fittedRoundRef.current = null;
      setViewport((current) => {
        const initKey = `${game.gameId}:${layout.columns}:${layout.rows}`;
        if (initializedViewportRef.current !== initKey) {
          return current;
        }
        return clampViewport(current, viewportSize, contentSize);
      });
      return;
    }

    const fitKey = `${game.gameId}:${round?.index ?? "unknown"}`;
    if (fittedRoundRef.current === fitKey) {
      return;
    }

    const tilesToFit = [guessTile, answerTile, opponentTile].filter((tile): tile is MapTile => Boolean(tile));
    if (tilesToFit.length === 0) {
      return;
    }

    const bounds = getTilesBounds(layout, tilesToFit);
    fittedRoundRef.current = fitKey;
    setViewport(fitBounds(bounds, viewportSize, contentSize));
  }, [answerTile, contentSize, game.gameId, game.status, guessTile, layout, opponentTile, round?.index]);

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement || game.status !== "guessing" || !focusTarget || consumedFocusTargetRef.current === focusTarget) {
      return;
    }

    const parts = focusTarget.split(':');
    if (parts.length < 4) {
      consumedFocusTargetRef.current = focusTarget;
      onFocusConsumed();
      return;
    }
    const breedId = parts[parts.length - 2];
    const tile = tileByBreed.get(breedId);

    if (tile) {
      consumedFocusTargetRef.current = focusTarget;
      setViewport(focusTile(layout, tile, getElementSize(viewportElement), contentSize));
      onFocusConsumed();
    }
  }, [contentSize, game.status, layout, focusTarget, onFocusConsumed, tileByBreed]);

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      const intent = classifyWheel(event);
      if (intent.kind === "none") {
        return;
      }

      event.preventDefault();
      const viewportSize = getElementSize(viewportElement);

      if (intent.kind === "trackpadPan") {
        setViewport((current) => panViewport(
          current,
          { x: -intent.deltaX, y: -intent.deltaY },
          viewportSize,
          contentSize
        ));
        return;
      }

      const rect = viewportElement.getBoundingClientRect();
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
      const factor = intent.kind === "pinchZoom" ? pinchScaleFactor(intent.deltaY) : intent.direction > 0 ? 1.12 : 1 / 1.12;

      setViewport((current) => zoomAtPoint(
        current,
        point,
        Math.min(MAX_MAP_SCALE, current.scale * factor),
        viewportSize,
        contentSize
      ));
    };

    viewportElement.addEventListener("wheel", onWheel, { passive: false });
    return () => viewportElement.removeEventListener("wheel", onWheel);
  }, [contentSize]);

  const suppressTileClickBriefly = () => {
    suppressNextTileClickRef.current = true;
    window.setTimeout(() => {
      suppressNextTileClickRef.current = false;
    }, 180);
  };

  const selectTile = (breedId: BreedId) => {
    if (suppressNextTileClickRef.current) {
      suppressNextTileClickRef.current = false;
      return;
    }
    onSelect(breedId);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) {
      return;
    }

    const isTouch = event.pointerType === "touch";
    const startedOnTile = Boolean((event.target as HTMLElement).closest(".breed-tile"));
    if (startedOnTile && !isTouch) {
      return;
    }

    if (!isTouch || !startedOnTile) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const point = relativePointerPoint(event, viewportElement);

    if (isTouch) {
      touchPointersRef.current.set(event.pointerId, point);
      const gesture = touchGesture(activeTouchPoints(touchPointersRef.current));
      touchGestureRef.current = gesture;
      if (gesture) {
        setDragStart(null);
        return;
      }
    }

    setDragStart({
      pointerId: event.pointerId,
      x: point.x,
      y: point.y,
      originX: viewport.x,
      originY: viewport.y
    });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) {
      return;
    }

    if (event.pointerType === "touch") {
      if (!touchPointersRef.current.has(event.pointerId)) {
        return;
      }

      event.preventDefault();
      touchPointersRef.current.set(event.pointerId, relativePointerPoint(event, viewportElement));
      const gesture = touchGesture(activeTouchPoints(touchPointersRef.current));
      if (gesture) {
        const previous = touchGestureRef.current ?? gesture;
        const viewportSize = getElementSize(viewportElement);
        const centerDelta = {
          x: gesture.center.x - previous.center.x,
          y: gesture.center.y - previous.center.y
        };
        const scaleFactor = previous.distance > 0 ? gesture.distance / previous.distance : 1;

        if (Math.abs(centerDelta.x) > 2 || Math.abs(centerDelta.y) > 2 || Math.abs(gesture.distance - previous.distance) > 2) {
          suppressTileClickBriefly();
        }

        setViewport((current) => {
          const panned = panViewport(current, centerDelta, viewportSize, contentSize);
          return zoomAtPoint(panned, gesture.center, panned.scale * scaleFactor, viewportSize, contentSize);
        });
        touchGestureRef.current = gesture;
        return;
      }
    }

    if (!dragStart) {
      return;
    }

    event.preventDefault();
    const point = relativePointerPoint(event, viewportElement);
    if (event.pointerType === "touch" && Math.hypot(point.x - dragStart.x, point.y - dragStart.y) > 8) {
      suppressTileClickBriefly();
    }

    setViewport((current) => clampViewport(
      {
        ...current,
        x: dragStart.originX + point.x - dragStart.x,
        y: dragStart.originY + point.y - dragStart.y
      },
      getElementSize(viewportElement),
      contentSize
    ));
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") {
      touchPointersRef.current.delete(event.pointerId);
      touchGestureRef.current = touchGesture(activeTouchPoints(touchPointersRef.current));
    }
    setDragStart(null);
  };

  return (
    <section
      ref={viewportRef}
      className="map-viewport"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <div
        className="map-canvas"
        style={{
          width: mapWidth,
          height: mapHeight,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`
        }}
      >
        <div
          className="tile-grid"
          style={{
            gridTemplateColumns: `repeat(${layout.columns}, ${layout.tileWidth}px)`,
            gridTemplateRows: `repeat(${layout.rows}, ${layout.tileHeight}px)`,
            columnGap: layout.columnGap,
            rowGap: layout.rowGap
          }}
        >
          {layout.tiles.map((tile) => (
            <BreedTile
              key={tile.breedId}
              tile={tile}
              game={game}
              onSelect={selectTile}
              opponentBreedId={opponentBreedId}
              opponentScore={opponentScore}
            />
          ))}
        </div>
        {arc ? (
          <svg className="arc-layer" width={mapWidth} height={mapHeight}>
            <path d={arc.path} className={arc.loop ? "arc loop" : "arc"} />
            <text x={arc.labelX} y={arc.labelY} className="arc-label">{arc.label}</text>
          </svg>
        ) : null}
        {opponentArc ? (
          <svg className="arc-layer opponent-arc-layer" width={mapWidth} height={mapHeight}>
            <path d={opponentArc.path} className={opponentArc.loop ? "arc opponent-arc loop" : "arc opponent-arc"} />
            <text x={opponentArc.labelX} y={opponentArc.labelY} className="arc-label opponent-arc-label">{opponentArc.label}</text>
          </svg>
        ) : null}
      </div>
    </section>
  );
}

type TouchGesture = {
  center: Point;
  distance: number;
};

function relativePointerPoint(event: ReactPointerEvent<HTMLElement>, element: HTMLElement): Point {
  const rect = element.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function activeTouchPoints(pointsByPointer: Map<number, Point>): Point[] {
  return [...pointsByPointer.values()];
}

function touchGesture(points: Point[]): TouchGesture | null {
  if (points.length < 2) {
    return null;
  }

  const [first, second] = points;
  return {
    center: {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2
    },
    distance: Math.hypot(second.x - first.x, second.y - first.y)
  };
}

function BreedTile({
  tile,
  game,
  onSelect,
  opponentBreedId = null,
  opponentScore = null
}: {
  tile: MapTile;
  game: GameViewState;
  onSelect: (breedId: BreedId) => void;
  opponentBreedId?: BreedId | null;
  opponentScore?: number | null;
}) {
  const round = game.round;
  const selected = round?.selectedBreedId === tile.breedId;
  const answer = round?.answerBreed?.id === tile.breedId;
  const guess = round?.guessBreed?.id === tile.breedId;
  const opponent = opponentBreedId === tile.breedId;
  const score = round?.score ?? 0;
  const revealed = game.status === "revealed";
  const submittedOwnGuess = guess && !revealed;
  const className = [
    "breed-tile",
    selected ? "selected" : "",
    revealed ? "muted" : "",
    answer ? "answer" : "",
    guess ? "guess" : "",
    opponent ? "opponent" : ""
  ].join(" ");

  return (
    <button
      className={className}
      style={{
        background: submittedOwnGuess && !answer ? "#71717a" : guess && !answer ? scoreGradient(score) : opponent && !answer ? "#71717a" : tile.color,
        gridColumn: tile.gridColumn,
        gridRow: tile.gridRow
      }}
      title={tile.label}
      onClick={() => onSelect(tile.breedId)}
    >
      <span>{tile.label}</span>
      {opponent && opponentScore !== null && revealed ? <small className="opponent-tile-score">+{opponentScore}</small> : null}
    </button>
  );
}

function FinalScreen({ game, onHome }: { game: GameViewState; onHome: () => void }) {
  const ratio = game.totalScore / game.maxScore;
  return (
    <main className="app final-screen">
      <section className="final-header">
        <div className="final-score-label">Итоговый счет</div>
        <h1>{game.totalScore} <span className="max-score">/ {game.maxScore}</span></h1>
        <div className="score-bar">
          <div style={{ width: `${ratio * 100}%`, background: scoreGradient(Math.round(ratio * 100)) }} />
        </div>
      </section>
      <section className="result-scroll">
        <div className="result-list">
          {game.history.map((result) => <RoundResultRow key={result.index} result={result} />)}
        </div>
        <button className="primary-button" onClick={onHome}>На главный экран</button>
      </section>
    </main>
  );
}

function RoundResultRow({ result }: { result: RoundResult }) {
  return (
    <article className="result-row">
      <div className="result-card correct-card">
        <h2>Правильный ответ</h2>
        <div className="result-image-wrapper">
          <img src={result.answerImage.url} alt={result.answerBreed.ru} />
        </div>
        <strong>{result.answerBreed.ru}</strong>
      </div>
      <div className="round-score">
        +{result.score}
      </div>
      <div className={`result-card guess-card ${!result.guessImage ? 'missed' : ''}`}>
        <h2>Ваш ответ</h2>
        <div className="result-image-wrapper">
          {result.guessImage ? <img src={result.guessImage.url} alt={result.guessBreed?.ru ?? ""} /> : <div className="empty-image">Время вышло</div>}
        </div>
        <strong>{result.guessBreed?.ru ?? "Нет ответа"}</strong>
      </div>
    </article>
  );
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreGradient(score: number): string {
  const hue = Math.round((clamp(score, 0, 100) / 100) * 120);
  return `hsl(${hue} 72% 48%)`;
}

function getArc(layout: GameViewState["map"], guess: MapTile, answer: MapTile, score: number) {
  const topCenter = (tile: MapTile) => ({
    x: (tile.gridColumn - 1) * (layout.tileWidth + layout.columnGap) + layout.tileWidth / 2,
    y: (tile.gridRow - 1) * (layout.tileHeight + layout.rowGap)
  });
  const start = topCenter(guess);
  const end = topCenter(answer);
  if (guess.breedId === answer.breedId) {
    return {
      loop: true,
      path: `M ${start.x} ${start.y} c -74 -96, 74 -96, 0 0`,
      labelX: start.x,
      labelY: start.y - 54,
      label: "+100!"
    };
  }
  const midX = (start.x + end.x) / 2;
  const midY = Math.min(start.y, end.y) - Math.max(96, Math.abs(start.x - end.x) * 0.18);
  return {
    loop: false,
    path: `M ${start.x} ${start.y} Q ${midX} ${midY} ${end.x} ${end.y}`,
    labelX: start.x,
    labelY: start.y - 54,
    label: `+${score}`
  };
}

function getTilesBounds(layout: GameViewState["map"], tiles: MapTile[]) {
  const points = tiles.map((tile) => {
    const x = (tile.gridColumn - 1) * (layout.tileWidth + layout.columnGap);
    const y = (tile.gridRow - 1) * (layout.tileHeight + layout.rowGap);
    return {
      left: x,
      top: y,
      right: x + layout.tileWidth,
      bottom: y + layout.tileHeight
    };
  });
  const left = Math.min(...points.map((point) => point.left));
  const top = Math.min(...points.map((point) => point.top));
  const right = Math.max(...points.map((point) => point.right));
  const bottom = Math.max(...points.map((point) => point.bottom));
  return {
    left,
    top,
    right,
    bottom
  };
}

function focusTile(layout: GameViewState["map"], tile: MapTile, viewportSize: Size, contentSize: Size): Viewport {
  const x = (tile.gridColumn - 1) * (layout.tileWidth + layout.columnGap);
  const y = (tile.gridRow - 1) * (layout.tileHeight + layout.rowGap);
  const scale = 1.08;
  return clampViewport(
    {
      scale,
      x: viewportSize.width / 2 - (x + layout.tileWidth / 2) * scale,
      y: viewportSize.height / 2 - (y + layout.tileHeight / 2) * scale
    },
    viewportSize,
    contentSize
  );
}

function getElementSize(element: HTMLElement): Size {
  return {
    width: element.clientWidth,
    height: element.clientHeight
  };
}
