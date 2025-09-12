from __future__ import annotations
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import select, func, or_, and_, desc, asc
import io

try:
    from openpyxl import Workbook  # type: ignore
except Exception:  # pragma: no cover
    Workbook = None  # type: ignore

from .db import get_db
from .models import Publication, Author, Source
from .schemas import SearchResponse, PageMeta, PublicationOut
from .config import get_settings

router = APIRouter(prefix="/search", tags=["search"])


def _apply_common_filters(stmt, filters, joins, need_join_authors, need_join_source):
    if need_join_authors:
        stmt = stmt.join(Publication.authors)
    if need_join_source:
        stmt = stmt.join(Publication.source)
    if filters:
        stmt = stmt.where(and_(*filters))
    return stmt


@router.get("", response_model=SearchResponse)
def search_publications(
    q: Optional[str] = Query(default=None, description="Keyword query across title/doi/author/source"),
    year_min: Optional[int] = Query(default=None),
    year_max: Optional[int] = Query(default=None),
    quartiles: Optional[List[str]] = Query(default=None),  # e.g., Q1,Q2
    authors: Optional[List[int]] = Query(default=None),
    sources: Optional[List[int]] = Query(default=None),
    issn: Optional[str] = Query(default=None),
    source_type: Optional[str] = Query(default=None, description="journal|conference"),
    citations_min: Optional[int] = Query(default=None),
    citations_max: Optional[int] = Query(default=None),
    percentile_min: Optional[int] = Query(default=None),
    percentile_max: Optional[int] = Query(default=None),
    sort: str = Query(default="year_desc", description="year_desc|year_asc|citations_desc|citations_asc|title_asc|title_desc"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=None),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    if per_page is None:
        per_page = settings.PAGE_SIZE_DEFAULT
    per_page = max(1, min(per_page, settings.PAGE_SIZE_MAX))

    filters = [Publication.status == "approved"]
    joins = []

    if year_min is not None:
        filters.append(Publication.year >= year_min)
    if year_max is not None:
        filters.append(Publication.year <= year_max)

    if quartiles:
        filters.append(Publication.quartile.in_(quartiles))

    if sources:
        filters.append(Publication.source_id.in_(sources))

    if source_type:
        joins.append("source")
        filters.append(Source.type == source_type)

    if issn:
        joins.append("source")
        filters.append(Source.issn.ilike(f"%{issn.strip()}%"))

    if citations_min is not None:
        filters.append(Publication.citations_count >= citations_min)
    if citations_max is not None:
        filters.append(Publication.citations_count <= citations_max)

    if percentile_min is not None:
        filters.append(Publication.percentile_2024 >= percentile_min)
    if percentile_max is not None:
        filters.append(Publication.percentile_2024 <= percentile_max)

    # text query across title, doi, author name, source name
    if q:
        q_like = f"%{q.strip()}%"
        # Left join authors and source for filtering
        joins.append("authors")
        joins.append("source")
        filters.append(
            or_(
                Publication.title.ilike(q_like),
                Publication.doi.ilike(q_like),
                Source.name.ilike(q_like),
                Author.display_name.ilike(q_like),
            )
        )

    if authors:
        joins.append("authors")
        filters.append(Author.id.in_(authors))

    stmt = select(Publication).options(
        joinedload(Publication.source),
        joinedload(Publication.authors),
    )

    # apply joins only once
    need_join_authors = "authors" in joins
    need_join_source = "source" in joins
    if need_join_authors:
        stmt = stmt.join(Publication.authors)
    if need_join_source:
        stmt = stmt.join(Publication.source)

    if filters:
        stmt = stmt.where(and_(*filters))

    # total count
    count_stmt = select(func.count(func.distinct(Publication.id)))
    if need_join_authors:
        count_stmt = count_stmt.join(Publication.authors)
    if need_join_source:
        count_stmt = count_stmt.join(Publication.source)
    if filters:
        count_stmt = count_stmt.where(and_(*filters))

    total: int = db.execute(count_stmt).scalar_one()

    # sorting
    if sort == "year_asc":
        stmt = stmt.order_by(asc(Publication.year), Publication.id)
    elif sort == "citations_desc":
        stmt = stmt.order_by(desc(Publication.citations_count), desc(Publication.year), Publication.id)
    elif sort == "citations_asc":
        stmt = stmt.order_by(asc(Publication.citations_count), desc(Publication.year), Publication.id)
    elif sort == "title_asc":
        stmt = stmt.order_by(asc(Publication.title), Publication.id)
    elif sort == "title_desc":
        stmt = stmt.order_by(desc(Publication.title), Publication.id)
    else:
        stmt = stmt.order_by(desc(Publication.year), Publication.id)

    # pagination
    offset = (page - 1) * per_page
    stmt = stmt.offset(offset).limit(per_page)

    result = db.execute(stmt).scalars().unique().all()

    total_pages = (total + per_page - 1) // per_page if total else 1

    return SearchResponse(
        meta=PageMeta(page=page, per_page=per_page, total=total, total_pages=total_pages),
        items=[PublicationOut.model_validate(pub) for pub in result],
    )


@router.get("/facets/authors")
def facets_authors(
    q: Optional[str] = Query(default=None),
    year_min: Optional[int] = None,
    year_max: Optional[int] = None,
    quartiles: Optional[List[str]] = None,
    sources: Optional[List[int]] = None,
    issn: Optional[str] = None,
    source_type: Optional[str] = None,
    citations_min: Optional[int] = None,
    citations_max: Optional[int] = None,
    percentile_min: Optional[int] = None,
    percentile_max: Optional[int] = None,
    query: Optional[str] = Query(default=None, description="filter authors by name"),
    limit: int = 50,
    db: Session = Depends(get_db),
):
    filters = [Publication.status == "approved"]
    joins: List[str] = ["authors"]
    if year_min is not None:
        filters.append(Publication.year >= year_min)
    if year_max is not None:
        filters.append(Publication.year <= year_max)
    if quartiles:
        filters.append(Publication.quartile.in_(quartiles))
    if sources:
        filters.append(Publication.source_id.in_(sources))
    if source_type:
        joins.append("source")
        filters.append(Source.type == source_type)
    if issn:
        joins.append("source")
        filters.append(Source.issn.ilike(f"%{issn.strip()}%"))
    if citations_min is not None:
        filters.append(Publication.citations_count >= citations_min)
    if citations_max is not None:
        filters.append(Publication.citations_count <= citations_max)
    if percentile_min is not None:
        filters.append(Publication.percentile_2024 >= percentile_min)
    if percentile_max is not None:
        filters.append(Publication.percentile_2024 <= percentile_max)
    if q:
        q_like = f"%{q.strip()}%"
        joins.append("source")
        filters.append(or_(Publication.title.ilike(q_like), Publication.doi.ilike(q_like), Source.name.ilike(q_like)))

    need_join_authors = True
    need_join_source = "source" in joins
    stmt = select(Author.id, Author.display_name, func.count(func.distinct(Publication.id))).join(Publication.authors)
    if need_join_source:
        stmt = stmt.join(Publication.source)
    if filters:
        stmt = stmt.where(and_(*filters))
    if query:
        stmt = stmt.where(Author.display_name.ilike(f"%{query.strip()}%"))
    stmt = stmt.group_by(Author.id, Author.display_name).order_by(desc(func.count(func.distinct(Publication.id)))).limit(limit)
    rows = db.execute(stmt).all()
    return [{"id": r[0], "name": r[1], "count": r[2]} for r in rows]


@router.get("/facets/sources")
def facets_sources(
    q: Optional[str] = Query(default=None),
    year_min: Optional[int] = None,
    year_max: Optional[int] = None,
    quartiles: Optional[List[str]] = None,
    authors: Optional[List[int]] = None,
    issn: Optional[str] = None,
    source_type: Optional[str] = None,
    citations_min: Optional[int] = None,
    citations_max: Optional[int] = None,
    percentile_min: Optional[int] = None,
    percentile_max: Optional[int] = None,
    query: Optional[str] = Query(default=None, description="filter sources by name"),
    limit: int = 50,
    db: Session = Depends(get_db),
):
    filters = [Publication.status == "approved"]
    joins: List[str] = ["source"]
    if year_min is not None:
        filters.append(Publication.year >= year_min)
    if year_max is not None:
        filters.append(Publication.year <= year_max)
    if quartiles:
        filters.append(Publication.quartile.in_(quartiles))
    if authors:
        joins.append("authors")
        filters.append(Author.id.in_(authors))
    if issn:
        joins.append("source")
        filters.append(Source.issn.ilike(f"%{issn.strip()}%"))
    if source_type:
        filters.append(Source.type == source_type)
    if citations_min is not None:
        filters.append(Publication.citations_count >= citations_min)
    if citations_max is not None:
        filters.append(Publication.citations_count <= citations_max)
    if percentile_min is not None:
        filters.append(Publication.percentile_2024 >= percentile_min)
    if percentile_max is not None:
        filters.append(Publication.percentile_2024 <= percentile_max)
    if q:
        q_like = f"%{q.strip()}%"
        joins.append("authors")
        filters.append(or_(Publication.title.ilike(q_like), Publication.doi.ilike(q_like), Author.display_name.ilike(q_like)))

    need_join_authors = "authors" in joins
    need_join_source = True
    stmt = select(Source.id, Source.name, func.count(func.distinct(Publication.id))).join(Publication.source)
    if need_join_authors:
        stmt = stmt.join(Publication.authors)
    if filters:
        stmt = stmt.where(and_(*filters))
    if query:
        stmt = stmt.where(Source.name.ilike(f"%{query.strip()}%"))
    stmt = stmt.group_by(Source.id, Source.name).order_by(desc(func.count(func.distinct(Publication.id)))).limit(limit)
    rows = db.execute(stmt).all()
    return [{"id": r[0], "name": r[1], "count": r[2]} for r in rows]


@router.get("/export")
def export_csv(
    q: Optional[str] = Query(default=None),
    year_min: Optional[int] = None,
    year_max: Optional[int] = None,
    quartiles: Optional[List[str]] = None,
    authors: Optional[List[int]] = None,
    sources: Optional[List[int]] = None,
    issn: Optional[str] = None,
    source_type: Optional[str] = None,
    citations_min: Optional[int] = None,
    citations_max: Optional[int] = None,
    percentile_min: Optional[int] = None,
    percentile_max: Optional[int] = None,
    sort: str = "year_desc",
    fmt: str = Query(default="csv", description="csv|xlsx"),
    db: Session = Depends(get_db),
):
    filters = [Publication.status == "approved"]
    joins: List[str] = []
    if year_min is not None:
        filters.append(Publication.year >= year_min)
    if year_max is not None:
        filters.append(Publication.year <= year_max)
    if quartiles:
        filters.append(Publication.quartile.in_(quartiles))
    if sources:
        filters.append(Publication.source_id.in_(sources))
    if source_type:
        joins.append("source")
        filters.append(Source.type == source_type)
    if issn:
        joins.append("source")
        filters.append(Source.issn.ilike(f"%{issn.strip()}%"))
    if citations_min is not None:
        filters.append(Publication.citations_count >= citations_min)
    if citations_max is not None:
        filters.append(Publication.citations_count <= citations_max)
    if percentile_min is not None:
        filters.append(Publication.percentile_2024 >= percentile_min)
    if percentile_max is not None:
        filters.append(Publication.percentile_2024 <= percentile_max)
    if q:
        q_like = f"%{q.strip()}%"
        joins += ["authors", "source"]
        filters.append(or_(Publication.title.ilike(q_like), Publication.doi.ilike(q_like), Source.name.ilike(q_like), Author.display_name.ilike(q_like)))
    if authors:
        joins.append("authors")
        filters.append(Author.id.in_(authors))

    stmt = select(Publication).options(joinedload(Publication.source), joinedload(Publication.authors))
    need_join_authors = "authors" in joins
    need_join_source = "source" in joins
    if need_join_authors:
        stmt = stmt.join(Publication.authors)
    if need_join_source:
        stmt = stmt.join(Publication.source)
    if filters:
        stmt = stmt.where(and_(*filters))

    if sort == "year_asc":
        stmt = stmt.order_by(asc(Publication.year), Publication.id)
    elif sort == "citations_desc":
        stmt = stmt.order_by(desc(Publication.citations_count), desc(Publication.year), Publication.id)
    elif sort == "citations_asc":
        stmt = stmt.order_by(asc(Publication.citations_count), desc(Publication.year), Publication.id)
    elif sort == "title_asc":
        stmt = stmt.order_by(asc(Publication.title), Publication.id)
    elif sort == "title_desc":
        stmt = stmt.order_by(desc(Publication.title), Publication.id)
    else:
        stmt = stmt.order_by(desc(Publication.year), Publication.id)

    rows = db.execute(stmt).scalars().unique().all()

    # CSV export
    if fmt.lower() == "csv":
        def iter_csv():
            header = [
                "id","year","title","authors","source","issn","doi","scopus_url","citations","quartile","percentile_2024","pdf_url"
            ]
            yield ",".join(header) + "\n"
            for p in rows:
                authors_str = "; ".join([a.display_name for a in p.authors])
                source_name = p.source.name if p.source else ""
                issn_val = p.source.issn if p.source else ""
                vals = [
                    str(p.id), str(p.year or ''), p.title.replace('"','""'), authors_str.replace('"','""'), source_name.replace('"','""'),
                    str(issn_val or ''), str(p.doi or ''), str(p.scopus_url or ''), str(p.citations_count or 0), str(p.quartile or ''), str(p.percentile_2024 or ''), str(p.pdf_url or ''),
                ]
                # Quote fields that may contain commas
                def q(v: str) -> str:
                    return f'"{v}"' if ("," in v or "\n" in v or '"' in v) else v
                yield ",".join([q(v) for v in vals]) + "\n"
        return StreamingResponse(iter_csv(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=export.csv"})

    # XLSX export
    if fmt.lower() == "xlsx":
        if Workbook is None:
            # Fallback to CSV if openpyxl not installed
            return StreamingResponse((line for line in []), media_type="text/plain", headers={"Content-Disposition": "attachment; filename=error.txt"})
        wb = Workbook()
        ws = wb.active
        ws.title = "Export"
        header = ["id","year","title","authors","source","issn","doi","scopus_url","citations","quartile","percentile_2024","pdf_url"]
        ws.append(header)
        for p in rows:
            authors_str = "; ".join([a.display_name for a in p.authors])
            source_name = p.source.name if p.source else ""
            issn_val = p.source.issn if p.source else ""
            ws.append([
                p.id, p.year or '', p.title, authors_str, source_name,
                issn_val or '', p.doi or '', p.scopus_url or '', p.citations_count or 0, p.quartile or '', p.percentile_2024 or '', p.pdf_url or ''
            ])
        # Autosize columns (simple)
        for col in ws.columns:
            max_len = 10
            col_letter = col[0].column_letter
            for cell in col:
                try:
                    max_len = max(max_len, len(str(cell.value or "")))
                except Exception:
                    pass
            ws.column_dimensions[col_letter].width = min(max_len + 2, 60)
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=export.xlsx"})

    # default CSV fallback
    def iter_fallback():
        yield "Unsupported format"
    return StreamingResponse(iter_fallback(), media_type="text/plain")


@router.get("/stats")
def stats(
    q: Optional[str] = Query(default=None),
    year_min: Optional[int] = None,
    year_max: Optional[int] = None,
    quartiles: Optional[List[str]] = None,
    authors: Optional[List[int]] = None,
    sources: Optional[List[int]] = None,
    issn: Optional[str] = None,
    source_type: Optional[str] = None,
    citations_min: Optional[int] = None,
    citations_max: Optional[int] = None,
    percentile_min: Optional[int] = None,
    percentile_max: Optional[int] = None,
    db: Session = Depends(get_db),
):
    filters = [Publication.status == "approved"]
    joins: List[str] = []
    if year_min is not None:
        filters.append(Publication.year >= year_min)
    if year_max is not None:
        filters.append(Publication.year <= year_max)
    if quartiles:
        filters.append(Publication.quartile.in_(quartiles))
    if sources:
        filters.append(Publication.source_id.in_(sources))
    if source_type:
        joins.append("source")
        filters.append(Source.type == source_type)
    if issn:
        joins.append("source")
        filters.append(Source.issn.ilike(f"%{issn.strip()}%"))
    if citations_min is not None:
        filters.append(Publication.citations_count >= citations_min)
    if citations_max is not None:
        filters.append(Publication.citations_count <= citations_max)
    if percentile_min is not None:
        filters.append(Publication.percentile_2024 >= percentile_min)
    if percentile_max is not None:
        filters.append(Publication.percentile_2024 <= percentile_max)
    if q:
        q_like = f"%{q.strip()}%"
        joins += ["authors", "source"]
        filters.append(or_(Publication.title.ilike(q_like), Publication.doi.ilike(q_like), Source.name.ilike(q_like), Author.display_name.ilike(q_like)))
    if authors:
        joins.append("authors")
        filters.append(Author.id.in_(authors))

    need_join_authors = "authors" in joins
    need_join_source = "source" in joins

    # KPI
    kpi_stmt = select(func.count(func.distinct(Publication.id)))
    if need_join_authors:
        kpi_stmt = kpi_stmt.join(Publication.authors)
    if need_join_source:
        kpi_stmt = kpi_stmt.join(Publication.source)
    if filters:
        kpi_stmt = kpi_stmt.where(and_(*filters))
    total_pubs = db.execute(kpi_stmt).scalar_one()

    authors_count_stmt = select(func.count(func.distinct(Author.id))).join(Publication.authors)
    if need_join_source:
        authors_count_stmt = authors_count_stmt.join(Publication.source)
    if filters:
        authors_count_stmt = authors_count_stmt.where(and_(*filters))
    total_authors = db.execute(authors_count_stmt).scalar_one()

    sources_count_stmt = select(func.count(func.distinct(Source.id))).join(Publication.source)
    if need_join_authors:
        sources_count_stmt = sources_count_stmt.join(Publication.authors)
    if filters:
        sources_count_stmt = sources_count_stmt.where(and_(*filters))
    total_sources = db.execute(sources_count_stmt).scalar_one()

    avg_per_author = (total_pubs / total_authors) if total_authors else 0.0

    # Yearly series
    year_stmt = select(Publication.year, func.count(Publication.id), func.sum(Publication.citations_count)).group_by(Publication.year).order_by(Publication.year)
    if need_join_authors:
        year_stmt = year_stmt.join(Publication.authors)
    if need_join_source:
        year_stmt = year_stmt.join(Publication.source)
    if filters:
        year_stmt = year_stmt.where(and_(*filters))
    year_rows = db.execute(year_stmt).all()
    yearly = [{"year": r[0], "publications": r[1], "citations": int(r[2] or 0)} for r in year_rows]

    # Top authors
    top_auth_stmt = select(Author.display_name, func.count(func.distinct(Publication.id))).join(Publication.authors)
    if need_join_source:
        top_auth_stmt = top_auth_stmt.join(Publication.source)
    if filters:
        top_auth_stmt = top_auth_stmt.where(and_(*filters))
    top_auth_stmt = top_auth_stmt.group_by(Author.display_name).order_by(desc(func.count(func.distinct(Publication.id)))).limit(10)
    top_authors = [{"author": r[0], "count": r[1]} for r in db.execute(top_auth_stmt).all()]

    # Top sources
    top_src_stmt = select(Source.name, func.count(func.distinct(Publication.id))).join(Publication.source)
    if need_join_authors:
        top_src_stmt = top_src_stmt.join(Publication.authors)
    if filters:
        top_src_stmt = top_src_stmt.where(and_(*filters))
    top_src_stmt = top_src_stmt.group_by(Source.name).order_by(desc(func.count(func.distinct(Publication.id)))).limit(10)
    top_sources = [{"source": r[0], "count": r[1]} for r in db.execute(top_src_stmt).all()]

    # Quartile distribution
    quart_stmt = select(Publication.quartile, func.count(Publication.id)).group_by(Publication.quartile)
    if need_join_authors:
        quart_stmt = quart_stmt.join(Publication.authors)
    if need_join_source:
        quart_stmt = quart_stmt.join(Publication.source)
    if filters:
        quart_stmt = quart_stmt.where(and_(*filters))
    quart = [{"quartile": (r[0] or "-"), "count": r[1]} for r in db.execute(quart_stmt).all()]

    return {
        "kpi": {"publications": total_pubs, "authors": total_authors, "sources": total_sources, "avg_per_author": avg_per_author},
        "yearly": yearly,
        "top_authors": top_authors,
        "top_sources": top_sources,
        "quartiles": quart,
    }
