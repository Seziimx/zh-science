from __future__ import annotations

from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, Header
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import select
import os
import shutil

from .db import get_db
from .models import Publication, Author, Source
from .schemas import PublicationCreate, ValidateSourceResponse, PublicationOut
from .config import get_settings


def _role_from_token(token: str) -> str | None:
    s = get_settings()
    if token == s.ADMIN_TOKEN:
        return "admin"
    if token == s.USER_TOKEN:
        return "user"
    return None


def require_uploader(authorization: str | None = Header(default=None), x_client_id: str | None = Header(default=None)) -> tuple[str, str]:
    """Return (role, client_id). Only allow user/admin tokens."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = authorization.split()[-1]
    role = _role_from_token(token)
    if not role:
        raise HTTPException(status_code=401, detail="Invalid token")
    if not x_client_id:
        raise HTTPException(status_code=400, detail="Missing X-Client-Id header")
    return role, x_client_id

router = APIRouter(prefix="/publications", tags=["publications"])

# Resolve uploads directory from settings (supports Render Disk via UPLOAD_DIR env)
_settings = get_settings()
UPLOAD_DIR = _settings.UPLOAD_DIR
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.get("/validate/source", response_model=ValidateSourceResponse)
def validate_source(
    issn: Optional[str] = Query(default=None),
    name: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _dep: tuple[str, str] = Depends(require_uploader),
):
    if not issn and not name:
        raise HTTPException(status_code=400, detail="Provide issn or name")

    stmt = select(Source)
    if issn:
        stmt = stmt.where(Source.issn == issn)
    elif name:
        stmt = stmt.where(Source.name.ilike(name))

    src = db.execute(stmt).scalars().first()
    if src:
        return ValidateSourceResponse(found=True, source=src)  # type: ignore[arg-type]
    return ValidateSourceResponse(found=False, message="Источник не найден в базе")


@router.post("", response_model=PublicationOut, status_code=201)
def create_publication(payload: PublicationCreate, db: Session = Depends(get_db)):
    # Source detect or create (lightweight)
    src: Optional[Source] = None
    if payload.issn:
        src = db.execute(select(Source).where(Source.issn == payload.issn)).scalars().first()
    if not src and payload.source_name:
        src = db.execute(select(Source).where(Source.name.ilike(payload.source_name))).scalars().first()
    if not src and (payload.issn or payload.source_name):
        src = Source(
            name=payload.source_name or (payload.issn or "Unknown"),
            issn=payload.issn,
            type=(payload.source_type or "journal"),
        )
        db.add(src)
        db.flush()

    # Create or reuse authors
    author_objs: List[Author] = []
    for idx, name in enumerate(payload.authors):
        nm = (name or "").strip()
        if not nm:
            continue
        existing = db.execute(select(Author).where(Author.display_name == nm)).scalars().first()
        if existing:
            author_objs.append(existing)
        else:
            a = Author(display_name=nm, normalized_name=nm.lower())
            db.add(a)
            db.flush()
            author_objs.append(a)

    pub = Publication(
        title=payload.title.strip(),
        year=payload.year,
        doi=(payload.doi or None),
        pdf_url=(payload.pdf_url or None),
        citations_count=payload.citations_count or 0,
        quartile=None,  # may be inferred from src later
        source=src,
        status="pending",  # submissions go to moderation
    )
    # Любое редактирование через личный кабинет переводит публикацию в pending на повторную модерацию
    # (админ правит через админ-роуты; здесь всегда pending)
    pub.status = "pending"

    db.add(pub)
    db.flush()

    # link authors preserving order
    pub.authors = author_objs

    # infer quartile from source if present
    if src and src.sjr_quartile and not pub.quartile:
        pub.quartile = src.sjr_quartile

    db.commit()
    db.refresh(pub)
    return pub  # type: ignore[return-value]


@router.post("/upload", status_code=201)
async def upload_publication(
    title: str = Form(...),
    year: int = Form(...),
    authors: str = Form(...),  # semicolon-separated list
    source_name: Optional[str] = Form(None),
    issn: Optional[str] = Form(None),
    doi: Optional[str] = Form(None),
    citations_count: Optional[int] = Form(0),
    quartile: Optional[str] = Form(None),
    percentile_2024: Optional[int] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    actor: tuple[str, str] = Depends(require_uploader),
):
    # 1) Save file to uploads/
    safe_title = "_".join(title.strip().split())[:60]
    filename = f"{safe_title}_{year}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # 2) Source detect or create (by strict name first)
    src: Optional[Source] = None
    if source_name:
        src = db.execute(select(Source).where(Source.name == source_name.strip())).scalars().first()
    if not src and issn:
        src = db.execute(select(Source).where(Source.issn == issn.strip())).scalars().first()
    if not src and (source_name or issn):
        src = Source(
            name=source_name or (issn or "Unknown"),
            issn=issn,
            type="journal",
        )
        db.add(src)
        db.flush()

    # 3) Authors (split by ';')
    author_objs: List[Author] = []
    for nm in [a.strip() for a in authors.split(';') if a.strip()]:
        existing = db.execute(select(Author).where(Author.display_name == nm)).scalars().first()
        if existing:
            author_objs.append(existing)
        else:
            a = Author(display_name=nm, normalized_name=" ".join(nm.lower().split()))
            db.add(a)
            db.flush()
            author_objs.append(a)

    # 4) Create publication (pending)
    role, client_id = actor
    pub = Publication(
        title=title.strip(),
        year=year,
        doi=(doi or None),
        pdf_url=f"/uploads/{filename}",  # relative URL served by static
        citations_count=citations_count or 0,
        quartile=quartile,
        percentile_2024=percentile_2024,
        source=src,
        status="pending",
        uploader_id=client_id,
        uploaded_by_role=role,
    )
    db.add(pub)
    db.flush()
    pub.authors = author_objs
    db.commit()
    db.refresh(pub)
    return {"message": "Publication uploaded", "publication_id": pub.id, "pdf_url": pub.pdf_url}


@router.get("/{pub_id}/download")
def download_publication_file(pub_id: int, db: Session = Depends(get_db)):
    pub = db.get(Publication, pub_id)
    if not pub or not pub.pdf_url:
        raise HTTPException(status_code=404, detail="File not found")
    # Ensure we only serve files from uploads dir
    fname = os.path.basename(pub.pdf_url)
    file_path = os.path.join(UPLOAD_DIR, fname)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=file_path, filename=fname, media_type="application/octet-stream")


@router.get("/mine", response_model=list[PublicationOut])
def my_publications(
    q: Optional[str] = Query(default=None, description="Поиск по названию/DOI/источнику"),
    db: Session = Depends(get_db),
    actor: tuple[str, str] = Depends(require_uploader),
):
    role, client_id = actor
    stmt = select(Publication).options().order_by(Publication.created_at.desc())
    # lightweight search by title/doi/source name
    if q:
        like = f"%{q.strip()}%"
        from .models import Source as Src
        stmt = stmt.join(Src, isouter=True).where(
            (Publication.title.ilike(like)) |
            ((Publication.doi != None) & (Publication.doi.ilike(like))) |
            ((Publication.source_id != None) & (Src.name.ilike(like)))
        )
    if role != "admin":
        stmt = stmt.where(Publication.uploader_id == client_id)
    rows = db.execute(stmt).scalars().unique().all()
    return [PublicationOut.model_validate(p) for p in rows]


@router.api_route("/mine/{pub_id}", methods=["PATCH", "POST"], response_model=PublicationOut)
async def update_my_publication(
    pub_id: int,
    title: Optional[str] = Form(None),
    year: Optional[int] = Form(None),
    doi: Optional[str] = Form(None),
    citations_count: Optional[int] = Form(None),
    quartile: Optional[str] = Form(None),
    percentile_2024: Optional[int] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    actor: tuple[str, str] = Depends(require_uploader),
):
    role, client_id = actor
    pub = db.get(Publication, pub_id)
    if not pub:
        raise HTTPException(status_code=404, detail="Publication not found")
    if role != "admin" and pub.uploader_id != client_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    # Разрешаем редактирование, если статус pending или rejected (для пользователя).
    # Админ может редактировать любой статус.
    if role != "admin" and pub.status not in ("pending", "rejected"):
        raise HTTPException(status_code=400, detail="Only pending or rejected publications can be edited")

    # Replace file if provided
    if file is not None:
        # remove old file
        try:
            if pub.pdf_url:
                old = os.path.join(UPLOAD_DIR, os.path.basename(pub.pdf_url))
                if os.path.isfile(old):
                    os.remove(old)
        except Exception:
            pass
        safe_title = "_".join((title or pub.title).strip().split())[:60]
        original_name = os.path.basename(file.filename)
        filename = f"{safe_title}_{(year or pub.year)}_{original_name}"
        file_path = os.path.join(UPLOAD_DIR, filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        pub.pdf_url = f"/uploads/{filename}"

    if title is not None:
        pub.title = title
    if year is not None:
        pub.year = year
    if doi is not None:
        pub.doi = doi
    if citations_count is not None:
        pub.citations_count = citations_count
    if quartile is not None:
        pub.quartile = quartile
    if percentile_2024 is not None:
        pub.percentile_2024 = percentile_2024

    # After any personal edit, send back to moderation
    pub.status = "pending"
    pub.note = None

    db.add(pub)
    db.commit()
    db.refresh(pub)
    return PublicationOut.model_validate(pub)
