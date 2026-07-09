import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, CircleAlert, Clock3, List, Maximize2, Minimize2, Search, X } from "lucide-react";
import { api } from "../api/client";
import type { BreedId, BreedSuggestion, GameStatus, GameViewState, ImageRef, MapLegendItem, RoundResult } from "../api/types";
import { formatBreedName, formatLegendItem, useI18n } from "../i18n";

export type ImageScale = "small" | "normal" | "large";
export type GalleryPhoto = "answer" | "guess";

/** Lets the player search and pick a breed without knowing any screen state. */
export function BreedSearchBox({ onPick }: { onPick: (breedId: BreedId) => void }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<BreedSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);
  const { copy, locale } = useI18n();
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
          setError(caught instanceof Error ? caught.message : copy.search.error);
        })
        .finally(() => {
          if (requestIdRef.current === requestId) {
            setLoading(false);
          }
        });
    }, 220);

    return () => window.clearTimeout(timeoutId);
  }, [copy.search.error, query]);

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
        placeholder={copy.search.placeholder}
        aria-label={copy.search.placeholder}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {query ? (
        <button
          className="search-clear-button"
          type="button"
          title={copy.search.clear}
          aria-label={copy.search.clear}
          onMouseDown={(event) => event.preventDefault()}
          onClick={clearSearch}
        >
          <X size={18} />
        </button>
      ) : null}
      {listOpen ? (
        <div className="breed-suggestions" role="listbox">
          {loading ? <div className="breed-suggestion-state">{copy.search.loading}</div> : null}
          {error ? <div className="breed-suggestion-state error">{error}</div> : null}
          {!loading && !error && suggestions.length === 0 ? <div className="breed-suggestion-state">{copy.search.empty}</div> : null}
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
              <span>{formatBreedName(suggestion.breed, locale)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Shows the remaining round time and emits timeout when the frozen deadline is reached. */
export function Timer({ game, onTimeout }: { game: GameViewState; onTimeout: () => void }) {
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
    <div className={`timer ${remainingSeconds !== null && remainingSeconds <= 10 ? "danger" : ""}`}>
      <Clock3 size={22} />
      <span>{remainingSeconds === null ? "∞" : formatSeconds(remainingSeconds)}</span>
    </div>
  );
}

/** Displays the map color legend and owns its open/close interaction. */
export function BreedLegend({ items }: { items: MapLegendItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { copy } = useI18n();

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
        aria-label={copy.legend.title}
        title={copy.legend.title}
        onClick={() => setOpen((current) => !current)}
      >
        <List size={20} />
        <span>{copy.legend.label}</span>
      </button>
      {open ? (
        <div className="legend-popover">
          {items.map((item) => (
            <div className="legend-row" key={item.group}>
              <span className="legend-swatch" style={{ background: item.color }} />
              <span>{formatLegendItem(item, copy)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Shows the dog photo panel and switches answer/guess photos after reveal. */
export function DogGalleryPanel({
  phase,
  answerImage,
  guessImage,
  activePhoto,
  onActivePhotoChange,
  scale,
  isMobile,
  onScale,
  canReport,
  reportedImageIds,
  onReportPhoto
}: {
  phase: GameStatus;
  answerImage: ImageRef;
  guessImage: ImageRef | null;
  activePhoto: GalleryPhoto;
  onActivePhotoChange: (photo: GalleryPhoto) => void;
  scale: ImageScale;
  isMobile: boolean;
  onScale: (direction: "up" | "down") => void;
  canReport: boolean;
  reportedImageIds: Set<string>;
  onReportPhoto: (image: ImageRef, photo: GalleryPhoto) => void;
}) {
  const { copy } = useI18n();
  const hasGuess = phase === "revealed" && Boolean(guessImage);
  const visiblePhoto: GalleryPhoto = hasGuess ? activePhoto : "answer";
  const visibleImage = visiblePhoto === "guess" && guessImage ? guessImage : answerImage;
  const title = phase === "revealed" ? (visiblePhoto === "guess" ? copy.common.yourAnswer : copy.common.correctAnswer) : copy.gallery.title;
  const reportDisabled = reportedImageIds.has(visibleImage.id);
  const togglePhoto = () => {
    if (!hasGuess) {
      return;
    }
    onActivePhotoChange(visiblePhoto === "answer" ? "guess" : "answer");
  };

  return (
    <aside className={`dog-panel right scale-${scale}`}>
      <div className="dog-panel-header">
        {canReport ? (
          <button
            className="photo-report-button"
            title={reportDisabled ? copy.gallery.reported : copy.gallery.report}
            aria-label={reportDisabled ? copy.gallery.reported : copy.gallery.report}
            disabled={reportDisabled}
            onClick={() => onReportPhoto(visibleImage, visiblePhoto)}
          >
            <CircleAlert size={18} />
          </button>
        ) : null}
        <div className="gallery-tabs">
          {phase === "revealed" ? (
            <>
              <button
                className={visiblePhoto === "answer" ? "active" : ""}
                onClick={() => onActivePhotoChange("answer")}
              >
                {copy.common.correctAnswer}
              </button>
              {hasGuess ? (
                <button
                  className={visiblePhoto === "guess" ? "active" : ""}
                  onClick={() => onActivePhotoChange("guess")}
                >
                  {copy.common.yourAnswer}
                </button>
              ) : null}
            </>
          ) : (
            <span>{title}</span>
          )}
        </div>
        <div className="icon-actions">
          <button title={copy.gallery.expand} disabled={isMobile && scale === "normal"} onClick={() => onScale("up")}><Maximize2 size={18} /></button>
          <button title={copy.gallery.shrink} onClick={() => onScale("down")}><Minimize2 size={18} /></button>
        </div>
      </div>
      <div className="dog-image-wrap">
        {hasGuess ? (
          <>
            <button className="gallery-arrow left" title={copy.gallery.previous} onClick={togglePhoto}>
              <ChevronLeft size={30} />
            </button>
            <button className="gallery-arrow right" title={copy.gallery.next} onClick={togglePhoto}>
              <ChevronRight size={30} />
            </button>
          </>
        ) : null}
        <img src={visibleImage.url} alt={title} />
      </div>
    </aside>
  );
}

/** Renders the solo final score and per-round result list. */
export function FinalScreen({ game, onHome }: { game: GameViewState; onHome: () => void }) {
  const ratio = game.totalScore / game.maxScore;
  const { copy } = useI18n();
  return (
    <main className="app final-screen">
      <section className="final-header">
        <div className="final-score-label">{copy.final.totalScore}</div>
        <h1>{game.totalScore} <span className="max-score">/ {game.maxScore}</span></h1>
        <div className="score-bar">
          <div style={{ width: `${ratio * 100}%`, background: scoreGradient(Math.round(ratio * 100)) }} />
        </div>
      </section>
      <section className="result-scroll">
        <div className="result-list">
          {game.history.map((result) => <RoundResultRow key={result.index} result={result} />)}
        </div>
        <button className="primary-button" onClick={onHome}>{copy.common.home}</button>
      </section>
    </main>
  );
}

function RoundResultRow({ result }: { result: RoundResult }) {
  const { copy, locale } = useI18n();
  return (
    <article className="result-row">
      <div className="result-card correct-card">
        <h2>{copy.common.correctAnswer}</h2>
        <div className="result-image-wrapper">
          <img src={result.answerImage.url} alt={formatBreedName(result.answerBreed, locale)} />
        </div>
        <strong>{formatBreedName(result.answerBreed, locale)}</strong>
      </div>
      <div className="round-score">
        +{result.score}
      </div>
      <div className={`result-card guess-card ${!result.guessImage ? "missed" : ""}`}>
        <h2>{copy.common.yourAnswer}</h2>
        <div className="result-image-wrapper">
          {result.guessImage ? <img src={result.guessImage.url} alt={result.guessBreed ? formatBreedName(result.guessBreed, locale) : ""} /> : <div className="empty-image">{copy.common.timeOut}</div>}
        </div>
        <strong>{result.guessBreed ? formatBreedName(result.guessBreed, locale) : copy.common.noAnswer}</strong>
      </div>
    </article>
  );
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function scoreGradient(score: number): string {
  const hue = Math.round((clamp(score, 0, 100) / 100) * 120);
  return `hsl(${hue} 72% 48%)`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
