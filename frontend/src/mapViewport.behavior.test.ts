import { describe, expect, it } from "vitest";
import {
  MAX_MAP_SCALE,
  clampViewport,
  classifyWheel,
  fitBounds,
  getMinScale,
  panViewport,
  zoomAtPoint,
  type Bounds,
  type Point,
  type Size,
  type Viewport
} from "./mapViewport";

declare const process: { cwd(): string };

type BreedMapLayout = {
  tileWidth: number;
  tileHeight: number;
  columnGap: number;
  rowGap: number;
  columns: number;
  rows: number;
  tiles: BreedMapTile[];
};

type BreedMapTile = {
  breedId: string;
  label: string;
  gridColumn: number;
  gridRow: number;
};

describe("map viewport geometry contracts", () => {
  const contentSize: Size = { width: 3000, height: 2200 };

  it("computes min scale with the current 0.94 full-map padding and never above 1", () => {
    expect(getMinScale({ width: 1000, height: 800 }, contentSize)).toBeCloseTo((1000 / 3000) * 0.94, 12);
    expect(getMinScale({ width: 1600, height: 600 }, contentSize)).toBeCloseTo((600 / 2200) * 0.94, 12);
    expect(getMinScale({ width: 5000, height: 5000 }, contentSize)).toBe(1);
  });

  it("clamps scale to min and max before clamping position", () => {
    const viewportSize: Size = { width: 1000, height: 800 };
    const minScale = getMinScale(viewportSize, contentSize);

    expect(clampViewport({ x: 0, y: 0, scale: 0.01 }, viewportSize, contentSize).scale).toBe(minScale);
    expect(clampViewport({ x: 0, y: 0, scale: 99 }, viewportSize, contentSize).scale).toBe(MAX_MAP_SCALE);
  });

  it("uses width-based overscroll margins for large content", () => {
    const largeContent: Size = { width: 3000, height: 2200 };

    expect(clampViewport({ x: 9999, y: 9999, scale: 1 }, { width: 500, height: 400 }, largeContent)).toMatchObject({
      x: 160,
      y: 160
    });
    expect(clampViewport({ x: 9999, y: 9999, scale: 1 }, { width: 1000, height: 800 }, largeContent)).toMatchObject({
      x: 250,
      y: 250
    });
    expect(clampViewport({ x: 9999, y: 9999, scale: 1 }, { width: 2000, height: 1000 }, largeContent)).toMatchObject({
      x: 320,
      y: 320
    });
  });

  it("clamps both ends with overscroll margins when content is larger than the viewport", () => {
    const viewportSize: Size = { width: 1000, height: 800 };
    const result = clampViewport({ x: -9999, y: -9999, scale: 1 }, viewportSize, contentSize);

    expect(result.x).toBe(1000 - 3000 - 250);
    expect(result.y).toBe(800 - 2200 - 250);
  });

  it("keeps smaller content centered but allows the same bounded overscroll", () => {
    const viewportSize: Size = { width: 1000, height: 800 };
    const smallContent: Size = { width: 400, height: 200 };
    const centeredX = (viewportSize.width - smallContent.width) / 2;
    const centeredY = (viewportSize.height - smallContent.height) / 2;

    expect(clampViewport({ x: 9999, y: 9999, scale: 1 }, viewportSize, smallContent)).toMatchObject({
      x: centeredX + 250,
      y: centeredY + 250
    });
    expect(clampViewport({ x: -9999, y: -9999, scale: 1 }, viewportSize, smallContent)).toMatchObject({
      x: centeredX - 250,
      y: centeredY - 250
    });
  });

  it("pans by screen delta and then clamps to the current viewport envelope", () => {
    const viewportSize: Size = { width: 1000, height: 800 };

    expect(panViewport({ x: -300, y: -200, scale: 1 }, { x: 125, y: -75 }, viewportSize, contentSize)).toEqual({
      x: -175,
      y: -275,
      scale: 1
    });
    expect(panViewport({ x: 200, y: 200, scale: 1 }, { x: 200, y: 200 }, viewportSize, contentSize)).toMatchObject({
      x: 250,
      y: 250
    });
  });

  it("keeps the map coordinate under the cursor when zooming away from clamps", () => {
    const before: Viewport = { x: -520, y: -340, scale: 0.8 };
    const cursor: Point = { x: 430, y: 290 };
    const expected = mapPoint(before, cursor);
    const after = zoomAtPoint(before, cursor, 1.05, { width: 1000, height: 800 }, contentSize);

    expect(mapPoint(after, cursor).x).toBeCloseTo(expected.x, 8);
    expect(mapPoint(after, cursor).y).toBeCloseTo(expected.y, 8);
  });

  it("clamps zoomAtPoint at min and max scale", () => {
    const viewportSize: Size = { width: 1000, height: 800 };
    const before: Viewport = { x: -520, y: -340, scale: 0.8 };

    expect(zoomAtPoint(before, { x: 430, y: 290 }, 99, viewportSize, contentSize).scale).toBe(MAX_MAP_SCALE);
    expect(zoomAtPoint(before, { x: 430, y: 290 }, 0.01, viewportSize, contentSize).scale).toBe(
      getMinScale(viewportSize, contentSize)
    );
  });
});

