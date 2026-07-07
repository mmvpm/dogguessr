import { useEffect, useRef, useState } from "react";
import type { GameSettings } from "../api/types";
import startBackgroundUrl from "../assets/start-bg.jpg";

const START_BG_SHIFT = 0.5;

type Size = { width: number; height: number };

/** Renders the first screen and owns only its form controls. */
export function StartScreen({
  settings,
  onSettingsChange,
  duelCode,
  onDuelCode,
  isStarting,
  error,
  onStartGame,
  onCreateDuel,
  onJoinDuel
}: {
  settings: GameSettings;
  onSettingsChange: (settings: GameSettings) => void;
  duelCode: string;
  onDuelCode: (value: string) => void;
  isStarting: boolean;
  error: string | null;
  onStartGame: () => void;
  onCreateDuel: () => void;
  onJoinDuel: () => void;
}) {
  return (
    <main className="app start-screen">
      <StartBackground shift={START_BG_SHIFT} />
      <section className="start-panel">
        <div className="start-header">
          <h1 className="game-title">DogGuessr</h1>
          <p className="game-subtitle">Угадай породу собаки по фото</p>
        </div>
        <div className="start-actions">
          <button className="primary-button start-button" disabled={isStarting} onClick={onStartGame}>
            {isStarting ? <span className="spinner" /> : null}
            Одиночная игра
          </button>
          <div className="duel-section">
            <div className="duel-divider"><span>ДУЭЛЬ</span></div>
            <button className="primary-button duel-button" disabled={isStarting} onClick={onCreateDuel}>
              {isStarting ? <span className="spinner" /> : null}
              Создать комнату
            </button>
            <div className="duel-join-row">
              <input
                value={duelCode}
                maxLength={6}
                placeholder="Код комнаты"
                aria-label="Код комнаты"
                disabled={isStarting}
                onChange={(event) => onDuelCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onJoinDuel();
                  }
                }}
              />
              <button type="button" disabled={isStarting || duelCode.length !== 6} onClick={onJoinDuel}>Войти</button>
            </div>
          </div>
        </div>
        <div className="settings-section">
          <div className="settings-divider" />
          <label className="slider-row">
            <span>Секунд на вопрос</span>
            <strong>{settings.unlimitedTime ? "∞" : settings.secondsPerRound}</strong>
            <input
              type="range"
              min="30"
              max="330"
              step="30"
              value={settings.unlimitedTime ? 330 : settings.secondsPerRound}
              onChange={(event) => {
                const value = Number(event.target.value);
                onSettingsChange({
                  ...settings,
                  unlimitedTime: value > 300,
                  secondsPerRound: value > 300 ? settings.secondsPerRound : value
                });
              }}
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
              onChange={(event) => onSettingsChange({ ...settings, roundCount: Number(event.target.value) })}
            />
          </label>
        </div>
      </section>
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
