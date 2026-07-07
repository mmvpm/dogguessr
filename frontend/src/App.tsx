import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api/client";
import { duelApi } from "./api/duel";
import type { DuelViewState, GameSettings, GameViewState } from "./api/types";
import { readSettings, saveSettings, useMediaQuery } from "./appSettings";
import { clearSavedMapViewport } from "./components/BreedMap";
import { DuelGameScreen } from "./components/DuelGameScreen";
import { type GalleryPhoto, type ImageScale } from "./components/GameChrome";
import { SoloGameScreen } from "./components/SoloGameScreen";
import { StartScreen } from "./components/StartScreen";

/** Coordinates restore, polling and mode selection while screens own their UI. */
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
    saveSettings(settings);
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
      <StartScreen
        settings={settings}
        onSettingsChange={setSettings}
        duelCode={duelCode}
        onDuelCode={setDuelCode}
        isStarting={isStarting}
        error={error}
        onStartGame={startGame}
        onCreateDuel={createDuel}
        onJoinDuel={joinDuel}
      />
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

  return (
    <SoloGameScreen
      game={soloGame}
      error={error}
      imageScale={imageScale}
      activePhoto={activePhoto}
      focusTarget={focusTarget}
      isMobile={isMobile}
      onRun={run}
      onHome={goHome}
      onFocusTarget={setFocusTarget}
      onFocusConsumed={() => setFocusTarget(null)}
      onImageScale={setImageScale}
      onActivePhoto={setActivePhoto}
    />
  );
}