describe("fitBounds behavior", () => {
  const contentSize: Size = { width: 3000, height: 2200 };

  it("uses 190px padding but caps close bounds at 0.95 scale", () => {
    const viewportSize: Size = { width: 1000, height: 800 };
    const bounds: Bounds = { left: 900, top: 700, right: 1060, bottom: 740 };
    const result = fitBounds(bounds, viewportSize, contentSize);

    expect(result.scale).toBe(0.95);
    expect(screenPoint(result, { x: 980, y: 720 })).toEqual({ x: 500, y: 400 });
  });

  it("zooms out for far-apart bounds so all requested tiles are visible", () => {
    const viewportSize: Size = { width: 1000, height: 800 };
    const bounds: Bounds = { left: 0, top: 0, right: 3000, bottom: 2200 };
    const result = fitBounds(bounds, viewportSize, contentSize);
    const minScale = getMinScale(viewportSize, contentSize);

    expect(result.scale).toBe(minScale);
    expect(projectBounds(result, bounds).left).toBeGreaterThanOrEqual(-250);
    expect(projectBounds(result, bounds).right).toBeLessThanOrEqual(viewportSize.width + 250);
  });

  it("falls back to the min scale on a viewport smaller than the fit padding", () => {
    const viewportSize: Size = { width: 320, height: 240 };
    const result = fitBounds({ left: 900, top: 700, right: 1060, bottom: 740 }, viewportSize, contentSize);

    expect(result.scale).toBe(getMinScale(viewportSize, contentSize));
  });
});

describe("wheel intent classification", () => {
  it("treats ctrl-wheel as pinch zoom even for zero deltas", () => {
    expect(classifyWheel({ ctrlKey: true, deltaMode: 0, deltaX: 0, deltaY: 0 })).toEqual({
      kind: "pinchZoom",
      deltaY: 0
    });
  });

  it("keeps zero non-ctrl wheel events inert", () => {
    expect(classifyWheel({ ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: 0 })).toEqual({ kind: "none" });
  });

  it("classifies non-pixel wheel modes as mouse-wheel zoom", () => {
    expect(classifyWheel({ ctrlKey: false, deltaMode: 1, deltaX: 20, deltaY: -3 })).toEqual({
      kind: "mouseWheelZoom",
      direction: 1
    });
    expect(classifyWheel({ ctrlKey: false, deltaMode: 2, deltaX: 0, deltaY: 0 })).toEqual({ kind: "none" });
  });

  it("uses discrete high pixel deltas as mouse wheel and smaller or horizontal deltas as trackpad pan", () => {
    expect(classifyWheel({ ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: -100 })).toEqual({
      kind: "mouseWheelZoom",
      direction: 1
    });
    expect(classifyWheel({ ctrlKey: false, deltaMode: 0, deltaX: 0.5, deltaY: 119.5 })).toEqual({
      kind: "mouseWheelZoom",
      direction: -1
    });
    expect(classifyWheel({ ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: 79.9 })).toEqual({
      kind: "trackpadPan",
      deltaX: 0,
      deltaY: 79.9
    });
    expect(classifyWheel({ ctrlKey: false, deltaMode: 0, deltaX: 1, deltaY: 120 })).toEqual({
      kind: "trackpadPan",
      deltaX: 1,
      deltaY: 120
    });
  });
});

