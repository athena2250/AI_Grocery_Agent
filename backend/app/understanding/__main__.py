"""Talk to the configured LLM from the terminal and see what it understood.

    cd backend
    OLLAMA_MODEL=llama3:8b .venv/bin/python -m app.understanding                   # type messages, blank line quits
    OLLAMA_MODEL=llama3:8b .venv/bin/python -m app.understanding "get coriander"

For each message: the intent, items, pantry updates and questions the model extracted, then
what the deterministic safety net adds (a question the model forgot, "the usual" resolved
from the sample household's memory). Uses the starter catalog in seed_data.json. This is the
extraction step only — the reply text and chips the app shows come from the orchestrator.
"""

from __future__ import annotations

import asyncio
import json
import sys
import time

from app.ambiguity.safety_net import (
    Catalog,
    CatalogAlias,
    CatalogProduct,
    HouseholdPreference,
    apply_safety_net,
)
from app.seed import SEED_FILE

from .llm import client_from_env


def _catalog() -> Catalog:
    d = json.loads(SEED_FILE.read_text())
    return Catalog(
        products=tuple(CatalogProduct(p["id"], p["name"], p.get("default_unit", "pcs"), p.get("category"))
                       for p in d["products"]),
        aliases=tuple(CatalogAlias(a["alias"], a["product_id"], a.get("disambiguation_group"))
                      for a in d["aliases"]),
        preferences=tuple(HouseholdPreference(
            p["product_id"], p.get("preferred_brand"), p.get("preferred_variant"),
            p.get("typical_qty"), p.get("typical_unit"), p.get("confidence", 0.0)) for p in d["preferences"]),
    )


async def _one(client, catalog: Catalog, text: str) -> None:
    t = time.monotonic()
    try:
        raw = await client.extract(text)
    except Exception as e:  # noqa: BLE001 — show the reason and keep the session going
        print(f"  ✗ {e}\n")
        return
    took = time.monotonic() - t
    net = apply_safety_net(raw, catalog)
    print(f"  intent   {raw.intent.value}   ({took:.1f}s)")
    for i in raw.items:
        bits = [f"{i.qty or ''} {i.unit or ''}".strip(), i.brand, i.variant_hint]
        print(f"  item     {i.raw_text!r}  {' · '.join(b for b in bits if b)}")
    for u in raw.inventory_updates:
        print(f"  pantry   {u.model_dump(exclude_none=True)}")
    if raw.purchases_marked:
        print(f"  bought   {raw.purchases_marked}")
    for a in net.ambiguities:
        tag = "" if a in raw.ambiguities else "   ← added by safety net"
        print(f"  ask      [{a.kind.value}] {a.question}  {a.options}{tag}")
    print()


async def main(args: list[str]) -> None:
    client, catalog = client_from_env(), _catalog()
    print(f"model: {client._model}\n")
    if args:
        await _one(client, catalog, " ".join(args))
        return
    while True:
        try:
            text = input("you › ").strip()
        except EOFError:
            return
        if not text:
            return
        await _one(client, catalog, text)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
