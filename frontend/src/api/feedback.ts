import type { GameStatus, ImageRef } from "./types";

type FeedbackKind = "bad_image" | "message";
export type FeedbackMode = "solo" | "duel" | "start";
export type FeedbackVisiblePhoto = "answer" | "guess";

type FeedbackConfig = {
  formUrl: string;
  entries: Record<FeedbackField, string>;
};

type FeedbackField =
  | "kind"
  | "imageId"
  | "imageUrl"
  | "breedId"
  | "mode"
  | "gameId"
  | "roundIndex"
  | "phase"
  | "visiblePhoto"
  | "message"
  | "pageUrl"
  | "sentAt";

type FeedbackPayload = {
  kind: FeedbackKind;
  mode: FeedbackMode;
  gameId: string | null;
  roundIndex: number | null;
  phase: GameStatus | "waiting" | "countdown" | null;
  image: ImageRef | null;
  visiblePhoto: FeedbackVisiblePhoto | null;
  message: string;
};

const GOOGLE_FORM_URL =
  "https://docs.google.com/forms/u/0/d/e/1FAIpQLSdgSCkVniug7xnkhGphg9-C60wrfp61P-5tvk2g-P9frCUxvQ/formResponse";

const FEEDBACK_CONFIG: FeedbackConfig = {
  formUrl: GOOGLE_FORM_URL,
  entries: {
    kind: "entry.1873107385",
    imageId: "entry.633685469",
    imageUrl: "entry.498725050",
    breedId: "entry.317780206",
    mode: "entry.135927189",
    gameId: "entry.243860768",
    roundIndex: "entry.903597099",
    phase: "entry.1049934285",
    visiblePhoto: "entry.572107939",
    message: "entry.481938400",
    pageUrl: "entry.2083661841",
    sentAt: "entry.1291759109"
  }
};

/** Returns whether the Google Form sink has been configured with real values. */
export function isFeedbackConfigured(): boolean {
  return FEEDBACK_CONFIG.formUrl.includes("/formResponse") &&
    Object.values(FEEDBACK_CONFIG.entries).every((entry) => /^entry\.\d+$/.test(entry)) &&
    new Set(Object.values(FEEDBACK_CONFIG.entries)).size === Object.values(FEEDBACK_CONFIG.entries).length;
}

/** Sends one feedback event to the configured Google Form. */
export async function sendFeedback(payload: FeedbackPayload): Promise<void> {
  if (!isFeedbackConfigured()) {
    throw new Error("Feedback form is not configured");
  }

  const body = new FormData();
  append(body, "kind", payload.kind);
  append(body, "imageId", payload.image?.id ?? "");
  append(body, "imageUrl", payload.image ? absoluteUrl(payload.image.url) : "");
  append(body, "breedId", payload.image?.breedId ?? "");
  append(body, "mode", payload.mode);
  append(body, "gameId", payload.gameId ?? "");
  append(body, "roundIndex", payload.roundIndex === null ? "" : String(payload.roundIndex));
  append(body, "phase", payload.phase ?? "");
  append(body, "visiblePhoto", payload.visiblePhoto ?? "");
  append(body, "message", payload.message);
  append(body, "pageUrl", window.location.href);
  append(body, "sentAt", new Date().toISOString());

  await fetch(FEEDBACK_CONFIG.formUrl, {
    method: "POST",
    mode: "no-cors",
    body
  });
}

function append(body: FormData, field: FeedbackField, value: string): void {
  body.append(FEEDBACK_CONFIG.entries[field], value);
}

function absoluteUrl(url: string): string {
  return new URL(url, window.location.origin).href;
}