describe("touch gesture math contract", () => {
  it("derives center and distance from the first two active touch points", () => {
    const gesture = touchGesture([
      { x: 100, y: 120 },
      { x: 340, y: 360 },
      { x: 900, y: 900 }
    ]);

    expect(gesture).toEqual({
      center: { x: 220, y: 240 },
      distance: Math.hypot(240, 240)
    });
  });

  it("applies two-finger movement as pan by center delta followed by zoom at the new center", () => {
    const viewportSize: Size = { width: 1000, height: 800 };
    const contentSize: Size = { width: 3000, height: 2200 };
    const current: Viewport = { x: -480, y: -320, scale: 0.8 };
    const previous = touchGesture([{ x: 100, y: 100 }, { x: 300, y: 100 }])!;
    const next = touchGesture([{ x: 130, y: 120 }, { x: 370, y: 120 }])!;
    const centerDelta = { x: next.center.x - previous.center.x, y: next.center.y - previous.center.y };
    const scaleFactor = next.distance / previous.distance;

    const panned = panViewport(current, centerDelta, viewportSize, contentSize);
    const transformed = zoomAtPoint(panned, next.center, panned.scale * scaleFactor, viewportSize, contentSize);

    expect(centerDelta).toEqual({ x: 50, y: 20 });
    expect(scaleFactor).toBe(1.2);
    expect(transformed.scale).toBeCloseTo(0.96, 12);
    expect(mapPoint(transformed, next.center)).toEqual(mapPoint(panned, next.center));
  });
});

describe("breed map tile geometry from breed_map.json", () => {
  it("locks current content dimensions from map layout fields", async () => {
    const map = await loadBreedMap();

    expect(contentSizeOf(map)).toEqual({ width: 2848, height: 3208 });
    expect(map.tiles).toHaveLength(389);
  });

  it("computes stable tile centers used by scoring and arc geometry", async () => {
    const map = await loadBreedMap();

    expect(tileCenter(map, tileById(map, "Affenpinscher"))).toEqual({ x: 1424, y: 2708 });
    expect(tileCenter(map, tileById(map, "Akita"))).toEqual({ x: 2600, y: 596 });
    expect(tileTopCenter(map, tileById(map, "American Foxhound"))).toEqual({ x: 80, y: 1344 });
  });

  it("computes fitting bounds over answer, guess, and opponent tiles", async () => {
    const map = await loadBreedMap();
    const bounds = tilesBounds(map, [
      tileById(map, "Affenpinscher"),
      tileById(map, "Akita"),
      tileById(map, "American Foxhound")
    ]);

    expect(bounds).toEqual({ left: 0, top: 576, right: 2680, bottom: 2728 });
  });

  it("focuses a searched tile at scale 1.08 before viewport clamping", async () => {
    const map = await loadBreedMap();
    const viewportSize: Size = { width: 1000, height: 800 };
    const focused = focusTileExpected(map, tileById(map, "Afghan Hound"), viewportSize, contentSizeOf(map));

    expect(focused).toEqual({ x: -856.48, y: -1954.4, scale: 1.08 });
    expect(screenPoint(focused, tileCenter(map, tileById(map, "Afghan Hound")))).toEqual({ x: 500, y: 400 });
  });

  it("fits revealed answer, guess, and opponent tiles with current padding and min-scale rules", async () => {
    const map = await loadBreedMap();
    const viewportSize: Size = { width: 1000, height: 800 };
    const bounds = tilesBounds(map, [
      tileById(map, "Affenpinscher"),
      tileById(map, "Akita"),
      tileById(map, "American Foxhound")
    ]);
    const viewport = fitBounds(bounds, viewportSize, contentSizeOf(map));

    expect(viewport.scale).toBe(getMinScale(viewportSize, contentSizeOf(map)));
    expect(projectBounds(viewport, bounds)).toEqual({
      left: 185.88528678304237,
      top: 147.7705735660848,
      right: 814.1147132169576,
      bottom: 652.2294264339153
    });
  });
});

