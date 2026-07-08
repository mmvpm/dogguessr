import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { BreedId, GameViewState, MapTile } from "../api/types";
import { formatMapTileLabel, useI18n } from "../i18n";
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
} from "../mapViewport";

const MAP_VIEWPORT_KEY = "dogguessr:mapViewport:v1";
const INITIAL_MAP_SCALE = 0.58;

/** Renders the interactive breed map, including viewport gestures and round overlays. */
export function BreedMap({
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
      // Preserve a restored reveal viewport; auto-fit would otherwise overwrite the saved map position.
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

    const parts = focusTarget.split(":");
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

        // Small threshold filters touch jitter; larger movement means the gesture was pan/zoom, not tile selection.
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
    // Touch drag can end with a click event on the starting tile; suppress it once the finger clearly moved.
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

/** Clears saved map viewport when a new game flow starts. */
export function clearSavedMapViewport(): void {
  localStorage.removeItem(MAP_VIEWPORT_KEY);
}

type TouchGesture = {
  center: Point;
  distance: number;
};

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
  const { locale } = useI18n();
  const label = formatMapTileLabel(tile, locale);
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
      title={label}
      onClick={() => onSelect(tile.breedId)}
    >
      <span>{label}</span>
      {opponent && opponentScore !== null && revealed ? <small className="opponent-tile-score">+{opponentScore}</small> : null}
    </button>
  );
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
