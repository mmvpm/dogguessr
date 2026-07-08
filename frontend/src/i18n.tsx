import { createContext, useContext, type ReactNode } from "react";
import type { BreedInfo, MapLegendItem, MapTile } from "./api/types";

export type Locale = "ru" | "en";

const LOCALE_KEY = "dogguessr:locale:v1";

const ru = {
  meta: {
    title: "DogGuessr: угадай породу собаки по фото",
    description: "DogGuessr - браузерная игра, где нужно угадать породу собаки по фото. 400 пород, карта похожести и раунды на время."
  },
  start: {
    subtitle: "Угадай породу собаки по фото",
    solo: "Одиночная игра",
    duel: "ДУЭЛЬ",
    createRoom: "Создать комнату",
    roomCode: "Код комнаты",
    join: "Войти",
    secondsPerQuestion: "Секунд на вопрос",
    rounds: "Раундов",
    feedback: "Написать разработчику",
    feedbackTitle: "Сообщение разработчику",
    feedbackPlaceholder: "Что случилось?",
    cancel: "Отмена",
    send: "Отправить",
    close: "Закрыть"
  },
  language: {
    switchToEnglish: "Switch to English",
    switchToRussian: "Переключить на русский"
  },
  common: {
    home: "На главный экран",
    round: "Раунд",
    score: "Счет",
    scoreColon: "Счет:",
    guess: "Угадать",
    next: "Дальше",
    noAnswer: "Нет ответа",
    timeOut: "Время вышло",
    correctAnswer: "Правильный ответ",
    yourAnswer: "Ваш ответ"
  },
  search: {
    placeholder: "Найти породу",
    clear: "Очистить поиск",
    loading: "Ищем...",
    empty: "Ничего не найдено",
    error: "Ошибка поиска"
  },
  legend: {
    label: "Легенда",
    title: "Легенда групп пород"
  },
  gallery: {
    title: "Угадай породу",
    report: "Пожаловаться на фото",
    reported: "Жалоба уже отправлена",
    expand: "Расширить",
    shrink: "Сжать",
    previous: "Предыдущее фото",
    next: "Следующее фото"
  },
  final: {
    totalScore: "Итоговый счет"
  },
  duel: {
    opponentReady: "Соперник готов",
    waitingForOpponent: "Ждем соперника",
    waitingTitle: "Ожидание соперника...",
    shareLink: "Отправьте эту ссылку второму игроку:",
    copied: "Скопировано!",
    copyLink: "Копировать ссылку",
    draw: "Ничья",
    win: "Победа!",
    loss: "Поражение",
    myAnswer: "Мой ответ",
    opponentAnswer: "Ответ соперника"
  },
  toasts: {
    roomCodeInvalid: "Код комнаты должен быть из 6 символов",
    reportSent: "Жалоба отправлена",
    reportFailed: "Не удалось отправить жалобу",
    messageSent: "Сообщение отправлено",
    messageFailed: "Не удалось отправить сообщение",
    unknownError: "Unknown error"
  },
  groups: {
    bulldog: "Бульдоги",
    collie: "Колли",
    corgi: "Корги",
    griffon: "Гриффоны",
    hound: "Гончие",
    laika: "Лайки",
    mastiff: "Мастифы",
    other: "Другие",
    pinscher: "Пинчеры",
    podenco: "Поденко",
    pointer: "Легавые",
    poodle: "Пудели",
    retriever: "Ретриверы",
    schnauzer: "Шнауцеры",
    segugio: "Сегуджио",
    setter: "Сеттеры",
    shepherd: "Овчарки",
    spaniel: "Спаниели",
    spitz: "Шпицы",
    terrier: "Терьеры",
    wolf: "Волчьи собаки"
  }
} as const;

type MessageLeaf = string;
type MessageShape<T> = {
  [K in keyof T]: T[K] extends MessageLeaf ? string : MessageShape<T[K]>;
};

export type Messages = MessageShape<typeof ru>;

