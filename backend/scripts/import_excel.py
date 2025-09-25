from __future__ import annotations
import os
import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy import select

# Ensure backend package is importable when running as: `python scripts/import_excel.py`
import sys
SCRIPT_DIR = os.path.dirname(__file__)
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, '..'))
if BACKEND_DIR not in sys.path:
    sys.path.append(BACKEND_DIR)

from app.db import SessionLocal, Base, engine
from app.models import Source, Publication, Author

# Flexible column aliases
ALIASES = {
    'issn': {'issn', 'issn/isbn', 'issn/e-issn', 'issn/eissn'},
    'name': {'source', 'journal', 'журнал', 'название журнала', 'издание', 'источник'},
    'quartile': {'quartile', 'sjr', 'sjr quartile', 'q', 'квартиль'},
    'type': {'type', 'источник тип', 'source type', 'вид', 'journal/conference'},
}

PUB_ALIASES = {
    'authors': {
        'автор(ы)', 'автор', 'авторы',
        'author', 'authors',
        'author full names', 'authors full names', 'author full name', 'full names of authors',
        'полные имена авторов', 'автор полные имена', 'автор полное имя',
    },
    'title': {'title', 'название', 'название документа'},
    'year': {'year', 'год'},
    'source_name': {'название источника', 'source name'},
    'issn': {'issn', 'issn/isbn', 'issn/e-issn', 'issn/eissn'},
    'doi': {'doi'},
    'citations': {'citations', 'цитирования'},
    'pdf_url': {'pdf', 'pdf url'},
    'scopus_url': {'ссылка', 'link', 'scopus', 'scopus link'},
    'quartile': {'quartile', 'квартиль'},
    'percentile_2024': {'percentile_2024', 'процентиль 2024', 'percentile', 'percentile2024'},
    'note': {'note', 'comment', 'comments', 'примечание', 'комментарий', 'ескерту', 'ескертуi', 'ескертуі', 'ескертулер'},
}


def norm_col(col: str) -> str:
    c = str(col).strip().lower()
    for key, names in ALIASES.items():
        if c in names:
            return key
    return c


def norm_pub_col(col: str) -> str:
    c = str(col).strip().lower()
    for key, names in PUB_ALIASES.items():
        if c in names:
            return key
    # Fuzzy fallbacks for common variants
    if ('full' in c and 'author' in c) or ('полные' in c and 'автор' in c):
        return 'authors'
    if 'автор' in c:
        return 'authors'
    if 'название источ' in c:
        return 'source_name'
    if 'название' in c and 'документ' in c:
        return 'title'
    if c == 'год' or ' year' in c or c == 'year':
        return 'year'
    if 'scopus' in c or 'ссылка' in c or 'link' in c:
        return 'scopus_url'
    return c


import re
_PARENS_RE = re.compile(r"\s*\([^)]*\)\s*")

def clean_name(nm: str) -> str:
    nm = _PARENS_RE.sub(" ", nm)
    nm = " ".join(nm.split())
    return nm.strip()

def parse_authors(cell: str) -> list[str]:
    """Strict parser: take authors exactly from 'Автор(ы)'.
    Handle NaN cells and split only by semicolon or newline.
    """
    if cell is None:
        return []
    # If pandas NaN was stringified earlier
    if isinstance(cell, float):  # real NaN
        return []
    s = str(cell).strip()
    if not s or s.lower() == "nan":
        return []
    parts = re.split(r"[;\n]+", s)
    return [p.strip() for p in parts if p and p.strip()]


def looks_like_pdf(url: str | None) -> bool:
    if not url:
        return False
    u = str(url).lower().strip()
    if u.endswith('.pdf'):
        return True
    if 'format=pdf' in u or 'application/pdf' in u:
        return True
    return False


