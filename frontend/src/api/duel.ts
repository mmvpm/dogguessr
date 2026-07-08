import { withBotFallback } from "./duelBotFallback";
import { createRemoteDuelApi } from "./remoteDuelApi";

/** Public facade for room lifecycle, polling, selection and duel commands. */
export const duelApi = withBotFallback(createRemoteDuelApi());
