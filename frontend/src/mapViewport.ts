export type Viewport = {
  x: number;
  y: number;
  scale: number;
};

export type Point = {
  x: number;
  y: number;
};

export type Size = {
  width: number;
  height: number;
};

export type Bounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type WheelEventLike = {
  ctrlKey: boolean;
  deltaMode: number;
  deltaX: number;
  deltaY: number;
};

export type WheelIntent =
  | { kind: "pinchZoom"; deltaY: number }
  | { kind: "mouseWheelZoom"; direction: 1 | -1 }
  | { kind: "trackpadPan"; deltaX: number; deltaY: number }
  | { kind: "none" };

export const MAX_MAP_SCALE = 1.25;

const MIN_SCALE_PADDING = 0.94;
const FIT_PADDING = 190;
const MAX_PAN_MARGIN = 320;
const MIN_PAN_MARGIN = 160;

export function getMinScale(viewportSize: Size, contentSize: Size): number {
  return Math.min(
    1,
    Math.min(viewportSize.width / contentSize.width, viewportSize.height / contentSize.height) * MIN_SCALE_PADDING
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampViewport(viewport: Viewport, viewportSize: Size, contentSize: Size): Viewport {
  const scale = clamp(viewport.scale, getMinScale(viewportSize, contentSize), MAX_MAP_SCALE);
  const scaledWidth = contentSize.width * scale;
  const scaledHeight = contentSize.height * scale;
  const margin = getPanMargin(viewportSize);

  return {
    scale,
    x: clampAxis(viewport.x, viewportSize.width, scaledWidth, margin),
    y: clampAxis(viewport.y, viewportSize.height, scaledHeight, margin)
  };
}

export function panViewport(viewport: Viewport, delta: Point, viewportSize: Size, contentSize: Size): Viewport {
  return clampViewport(
    {
      ...viewport,
      x: viewport.x + delta.x,
      y: viewport.y + delta.y
    },
    viewportSize,
    contentSize
  );
}

export function zoomAtPoint(
  viewport: Viewport,
  point: Point,
  nextScale: number,
  viewportSize: Size,
  contentSize: Size
): Viewport {
  const scale = clamp(nextScale, getMinScale(viewportSize, contentSize), MAX_MAP_SCALE);
  const mapX = (point.x - viewport.x) / viewport.scale;
  const mapY = (point.y - viewport.y) / viewport.scale;

  return clampViewport(
    {
      scale,
      x: point.x - mapX * scale,
      y: point.y - mapY * scale
    },
    viewportSize,
    contentSize
  );
}

export function fitBounds(bounds: Bounds, viewportSize: Size, contentSize: Size): Viewport {
  const boundsWidth = Math.max(1, bounds.right - bounds.left);
  const boundsHeight = Math.max(1, bounds.bottom - bounds.top);
  const availableWidth = Math.max(1, viewportSize.width - FIT_PADDING * 2);
  const availableHeight = Math.max(1, viewportSize.height - FIT_PADDING * 2);
  const scale = clamp(
    Math.min(0.95, availableWidth / boundsWidth, availableHeight / boundsHeight),
    getMinScale(viewportSize, contentSize),
    MAX_MAP_SCALE
  );

  return clampViewport(
    {
      scale,
      x: viewportSize.width / 2 - ((bounds.left + bounds.right) / 2) * scale,
      y: viewportSize.height / 2 - ((bounds.top + bounds.bottom) / 2) * scale
    },
    viewportSize,
    contentSize
  );
}

export function classifyWheel(event: WheelEventLike): WheelIntent {
  if (event.ctrlKey) {
    return { kind: "pinchZoom", deltaY: event.deltaY };
  }

  if (event.deltaY === 0 && event.deltaX === 0) {
    return { kind: "none" };
  }

  if (event.deltaMode !== 0) {
    return { kind: "mouseWheelZoom", direction: event.deltaY < 0 ? 1 : -1 };
  }

  if (Math.abs(event.deltaX) < 1 && isDiscreteWheelDelta(Math.abs(event.deltaY))) {
    return { kind: "mouseWheelZoom", direction: event.deltaY < 0 ? 1 : -1 };
  }

  return { kind: "trackpadPan", deltaX: event.deltaX, deltaY: event.deltaY };
}

export function pinchScaleFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.003);
}

function getPanMargin(viewportSize: Size): number {
  return Math.min(MAX_PAN_MARGIN, Math.max(MIN_PAN_MARGIN, viewportSize.width * 0.25));
}

function clampAxis(position: number, viewportLength: number, scaledContentLength: number, margin: number): number {
  if (scaledContentLength <= viewportLength) {
    const centered = (viewportLength - scaledContentLength) / 2;
    return clamp(position, centered - margin, centered + margin);
  }
  return clamp(position, viewportLength - scaledContentLength - margin, margin);
}

function isDiscreteWheelDelta(absDeltaY: number): boolean {
  if (absDeltaY < 80) {
    return false;
  }

  return (
    Math.abs(absDeltaY - 100) < 1 ||
    Math.abs(absDeltaY - 120) < 1 ||
    Math.abs(absDeltaY % 100) < 1 ||
    Math.abs(absDeltaY % 120) < 1
  );
}
