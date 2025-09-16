from __future__ import annotations
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Header, Query, Body, UploadFile, File
from sqlalchemy.orm import Session, joinedload, aliased
from sqlalchemy import select, desc, asc, or_, func
import os
import json
import hashlib

from .db import get_db
from .config import get_settings
from .models import Publication, User, Author, publication_authors
from .schemas import PublicationOut, UserOut, UserWithCountOut, UserCreate, UserUpdate, UserPasswordChange, MatchPreviewResponse, LoginCheckResponse

router = APIRouter(prefix="/admin", tags=["admin"])

UPLOAD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'uploads'))


def require_admin(authorization: Optional[str] = Header(default=None)) -> None:
    settings = get_settings()
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = authorization.split()
    token = parts[-1] if parts else authorization
    if token != settings.ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid admin token")

# -----------------------------
# Helpers (password hash, name variants)
# -----------------------------
def _hash_password(pw: str, salt: str) -> str:
    data = (salt + pw).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def _generate_name_variants(full_name: str) -> List[str]:
    parts = [p for p in full_name.replace("\u00A0", " ").strip().split() if p]
    if not parts:
        return []
    # assume first token is last name in local formatting (common in CIS)
    last = parts[0]
    initials = "".join([(p[0] + ".") for p in parts[1:]])  # S.S.
    one_init = (parts[1][0] + ".") if len(parts) > 1 else ""

    def translit(s: str) -> str:
        table = {
            "А":"A","Б":"B","В":"V","Г":"G","Д":"D","Е":"E","Ё":"E","Ж":"Zh","З":"Z","И":"I","Й":"Y","К":"K","Л":"L","М":"M","Н":"N","О":"O","П":"P","Р":"R","С":"S","Т":"T","У":"U","Ф":"F","Х":"Kh","Ц":"Ts","Ч":"Ch","Ш":"Sh","Щ":"Sch","Ы":"Y","Э":"E","Ю":"Yu","Я":"Ya",
            "а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"e","ж":"zh","з":"z","и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"kh","ц":"ts","ч":"ch","ш":"sh","щ":"sch","ы":"y","э":"e","ю":"yu","я":"ya",
        }
        return "".join([table.get(ch, ch) for ch in s])

    candidates = set()
    variants_last = {last, translit(last)}
    for l in variants_last:
        candidates.add(l)
        if one_init:
            candidates.add(f"{l} {one_init}")
        if initials:
            candidates.add(f"{l} {initials}")
        if one_init:
            candidates.add(f"{one_init} {l}")
        if initials:
            spaced = " ".join([f"{c}." for c in initials.replace('.', '') if c]) if initials else ""
            if spaced:
                candidates.add(f"{spaced} {l}")
    if initials:
        candidates.add(initials)
    return sorted({c.strip() for c in candidates if c.strip()})


