# docs/SANDBOX.md — Phase 1 Mobile Sandbox Guide

## What it is

An Expo (React Native + TypeScript) app that runs on your phone via **Expo Go**, uses a **rule-based mock AI** in TypeScript, and stores state locally in **AsyncStorage**. Zero backend, zero LLM. Its job is to make the core UX feel right before we build the Python side.

## Requirements

- Node.js ≥ 18 on your laptop.
- Expo Go app on your phone (iOS App Store / Google Play).
- Same Wi-Fi network on laptop + phone (or use `--tunnel`).

## First-time setup

```bash
cd mobile
npm install
npx expo start
```

Then either:
- **iOS**: open the phone camera, point at the QR code in your terminal, tap the notification.
- **Android**: open Expo Go, tap "Scan QR code".

If Wi-Fi blocks device-to-laptop traffic:
```bash
npx expo start --tunnel
```

Hot reload is on by default — save a file, watch the phone update.

## Folder map

```
mobile/
├── App.tsx                     # entry
└── src/
    ├── navigation/             # bottom-tab + modal stacks
    ├── screens/                # Chat, List, ItemDetailModal, Pantry, Memory, History
    ├── components/             # ChatBubble, QuickReplyChip, ItemRow, ConfidenceDot
    ├── state/                  # HouseholdContext + AsyncStorage persistence
    ├── services/               # AIService interface + MockAIService + factory
    ├── data/                   # seedProducts, seedMemory, seedHistory
    ├── types.ts
    └── theme.ts
```

## The chat interaction

- User bubble: right-aligned, plain text.
- Agent bubble: left-aligned, may render quick-reply chips underneath.
- Tapping a chip sends its label as the next user turn with an internal marker so the mock knows it's a clarification response.
- Above the input, a banner shows "N items in list · tap to review" and jumps to the List tab.

## Verification script (must pass on your phone)

1. `get coriander` → agent asks leaves / seeds / powder (3 chips).
2. Tap `Coriander seeds` → agent asks quantity (chips `100 g / 200 g / custom`).
3. Tap `100 g` → agent confirms + offers `save as usual` chip.
4. Tap `Yes, save` → open **Memory** tab, see new row "Coriander → coriander seeds, 100 g".
5. `get tomatoes I don't know how much` → agent proposes 1 kg from memory (chips `Yes 1 kg / ½ kg / 2 kg`). Tap Yes.
6. Open **List** — Coriander seeds under Spices, Tomatoes under Vegetables.
7. Tap Tomatoes → **Item Detail** shows rationale, high confidence, source = household_memory.
8. `rice is almost finished` → **Pantry** shows rice as almost finished; List adds Aashirvaad 5 kg with rationale.
9. `mark tomatoes purchased` → List item checked; **History** shows new row.
10. Kill and reopen app → all state persists.

All 10 → Phase 1 done, move to Phase 2 (real backend).

## Running Jest tests

```bash
cd mobile
npm test
```

Covers the `MockAIService` scripted table and the `HouseholdContext` reducer.

## Common pitfalls

- **QR scan does nothing** — install Expo Go first; iOS Camera app deep-links into it automatically once installed.
- **"Something went wrong"** on load — usually a Metro cache issue: `npx expo start -c`.
- **AsyncStorage looks stale** after code changes — long-press the app, "reset app data" from Expo Go dev menu, or bump a storage version key in `state/persistence.ts`.