describe("breed map arc geometry contract", () => {
  it("draws an exact-guess loop above the tile with the fixed success label", async () => {
    const map = await loadBreedMap();
    const tile = tileById(map, "Affenpinscher");

    expect(arcExpected(map, tile, tile, 100)).toEqual({
      loop: true,
      path: "M 1424 2688 c -74 -96, 74 -96, 0 0",
      labelX: 1424,
      labelY: 2634,
      label: "+100!"
    });
  });

  it("draws a quadratic arc from guess top-center to answer top-center and labels it at the guess", async () => {
    const map = await loadBreedMap();
    const guess = tileById(map, "Akita");
    const answer = tileById(map, "Affenpinscher");

    expect(arcExpected(map, guess, answer, 42)).toEqual({
      loop: false,
      path: "M 2600 576 Q 2012 364.32000000000005 1424 2688",
      labelX: 2600,
      labelY: 522,
      label: "+42"
    });
  });
});

function mapPoint(viewport: Viewport, point: Point): Point {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale
  };
}

function screenPoint(viewport: Viewport, point: Point): Point {
  return {
    x: viewport.x + point.x * viewport.scale,
    y: viewport.y + point.y * viewport.scale
  };
}

function projectBounds(viewport: Viewport, bounds: Bounds): Bounds {
  return {
    left: viewport.x + bounds.left * viewport.scale,
    top: viewport.y + bounds.top * viewport.scale,
    right: viewport.x + bounds.right * viewport.scale,
    bottom: viewport.y + bounds.bottom * viewport.scale
  };
}

async function loadBreedMap(): Promise<BreedMapLayout> {
  const fsModule = "node:fs/promises";
  const { readFile } = await import(fsModule);
  return JSON.parse(await readFile(`${process.cwd()}/../breed_map.json`, "utf8")) as BreedMapLayout;
}

function contentSizeOf(map: BreedMapLayout): Size {
  return {
    width: map.columns * map.tileWidth + (map.columns - 1) * map.columnGap,
    height: map.rows * map.tileHeight + (map.rows - 1) * map.rowGap
  };
}

function tileById(map: BreedMapLayout, breedId: string): BreedMapTile {
  const tile = map.tiles.find((candidate) => candidate.breedId === breedId);
  if (!tile) {
    throw new Error(`Missing tile ${breedId}`);
  }
  return tile;
}

function tileCenter(map: BreedMapLayout, tile: BreedMapTile): Point {
  return {
    x: (tile.gridColumn - 1) * (map.tileWidth + map.columnGap) + map.tileWidth / 2,
    y: (tile.gridRow - 1) * (map.tileHeight + map.rowGap) + map.tileHeight / 2
  };
}

function tileTopCenter(map: BreedMapLayout, tile: BreedMapTile): Point {
  return {
    x: (tile.gridColumn - 1) * (map.tileWidth + map.columnGap) + map.tileWidth / 2,
    y: (tile.gridRow - 1) * (map.tileHeight + map.rowGap)
  };
}

function tilesBounds(map: BreedMapLayout, tiles: BreedMapTile[]): Bounds {
  const points = tiles.map((tile) => {
    const x = (tile.gridColumn - 1) * (map.tileWidth + map.columnGap);
    const y = (tile.gridRow - 1) * (map.tileHeight + map.rowGap);
    return {
      left: x,
      top: y,
      right: x + map.tileWidth,
      bottom: y + map.tileHeight
    };
  });
  return {
    left: Math.min(...points.map((point) => point.left)),
    top: Math.min(...points.map((point) => point.top)),
    right: Math.max(...points.map((point) => point.right)),
    bottom: Math.max(...points.map((point) => point.bottom))
  };
}

function focusTileExpected(map: BreedMapLayout, tile: BreedMapTile, viewportSize: Size, contentSize: Size): Viewport {
  const x = (tile.gridColumn - 1) * (map.tileWidth + map.columnGap);
  const y = (tile.gridRow - 1) * (map.tileHeight + map.rowGap);
  const scale = 1.08;
  return clampViewport(
    {
      scale,
      x: viewportSize.width / 2 - (x + map.tileWidth / 2) * scale,
      y: viewportSize.height / 2 - (y + map.tileHeight / 2) * scale
    },
    viewportSize,
    contentSize
  );
}

function arcExpected(map: BreedMapLayout, guess: BreedMapTile, answer: BreedMapTile, score: number) {
  const start = tileTopCenter(map, guess);
  const end = tileTopCenter(map, answer);
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

function touchGesture(points: Point[]): { center: Point; distance: number } | null {
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
