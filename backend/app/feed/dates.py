"""Turn the date / time words a family member typed into calendar values. Pure — no LLM.

The extraction prompt copies phrases verbatim ("next Friday", "on the 10th", "at 5") and is
never told today's date; this module resolves them against the household's `today`.

Nothing is guessed. A phrase this module doesn't understand ("before Diwali" with no
`named_dates` entry, "kal") returns None, and the field stays empty so completeness asks.
A phrase with two real readings returns `candidates` instead of a value, so the question
layer can offer both as chips:

  - "next Friday" said on a Monday → this week's Friday or the following one.
  - "at 7" → 7 AM or 7 PM. Bare hours 1–6 are read as PM (nobody books a 3 AM plumber),
    and the result says so (`assumed_meridiem`), so the UI can show it.
"""

from __future__ import annotations

import calendar
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, time, timedelta
from typing import Literal

Relation = Literal["on", "by", "before"]
Precision = Literal["day", "week", "month"]

WEEKDAYS = {
    "monday": 0, "mon": 0, "tuesday": 1, "tue": 1, "tues": 1, "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3, "thur": 3, "thurs": 3, "friday": 4, "fri": 4,
    "saturday": 5, "sat": 5, "sunday": 6, "sun": 6,
}
MONTHS = {
    name.lower(): i for i, name in enumerate(calendar.month_name) if name
} | {name.lower(): i for i, name in enumerate(calendar.month_abbr) if name} | {"sept": 9}
NUMBER_WORDS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}
# Exact words → days from today. Hindi "kal" / "parso" mean both yesterday and tomorrow,
# so they are deliberately absent.
OFFSETS = {
    "today": 0, "tonight": 0, "aaj": 0, "ivala": 0, "ivvala": 0, "ee roju": 0, "eeroju": 0,
    "tomorrow": 1, "tmrw": 1, "tmr": 1, "tomorow": 1, "tommorow": 1, "repu": 1,
    "day after tomorrow": 2, "ellundi": 2,
}
PARTS_OF_DAY = {"morning": "morning", "afternoon": "afternoon", "evening": "evening",
                "night": "night", "tonight": "night"}

_RELATION_PREFIXES: tuple[tuple[str, Relation], ...] = (
    ("no later than ", "by"), ("not later than ", "by"), ("by ", "by"), ("until ", "by"),
    ("till ", "by"), ("before ", "before"), ("on or before ", "by"),
)
_FILLER_PREFIXES = ("on ", "for ", "this coming ", "coming ", "the ")
_ORDINAL = r"(\d{1,2})(?:st|nd|rd|th)?"


@dataclass(frozen=True)
class DateResolution:
    phrase: str
    relation: Relation = "on"
    start: date | None = None
    end: date | None = None
    """For a deadline use `end`: "next week" → by the Sunday of next week."""
    precision: Precision = "day"
    candidates: tuple[date, ...] = ()
    """Set (and start/end None) when the phrase has more than one real reading."""

    @property
    def resolved(self) -> bool:
        return self.end is not None

    @property
    def exact_day(self) -> bool:
        return self.resolved and self.precision == "day"


@dataclass(frozen=True)
class TimeResolution:
    phrase: str
    value: time | None = None
    part_of_day: str | None = None
    """"morning" etc. when that is all that was said."""
    candidates: tuple[time, ...] = ()
    assumed_meridiem: bool = False

    @property
    def resolved(self) -> bool:
        return self.value is not None or self.part_of_day is not None


