import { useEffect, useState } from "react";
import type { GameSettings } from "./api/types";

const SETTINGS_KEY = "dogguessr:settings:v1";

export const DEFAULT_SETTINGS: GameSettings = {
  unlimitedTime: false,
  secondsPerRound: 3 * 60,
  roundCount: 10
};

/** Reads persisted start-screen settings and clamps them to the supported UI range. */
export function readSettings(): GameSettings {
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

/** Persists start-screen settings exactly where the previous single-file app stored them. */
export function saveSettings(settings: GameSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/** Tracks one CSS media query for layout decisions that are mirrored in React state. */
export function useMediaQuery(query: string): boolean {
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
