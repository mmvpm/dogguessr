/** Normalizes persisted dataset ids without changing user-facing labels. */
export function normalizeText(value: string): string {
  return value.normalize("NFC");
}
