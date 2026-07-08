# Contributing to DogGuessr

DogGuessr is a static React game with a thick client and a thin server. Keep that paradigm until the business can afford a different architecture.

## Product Model

- The player guesses a dog breed from a photo by selecting a tile on a breed map.
- Solo games are fully client-side: data loading, search, scoring, game state and persistence live in the frontend.
- Duels use a thin Python/Yandex backend only for room state, player credentials, guesses, deadlines and conflict-safe persistence.
- Static game data lives at the repository root: `dataset/`, `dataset.csv`, `breed-similarity.csv`, `breed_map.json`, `image_manifest.json`.
- Vite serves those root files in dev and copies JSON/CSV into `frontend/dist` during build.

## Non-Negotiable Rules

- Keep changes scoped. No opportunistic redesigns, validations, backend authority upgrades or style tweaks.
- Prefer explicit module boundaries over clever abstractions.
- Avoid cycles between modules. Shared helpers belong in neutral modules.
- Keep the server thin. Do not move catalog, map, search or scoring authority to the backend yet.
- Preserve public facades unless there is a strong reason: `api` in `api/client.ts`, `duelApi` in `api/duel.ts`.

## Frontend Structure

- `src/App.tsx`: app coordinator only. Owns restore, polling, shared screen state, home/start actions and mode selection.
- `src/appSettings.ts`: persisted start-screen settings and media query hook.
- `src/components/StartScreen.tsx`: start page, duel code input and solo settings controls.
- `src/components/SoloGameScreen.tsx`: solo gameplay screen and solo commands.
- `src/components/DuelGameScreen.tsx`: duel gameplay, waiting/countdown/pressure overlays and duel final screen.
- `src/components/GameChrome.tsx`: shared UI widgets: search, timer, legend, dog gallery and solo final screen.
- `src/components/BreedMap.tsx`: interactive map shell, viewport persistence, wheel/pinch/drag gestures, tiles and arcs.
- `src/mapViewport.ts`: pure pan/zoom/fit math. Keep DOM, React and storage out of it.
- `src/i18n.tsx`: UI locale detection, persisted manual language choice, translated UI copy and display-format helpers. Keep locale as a UI concern only.

## Frontend Engine/API Modules

- `src/api/client.ts`: public solo/shared facade. Keep it thin.
- `src/api/gameData.ts`: loads and normalizes static data, builds catalog/maps/images.
- `src/api/breedSearch.ts`: local breed search ranking.
- `src/api/scoring.ts`: pure score calculation from map distance and similarity.
- `src/api/soloGame.ts`: solo state machine and `localStorage` persistence.
- `src/api/duel.ts`: public duel facade. It wires transport, session and projection.
- `src/api/duelTransport.ts`: HTTP calls to the Yandex function.
- `src/api/duelSession.ts`: active duel session, stored credentials and in-memory selected breed.
- `src/api/duelProjection.ts`: backend snapshot to `DuelViewState`.
- `src/api/duelConstants.ts`: frontend duel constants that mirror backend protocol.
- `src/api/types.ts`: shared frontend view and protocol types.
- `src/api/text.ts`: neutral text/id helpers used by multiple API modules.
- `src/api/feedback.ts`: static frontend feedback sink. It posts reports to Google Forms and must not become game authority.

## Backend Structure

- `backend/duel_function/state.py`: pure duel state transitions and snapshot filtering.
- `backend/duel_function/index.py`: serverless HTTP routing and retry loops.
- `backend/duel_function/repository.py`: YDB persistence and optimistic updates.
- `backend/duel_function/*_test.py`: state and protocol regression tests.

Important backend constants mirrored by frontend expectations:

- `DUEL_ROUNDS = 7`
- countdown: `3000ms`
- second-player deadline: `15000ms`
- server timeout grace: `5000ms`
- revealed auto-next: `10000ms`
- room id: 6 alphanumeric chars

## Behavior Invariants

- Solo settings default to 10 rounds, 180 seconds, limited time.
- Solo answers must be unique within one game.
- Round timeout submits the currently selected breed; no selection means zero score and no guess image.
- Revealed solo rounds show answer, guess if present, score arc and shrink the dog panel.
- Search debounce, ranking and keyboard behavior are part of the frozen UX.
- Map wheel handling distinguishes mouse zoom, trackpad pan and pinch zoom.
- Map viewport is persisted per game id; restored reveal viewport must not be overwritten by reveal auto-fit.
- Touch pan/zoom must suppress accidental tile clicks after meaningful movement.
- Duel selected breed is intentionally in memory, while player credentials are persisted.
- Duel opponent guesses stay hidden until reveal.
- Duel pressure mode starts only after the opponent has guessed and this player has not.
- `clearSession()` clears only the active in-memory duel session, not stored credentials.

## Code Quality Rules

- Each module should have one reason to change.
- Each exported function/component needs a short comment describing exactly what it does.
- Add "why" comments only for non-obvious invariants, compatibility constraints or race/gesture handling.
- Do not pass React state setters into presentational components when a semantic callback is clearer.
- Keep UI components data-in/data-out; persistence and transport belong outside them.
- Add player-facing UI text only through `src/i18n.tsx`. The English dictionary must satisfy the same TypeScript shape as the Russian base dictionary.
- Do not pass locale into game engines, scoring, search ranking, persistence or duel protocol modules.
- Keep pure algorithms pure: no `fetch`, DOM, timers or storage in scoring/search/viewport math.
- Prefer adapters at mode boundaries over fake state leaking across layers. If an adapter remains, document why.
- Do not add new dependencies for refactoring unless the existing stack cannot reasonably solve the problem.

## Testing

Run these before handing off a frontend/backend change:

```bash
cd frontend
npm test
npm run build

cd ../backend/duel_function
python3 -m unittest state_test protocol_test
```

Test ownership:

- `App.ui.test.tsx`: screen-level UI behavior and visible contracts.
- `styles.behavior.test.ts`: CSS/layout contracts.
- `mapViewport*.test.ts`: pure viewport math and legacy static API coverage.
- `api/client.behavior.test.ts`: static data, solo lifecycle, scoring, search and persistence.
- `api/duel.behavior.test.ts`: duel client/session/projection behavior.
- `api/duel.contract.test.ts` and `backend/duel_function/protocol_test.py`: frontend/backend wire contract.

## Deploy

```bash
cd frontend
npm run deploy
```

## Common Pitfalls

- Changing JSX wrappers, class names or button text can break frozen style/behavior tests.
- Replacing functional React state updates with captured values can alter rapid-click behavior.
- Persisting duel selected breed would be a behavior change.
- Moving duel constants without checking backend state tests can create silent protocol drift.
- Editing tests to match refactoring structure is acceptable only when imports/signatures move; do not weaken behavior assertions.
