from __future__ import annotations
from typing import List, Optional
from datetime import datetime
from sqlalchemy import Column, String, Integer, ForeignKey, Table, DateTime, Text, Date
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func
from .db import Base
from enum import Enum as PyEnum


class SourceTypeEnum(str, PyEnum):
    JOURNAL = "journal"
    CONFERENCE = "conference"


publication_authors = Table(
    "publication_authors",
    Base.metadata,
    Column("publication_id", ForeignKey("publications.id", ondelete="CASCADE"), primary_key=True),
    Column("author_id", ForeignKey("authors.id", ondelete="CASCADE"), primary_key=True),
    Column("author_order", Integer, nullable=False, default=0),
)

publication_categories = Table(
    "publication_categories",
    Base.metadata,
    Column("publication_id", ForeignKey("publications.id", ondelete="CASCADE"), primary_key=True),
    Column("category_id", ForeignKey("categories.id", ondelete="CASCADE"), primary_key=True),
)


class Publication(Base):
    __tablename__ = "publications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, index=True)
    published_date: Mapped[Optional[datetime]] = mapped_column(Date, nullable=True, index=True)
    title: Mapped[str] = mapped_column(Text, index=True)
    doi: Mapped[Optional[str]] = mapped_column(String(255), index=True, nullable=True)
    pdf_url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    # Generic external URL (journal page, Kokson link, etc.)
    url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    scopus_url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    # Generic language for publication (e.g., 'kz', 'ru', 'en')
    language: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    citations_count: Mapped[int] = mapped_column(Integer, default=0, index=True)
    quartile: Mapped[Optional[str]] = mapped_column(String(8), index=True, nullable=True)  # e.g., Q1..Q4
    percentile_2024: Mapped[Optional[int]] = mapped_column(Integer, index=True, nullable=True)
    # Document type for Kokson/Articles (e.g., KOKSON list, journal, monograph, etc.)
    doc_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    # Number of main authors at the start of the authors list; the rest are coauthors
    main_authors_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)

    # Uploader tracking (no registration: session-based client id and role)
    uploader_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, nullable=True)
    uploaded_by_role: Mapped[Optional[str]] = mapped_column(String(16), index=True, nullable=True)  # guest|user|admin

    source_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sources.id"), index=True, nullable=True)
    source: Mapped[Optional[Source]] = relationship("Source", back_populates="publications")

    authors: Mapped[List[Author]] = relationship(
        "Author",
        secondary=publication_authors,
        back_populates="publications",
        order_by="publication_authors.c.author_order",
    )

    categories: Mapped[List[Category]] = relationship(
        "Category",
        secondary=publication_categories,
        back_populates="publications",
    )

    status: Mapped[str] = mapped_column(String(16), default="approved", index=True)  # pending|approved|rejected
    # Source of upload: scopus|kokson|manual
    upload_source: Mapped[Optional[str]] = mapped_column(String(16), nullable=True, index=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # admin rejection note or other
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Author(Base):
    __tablename__ = "authors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    display_name: Mapped[str] = mapped_column(String(255), index=True)
    normalized_name: Mapped[Optional[str]] = mapped_column(String(255), index=True, nullable=True)
    faculty: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    department: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    user: Mapped[Optional["User"]] = relationship("User")

    publications: Mapped[List[Publication]] = relationship(
        "Publication",
        secondary=publication_authors,
        back_populates="authors",
    )


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    type: Mapped[Optional[str]] = mapped_column(String(32), default="journal", index=True)
    issn: Mapped[Optional[str]] = mapped_column(String(32), index=True, nullable=True)
    sjr_quartile: Mapped[Optional[str]] = mapped_column(String(8), index=True, nullable=True)

    publications: Mapped[List[Publication]] = relationship("Publication", back_populates="source")


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    slug: Mapped[str] = mapped_column(String(128), unique=True, index=True)

    publications: Mapped[List[Publication]] = relationship(
        "Publication",
        secondary=publication_categories,
        back_populates="categories",
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    full_name: Mapped[str] = mapped_column(String(255), index=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True, index=True)
    role: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, index=True)  # admin|teacher|student
    faculty: Mapped[str] = mapped_column(String(128), index=True)
    department: Mapped[str] = mapped_column(String(128), index=True)
    login: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    # For imported users: optional initial password to show to admin/self; do NOT export
    initial_password: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    name_variants: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON-encoded list of string variants
    position: Mapped[str] = mapped_column(String(64), index=True)  # e.g., Оқытушы, Кафедра меңгерушісі, Декан, Ғылымға жауапты, Админ
    degree: Mapped[str] = mapped_column(String(128), default="", index=True)
    active: Mapped[int] = mapped_column(Integer, default=1, index=True)
    # How the user was created: 'admin' | 'import' | 'api'
    created_source: Mapped[Optional[str]] = mapped_column(String(16), nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