def load_sources_from_excel(db: Session, excel_path: str) -> int:
    if not os.path.exists(excel_path):
        print(f"Excel not found: {excel_path}")
        return 0

    xls = pd.ExcelFile(excel_path)
    df = None
    for sheet in xls.sheet_names:
        tmp = xls.parse(sheet)
        cols = [norm_col(c) for c in tmp.columns]
        if ("issn" in cols) or ("name" in cols):
            tmp.columns = cols
            df = tmp
            print(f"[import] Sources sheet detected: {sheet}")
            break
    if df is None:
        df = pd.read_excel(excel_path)
        df.columns = [norm_col(c) for c in df.columns]
        print("[import] Sources sheet not detected explicitly — using the first sheet")

    created = 0
    updated_cnt = 0
    for _, row in df.iterrows():
        name = str(row.get('name') or '').strip()
        issn = str(row.get('issn') or '').strip()
        # Ignore quartile from Excel for sources
        src_type = str(row.get('type') or '').strip().lower() or 'journal'
        if not name and not issn:
            continue

        stmt = select(Source)
        if issn:
            stmt = stmt.where(Source.issn == issn)
        else:
            stmt = stmt.where(Source.name == name)
        existing = db.execute(stmt).scalars().first()
        if existing:
            updated = False
            # Do not import quartile for sources
            if src_type and (existing.type or '').strip() != src_type:
                existing.type = src_type
                updated = True
            if updated:
                db.add(existing)
            continue

        src = Source(
            name=name or (issn or 'unknown'),
            issn=issn or None,
            type=src_type
        )
        db.add(src)
        created += 1

    if created:
        db.commit()
    print(f"Sources imported/updated. New created: {created}")
    return created


