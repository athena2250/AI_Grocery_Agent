"""Recipe reads (plan_11). Read-only — a recipe check proposes, it never writes to the list."""

from __future__ import annotations

from sqlmodel import Session

from app.ambiguity.safety_net import Catalog
from app.inventory.store import get_inventory
from app.planner.models import GroceryList, ItemStatus
from app.planner.store import list_items

from .rules import Recipe, RecipeCheck, check_recipe


def check_recipe_for_household(
    session: Session, household_id: str, grocery_list: GroceryList, recipe: Recipe, catalog: Catalog
) -> RecipeCheck:
    pending = {
        i.product_id for i in list_items(session, grocery_list.id) if i.status == ItemStatus.PENDING
    }
    return check_recipe(recipe, get_inventory(session, household_id), pending, catalog)
