"""Ambiguity resolution — deterministic safety net that runs after the LLM (plan_04)."""

from __future__ import annotations

from app.understanding import UnderstandingClient, UnderstandingContext
from app.understanding.schema import LLMExtraction

from .safety_net import (
    Catalog,
    CatalogAlias,
    CatalogProduct,
    HouseholdPreference,
    apply_safety_net,
    forced_ambiguities,
    merge_ambiguities,
)


async def understand(
    client: UnderstandingClient,
    utterance: str,
    catalog: Catalog,
    context: UnderstandingContext | None = None,
) -> LLMExtraction:
    """One LLM call, then the safety net. The orchestrator's entry point for a turn."""

    extraction = await client.extract(utterance, context)
    return apply_safety_net(extraction, catalog)


__all__ = [
    "Catalog",
    "CatalogAlias",
    "CatalogProduct",
    "HouseholdPreference",
    "apply_safety_net",
    "forced_ambiguities",
    "merge_ambiguities",
    "understand",
]
