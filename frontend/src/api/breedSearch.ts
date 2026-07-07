import type { BreedSuggestion } from "./types";
import type { BreedRecord } from "./gameData";

export type SearchEntry = {
  record: BreedRecord;
  ru: string;
  en: string;
  ruTokens: string[];
  enTokens: string[];
  ruCompact: string;
  enCompact: string;
};

/** Builds normalized search fields once so every query can stay allocation-light. */
export function buildSearchEntries(catalog: BreedRecord[]): SearchEntry[] {
  return catalog.map((record) => {
    const ru = normalizeQuery(record.ru);
    const en = normalizeQuery(record.en);
    return {
      record,
      ru,
      en,
      ruTokens: ru.split(" "),
      enTokens: en.split(" "),
      ruCompact: ru.replaceAll(" ", ""),
      enCompact: en.replaceAll(" ", "")
    };
  });
}

/** Ranks breed suggestions using the exact matching rules frozen by behavior tests. */
export function suggest(entries: SearchEntry[], query: string): BreedSuggestion[] {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return [];
  }

  const compact = normalized.replaceAll(" ", "");
  const queryTokens = normalized.split(" ");
  return entries
    .map((entry) => {
      const ruScore = scoreText(normalized, compact, queryTokens, entry.ru, entry.ruTokens, entry.ruCompact);
      const enScore = scoreText(normalized, compact, queryTokens, entry.en, entry.enTokens, entry.enCompact);
      if (!ruScore && !enScore) {
        return null;
      }
      const match = ruScore && (!enScore || compareScore(ruScore, enScore) <= 0) ? "ru" : "en";
      const score = match === "ru" ? ruScore : enScore;
      return { entry, match, rank: [...score!, entry.record.ru.toLocaleLowerCase("ru-RU")] };
    })
    .filter((item): item is { entry: SearchEntry; match: "ru" | "en"; rank: (number | string)[] } => item !== null)
    .sort((left, right) => compareRank(left.rank, right.rank))
    .map(({ entry, match }) => ({ breed: entry.record, label: entry.record.ru, match }));
}

function scoreText(
  query: string,
  compact: string,
  queryTokens: string[],
  text: string,
  tokens: string[],
  textCompact: string
): [number, number, number, number] | null {
  if (query.includes(" ") && text.startsWith(query)) {
    return [0, 0, 0, text.length];
  }

  const tokenMatches = tokens
    .map((token, index) => token.startsWith(query) ? [token.length - query.length, index] : null)
    .filter((item): item is [number, number] => item !== null)
    .sort(compareScore);
  if (tokenMatches.length) {
    return [1, tokenMatches[0][0], tokenMatches[0][1], text.length];
  }

  const compactIndex = textCompact.indexOf(compact);
  if (compactIndex >= 0) {
    return [2, compactIndex, 0, text.length];
  }

  const sequencePosition = tokenSequencePosition(queryTokens, tokens);
  if (sequencePosition !== null) {
    return [3, sequencePosition, 0, text.length];
  }

  const textIndex = text.indexOf(query);
  if (textIndex >= 0) {
    return [4, textIndex, 0, text.length];
  }

  if (queryTokens.every((queryToken) => tokens.some((token) => token.includes(queryToken)))) {
    return [5, tokens.length, 0, text.length];
  }

  return null;
}

function tokenSequencePosition(queryTokens: string[], tokens: string[]): number | null {
  let startAt = 0;
  let firstPosition: number | null = null;

  for (const queryToken of queryTokens) {
    let found = false;
    for (let index = startAt; index < tokens.length; index += 1) {
      if (tokens[index].startsWith(queryToken) || tokens[index].includes(queryToken)) {
        firstPosition ??= index;
        startAt = index + 1;
        found = true;
        break;
      }
    }
    if (!found) {
      return null;
    }
  }
  return firstPosition;
}

function normalizeQuery(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[^0-9a-zа-я]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compareRank(left: (number | string)[], right: (number | string)[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === b) {
      continue;
    }
    return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "ru");
  }
  return left.length - right.length;
}

function compareScore(left: number[], right: number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return left.length - right.length;
}
