from typing import Any

from sqlmodel import Field, SQLModel

from app.core.sqltypes import JSONType


class ReportState(SQLModel, table=True):
    __tablename__ = "report_state"

    household_id: str = Field(foreign_key="household.id", primary_key=True)
    stream: str = Field(primary_key=True)
    last_seq: int = 0
    state: dict[str, Any] = Field(default_factory=dict, sa_type=JSONType)
    # Track only rows owned by this projection, never legacy/manual server records.
    row_ids: list[str] = Field(default_factory=list, sa_type=JSONType)
