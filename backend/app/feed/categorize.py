"""Which post kind (and display category) does an extracted action belong to? Pure — no LLM.

Keyword rules, first match wins. The LLM never categorizes (principle 4); it only restates
the action in the author's words. Anything no rule claims goes to `misc` ("Miscellaneous")
rather than being forced somewhere wrong. Groceries never come through here — they are
`items` in the extraction and always become a `grocery` post.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.understanding.schema import ExtractedAction

GROCERIES = "Groceries"


@dataclass(frozen=True)
class Category:
    kind: str
    """A `post_kind.kind`."""
    label: str
    """What the family sees: "Home Repair", "Errands" …; also `task.category` for tasks."""


@dataclass(frozen=True)
class Rule:
    category: Category
    pattern: re.Pattern[str]


def _words(*words: str) -> re.Pattern[str]:
    return re.compile(r"\b(?:" + "|".join(words) + r")\b")


BILLS = Category("bill", "Bills & Payments")
TICKETS = Category("ticket_booking", "Tickets")
APPOINTMENTS = Category("appointment", "Appointments")
ERRANDS = Category("errand", "Errands")
MAINTENANCE = Category("task", "Maintenance")
HOME_REPAIR = Category("task", "Home Repair")
CHORES = Category("task", "Household Chores")
SHOPPING = Category("shopping", "Shopping")
MISC = Category("misc", "Miscellaneous")

_BILL_NAMES = r"electricity|internet|wifi|wi-fi|broadband|water|gas|phone|mobile|rent|maintenance|school fees?|fees"

RULES: tuple[Rule, ...] = (
    Rule(BILLS, _words(r"bills?", "eb", "emi", "recharge", "premium", "dues",
                       rf"pay (?:the )?(?:{_BILL_NAMES})", "current bill")),
    Rule(TICKETS, _words(r"tickets?", "tatkal", r"book (?:a |the )?(?:train|bus|flight|cab)")),
    Rule(APPOINTMENTS, _words(r"appointments?", "doctor", "dr", "dentist", "check ?-?up",
                              "clinic", "hospital", "vaccination", "ptm", "parent teacher meeting")),
    Rule(ERRANDS, _words("bank", "cheque", "check deposit", "atm", "post office", "courier",
                         "parcel", r"pick ?up", r"drop (?:off)?", "collect", "passport",
                         "aadhaar", "aadhar", "xerox", "photocopy", "dry clean(?:ing)?", "register")),
    Rule(MAINTENANCE, _words("service", "serviced", "servicing", "pest control", "tank cleaning",
                             "clean(?:ing)? the tank", "ro filter", "filter change", "paint(?:ing)?")),
    Rule(HOME_REPAIR, _words("leak", "leaking", "leaks", "tap", "plumb(?:er|ing)?", "pipe",
                             "repair", "fix", "broken", "not working", "electrician", "fuse",
                             "switch", "wiring", "carpenter", "lock", "geyser", "ac", "fridge",
                             "fan", "light", "bulb", "tube ?light", "gone again")),
    Rule(CHORES, _words("clean", "wash", "laundry", "iron", "ironing", "sweep", "mop", "dishes",
                        "water the plants", "garbage", "trash", "dusting")),
    Rule(SHOPPING, _words("buy", "order", "purchase", "get a new")),
)

# For bill posts: which bill. "current" is how Telangana / AP households say electricity.
BILL_TYPES: tuple[tuple[re.Pattern[str], str], ...] = (
    (_words("eb", "current", "electricity", "power"), "Electricity"),
    (_words("internet", "wifi", "wi-fi", "broadband", "fiber", "fibre"), "Internet"),
    (_words("maintenance"), "Maintenance"),
    (_words("water"), "Water"),
    (_words("gas", "cylinder", "lpg"), "Gas"),
    (_words("phone", "mobile", "recharge", "postpaid"), "Phone"),
)


def _text(action: ExtractedAction) -> str:
    return f"{action.title} {action.raw_text}".lower()


def categorize(action: ExtractedAction) -> Category:
    text = _text(action)
    return next((r.category for r in RULES if r.pattern.search(text)), MISC)


def bill_type(action: ExtractedAction) -> str | None:
    text = _text(action)
    return next((label for pattern, label in BILL_TYPES if pattern.search(text)), None)
