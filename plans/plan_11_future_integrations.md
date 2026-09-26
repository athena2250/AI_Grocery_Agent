# plan_11 — Future Integrations

## Goal

Sketch (not build) the integrations that turn the sandbox into a household product. Each subsection lists what needs to be true before we start.

## Budget engine

- **Prereq**: price data collected on ≥ 60% of list items (via receipts or manual entry).
- **What**: estimate list total, warn when > budget, offer to review largest optional items. Never auto-remove.
- **Where**: new `budget` module invoked by planner post-assembly.

## Recipe intelligence

- **Prereq**: seed recipe DB (~30 common household dishes) with ingredient lists mapped to `product_id`.
- **What**: "I'm making sambar tomorrow" → diff recipe ingredients against pantry → propose missing ones for approval.
- **Never**: auto-add to list.

## Multi-user household

- **Prereq**: real auth. Options: Clerk (fast), custom email+OTP (control), Apple/Google sign-in.
- **What**: invite codes per household; members share list, memory, inventory. Every DB read is scoped by `household_id` (already true in schema).
- **Roles v1**: everyone can add/edit; anyone can mark purchased. No admin tier at first.

## WhatsApp integration

- **Prereq**: backend deployed with public HTTPS. WhatsApp Business API or Twilio.
- **What**: Mom messages the WhatsApp bot exactly the way she'd text the mobile app. Same `AIService` behind an inbound webhook adapter. Clarifications sent back as messages with numbered options.

## Voice input

- **Prereq**: on-device or cloud speech-to-text. iOS: `SFSpeechRecognizer`. Cheap fallback: Whisper.cpp.
- **What**: hold-to-talk button in Chat screen; STT → same `AIService.chat` call. Rendered as normal user bubble.

## Online grocery ordering

- **Prereq**: partner API (BigBasket, Blinkit, DMart-Ready). Requires product SKU mapping.
- **What**: "send to BigBasket" button on approved lists. Never auto-send. Never store payment credentials — deep-link into their app for checkout.

## Store route optimizer

- **Prereq**: user defines physical layout of preferred stores (aisle order).
- **What**: replace fixed category order in [plan_08](plan_08_grocery_planner.md) with per-store sequence. Same list, different sort.

## Web UI

- **Prereq**: FastAPI backend running (Phase 2 done).
- **What**: minimal Next.js app hitting the same JSON endpoints. Household admin views, harder-to-do-on-phone edits (bulk manage aliases). Not customer-facing for Mom.

## Ordering across phases

Rough priority once Phase 2 is stable:
1. Receipt OCR ([plan_09](plan_09_receipt_processing.md)) — biggest data unlock.
2. Prediction ([plan_10](plan_10_prediction.md)) — piggybacks on OCR-produced history.
3. Multi-user auth — unblocks family adoption.
4. WhatsApp — real usage boost for Mom.
5. Budget + recipe — comfort features.
6. Web UI + store route + online ordering — power-user territory.