const en: Messages = {
  meta: {
    title: "DogGuessr: guess the dog breed from a photo",
    description: "DogGuessr is a browser game where you guess dog breeds from photos. 400 breeds, a similarity map, and timed rounds."
  },
  start: {
    subtitle: "Guess the dog breed from a photo",
    solo: "Solo game",
    duel: "DUEL",
    createRoom: "Create room",
    roomCode: "Room code",
    join: "Join",
    secondsPerQuestion: "Seconds per question",
    rounds: "Rounds",
    feedback: "Message the developer",
    feedbackTitle: "Message the developer",
    feedbackPlaceholder: "What happened?",
    cancel: "Cancel",
    send: "Send",
    close: "Close"
  },
  language: {
    switchToEnglish: "Switch to English",
    switchToRussian: "Переключить на русский"
  },
  common: {
    home: "Home",
    round: "Round",
    score: "Score",
    scoreColon: "Score:",
    guess: "Guess",
    next: "Next",
    noAnswer: "No answer",
    timeOut: "Time is up",
    correctAnswer: "Correct answer",
    yourAnswer: "Your answer"
  },
  search: {
    placeholder: "Find a breed",
    clear: "Clear search",
    loading: "Searching...",
    empty: "Nothing found",
    error: "Search failed"
  },
  legend: {
    label: "Legend",
    title: "Breed group legend"
  },
  gallery: {
    title: "Guess the breed",
    report: "Report photo",
    reported: "Photo already reported",
    expand: "Expand",
    shrink: "Shrink",
    previous: "Previous photo",
    next: "Next photo"
  },
  final: {
    totalScore: "Final score"
  },
  duel: {
    opponentReady: "Opponent is ready",
    waitingForOpponent: "Waiting for opponent",
    waitingTitle: "Waiting for opponent...",
    shareLink: "Send this link to the second player:",
    copied: "Copied!",
    copyLink: "Copy link",
    draw: "Draw",
    win: "Victory!",
    loss: "Defeat",
    myAnswer: "My answer",
    opponentAnswer: "Opponent answer"
  },
  toasts: {
    roomCodeInvalid: "Room code must contain 6 characters",
    reportSent: "Report sent",
    reportFailed: "Could not send report",
    messageSent: "Message sent",
    messageFailed: "Could not send message",
    unknownError: "Unknown error"
  },
  groups: {
    bulldog: "Bulldogs",
    collie: "Collies",
    corgi: "Corgis",
    griffon: "Griffons",
    hound: "Hounds",
    laika: "Laikas",
    mastiff: "Mastiffs",
    other: "Other",
    pinscher: "Pinschers",
    podenco: "Podencos",
    pointer: "Pointers",
    poodle: "Poodles",
    retriever: "Retrievers",
    schnauzer: "Schnauzers",
    segugio: "Segugios",
    setter: "Setters",
    shepherd: "Shepherds",
    spaniel: "Spaniels",
    spitz: "Spitz",
    terrier: "Terriers",
    wolf: "Wolfdogs"
  }
};

const messages: Record<Locale, Messages> = { ru, en };

type I18nValue = {
  locale: Locale;
  copy: Messages;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <I18nContext.Provider value={{ locale, copy: messages[locale] }}>
      {children}
    </I18nContext.Provider>
  );
}

/** Returns translated copy outside React components, for app-level effects and callbacks. */
export function getMessages(locale: Locale): Messages {
  return messages[locale];
}

/** Returns the current UI locale and complete translated copy dictionary. */
export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return context;
}

/** Reads the persisted manual locale choice, if it is valid. */
export function readSavedLocale(): Locale | null {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    return saved === "ru" || saved === "en" ? saved : null;
  } catch {
    return null;
  }
}

/** Persists a manual locale choice. */
export function saveLocale(locale: Locale): void {
  localStorage.setItem(LOCALE_KEY, locale);
}

/** Chooses the first supported browser/device language, defaulting to English. */
export function detectInitialLocale(): Locale {
  const saved = readSavedLocale();
  if (saved) {
    return saved;
  }

  const languages = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some((language) => language.toLocaleLowerCase("en-US").startsWith("ru")) ? "ru" : "en";
}

/** Displays breed entities according to the UI locale without changing catalog/search logic. */
export function formatBreedName(breed: BreedInfo, locale: Locale): string {
  return locale === "en" ? breed.en : breed.ru;
}

/** Displays map tiles according to the UI locale without changing tile ids or geometry. */
export function formatMapTileLabel(tile: MapTile, locale: Locale): string {
  return locale === "en" ? tile.breedId : tile.label;
}

/** Displays legend group names in the current UI language. */
export function formatLegendItem(item: MapLegendItem, copy: Messages): string {
  return copy.groups[item.group as keyof Messages["groups"]] ?? item.label;
}