def _norm(phrase: str) -> str:
    s = phrase.lower().replace("’", "'")
    s = re.sub(r"[^\w\s:'/-]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _week_bounds(d: date) -> tuple[date, date]:
    monday = d - timedelta(days=d.weekday())
    return monday, monday + timedelta(days=6)


def _month_end(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def _add_months(year: int, month: int, n: int) -> tuple[int, int]:
    m = month - 1 + n
    return year + m // 12, m % 12 + 1


def _day_of_month(day: int, today: date) -> date | None:
    """The next date with this day number, today counting; skips months that lack it."""

    for n in range(13):
        y, m = _add_months(today.year, today.month, n)
        if day <= calendar.monthrange(y, m)[1]:
            d = date(y, m, day)
            if d >= today:
                return d
    return None


def _month_day(month: int, day: int, today: date) -> date | None:
    for year in (today.year, today.year + 1):
        if day <= calendar.monthrange(year, month)[1] and (d := date(year, month, day)) >= today:
            return d
    return None


def _weekday(target: int, today: date, qualifier: str) -> DateResolution | tuple[date, ...]:
    ahead = (target - today.weekday()) % 7
    coming = today + timedelta(days=ahead)
    if qualifier == "next":
        if coming > today and _week_bounds(coming) == _week_bounds(today):
            return (coming, coming + timedelta(days=7))
        return (coming if coming > today else coming + timedelta(days=7),)
    return (coming,)


def resolve_date(
    phrase: str | None, today: date, named_dates: Mapping[str, date] | None = None
) -> DateResolution | None:
    """`today` is the household's local date. `named_dates` maps lowercased names the
    household uses ("diwali", "anna's birthday") to dates, if the caller has a calendar."""

    if not phrase or not (s := _norm(phrase)):
        return None
    relation: Relation = "on"
    for prefix, rel in _RELATION_PREFIXES:
        if s.startswith(prefix):
            relation, s = rel, s[len(prefix):]
            break
    for prefix in _FILLER_PREFIXES:
        if s.startswith(prefix):
            s = s[len(prefix):]

    def day(d: date) -> DateResolution:
        return DateResolution(phrase, relation, d, d)

    def span(a: date, b: date, precision: Precision) -> DateResolution:
        return DateResolution(phrase, relation, a, b, precision)

    if s in OFFSETS:
        return day(today + timedelta(days=OFFSETS[s]))
    if m := re.fullmatch(r"(?:in|after) (\d+|\w+) (day|week|month)s?(?: time)?", s) or \
            re.fullmatch(r"(\d+|\w+) (day|week|month)s? (?:later|from now)", s):
        n = int(m[1]) if m[1].isdigit() else NUMBER_WORDS.get(m[1])
        if n is None:
            return None
        if m[2] == "day":
            return day(today + timedelta(days=n))
        if m[2] == "week":
            return day(today + timedelta(weeks=n))
        y, mo = _add_months(today.year, today.month, n)
        return day(date(y, mo, min(today.day, calendar.monthrange(y, mo)[1])))
    if s in ("this week", "within this week", "week"):
        return span(today, _week_bounds(today)[1], "week")
    if s in ("next week", "coming week"):
        a, b = _week_bounds(today + timedelta(days=7))
        return span(a, b, "week")
    if s in ("weekend", "this weekend"):
        sat = today + timedelta(days=(5 - today.weekday()) % 7)
        if today.weekday() == 6:
            return span(today, today, "day")
        return span(sat, sat + timedelta(days=1), "week")
    if s == "next weekend":
        sat = _week_bounds(today)[0] + timedelta(days=12)
        return span(sat, sat + timedelta(days=1), "week")
    if s in ("end of the month", "end of month", "month end", "this month end", "end of this month"):
        return day(_month_end(today.year, today.month))
    if s == "this month":
        return span(today, _month_end(today.year, today.month), "month")
    if s == "next month":
        y, mo = _add_months(today.year, today.month, 1)
        return span(date(y, mo, 1), _month_end(y, mo), "month")
    if m := re.fullmatch(r"(?:(this|next) )?(\w+)", s):
        if m[2] in WEEKDAYS:
            found = _weekday(WEEKDAYS[m[2]], today, m[1] or "this")
            if len(found) == 1:
                return day(found[0])
            return DateResolution(phrase, relation, candidates=found)
    if m := re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s):
        try:
            return day(date(int(m[1]), int(m[2]), int(m[3])))
        except ValueError:
            return None
    if m := re.fullmatch(_ORDINAL + r"(?: of)? ([a-z]+)", s):
        if m[2] in MONTHS and (d := _month_day(MONTHS[m[2]], int(m[1]), today)):
            return day(d)
    if m := re.fullmatch(r"([a-z]+) " + _ORDINAL, s):
        if m[1] in MONTHS and (d := _month_day(MONTHS[m[1]], int(m[2]), today)):
            return day(d)
    if m := re.fullmatch(_ORDINAL, s):
        if 1 <= int(m[1]) <= 31 and (d := _day_of_month(int(m[1]), today)):
            return day(d)
    if named_dates and (d := named_dates.get(s)) is not None:
        return day(d)
    return None


def resolve_time(phrase: str | None) -> TimeResolution | None:
    if not phrase or not (s := _norm(phrase)):
        return None
    s = re.sub(r"^(?:at|by|around|@) ", "", s)
    part = next((p for word, p in PARTS_OF_DAY.items() if re.search(rf"\b{word}\b", s)), None)
    if s in ("noon", "midday", "12 noon"):
        return TimeResolution(phrase, time(12, 0))
    if s == "midnight":
        return TimeResolution(phrase, time(0, 0))

    m = re.search(r"\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m|p\.m|o'?clock)?\b", s)
    if not m:
        return TimeResolution(phrase, part_of_day=part) if part else None
    hour, minute, suffix = int(m[1]), int(m[2] or 0), (m[3] or "").replace(".", "")
    if hour > 23 or minute > 59:
        return None
    if suffix in ("am", "pm"):
        if not 1 <= hour <= 12:
            return None
        hour = hour % 12 + (12 if suffix == "pm" else 0)
        return TimeResolution(phrase, time(hour, minute))
    if hour >= 13 or hour == 0:
        return TimeResolution(phrase, time(hour, minute))
    if part in ("afternoon", "evening", "night") and hour < 12:
        return TimeResolution(phrase, time(hour + 12, minute))
    if part == "morning":
        return TimeResolution(phrase, time(hour, minute))
    if hour == 12:
        return TimeResolution(phrase, time(12, minute))
    if 1 <= hour <= 6:
        return TimeResolution(phrase, time(hour + 12, minute), assumed_meridiem=True)
    return TimeResolution(phrase, candidates=(time(hour, minute), time(hour + 12, minute)))


def format_date(d: date) -> str:
    """"Fri, Oct 16" — short enough for a chip."""

    return f"{d:%a}, {d:%b} {d.day}"


def format_time(t: time) -> str:
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"