def load_publications_from_excel(db: Session, excel_path: str) -> int:
    if not os.path.exists(excel_path):
        print(f"Excel not found: {excel_path}")
        return 0

    xls = pd.ExcelFile(excel_path)
    df = None
    for sheet in xls.sheet_names:
        tmp = xls.parse(sheet)
        cols = [norm_pub_col(c) for c in tmp.columns]
        if ("title" in cols) and ("year" in cols):
            tmp.columns = cols
            df = tmp
            print(f"[import] Publications sheet detected: {sheet}")
            break
    if df is None:
        print("[import] Publications sheet not found — skipping publications import. Ensure the sheet contains columns 'Название документа/Title' и 'Год/Year'.")
        return 0

    created = 0
    updated_cnt = 0
    for _, row in df.iterrows():
        title = str(row.get('title') or '').strip()
        if not title:
            continue
        try:
            year = int(row.get('year')) if pd.notna(row.get('year')) else None
        except Exception:
            year = None
        if not year:
            continue

        # Safe getters that handle duplicate-named columns (Series)
        def _cell(name: str) -> str:
            val = row.get(name)
            if isinstance(val, pd.Series):
                # choose the longest non-empty string
                vals = [str(x).strip() for x in val if pd.notna(x) and str(x).strip().lower() != 'nan']
                return max(vals, key=len) if vals else ''
            if val is None or (isinstance(val, float) and pd.isna(val)):
                return ''
            s = str(val).strip()
            return '' if s.lower() == 'nan' else s

        doi = _cell('doi') or None
        issn = _cell('issn') or None
        source_name = (_cell('source_name') or _cell('name')) or None
        pdf_cell = _cell('pdf_url') or None
        pdf_url = pdf_cell if looks_like_pdf(pdf_cell) else None
        scopus_url = _cell('scopus_url') or None
        note_val = _cell('note') or None
        # Optional quartile / percentile for Scopus
        q_raw = (_cell('quartile') or '').strip().upper()
        quartile_val = q_raw if q_raw in {'Q1','Q2','Q3','Q4'} else None
        p_raw = _cell('percentile_2024')
        try:
            percentile_val = int(p_raw) if p_raw not in (None, '') else None
            if percentile_val is not None:
                if percentile_val < 0: percentile_val = 0
                if percentile_val > 100: percentile_val = 100
        except Exception:
            percentile_val = None
        try:
            c_raw = row.get('citations')
            if isinstance(c_raw, pd.Series):
                c_vals = [x for x in c_raw if pd.notna(x)]
                c_val = c_vals[0] if c_vals else 0
            else:
                c_val = c_raw
            citations = int(c_val) if pd.notna(c_val) else 0
        except Exception:
            citations = 0
        # percentile_2024 already parsed above

        # upsert source
        src = None
        source_name_norm = " ".join((source_name or '').split()) if source_name else None
        if source_name_norm:
            src = db.execute(select(Source).where(Source.name == source_name_norm)).scalars().first()
        if not src and source_name_norm:
            # Do not set quartile for sources here; keep creation minimal
            src = Source(name=source_name_norm, issn=issn or None, type=(row.get('type') or None))
            db.add(src)
            db.flush()
        elif src:
            changed = False
            if (issn or None) and (src.issn or None) != issn:
                src.issn = issn
                changed = True
            # Do not import quartile for sources
            if changed:
                db.add(src)

        # Authors: take strictly from 'authors' column; split by ';' or newline only (no cleanup)
        a_raw = row.get('authors')
        if isinstance(a_raw, pd.Series):
            a_vals = [str(x).strip() for x in a_raw if pd.notna(x) and str(x).strip().lower() != 'nan']
            authors_cell = max(a_vals, key=len) if a_vals else ''
        else:
            authors_cell = str(a_raw or '').strip()
        author_names = parse_authors(authors_cell)
        author_objs = []
        for nm in author_names:
            existing = db.execute(select(Author).where(Author.display_name == nm)).scalars().first()
            if existing:
                author_objs.append(existing)
            else:
                a = Author(display_name=nm, normalized_name=" ".join(nm.lower().split()))
                db.add(a)
                db.flush()
                author_objs.append(a)

        dup_q = select(Publication).where(Publication.title == title, Publication.year == year)
        if src:
            dup_q = dup_q.where(Publication.source_id == src.id)
        existing = db.execute(dup_q).scalars().first()
        if existing:
            # Update key fields and mark as scopus
            changed = False
            if doi and existing.doi != doi:
                existing.doi = doi; changed = True
            if looks_like_pdf(pdf_url) and existing.pdf_url != pdf_url:
                existing.pdf_url = pdf_url; changed = True
            if scopus_url and existing.scopus_url != scopus_url:
                existing.scopus_url = scopus_url; changed = True
            # Update quartile / percentile when provided
            if quartile_val is not None and (existing.quartile or None) != quartile_val:
                existing.quartile = quartile_val; changed = True
            if (existing.citations_count or 0) != citations:
                existing.citations_count = citations; changed = True
            if percentile_val is not None and (existing.percentile_2024 or None) != percentile_val:
                existing.percentile_2024 = percentile_val; changed = True
            if (existing.upload_source or None) != 'scopus':
                existing.upload_source = 'scopus'; changed = True
            if note_val and (existing.note or None) != note_val:
                existing.note = note_val; changed = True
            if existing.status != 'approved':
                existing.status = 'approved'; changed = True
            if changed:
                db.add(existing)
                updated_cnt += 1
            continue

        pub = Publication(
            title=title,
            year=year,
            doi=doi,
            pdf_url=pdf_url,
            scopus_url=scopus_url,
            citations_count=citations,
            source=src,
            status='approved',
            upload_source='scopus',
            note=note_val or None,
            quartile=quartile_val,
            percentile_2024=percentile_val,
        )
        db.add(pub)
        db.flush()
        pub.authors = author_objs
        created += 1

    if created or updated_cnt:
        db.commit()
    print(f"Publications imported: {created}, updated: {updated_cnt}")
    return created


def main():
    excel_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'zhubanov_scopus_issn.xlsx'))
    # Ensure DB tables exist when running the script directly (fresh DB case)
    try:
        Base.metadata.create_all(bind=engine)
    except Exception:
        pass
    db = SessionLocal()
    try:
        load_sources_from_excel(db, excel_path)
        load_publications_from_excel(db, excel_path)
    finally:
        db.close()


if __name__ == '__main__':
    main()
