import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Clock3, Home, List, Maximize2, Minimize2, Search, X } from "lucide-react";
import { api } from "./api/client";
import type { BreedId, BreedSuggestion, GameSettings, GameStatus, GameViewState, MapLegendItem, MapTile, RoundResult } from "./api/types";
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
  const [error, setError] = useState<string | null>(null);
  const [imageScale, setImageScale] = useState<ImageScale>("normal");
  const [activePhoto, setActivePhoto] = useState<GalleryPhoto>("answer");
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [restoringGame, setRestoringGame] = useState(true);
  const isMobile = useMediaQuery("(max-width: 760px)");

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    api.restoreGame()
      .then((restored) => {
        if (!cancelled && restored) {
          setGame(restored);
        }
      })
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

  const startGame = () => {
    setImageScale("normal");
    setActivePhoto("answer");
    clearSavedMapViewport();
    void run(() => api.createGame(settings));
  };

  const goHome = () => {
    api.clearGame();
    clearSavedMapViewport();
    setFocusTarget(null);
    setImageScale("normal");
    setActivePhoto("answer");
    setGame(null);
  };

  if (restoringGame) {
    return <main className="app game-screen" />;
  }

  if (!game) {
    return (
      <main className="app start-screen">
        <StartBackground shift={START_BG_SHIFT} />
        <section className="start-panel">
          <h1 className="game-title">DogGuessr</h1>
          <p className="game-subtitle">Угадай породу собаки по фото</p>
          <button className="primary-button start-button" onClick={startGame}>Начать игру</button>
          <div className="settings-divider" />
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.unlimitedTime}
              onChange={(event) => setSettings((prev) => ({ ...prev, unlimitedTime: event.target.checked }))}
            />
            Неограниченное время
          </label>
          <label className="slider-row">
            <span>Секунд на вопрос</span>
            <strong>{settings.secondsPerRound}</strong>
            <input
              type="range"
              min="30"
              max="300"
              step="30"
              disabled={settings.unlimitedTime}
              value={settings.secondsPerRound}
              onChange={(event) => setSettings((prev) => ({ ...prev, secondsPerRound: Number(event.target.value) }))}
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
        </section>
        {error ? <div className="error-toast">{error}</div> : null}
      </main>
    );
  }

  if (game.status === "finished") {
    return <FinalScreen game={game} onHome={goHome} />;
  }

  const round = game.round;
  if (!round) {
    return null;
  }

  const selectBreed = (breedId: BreedId) => {
    if (game.status !== "guessing") {
      return;
    }
    void run(() => api.selectBreed(game.gameId, breedId));
  };

  const selectBreedFromSearch = (breedId: BreedId) => {
    if (game.status !== "guessing") {
      return;
    }
    setFocusTarget(`${game.gameId}:${round?.index}:${breedId}:${Date.now()}`);
    void run(() => api.selectBreed(game.gameId, breedId));
  };

  const submitGuess = () => void run(() => api.submitGuess(game.gameId));
  const nextRound = () => {
    setImageScale("normal");
    setActivePhoto("answer");
    void run(() => api.nextRound(game.gameId));
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
        game={game}
        onSelect={selectBreed}
        focusTarget={focusTarget}
        onFocusConsumed={() => setFocusTarget(null)}
      />
      <header className="hud">
        <div className="hud-left">
          <BreedLegend items={game.map.legend} />
          <div className="round-badge">
            <span className="round-label">Раунд</span>
            <span>{round.index}/{round.total}</span>
          </div>
          <Timer game={game} onTimeout={submitGuess} />
        </div>
        <div className="hud-center">
          {game.status === "guessing" ? <BreedSearchBox onPick={selectBreedFromSearch} /> : null}
        </div>
        <div className="hud-right">
          <div className="score">
            <span className="score-label">Счет</span>
            <span className="score-value">{game.totalScore}</span>
          </div>
          <button className="home-button" type="button" title="На главный экран" aria-label="На главный экран" onClick={goHome}>
            <Home size={22} />
          </button>
        </div>
      </header>
      <DogGalleryPanel
        phase={game.status}
        answerImageUrl={round.answerImage.url}
        guessImageUrl={round.guessImage?.url ?? null}
        activePhoto={activePhoto}
        onActivePhotoChange={setActivePhoto}
        scale={imageScale}
        isMobile={isMobile}
        onScale={changeImageScale}
      />
      {game.status === "guessing" && round.selectedBreedId ? (
        <button className="primary-button bottom-action" onClick={submitGuess}>Угадать</button>
      ) : null}
      {game.status === "revealed" ? (
        <button className="primary-button bottom-action" onClick={nextRound}>Дальше</button>
      ) : null}
      {error ? <div className="error-toast">{error}</div> : null}
    </main>
  );
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
  onFocusConsumed
}: {
  game: GameViewState;
  onSelect: (breedId: BreedId) => void;
  focusTarget: string | null;
  onFocusConsumed: () => void;
}) {
  const viewportRef = useRef<HTMLElement | null>(null);
  const fittedRoundRef = useRef<string | null>(null);
  const consumedFocusTargetRef = useRef<string | null>(null);
  const initializedViewportRef = useRef<string | null>(null);
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
  const selectedTile = round?.selectedBreedId ? tileByBreed.get(round.selectedBreedId) : null;
  const arc = answerTile && guessTile ? getArc(layout, guessTile, answerTile, round?.score ?? 0) : null;

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

    const tilesToFit = [guessTile, answerTile].filter((tile): tile is MapTile => Boolean(tile));
    if (tilesToFit.length === 0) {
      return;
    }

    const bounds = getTilesBounds(layout, tilesToFit);
    fittedRoundRef.current = fitKey;
    setViewport(fitBounds(bounds, viewportSize, contentSize));
  }, [answerTile, contentSize, game.gameId, game.status, guessTile, layout, round?.index]);

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement || game.status !== "guessing" || !focusTarget || consumedFocusTargetRef.current === focusTarget) {
      return;
    }

    const parts = focusTarget.split(':');
    if (parts.length < 3) {
      consumedFocusTargetRef.current = focusTarget;
      onFocusConsumed();
      return;
    }
    const breedId = parts[2];
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

  return (
    <section
      ref={viewportRef}
      className="map-viewport"
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest(".breed-tile")) {
          return;
        }
        const viewportElement = viewportRef.current;
        if (!viewportElement) {
          return;
        }
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragStart({
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          originX: viewport.x,
          originY: viewport.y
        });
      }}
      onPointerMove={(event) => {
        const viewportElement = viewportRef.current;
        if (!dragStart || !viewportElement) {
          return;
        }
        event.preventDefault();
        setViewport((current) => clampViewport(
          {
            ...current,
            x: dragStart.originX + event.clientX - dragStart.x,
            y: dragStart.originY + event.clientY - dragStart.y
          },
          getElementSize(viewportElement),
          contentSize
        ));
      }}
      onPointerUp={() => setDragStart(null)}
      onPointerCancel={() => setDragStart(null)}
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
              onSelect={onSelect}
            />
          ))}
        </div>
        {arc ? (
          <svg className="arc-layer" width={mapWidth} height={mapHeight}>
            <path d={arc.path} className={arc.loop ? "arc loop" : "arc"} />
            <text x={arc.labelX} y={arc.labelY} className="arc-label">{arc.label}</text>
          </svg>
        ) : null}
      </div>
    </section>
  );
}

function BreedTile({ tile, game, onSelect }: { tile: MapTile; game: GameViewState; onSelect: (breedId: BreedId) => void }) {
  const round = game.round;
  const selected = round?.selectedBreedId === tile.breedId;
  const answer = round?.answerBreed?.id === tile.breedId;
  const guess = round?.guessBreed?.id === tile.breedId;
  const score = round?.score ?? 0;
  const revealed = game.status === "revealed";
  const className = [
    "breed-tile",
    selected ? "selected" : "",
    revealed ? "muted" : "",
    answer ? "answer" : "",
    guess ? "guess" : ""
  ].join(" ");

  return (
    <button
      className={className}
      style={{
        background: guess && !answer ? scoreGradient(score) : tile.color,
        gridColumn: tile.gridColumn,
        gridRow: tile.gridRow
      }}
      title={tile.label}
      onClick={() => onSelect(tile.breedId)}
    >
      <span>{tile.label}</span>
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
