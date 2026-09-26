# plan_01 — Project Setup

## Goal

Repo skeleton, tooling, and shared conventions so every subsequent plan drops into a known structure.

## Deliverables

- Top-level dirs: `mobile/`, `backend/`, `tests/`, `plans/`, `docs/` (already created).
- `README.md` at repo root: one-paragraph project pitch + how to run each phase.
- `.gitignore` covering `node_modules/`, `.expo/`, `__pycache__/`, `.venv/`, `.env`, `*.sqlite`, `.DS_Store`.
- `.editorconfig` for consistent whitespace across TS + Python.
- `mobile/` scaffolded via `npx create-expo-app -t blank-typescript` (blocking on user go-ahead).
- `backend/README.md` placeholder describing that Phase 2 will live here.
- `tests/README.md` explaining split: mobile Jest tests live under `mobile/__tests__/`, cross-cutting integration tests under `tests/`.

## Conventions

- **TypeScript** (mobile): strict mode on, path alias `@/*` → `mobile/src/*`, ESLint + Prettier defaults from Expo template.
- **Python** (backend, Phase 2): 3.11, `ruff` + `mypy`, `uv` for deps.
- **Naming parity**: TS interface field names match future SQL column names exactly (see [docs/DATABASE.md](../docs/DATABASE.md)).
- **Commit style**: conventional-ish (`feat:`, `fix:`, `chore:`) — not enforced by hook in Phase 1.

## Steps

1. Create root `README.md` (short) and `.gitignore`.
2. `cd mobile && npx create-expo-app@latest . -t blank-typescript` (interactive; user runs on approval).
3. Install nav + storage deps: `@react-navigation/native`, `@react-navigation/bottom-tabs`, `@react-navigation/native-stack`, `react-native-screens`, `react-native-safe-area-context`, `@react-native-async-storage/async-storage`.
4. Add `mobile/tsconfig.json` path alias.
5. Placeholder `backend/README.md`, `tests/README.md`.
6. First commit.

## Definition of done

`cd mobile && npx expo start` boots to the default Expo blank screen on Expo Go without errors. Nothing product-specific yet.
