export const DUEL_ROUNDS = 7;
// Mirrors backend COUNTDOWN_MS for local bot duels that reuse the server snapshot projection.
export const COUNTDOWN_MS = 3000;
// Mirrors backend SECOND_GUESS_MS so local bot pressure windows match server duels.
export const SECOND_GUESS_MS = 15000;
// Mirrors backend SERVER_TIMEOUT_GRACE_MS so timeout submit calls can arrive after the UI deadline.
export const SERVER_TIMEOUT_GRACE_MS = 5000;
// Frontend-only matchmaking fallback before a public waiting room becomes a local bot duel.
export const PUBLIC_BOT_FALLBACK_MS = 10000;
// Mirrors backend REVEALED_AUTO_NEXT_MS so the ready-note countdown matches server auto-advance.
export const REVEALED_AUTO_NEXT_MS = 10000;
export const DUEL_API_BASE = "https://functions.yandexcloud.net/d4ec787bcv63t735518s".replace(/\/$/, "");
