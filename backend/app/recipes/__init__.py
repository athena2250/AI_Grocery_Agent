"""Recipe intelligence — diff a dish's ingredients against the pantry, propose what's low (plan_11)."""

from .data import RECIPES
from .rules import Recipe, RecipeCheck, check_recipe, find_recipe, recipe_message
from .store import check_recipe_for_household

__all__ = [
    "RECIPES",
    "Recipe",
    "RecipeCheck",
    "check_recipe",
    "check_recipe_for_household",
    "find_recipe",
    "recipe_message",
]
