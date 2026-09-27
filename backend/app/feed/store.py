"""Feed reads/writes. Writes are added to the session; the caller commits.

The one hard rule lives in `publish`: a post with anything required missing is never sent,
whoever wrote it (Mom, Dad, or anyone else).
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from sqlmodel import Session, select

from .completeness import Missing, Requirement, missing_fields
from .models import Post, PostKindField, PostRecipient, PostStatus

_OPEN = (PostStatus.DRAFT, PostStatus.CLARIFYING, PostStatus.READY)


class PostIncomplete(Exception):
    def __init__(self, missing: Sequence[Missing]):
        super().__init__(", ".join(m.field for m in missing))
        self.missing = list(missing)


def requirements_for(session: Session, kind: str) -> list[Requirement]:
    rows = session.exec(select(PostKindField).where(PostKindField.kind == kind)).all()
    return [
        Requirement(
            field=r.field,
            question=r.question,
            required=r.required,
            applies_to=r.applies_to.value if hasattr(r.applies_to, "value") else str(r.applies_to),
            chips=tuple(r.default_chips or ()),
            depends_on_field=r.depends_on_field,
            depends_on_value=r.depends_on_value,
            position=r.position,
        )
        for r in rows
    ]


def check(session: Session, post: Post, now: datetime) -> list[Missing]:
    """Re-run completeness; move an unsent post between clarifying and ready."""

    missing = missing_fields(post.fields_json or {}, requirements_for(session, post.kind))
    if post.status in _OPEN:
        post.missing_fields_json = [m.as_json() for m in missing]
        post.status = PostStatus.CLARIFYING if missing else PostStatus.READY
        post.updated_at = now
        session.add(post)
    return missing


def publish(session: Session, post: Post, recipient_ids: Sequence[str], now: datetime) -> Post:
    """The author tapped Send. Refuses (PostIncomplete) while anything required is missing."""

    if post.status not in _OPEN:
        raise ValueError(f"post {post.id} is already {post.status.value}")
    missing = check(session, post, now)
    if missing:
        raise PostIncomplete(missing)
    post.status = PostStatus.PUBLISHED
    post.published_at = now
    session.add(post)
    for member_id in dict.fromkeys(recipient_ids):
        if member_id != post.author_member_id:
            session.add(PostRecipient(post_id=post.id, member_id=member_id))
    return post
