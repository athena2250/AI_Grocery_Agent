"""Who is "Dad" / "me" / "Amma"? Map a verbatim mention to a member id. Pure — no LLM.

An unknown mention ("the watchman", "we") resolves to None, so the post stays unassigned
and completeness asks — never a guess.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

SELF_WORDS = {"me", "i", "myself", "mine", "my", "i'll", "i will", "im", "i'm", "nenu", "main"}

# Relation → the words a family uses for it (English, Hindi, Telugu in Roman script).
RELATION_WORDS: dict[str, set[str]] = {
    "mom": {"mom", "mum", "mummy", "mommy", "mother", "ma", "maa", "amma", "mama"},
    "dad": {"dad", "daddy", "papa", "father", "pa", "nanna", "nana", "appa", "baba"},
}


@dataclass(frozen=True)
class MemberRef:
    id: str
    name: str
    relation: str | None = None


def _clean(mention: str) -> str:
    s = mention.lower().replace("’", "'").strip()
    s = re.sub(r"'s$", "", s)
    return re.sub(r"[^\w\s']", "", s).strip()


def resolve_member(
    mention: str | None, members: Sequence[MemberRef], author_id: str | None
) -> str | None:
    if not mention or not (s := _clean(mention)):
        return None
    if s in SELF_WORDS:
        return author_id
    for m in members:
        if s == m.name.lower():
            return m.id
    for m in members:
        relation = (m.relation or "").lower()
        if relation and (s == relation or s in RELATION_WORDS.get(relation, ())):
            return m.id
    return None
