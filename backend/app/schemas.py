from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel


class AuthorOut(BaseModel):
    id: int
    display_name: str

    class Config:
        from_attributes = True


class SourceOut(BaseModel):
    id: int
    name: str
    type: Optional[str] = None
    issn: Optional[str] = None
    sjr_quartile: Optional[str] = None

    class Config:
        from_attributes = True


class PublicationOut(BaseModel):
    id: int
    year: int
    title: str
    doi: Optional[str] = None
    pdf_url: Optional[str] = None
    scopus_url: Optional[str] = None
    citations_count: int
    quartile: Optional[str] = None
    percentile_2024: Optional[int] = None
    source: Optional[SourceOut] = None
    authors: List[AuthorOut] = []
    status: str
    note: Optional[str] = None

    class Config:
        from_attributes = True


class PageMeta(BaseModel):
    page: int
    per_page: int
    total: int
    total_pages: int


class SearchResponse(BaseModel):
    meta: PageMeta
    items: List[PublicationOut]


# Create payloads
class PublicationCreate(BaseModel):
    title: str
    year: int
    authors: List[str]
    source_name: Optional[str] = None
    issn: Optional[str] = None
    source_type: Optional[str] = None  # journal|conference
    doi: Optional[str] = None
    pdf_url: Optional[str] = None
    citations_count: Optional[int] = 0


class ValidateSourceResponse(BaseModel):
    found: bool
    source: Optional[SourceOut] = None
    message: Optional[str] = None


# Users
class UserOut(BaseModel):
    id: int
    full_name: str
    login: str
    email: Optional[str] = None
    role: Optional[str] = None
    faculty: str
    department: str
    position: str
    degree: str
    active: int

    class Config:
        from_attributes = True


class UserCreate(BaseModel):
    full_name: str
    login: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None  # admin|teacher|student
    faculty: str
    department: str
    position: str
    degree: str
    password: str


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    login: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    faculty: Optional[str] = None
    department: Optional[str] = None
    position: Optional[str] = None
    degree: Optional[str] = None
    active: Optional[int] = None


class UserPasswordChange(BaseModel):
    password: str


class MatchPreviewResponse(BaseModel):
    count: int
    examples: List[str] = []
    publications: List[PublicationOut] = []


class UserWithCountOut(UserOut):
    publications_count: int


class LoginCheckResponse(BaseModel):
    available: bool