# -----------------------------
# Publications moderation
# -----------------------------
@router.get("/publications", response_model=list[PublicationOut])
def list_publications(
    status: Optional[str] = Query(default=None, description="pending|approved|rejected"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    order: str = Query(default="created_desc", description="created_desc|year_desc|year_asc"),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    stmt = select(Publication).options(joinedload(Publication.source), joinedload(Publication.authors))
    if status:
        stmt = stmt.where(Publication.status == status)
    if order == "year_asc":
        stmt = stmt.order_by(asc(Publication.year), Publication.id)
    elif order == "year_desc":
        stmt = stmt.order_by(desc(Publication.year), Publication.id)
    else:
        stmt = stmt.order_by(desc(Publication.created_at))
    offset = (page - 1) * per_page
    stmt = stmt.offset(offset).limit(per_page)
    rows = db.execute(stmt).scalars().unique().all()
    return [PublicationOut.model_validate(p) for p in rows]


@router.post("/publications/{pub_id}/approve")
def approve_publication(pub_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    pub = db.get(Publication, pub_id)
    if not pub:
        raise HTTPException(status_code=404, detail="Publication not found")
    pub.status = "approved"
    pub.note = None
    db.add(pub)
    db.commit()
    return {"ok": True}


# -----------------------------
# Users management
# -----------------------------

@router.get("/users", response_model=List[UserWithCountOut])
def list_users(
    q: Optional[str] = Query(default=None),
    role: Optional[str] = Query(default=None),
    faculty: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """List users with publications_count computed by strict author-name matching.
    Strategy per user: strict normalized equality to Author.display_name only.
    Counts are DISTINCT publication ids.
    """

    # base users query with filters
    u_stmt = select(User)
    if q:
        like = f"%{q}%"
        u_stmt = u_stmt.where(or_(User.full_name.ilike(like), User.login.ilike(like), User.email.ilike(like)))
    if role:
        u_stmt = u_stmt.where(User.role == role)
    if faculty:
        u_stmt = u_stmt.where(User.faculty == faculty)
    u_stmt = u_stmt.order_by(User.full_name)
    users = db.execute(u_stmt).scalars().all()

    def norm_expr(col):
        return func.lower(
            func.replace(
                func.replace(
                    func.replace(func.replace(col, ",", ""), "\u00A0", " "),
                    ".", ""
                ),
                " ", ""
            )
        )

    out: List[UserWithCountOut] = []
    for u in users:
        raw = (u.full_name or '').replace("\u00A0", " ").strip()
        norm = raw.lower().replace(".", "").replace(",", "").replace(" ", "")
        parts = [p for p in raw.split() if p]
        last = parts[0].lower() if parts else ''
        inits = ''.join([p[0].lower() for p in parts[1:]])
        # exact equality count (strict)
        eq_count_stmt = (
            select(func.count(func.distinct(Publication.id)))
            .select_from(Publication)
            .join(publication_authors, publication_authors.c.publication_id == Publication.id)
            .join(Author, Author.id == publication_authors.c.author_id)
            .where(norm_expr(Author.display_name) == norm)
        )
        pubs_count = db.execute(eq_count_stmt).scalar() or 0
        # fallback: require last name and all initials to be present in normalized author string
        if pubs_count == 0 and last:
            cond = norm_expr(Author.display_name).like(f"%{last.replace(' ', '')}%")
            for ch in inits:
                cond = cond & norm_expr(Author.display_name).like(f"%{ch}%")
            fb_count_stmt = (
                select(func.count(func.distinct(Publication.id)))
                .select_from(Publication)
                .join(publication_authors, publication_authors.c.publication_id == Publication.id)
                .join(Author, Author.id == publication_authors.c.author_id)
                .where(cond)
            )
            pubs_count = db.execute(fb_count_stmt).scalar() or 0
        # final fallback: name variants with ILIKE OR (broader)
        if pubs_count == 0:
            variants = _generate_name_variants(u.full_name or '')
            if variants:
                conds = [Author.display_name.ilike(f"%{v}%") for v in variants]
                var_count_stmt = (
                    select(func.count(func.distinct(Publication.id)))
                    .select_from(Publication)
                    .join(publication_authors, publication_authors.c.publication_id == Publication.id)
                    .join(Author, Author.id == publication_authors.c.author_id)
                    .where(or_(*conds))
                )
                pubs_count = db.execute(var_count_stmt).scalar() or 0

        d = UserOut.model_validate(u).model_dump()
        d["publications_count"] = int(pubs_count)
        out.append(UserWithCountOut(**d))

    return out


@router.get("/users/match_preview", response_model=MatchPreviewResponse)
def users_match_preview(full_name: str, exact: bool = Query(default=False), db: Session = Depends(get_db), _=Depends(require_admin)):
    """Preview publications matched to a person's full name.
    If exact=True or by default, use strict normalized equality only.
    """
    norm = full_name.replace("\u00A0", " ").strip()
    if not norm:
        return MatchPreviewResponse(count=0, examples=[], publications=[])

    def normalized_expr(col):
        # lower(trim(replace(non-breaking space, space)))
        return func.lower(func.replace(func.replace(col, ",", ""), "\u00A0", " "))

    pubs: list[Publication] = []
    ids: set[int] = set()

    # 1) Exact normalized equality match Author.display_name == full_name (case-insensitive)
    if exact:
        eq_stmt = (
            select(Publication)
            .join(publication_authors, publication_authors.c.publication_id == Publication.id)
            .join(Author, Author.id == publication_authors.c.author_id)
            .where(normalized_expr(Author.display_name) == norm.lower())
            .options(joinedload(Publication.source), joinedload(Publication.authors))
            .limit(50)
        )
        pubs = db.execute(eq_stmt).scalars().unique().all()
        if pubs:
            ids = {p.id for p in pubs}
            return MatchPreviewResponse(count=len(ids), examples=[norm], publications=[PublicationOut.model_validate(p) for p in pubs])
        # fallback strict: require last name and initials present
        parts = [p for p in norm.split() if p]
        last = parts[0] if parts else ''
        inits = ''.join([p[0] for p in parts[1:]])
        if last:
            cond = normalized_expr(Author.display_name).like(f"%{last}%")
            for ch in inits:
                cond = cond & normalized_expr(Author.display_name).like(f"%{ch}%")
            fb_stmt = (
                select(Publication)
                .join(publication_authors, publication_authors.c.publication_id == Publication.id)
                .join(Author, Author.id == publication_authors.c.author_id)
                .where(cond)
                .options(joinedload(Publication.source), joinedload(Publication.authors))
                .limit(50)
            )
            pubs = db.execute(fb_stmt).scalars().unique().all()
            if pubs:
                ids = {p.id for p in pubs}
                return MatchPreviewResponse(count=len(ids), examples=[norm], publications=[PublicationOut.model_validate(p) for p in pubs])
    # If nothing found, return empty (no fuzzy fallback in strict mode)
    return MatchPreviewResponse(count=0, examples=[norm], publications=[])


@router.post("/users", response_model=UserOut)
def create_user(payload: UserCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    settings = get_settings()
    # ensure unique login
    desired_login = (payload.login or payload.email or payload.full_name.replace(" ", ".").lower()).strip()
    if not desired_login:
        raise HTTPException(status_code=400, detail="Login is required")
    # check email uniqueness if provided
    if payload.email:
        exists_email = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
        if exists_email:
            raise HTTPException(status_code=400, detail="Email already exists")
    # disallow using reserved admin static login
    if desired_login == settings.ADMIN_LOGIN:
        raise HTTPException(status_code=400, detail="Login is reserved")
    login = desired_login
    if db.execute(select(User).where(User.login == login)).scalar_one_or_none():
        # ensure uniqueness
        login = f"{login}.{hashlib.sha1(login.encode()).hexdigest()[:6]}"
    variants = _generate_name_variants(payload.full_name)
    u = User(
        full_name=payload.full_name,
        email=payload.email,
        role=payload.role,
        faculty=payload.faculty,
        department=payload.department,
        position=payload.position,
        degree=payload.degree,
        login=login,
        password_hash=_hash_password(payload.password, settings.PASSWORD_SALT),
        name_variants=json.dumps(variants, ensure_ascii=False),
        active=1,
    )
    db.add(u)
    db.flush()

    # auto-link publications by author variants
    if variants:
        conds = [Author.display_name.ilike(f"%{v}%") for v in variants]
        stmt = (
            select(Publication)
            .join(publication_authors, publication_authors.c.publication_id == Publication.id)
            .join(Author, Author.id == publication_authors.c.author_id)
            .where(or_(*conds))
        )
        pubs = db.execute(stmt).scalars().unique().all()
        for p in pubs:
            p.user_id = u.id
            db.add(p)

    db.commit()
    db.refresh(u)
    return UserOut.model_validate(u)


@router.get("/users/check_login", response_model=LoginCheckResponse)
def check_login(login: str, db: Session = Depends(get_db), _=Depends(require_admin)):
    settings = get_settings()
    exists = db.execute(select(User).where(User.login == login)).scalar_one_or_none()
    # also treat static ADMIN_LOGIN as reserved
    if login == settings.ADMIN_LOGIN:
        return LoginCheckResponse(available=False)
    return LoginCheckResponse(available=not bool(exists))


@router.patch("/users/{user_id}/active")
def set_user_active(user_id: int, active: int = Body(embed=True), db: Session = Depends(get_db), _=Depends(require_admin)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    u.active = 1 if int(active) else 0
    db.add(u)
    db.commit()
    return {"ok": True}


@router.get("/users/{user_id}/publications", response_model=List[PublicationOut])
def user_publications(
    user_id: int,
    match: str = Query(default="initials", description="exact | initials | broad"),
    # 'exact'    -> only exact normalized equality
    # 'initials' -> exact + last name with all initials present (recommended)
    # 'broad'    -> initials + name variants + legacy user_id link
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Return publications for a user by matching their full_name to authors.
    match parameter controls strictness: exact | initials | broad.
    """
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    def norm_expr(col):
        return func.lower(
            func.replace(
                func.replace(
                    func.replace(col, "\u00A0", " "),
                    ".", ""
                ),
                " ", ""
            )
        )

    raw = (u.full_name or '').replace("\u00A0", " ").strip()
    norm = raw.lower().replace(".", "").replace(",", "").replace(" ", "")
    parts = [p for p in raw.split() if p]
    last = parts[0].lower() if parts else ''
    inits = ''.join([p[0].lower() for p in parts[1:]])

    # Build a distinct set of publication IDs
    pub_ids: set[int] = set()

    # A) exact normalized equality (always applied)
    ids_eq = db.execute(
        select(Publication.id)
        .join(publication_authors, publication_authors.c.publication_id == Publication.id)
        .join(Author, Author.id == publication_authors.c.author_id)
        .where(norm_expr(Author.display_name) == norm)
    ).all()
    pub_ids.update([row[0] for row in ids_eq])

    if match in ("initials", "broad"):
        # B) last name + all initials present
        if last:
            cond = norm_expr(Author.display_name).like(f"%{last}%")
            for ch in inits:
                cond = cond & norm_expr(Author.display_name).like(f"%{ch}%")
            ids_fb = db.execute(
                select(Publication.id)
                .join(publication_authors, publication_authors.c.publication_id == Publication.id)
                .join(Author, Author.id == publication_authors.c.author_id)
                .where(cond)
            ).all()
            pub_ids.update([row[0] for row in ids_fb])

    if match == "broad":
        # C) name variants ILIKE OR (broad)
        variants = _generate_name_variants(u.full_name or '')
        if variants:
            conds = [Author.display_name.ilike(f"%{v}%") for v in variants]
            ids_var = db.execute(
                select(Publication.id)
                .join(publication_authors, publication_authors.c.publication_id == Publication.id)
                .join(Author, Author.id == publication_authors.c.author_id)
                .where(or_(*conds))
            ).all()
            pub_ids.update([row[0] for row in ids_var])

        # D) legacy fallback: publications explicitly linked to user_id
        ids_link = db.execute(
            select(Publication.id).where(Publication.user_id == user_id)
        ).all()
        pub_ids.update([row[0] for row in ids_link])

    if not pub_ids:
        return []

    rows = db.execute(
        select(Publication)
        .where(Publication.id.in_(list(pub_ids)))
        .options(joinedload(Publication.source), joinedload(Publication.authors))
        .order_by(desc(Publication.year), Publication.id)
    ).scalars().unique().all()
    return [PublicationOut.model_validate(p) for p in rows]


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    # handle login change with uniqueness check
    if payload.login is not None:
        new_login = payload.login.strip()
        if not new_login:
            raise HTTPException(status_code=400, detail="Login cannot be empty")
        if new_login != u.login:
            settings = get_settings()
            if new_login == settings.ADMIN_LOGIN:
                raise HTTPException(status_code=400, detail="Login is reserved")
            exists = db.execute(select(User).where(User.login == new_login)).scalar_one_or_none()
            if exists:
                raise HTTPException(status_code=400, detail="Login already exists")
            u.login = new_login
    for field in ["full_name","email","role","faculty","department","position","degree","active"]:
        val = getattr(payload, field)
        if val is not None:
            setattr(u, field, val)
    # if full_name changed, recompute variants and relink
    if payload.full_name is not None:
        variants = _generate_name_variants(u.full_name)
        u.name_variants = json.dumps(variants, ensure_ascii=False)
        # relink (simple strategy: link publications matching variants)
        conds = [Author.display_name.ilike(f"%{v}%") for v in variants]
        stmt = (
            select(Publication)
            .join(publication_authors, publication_authors.c.publication_id == Publication.id)
            .join(Author, Author.id == publication_authors.c.author_id)
            .where(or_(*conds))
        )
        pubs = db.execute(stmt).scalars().unique().all()
        for p in pubs:
            p.user_id = u.id
            db.add(p)
    db.add(u)
    db.commit()
    db.refresh(u)
    return UserOut.model_validate(u)


@router.patch("/users/{user_id}/password")
def update_user_password(user_id: int, payload: UserPasswordChange, db: Session = Depends(get_db), _=Depends(require_admin)):
    settings = get_settings()
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    u.password_hash = _hash_password(payload.password, settings.PASSWORD_SALT)
    db.add(u)
    db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(u)
    db.commit()
    return {"ok": True}
@router.post("/publications/{pub_id}/reject")
def reject_publication(
    pub_id: int,
    note: Optional[str] = Body(default=None, embed=True),  # expect {"note": "..."}
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    pub = db.get(Publication, pub_id)
    if not pub:
        raise HTTPException(status_code=404, detail="Publication not found")
    pub.status = "rejected"
    pub.note = note
    db.add(pub)
    db.commit()
    return {"ok": True}


@router.delete("/publications/{pub_id}")
def delete_publication(pub_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    pub = db.get(Publication, pub_id)
    if not pub:
        raise HTTPException(status_code=404, detail="Publication not found")
    # try remove file from disk if present
    try:
        if pub.pdf_url:
            fname = os.path.basename(pub.pdf_url)
            fpath = os.path.join(UPLOAD_DIR, fname)
            if os.path.isfile(fpath):
                os.remove(fpath)
    except Exception:
        pass
    db.delete(pub)
    db.commit()
    return {"ok": True}

# -----------------------------
# Import faculty/users from Excel (upload in browser)
# -----------------------------

@router.post("/import/faculty")
def import_faculty_excel(
    authorization: Optional[str] = Header(default=None),
    file: UploadFile = File(..., description="Excel file with faculty/users (e.g., факультет.xlsx)"),
):
    """Upload an Excel file and import faculty/department/users to DB.
    Auth: pass admin token in Authorization header (raw token or 'Bearer <token>').
    """
    require_admin(authorization)  # raises 401 if invalid

    # Save to a temporary file under uploads
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    temp_path = os.path.join(UPLOAD_DIR, f"_faculty_import_{file.filename}")
    with open(temp_path, "wb") as out:
        out.write(file.file.read())

    # Run importer
    try:
        try:
            from scripts.import_faculty_excel import import_faculty_from_excel  # type: ignore
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Importer not available: {e}")

        res = import_faculty_from_excel(temp_path)
        return {"status": "ok", **res}
    finally:
        try:
            os.remove(temp_path)
        except Exception:
            pass


@router.post("/import/publications")
def import_publications_excel(
    authorization: Optional[str] = Header(default=None),
    file: UploadFile = File(..., description="Scopus Excel with Sources/Publications (e.g., zhubanov_scopus_issn.xlsx)"),
):
    """Upload Scopus Excel and import Sources and Publications on the server.
    Auth via `Authorization: Bearer <ADMIN_TOKEN>`.
    """
    require_admin(authorization)

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    temp_path = os.path.join(UPLOAD_DIR, f"_pubs_import_{file.filename}")
    with open(temp_path, "wb") as out:
        out.write(file.file.read())

    try:
        try:
            from scripts.import_excel import load_sources_from_excel, load_publications_from_excel  # type: ignore
            from app.db import SessionLocal
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Importer not available: {e}")

        db = SessionLocal()
        try:
            load_sources_from_excel(db, temp_path)
            created = load_publications_from_excel(db, temp_path)
        finally:
            db.close()
        return {"status": "ok", "publications_imported": created}
    finally:
        try:
            os.remove(temp_path)
        except Exception:
            pass


@router.patch("/publications/{pub_id}", response_model=PublicationOut)
def update_publication(
    pub_id: int,
    title: Optional[str] = None,
    year: Optional[int] = None,
    doi: Optional[str] = None,
    scopus_url: Optional[str] = None,
    pdf_url: Optional[str] = None,
    citations_count: Optional[int] = None,
    quartile: Optional[str] = None,
    percentile_2024: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    pub = db.get(Publication, pub_id)
    if not pub:
        raise HTTPException(status_code=404, detail="Publication not found")
    if title is not None:
        pub.title = title
    if year is not None:
        pub.year = year
    if doi is not None:
        pub.doi = doi
    if scopus_url is not None:
        pub.scopus_url = scopus_url
    if pdf_url is not None:
        pub.pdf_url = pdf_url
    if citations_count is not None:
        pub.citations_count = citations_count
    if quartile is not None:
        pub.quartile = quartile
    if percentile_2024 is not None:
        pub.percentile_2024 = percentile_2024
    db.add(pub)
    db.commit()
    db.refresh(pub)
    return PublicationOut.model_validate(pub)
