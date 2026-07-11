import { useCallback, useEffect, useRef, useState } from "react";
import backgroundUrl from "../sounds/background.wav";
import clickUrl from "../sounds/click.wav";
import countdownUrl from "../sounds/countdown.wav";
import pressureUrl from "../sounds/pressure.wav";
import winUrl from "../sounds/win.wav";

const AUDIO_SETTINGS_KEY = "dogguessr:audio:v1";
const MUSIC_FADE_MS = 200;

export type SoundEffect = "click" | "countdown" | "win";

export type AudioSettings = {
  effectsEnabled: boolean;
  musicEnabled: boolean;
};

type MusicState = {
  isGameActive: boolean;
  musicEnabled: boolean;
  pressureKey: string | null;
};

const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  effectsEnabled: true,
  musicEnabled: true
};

const effectUrls: Record<SoundEffect, string> = {
  click: clickUrl,
  countdown: countdownUrl,
  win: winUrl
};

/** Reads the player's persisted effects and music choices. */
export function readAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(AUDIO_SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_AUDIO_SETTINGS;
    }
    const saved = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      effectsEnabled: typeof saved.effectsEnabled === "boolean" ? saved.effectsEnabled : DEFAULT_AUDIO_SETTINGS.effectsEnabled,
      musicEnabled: typeof saved.musicEnabled === "boolean" ? saved.musicEnabled : DEFAULT_AUDIO_SETTINGS.musicEnabled
    };
  } catch {
    localStorage.removeItem(AUDIO_SETTINGS_KEY);
    return DEFAULT_AUDIO_SETTINGS;
  }
}

/** Persists the player's effects and music choices without coupling them to game state. */
export function saveAudioSettings(settings: AudioSettings): void {
  try {
    localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Audio preferences are optional when storage is unavailable or full.
  }
}

/** Owns browser audio playback and exposes the two persistent menu toggles. */
export function useGameAudio({ isGameActive, pressureKey }: { isGameActive: boolean; pressureKey: string | null }) {
  const [settings, setSettings] = useState<AudioSettings>(() => readAudioSettings());
  const settingsRef = useRef(settings);
  const musicStateRef = useRef<MusicState>({ isGameActive, musicEnabled: settings.musicEnabled, pressureKey });
  const fadeTimersRef = useRef(new Map<HTMLAudioElement, number>());
  const activePressureKeyRef = useRef<string | null>(null);
  const completedPressureKeyRef = useRef<string | null>(null);
  const syncMusicRef = useRef<() => void>(() => undefined);

  settingsRef.current = settings;
  musicStateRef.current = { isGameActive, musicEnabled: settings.musicEnabled, pressureKey };

  useEffect(() => {
    saveAudioSettings(settings);
  }, [settings]);

  const playEffect = useCallback((effect: SoundEffect) => {
    if (!settingsRef.current.effectsEnabled || typeof Audio === "undefined") {
      return;
    }

    try {
      const audio = new Audio(effectUrls[effect]);
      audio.preload = "auto";
      void audio.play().catch(() => undefined);
    } catch {
      // Missing browser media support must never affect gameplay controls.
    }
  }, []);

  const toggleEffects = useCallback(() => {
    const next = { ...settingsRef.current, effectsEnabled: !settingsRef.current.effectsEnabled };
    settingsRef.current = next;
    setSettings(next);
  }, []);

  const toggleMusic = useCallback(() => {
    const next = { ...settingsRef.current, musicEnabled: !settingsRef.current.musicEnabled };
    settingsRef.current = next;
    setSettings(next);
  }, []);

  useEffect(() => {
    if (typeof Audio === "undefined") {
      return;
    }

    let background: HTMLAudioElement;
    let pressure: HTMLAudioElement;
    try {
      background = new Audio(backgroundUrl);
      pressure = new Audio(pressureUrl);
    } catch {
      return;
    }

    background.loop = true;
    background.preload = "auto";
    pressure.loop = false;
    pressure.preload = "auto";

    const cancelFade = (audio: HTMLAudioElement) => {
      const timer = fadeTimersRef.current.get(audio);
      if (timer !== undefined) {
        window.clearInterval(timer);
        fadeTimersRef.current.delete(audio);
      }
    };

    const fadeTo = (audio: HTMLAudioElement, targetVolume: number, onComplete?: () => void) => {
      cancelFade(audio);
      const startVolume = audio.volume;
      if (Math.abs(startVolume - targetVolume) < 0.01) {
        audio.volume = targetVolume;
        onComplete?.();
        return;
      }
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        const progress = Math.min(1, (Date.now() - startedAt) / MUSIC_FADE_MS);
        audio.volume = startVolume + (targetVolume - startVolume) * progress;
        if (progress === 1) {
          cancelFade(audio);
          onComplete?.();
        }
      }, 16);
      fadeTimersRef.current.set(audio, timer);
    };

    const play = (audio: HTMLAudioElement) => {
      void audio.play().catch(() => undefined);
    };

    const stop = (audio: HTMLAudioElement) => {
      cancelFade(audio);
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 1;
    };

    const resumeBackground = () => {
      if (background.paused) {
        background.volume = 0;
        play(background);
      }
      fadeTo(background, 1);
    };

    const fadeOutPressure = () => {
      fadeTo(pressure, 0, () => {
        pressure.pause();
        pressure.currentTime = 0;
        pressure.volume = 1;
      });
    };

    const syncMusic = () => {
      const state = musicStateRef.current;
      if (!state.musicEnabled || !state.isGameActive) {
        activePressureKeyRef.current = null;
        completedPressureKeyRef.current = null;
        stop(background);
        stop(pressure);
        return;
      }

      if (!state.pressureKey || completedPressureKeyRef.current === state.pressureKey) {
        activePressureKeyRef.current = null;
        if (!pressure.paused) {
          fadeOutPressure();
        }
        resumeBackground();
        return;
      }

      if (activePressureKeyRef.current === state.pressureKey) {
        return;
      }

      activePressureKeyRef.current = state.pressureKey;
      completedPressureKeyRef.current = null;
      fadeTo(background, 0, () => background.pause());
      stop(pressure);
      pressure.volume = 0;
      play(pressure);
      fadeTo(pressure, 1);
      const key = state.pressureKey;
      pressure.onended = () => {
        if (activePressureKeyRef.current !== key) {
          return;
        }
        activePressureKeyRef.current = null;
        completedPressureKeyRef.current = key;
        pressure.currentTime = 0;
        pressure.volume = 1;
        if (musicStateRef.current.musicEnabled && musicStateRef.current.isGameActive && musicStateRef.current.pressureKey === key) {
          resumeBackground();
        }
      };
    };

    syncMusicRef.current = syncMusic;
    syncMusic();

    return () => {
      syncMusicRef.current = () => undefined;
      pressure.onended = null;
      stop(background);
      stop(pressure);
    };
  }, []);

  useEffect(() => {
    syncMusicRef.current();
  }, [isGameActive, pressureKey, settings.musicEnabled]);

  useEffect(() => {
    const playButtonClick = (event: MouseEvent) => {
      const target = event.target;
      const button = target instanceof Element ? target.closest<HTMLButtonElement>("button") : null;
      if (!button || button.disabled) {
        return;
      }
      playEffect("click");
      // A click is also the next safe opportunity to retry media blocked by autoplay policy.
      syncMusicRef.current();
    };

    document.addEventListener("click", playButtonClick);
    return () => document.removeEventListener("click", playButtonClick);
  }, [playEffect]);

  return { settings, toggleEffects, toggleMusic, playEffect };
}
