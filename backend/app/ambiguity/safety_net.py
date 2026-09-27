"""Deterministic ambiguity safety net (plan_04).

Runs AFTER the LLM extraction. 7B models miss edge cases, so independent of
what the LLM emitted we re-scan every extracted item against the catalog and
household memory and force an ambiguity wherever a silent guess could hide:

  1. Alias maps to a disambiguation group / ≥2 products → `product_type`.
  2. No qty and no `typical_qty` preference            → `quantity`.
  3. `variant_hint == "usual"` with nothing remembered → `usual_unresolved`.
  4. Merge with LLM ambiguities, dedupe by (raw_text, kind).

Pure functions over plain data — no I/O, no LLM.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field

from app.understanding.schema import (
    Ambiguity,
    AmbiguityKind,
    ExtractedItem,
    Intent,
    LLMExtraction,
)

# Only these intents carry *new* item requests worth re-scanning. A
# CLARIFY_RESPONSE item ("seeds", "100g") is an answer, not a request.
_SCANNED_INTENTS = {Intent.ADD_ITEMS, Intent.UPDATE_INVENTORY}

_USUAL_HINTS = {"usual", "same", "regular", "the one", "same as last time"}


@dataclass(frozen=True)
class CatalogProduct:
    id: str
    name: str
    default_unit: str = "pcs"


@dataclass(frozen=True)
class CatalogAlias:
    alias: str
    product_id: str
    disambiguation_group: str | None = None


@dataclass(frozen=True)
class HouseholdPreference:
    """Mirrors the plan_05 `preference` table columns the net needs."""

    product_id: str
    preferred_brand: str | None = None
    preferred_variant: str | None = None
    typical_qty: float | None = None
    typical_unit: str | None = None
    confidence: float = 0.0


@dataclass(frozen=True)
class Catalog:
    products: Sequence[CatalogProduct] = field(default_factory=tuple)
    aliases: Sequence[CatalogAlias] = field(default_factory=tuple)
    preferences: Sequence[HouseholdPreference] = field(default_factory=tuple)

    def product(self, product_id: str) -> CatalogProduct | None:
        return next((p for p in self.products if p.id == product_id), None)

    def preference(self, product_id: str) -> HouseholdPreference | None:
        return next((p for p in self.preferences if p.product_id == product_id), None)


def _norm(s: str) -> str:
    return re.sub(r"[?.!,]", "", s.lower()).strip()


def match_aliases(text: str, aliases: Sequence[CatalogAlias]) -> list[CatalogAlias]:
    """Longest-alias-wins lookup. Returns every alias row sharing the winning surface form."""

    t = _norm(text)
    words = t.split()
    for alias in sorted(aliases, key=lambda a: len(a.alias), reverse=True):
        al = _norm(alias.alias)
        hit = re.search(rf"\b{re.escape(al)}\b", t) if " " in al else al in words
        if hit:
            return [a for a in aliases if _norm(a.alias) == al]
    return []


def candidate_product_ids(item: ExtractedItem, aliases: Sequence[CatalogAlias]) -> list[str]:
    """Distinct product ids the item could refer to, grounded in the user's own words.

    `raw_text` is tried first. A non-"usual" `variant_hint` (e.g. "seeds") may
    narrow an ambiguous match. `canonical_guess` is only a fallback when the
    raw text matches nothing at all.
    """

    matches = match_aliases(item.raw_text, aliases)
    hint = (item.variant_hint or "").strip()
    if len({m.product_id for m in matches}) > 1 and hint and _norm(hint) not in _USUAL_HINTS:
        narrowed = match_aliases(f"{item.raw_text} {hint}", aliases)
        if len({m.product_id for m in narrowed}) == 1:
            matches = narrowed
    if not matches and item.canonical_guess:
        matches = match_aliases(item.canonical_guess, aliases)
    return list(dict.fromkeys(m.product_id for m in matches))


def _quantity_options(unit: str) -> list[str]:
    if unit == "g":
        bases: list[float] = [50, 100, 200]
    elif unit in ("kg", "L"):
        bases = [0.5, 1, 2]
    else:
        bases = [1, 2, 3]
    return [f"{b:g} {unit}" for b in bases] + ["custom"]


def forced_ambiguities(item: ExtractedItem, catalog: Catalog) -> list[Ambiguity]:
    """Ambiguities the deterministic rules demand for one item, regardless of the LLM."""

    product_ids = candidate_product_ids(item, catalog.aliases)
    label = item.canonical_guess or item.raw_text

    # Rule 1 — product_type (covers product_identity too). Everything below
    # depends on knowing the product, so stop here until it's resolved.
    if len(product_ids) > 1:
        names = [p.name for pid in product_ids if (p := catalog.product(pid))]
        return [
            Ambiguity(
                raw_text=item.raw_text,
                kind=AmbiguityKind.PRODUCT_TYPE,
                question=f"Which {label}?",
                options=names,
            )
        ]

    product = catalog.product(product_ids[0]) if product_ids else None
    pref = catalog.preference(product.id) if product else None
    name = (product.name if product else label).lower()
    forced: list[Ambiguity] = []

    # Rule 3 — "the usual X" with nothing remembered for X.
    wants_usual = _norm(item.variant_hint or "") in _USUAL_HINTS
    remembered = pref is not None and any(
        v is not None for v in (pref.preferred_brand, pref.preferred_variant, pref.typical_qty)
    )
    if wants_usual and not remembered:
        forced.append(
            Ambiguity(
                raw_text=item.raw_text,
                kind=AmbiguityKind.USUAL_UNRESOLVED,
                question=f"I don't have a usual {name} saved yet. Which one?",
                options=[],
            )
        )

    # Rule 2 — quantity missing and no typical_qty to fall back on.
    if item.qty is None and (pref is None or pref.typical_qty is None):
        unit = item.unit or (product.default_unit if product else "pcs")
        forced.append(
            Ambiguity(
                raw_text=item.raw_text,
                kind=AmbiguityKind.QUANTITY,
                question=f"How much {name}?",
                options=_quantity_options(unit),
            )
        )

    return forced


def _dedupe_key(a: Ambiguity) -> tuple[str, AmbiguityKind]:
    kind = AmbiguityKind.PRODUCT_TYPE if a.kind is AmbiguityKind.PRODUCT_IDENTITY else a.kind
    return (_norm(a.raw_text), kind)


def merge_ambiguities(llm: Sequence[Ambiguity], forced: Sequence[Ambiguity]) -> list[Ambiguity]:
    """Rule 4 — union deduped by (raw_text, kind).

    `product_identity` is folded into `product_type`. On a collision the forced
    entry wins, since its options come from the catalog (and so map back to
    real product ids) rather than from free LLM text. Order: LLM first, then
    new forced ones.
    """

    forced_by_key = {_dedupe_key(a): a for a in forced}
    out: dict[tuple[str, AmbiguityKind], Ambiguity] = {}
    for a in llm:
        key = _dedupe_key(a)
        if key in out:
            continue
        chosen = forced_by_key.get(key, a)
        if chosen is a and a.kind is AmbiguityKind.PRODUCT_IDENTITY:
            chosen = a.model_copy(update={"kind": AmbiguityKind.PRODUCT_TYPE})
        out[key] = chosen
    for key, a in forced_by_key.items():
        out.setdefault(key, a)
    return list(out.values())


def apply_safety_net(extraction: LLMExtraction, catalog: Catalog) -> LLMExtraction:
    """Return a copy of `extraction` with forced ambiguities merged in."""

    if extraction.intent not in _SCANNED_INTENTS:
        return extraction

    forced: list[Ambiguity] = []
    for item in extraction.items:
        forced.extend(forced_ambiguities(item, catalog))

    # An inventory update against the wrong product is a silent guess too.
    for upd in extraction.inventory_updates:
        probe = ExtractedItem(raw_text=upd.raw_text, canonical_guess=upd.product_guess)
        ids = candidate_product_ids(probe, catalog.aliases)
        if len(ids) > 1:
            forced.extend(
                a
                for a in forced_ambiguities(probe, catalog)
                if a.kind is AmbiguityKind.PRODUCT_TYPE
            )

    return extraction.model_copy(
        update={"ambiguities": merge_ambiguities(extraction.ambiguities, forced)}
    )
