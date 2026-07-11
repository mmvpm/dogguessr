import { beforeAll, describe, expect, it } from "vitest";

declare const process: { cwd(): string };

let css = "";

describe("styles behavior contracts", () => {
  beforeAll(async () => {
    const fsModule = "node:fs/promises";
    const { readFile } = await import(fsModule);
    css = String(await readFile(`${process.cwd()}/src/styles.css`, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  });

  it("keeps design tokens that define the dark glass UI language", () => {
    expect(css).toContain("--bg-base: #09090b");
    expect(css).toContain("--bg-panel: rgba(24, 24, 27, 0.65)");
    expect(css).toContain("--accent: #10b981");
    expect(css).toContain("--danger: #ef4444");
    expect(css).toContain("--panel-blur: blur(20px)");
    expect(css).toContain("--shadow-float: 0 12px 40px rgba(0, 0, 0, 0.5)");
    expect(css).toContain("--radius-xl: 24px");
  });

  it("keeps start screen centered over a covered background image", () => {
    expectRule(".start-screen", {
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      overflow: "hidden"
    });
    expectRule(".start-background", {
      position: "absolute",
      inset: "0",
      "z-index": "0"
    });
    expectRule(".start-background img", {
      width: "100%",
      height: "100%",
      "object-fit": "cover",
      filter: "brightness(0.7) contrast(1.1)"
    });
    expectRule(".start-panel", {
      width: "min(460px, calc(100vw - 48px))",
      background: "var(--bg-panel)",
      "backdrop-filter": "var(--panel-blur)",
      "border-radius": "var(--radius-xl)",
      "box-shadow": "var(--shadow-float)"
    });
  });

  it("keeps game HUD fixed above the map with three regions and click-through container", () => {
    expectRule(".game-screen", {
      position: "relative",
      overflow: "hidden"
    });
    expectRule(".hud", {
      position: "fixed",
      inset: "24px 28px auto 28px",
      "z-index": "40",
      display: "grid",
      "grid-template-columns": "1fr auto 1fr",
      "pointer-events": "none"
    });
    expectRule(".hud-left", {
      "justify-self": "start",
      "pointer-events": "auto",
      display: "flex"
    });
    expectRule(".hud-center", {
      "justify-self": "center",
      "pointer-events": "auto"
    });
    expectRule(".hud-right", {
      "justify-self": "end",
      "pointer-events": "auto",
      display: "flex"
    });
  });

  it("keeps map viewport, canvas, tile grid, and revealed arc layering stable", () => {
    expectRule(".map-viewport", {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
      "touch-action": "none",
      "overscroll-behavior": "contain",
      background: "radial-gradient(circle at center, #18181b 0%, #09090b 100%)"
    });
    expectRule(".map-canvas", {
      position: "absolute",
      left: "0",
      top: "0",
      "transform-origin": "0 0",
      "will-change": "transform"
    });
    expectRule(".tile-grid", {
      position: "absolute",
      inset: "0",
      display: "grid"
    });
    expectRule(".breed-tile", {
      "border-radius": "var(--radius-sm)",
      display: "flex",
      "font-size": "13px",
      "font-weight": "800",
      overflow: "hidden"
    });
    expectRule(".arc-layer", {
      "pointer-events": "none",
      overflow: "visible",
      "z-index": "20"
    });
    expectRule(".opponent-arc-layer", {
      "z-index": "19"
    });
  });

  it("keeps dog panel fixed, scalable, and image-contained", () => {
    expectRule(".dog-panel", {
      position: "fixed",
      "z-index": "35",
      bottom: "24px",
      background: "var(--bg-panel)",
      "border-radius": "var(--radius-xl)",
      display: "flex"
    });
    expectRule(".dog-panel.right", {
      right: "24px"
    });
    expectRule(".dog-panel.scale-small", {
      width: "min(30vw, 380px)",
      height: "22vh",
      "min-width": "280px",
      "min-height": "200px"
    });
    expectRule(".dog-panel.scale-normal", {
      width: "min(40vw, 520px)",
      height: "45vh",
      "min-width": "360px"
    });
    expectRule(".dog-panel.scale-large", {
      width: "min(60vw, 800px)",
      height: "70vh",
      "min-width": "480px"
    });
    expectRule(".dog-image-wrap img", {
      width: "100%",
      height: "100%",
      "object-fit": "contain",
      display: "block"
    });
  });

  it("keeps bottom action overlay centered above map and disabled state visually distinct", () => {
    expectRule(".bottom-action", {
      position: "fixed",
      left: "50%",
      bottom: "32px",
      transform: "translateX(-50%)",
      "z-index": "55",
      "min-width": "200px",
      "border-radius": "99px"
    });
    expectRule(".bottom-action-stack", {
      position: "fixed",
      left: "50%",
      bottom: "32px",
      transform: "translateX(-50%)",
      "z-index": "55",
      display: "flex",
      "flex-direction": "column"
    });
    expectRule(".bottom-action:disabled", {
      cursor: "default",
      opacity: "0.76",
      background: "#52525b",
      "box-shadow": "var(--shadow-sm)"
    });
    expectRule(".opponent-ready-note", {
      "border-radius": "99px",
      "font-size": "13px",
      "font-weight": "700"
    });
  });

  it("keeps duel overlays above gameplay with blocking, countdown, pressure, and win effect layers", () => {
    expectRule(".duel-blocking-overlay", {
      position: "fixed",
      inset: "0",
      "z-index": "90",
      display: "grid",
      "place-items": "center",
      "pointer-events": "auto",
      background: "rgba(0, 0, 0, 0.78)"
    });
    expectRule(".duel-countdown-overlay", {
      position: "fixed",
      inset: "0",
      "z-index": "90",
      display: "grid",
      "place-items": "center",
      "pointer-events": "auto",
      "backdrop-filter": "blur(8px)"
    });
    expectRule(".duel-pressure-flash", {
      position: "fixed",
      inset: "0",
      "z-index": "85",
      "pointer-events": "none",
      animation: "duel-red-flash 1.05s ease-out forwards"
    });
    expectRule(".duel-win-effect", {
      position: "fixed",
      inset: "0",
      "z-index": "70",
      "pointer-events": "none",
      animation: "duel-win-pulse 1.2s ease-out forwards"
    });
    expectKeyframes("duel-red-flash");
    expectKeyframes("duel-win-pulse");
    expectKeyframes("countdown-pop");
  });

  it("keeps final screens scrollable with prominent score and result card grids", () => {
    expectRule(".final-screen", {
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      overflow: "hidden",
      height: "100vh"
    });
    expectRule(".final-header h1", {
      "font-size": "clamp(72px, 14vh, 160px)",
      "font-weight": "900",
      "line-height": "1"
    });
    expectRule(".result-scroll", {
      width: "min(900px, 100%)",
      "flex": "1 1 auto",
      "overflow-y": "auto",
      "overflow-x": "hidden",
      display: "flex"
    });
    expectRule(".result-row", {
      display: "grid",
      "grid-template-columns": "1fr auto 1fr",
      gap: "24px",
      "border-radius": "var(--radius-xl)"
    });
    expectRule(".duel-result-row", {
      display: "grid",
      "grid-template-columns": "1fr 1.2fr 1fr",
      gap: "16px",
      "border-radius": "var(--radius-xl)"
    });
  });

  it("keeps mobile responsive contracts for HUD, dog panel, bottom action, and final rows", () => {
    const mobile = mediaBlock("@media (max-width: 760px)");
    expect(mobile).toContain("grid-template-areas:");
    expect(mobile).toContain("\"round timer search score home\"");
    expectRuleIn(mobile, ".app", {
      height: "100dvh"
    });
    expectRuleIn(mobile, ".start-menu-hud", {
      top: "calc(10px + env(safe-area-inset-top, 0px))",
      right: "10px",
      "border-radius": "14px"
    });
    expectRuleIn(mobile, ".start-menu-control", {
      width: "38px",
      height: "34px"
    });
    expectRuleIn(mobile, ".start-panel", {
      width: "min(360px, calc(100vw - 24px))",
      "max-height": "calc(100dvh - 68px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
      padding: "24px 18px",
      gap: "18px"
    });
    expectRuleIn(mobile, ".game-title", {
      "font-size": "clamp(2rem, 10.8vw, 2.7rem)",
      "letter-spacing": "0"
    });
    expectRuleIn(mobile, ".hud", {
      "--hud-square": "36px",
      inset: "10px 10px auto 10px",
      "grid-template-rows": "var(--hud-square)"
    });
    expectRuleIn(mobile, ".hud-left", {
      display: "contents"
    });
    expectRuleIn(mobile, ".map-legend", {
      display: "none"
    });
    expectRuleIn(mobile, ".breed-search", {
      width: "100%",
      height: "var(--hud-square)"
    });
    expectRuleIn(mobile, ".dog-panel.scale-normal", {
      left: "12px",
      width: "auto",
      height: "min(48dvh, 420px)",
      right: "12px"
    });
    expectRuleIn(mobile, ".bottom-action", {
      bottom: "calc(20px + env(safe-area-inset-bottom, 0px))",
      "min-width": "176px",
      "font-size": "18px"
    });
    expectRuleIn(mobile, ".bottom-action-stack", {
      bottom: "calc(20px + env(safe-area-inset-bottom, 0px))"
    });
    expectRuleIn(mobile, ".final-screen", {
      height: "100dvh"
    });
    expectRuleIn(mobile, ".result-row", {
      "grid-template-columns": "minmax(0, 1fr) auto minmax(0, 1fr)",
      gap: "8px",
      padding: "12px"
    });
    expectRuleIn(mobile, ".duel-result-row", {
      "grid-template-columns": "1fr",
      gap: "20px",
      padding: "16px"
    });
    expectRuleIn(mobile, ".error-toast", {
      bottom: "calc(20px + env(safe-area-inset-bottom, 0px))"
    });
  });
});

function expectRule(selector: string, declarations: Record<string, string>) {
  expectRuleIn(css, selector, declarations);
}

function expectRuleIn(source: string, selector: string, declarations: Record<string, string>) {
  const block = ruleBlock(source, selector);
  for (const [property, value] of Object.entries(declarations)) {
    expect(block).toContain(`${property}: ${value}`);
  }
}

function ruleBlock(source: string, selector: string): string {
  const blocks: string[] = [];
  const rulePattern = /([^{}@][^{}]*)\{([^{}]*)\}/g;
  for (const match of source.matchAll(rulePattern)) {
    const selectors = match[1].split(",").map((part) => part.trim());
    if (selectors.includes(selector)) {
      blocks.push(match[2]);
    }
  }
  if (!blocks.length) {
    throw new Error(`Missing CSS rule: ${selector}`);
  }
  return blocks.join(" ").replace(/\s+/g, " ").trim();
}

function mediaBlock(query: string): string {
  const start = css.indexOf(`${query} {`);
  if (start === -1) {
    throw new Error(`Missing media query: ${query}`);
  }
  return css.slice(start);
}

function expectKeyframes(name: string) {
  expect(css).toContain(`@keyframes ${name}`);
}
