"""Recipe intelligence rules (plan_11). Pure functions — no I/O, no LLM.

"I'm making sambar tomorrow" → find the dish → check each ingredient:

  - already pending on the list          → `on_list`
  - pantry `available` / `running_low`   → `have`
  - pantry `almost_finished` / `out`     → a proposal, flagged `needs_confirmation`
  - no pantry row at all                 → `unsure`: ask, don't assume either way

Proposals use the remembered amount if there is one, never an invented one.
Nothing is ever added to the list from here; the caller asks first.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import cast

from app.ambiguity.safety_net import Catalog
from app.inventory.models import Inventory
from app.inventory.store import needs_restock
from app.memory.rules import confidence_level
from app.planner.rules import Category, Confidence, ProposedListItem, categorize


@dataclass(frozen=True)
class Recipe:
    id: str
    name: str
    aliases: tuple[str, ...]
    """Lowercase names the dish goes by, including its own name."""
    ingredients: tuple[str, ...]
    """Catalog product ids."""


@dataclass(frozen=True)
class RecipeCheck:
    recipe: Recipe
    proposals: list[ProposedListItem] = field(default_factory=list)
    unsure: list[str] = field(default_factory=list)
    have: list[str] = field(default_factory=list)
    on_list: list[str] = field(default_factory=list)


def _norm(s: str) -> str:
    return re.sub(r"[^\w\s]", " ", s.lower())


def find_recipe(text: str, recipes: Sequence[Recipe]) -> Recipe | None:
    """Longest alias wins, on word boundaries: "moong dal" beats "dal"."""

    t = _norm(text)
    hits = [
        (len(alias), r)
        for r in recipes
        for alias in r.aliases
        if re.search(rf"\b{re.escape(_norm(alias).strip())}\b", t)
    ]
    return max(hits, key=lambda h: h[0])[1] if hits else None


def check_recipe(
    recipe: Recipe,
    inventory: Sequence[Inventory],
    on_list_product_ids: Iterable[str],
    catalog: Catalog,
) -> RecipeCheck:
    pantry = {row.product_id: row for row in inventory}
    on_list = set(on_list_product_ids)
    check = RecipeCheck(recipe)
    dish = recipe.name.lower()

    for pid in dict.fromkeys(recipe.ingredients):
        product = catalog.product(pid)
        if product is None:
            continue
        row = pantry.get(pid)
        if pid in on_list:
            check.on_list.append(pid)
        elif row is None:
            check.unsure.append(pid)
        elif not needs_restock(row.state):
            check.have.append(pid)
        else:
            pref = catalog.preference(pid)
            usual = pref if pref and pref.typical_qty is not None and pref.typical_unit else None
            rationale = f"For {dish} — pantry says {product.name.lower()} is low."
            if usual:
                brand = f" {usual.preferred_brand}" if usual.preferred_brand else ""
                rationale += f" You usually get {usual.typical_qty:g} {usual.typical_unit}{brand}."
            check.proposals.append(
                ProposedListItem(
                    product_id=pid,
                    product=product.name,
                    qty=usual.typical_qty if usual else None,
                    unit=usual.typical_unit if usual else None,
                    brand=usual.preferred_brand if usual else None,
                    variant=usual.preferred_variant if usual else None,
                    category=categorize(pid, catalog, Category.HOUSEHOLD),
                    source="household_memory" if usual else "user",
                    confidence=(
                        cast(Confidence, confidence_level(usual.confidence)) if usual else "low"
                    ),
                    rationale=rationale,
                    needs_confirmation=True,
                )
            )
    return check


def _and(names: Sequence[str]) -> str:
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"


def recipe_message(check: RecipeCheck, catalog: Catalog) -> str:
    """The chat reply for a recipe check: what to add, then what we couldn't tell."""

    def names(pids: Iterable[str]) -> list[str]:
        return [p.name.lower() for pid in pids if (p := catalog.product(pid))]

    dish = check.recipe.name.lower()
    low = [p.product.lower() for p in check.proposals]
    unsure = names(check.unsure)
    parts: list[str] = []
    if low:
        it = "it" if len(low) == 1 else "them"
        parts.append(f"For {dish}, the pantry is low on {_and(low)}. Add {it} to the list?")
    if unsure:
        question = f"do you have {_and(unsure)}?"
        parts.append(f"For {dish}: {question}" if not low else question.capitalize())
    if not parts:
        parts.append(f"You have everything for {dish}.")
    return " ".join(parts)
