import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api/client";
import { duelApi } from "./api/duel";
import { isFeedbackConfigured, sendFeedback, type FeedbackVisiblePhoto } from "./api/feedback";
import type { DuelViewState, GameSettings, GameViewState, ImageRef } from "./api/types";
import { readSettings, saveSettings, useMediaQuery } from "./appSettings";
import { clearSavedMapViewport } from "./components/BreedMap";
import { DuelGameScreen } from "./components/DuelGameScreen";
import { type GalleryPhoto, type ImageScale } from "./components/GameChrome";
import { SoloGameScreen } from "./components/SoloGameScreen";
import { StartScreen } from "./components/StartScreen";
import { detectInitialLocale, getMessages, I18nProvider, saveLocale, type Locale } from "./i18n";

/** Coordinates restore, polling and mode selection while screens own their UI. */
export function App() {
  const [locale, setLocale] = useState<Locale>(() => detectInitialLocale());
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
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [reportedImageIds, setReportedImageIds] = useState<Set<string>>(() => new Set());
  const flashedPressureRoundRef = useRef<string | null>(null);
  const isMobile = useMediaQuery("(max-width: 760px)");
  const feedbackEnabled = isFeedbackConfigured();

  const copy = getMessages(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = copy.meta.title;
    document.querySelector<HTMLMetaElement>("meta[name='description']")?.setAttribute("content", copy.meta.description);
    document.querySelector<HTMLMetaElement>("meta[property='og:title']")?.setAttribute("content", copy.meta.title);
    document.querySelector<HTMLMetaElement>("meta[property='og:description']")?.setAttribute("content", copy.meta.description);
  }, [copy, locale]);

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
          setError(caught instanceof Error ? caught.message : copy.toasts.unknownError);
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

  useEffect(() => {
    if (!successToast) {
      return;
    }
    const timeoutId = window.setTimeout(() => setSuccessToast(null), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [successToast]);

  const run = useCallback(async (action: () => Promise<GameViewState>) => {
    try {
      setError(null);
      setGame(await action());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.toasts.unknownError);
    }
  }, [copy.toasts.unknownError]);

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
      setError(caught instanceof Error ? caught.message : copy.toasts.unknownError);
    }
  }, [copy.toasts.unknownError]);

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
      setError(copy.toasts.roomCodeInvalid);
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

  const reportSoloPhoto = (image: ImageRef, visiblePhoto: FeedbackVisiblePhoto) => {
    if (!game?.round) {
      return;
    }
    setReportedImageIds((current) => new Set(current).add(image.id));
    void sendFeedback({
      kind: "bad_image",
      mode: "solo",
      gameId: game.gameId,
      roundIndex: game.round.index,
      phase: game.status,
      image,
      visiblePhoto,
      message: ""
    }).then(() => {
      setError(null);
      setSuccessToast(copy.toasts.reportSent);
    }).catch((caught) => {
      setReportedImageIds((current) => {
        const next = new Set(current);
        next.delete(image.id);
        return next;
      });
      setError(caught instanceof Error ? caught.message : copy.toasts.reportFailed);
    });
  };

  const reportDuelPhoto = (image: ImageRef, visiblePhoto: FeedbackVisiblePhoto) => {
    if (!duel?.round) {
      return;
    }
    setReportedImageIds((current) => new Set(current).add(image.id));
    void sendFeedback({
      kind: "bad_image",
      mode: "duel",
      gameId: duel.gameId,
      roundIndex: duel.round.index,
      phase: duel.status,
      image,
      visiblePhoto,
      message: ""
    }).then(() => {
      setError(null);
      setSuccessToast(copy.toasts.reportSent);
    }).catch((caught) => {
      setReportedImageIds((current) => {
        const next = new Set(current);
        next.delete(image.id);
        return next;
      });
      setError(caught instanceof Error ? caught.message : copy.toasts.reportFailed);
    });
  };

  const sendStartFeedback = (message: string) => {
    void sendFeedback({
      kind: "message",
      mode: "start",
      gameId: null,
      roundIndex: null,
      phase: null,
      image: null,
      visiblePhoto: null,
      message
    }).then(() => {
      setError(null);
      setSuccessToast(copy.toasts.messageSent);
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : copy.toasts.messageFailed);
    });
  };

  if (restoringGame) {
    return <main className="app game-screen" />;
  }

  const feedbackToast = successToast ? <div className="success-toast">{successToast}</div> : null;

  if (!game && !duel) {
    return (
      <I18nProvider locale={locale}>
        <StartScreen
          settings={settings}
          onSettingsChange={setSettings}
          locale={locale}
          onToggleLocale={() => setLocale((current) => {
            const next = current === "ru" ? "en" : "ru";
            saveLocale(next);
            return next;
          })}
          duelCode={duelCode}
          onDuelCode={setDuelCode}
          isStarting={isStarting}
          error={error}
          onStartGame={startGame}
          onCreateDuel={createDuel}
          onJoinDuel={joinDuel}
          canSendFeedback={feedbackEnabled}
          onSendFeedback={sendStartFeedback}
        />
        {feedbackToast}
      </I18nProvider>
    );
  }

  if (duel) {
    return (
      <I18nProvider locale={locale}>
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
          canReport={feedbackEnabled}
          reportedImageIds={reportedImageIds}
          onReportPhoto={reportDuelPhoto}
        />
        {feedbackToast}
      </I18nProvider>
    );
  }

  const soloGame = game;
  if (!soloGame) {
    return null;
  }

  return (
    <I18nProvider locale={locale}>
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
        canReport={feedbackEnabled}
        reportedImageIds={reportedImageIds}
        onReportPhoto={reportSoloPhoto}
      />
      {feedbackToast}
    </I18nProvider>
  );
}
