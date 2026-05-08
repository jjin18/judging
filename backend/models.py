"""Pydantic schemas."""
from typing import Optional, List
from pydantic import BaseModel, Field


class EventIn(BaseModel):
    name: str
    date: Optional[str] = None
    venue: Optional[str] = None
    city: Optional[str] = None
    org_name: Optional[str] = None
    org_address: Optional[str] = None
    org_website: Optional[str] = None
    organizer_name: Optional[str] = None
    organizer_title: Optional[str] = None
    logo_path: Optional[str] = None
    devpost_url: Optional[str] = None
    hours_expected: Optional[float] = 4


class EventOut(EventIn):
    id: int


class JudgeIn(BaseModel):
    event_id: int
    name: str
    email: Optional[str] = None
    expertise: Optional[str] = None
    pin: Optional[str] = None


class JudgeOut(BaseModel):
    id: int
    event_id: int
    name: str
    email: Optional[str] = None
    expertise: Optional[str] = None
    pin: str


class ProjectIn(BaseModel):
    event_id: int
    title: str
    team_name: Optional[str] = None
    table_number: Optional[str] = None
    track: Optional[str] = None
    description: Optional[str] = None
    devpost_url: Optional[str] = None


class ProjectOut(ProjectIn):
    id: int


class ScoreIn(BaseModel):
    project_id: int
    innovation: float = Field(ge=0, le=10)
    technical: float = Field(ge=0, le=10)
    impact: float = Field(ge=0, le=10)
    presentation: float = Field(ge=0, le=10)
    notes: Optional[str] = ""
    updated_at: Optional[str] = None


class ScoreOut(BaseModel):
    id: int
    judge_id: int
    project_id: int
    innovation: float
    technical: float
    impact: float
    presentation: float
    total_raw: float
    total_weighted: float
    notes: Optional[str] = ""
    updated_at: str


class PinAuthIn(BaseModel):
    pin: str
    event_id: Optional[int] = None


class AdminAuthIn(BaseModel):
    password: str


class ProjectsImportIn(BaseModel):
    event_id: int
    projects: List[ProjectIn]


class JudgesImportIn(BaseModel):
    event_id: int
    judges: List[JudgeIn]


class ScrapeIn(BaseModel):
    event_id: int
    devpost_url: str


class TeamSubmitIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    devpost_url: str = Field(min_length=1)
    table_number: Optional[str] = None
    team_name: Optional[str] = None
    track: Optional[str] = None
    description: Optional[str] = None
    event_id: Optional[int] = None  # optional; defaults to most recent event
