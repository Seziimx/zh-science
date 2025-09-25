from __future__ import annotations
import os
from typing import Dict, List, Tuple

# Ensure backend package is importable when running as: `python -m backend.scripts.link_authors_to_users`
import sys
SCRIPT_DIR = os.path.dirname(__file__)
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, '..'))
if BACKEND_DIR not in sys.path:
    sys.path.append(BACKEND_DIR)

from app.db import SessionLocal, Base, engine
from app.models import Author, User, Publication, publication_authors
from sqlalchemy import select, and_


def _norm_name(s: str | None) -> str:
    s = (s or "").replace("\u00A0", " ").strip().lower()
    for ch in [" ", ".", ",", "\t", "\n", "\r"]:
        s = s.replace(ch, "")
    return s


def _split_parts(full: str) -> List[str]:
    return [p for p in (full or '').replace('\u00A0', ' ').split() if p]


def _key_last_init(full: str) -> Tuple[str, str]:
    parts = _split_parts(full)
    if not parts:
        return ("", "")
    last = parts[0].lower()
    first_init = parts[1][0].lower() if len(parts) > 1 and parts[1] else ''
    return (last, first_init)


def link_authors_to_users(dry_run: bool = False) -> dict:
    """
    Match Author.display_name to User.full_name and fill:
      - author.user_id
      - author.faculty
      - author.department

    Strategy:
      1) Exact match by normalized name
      2) Fallback: (last_name, first_initial) unique match
    """
    # Ensure tables exist (for fresh DB runs) and lightweight migration for new Author columns
    try:
        Base.metadata.create_all(bind=engine)
        from sqlalchemy import text
        with engine.begin() as conn:
            dialect = conn.engine.dialect.name
            if dialect == 'sqlite':
                cols = conn.exec_driver_sql("PRAGMA table_info('authors')").fetchall()
                col_names = {row[1] for row in cols}
                if 'faculty' not in col_names:
                    conn.exec_driver_sql("ALTER TABLE authors ADD COLUMN faculty VARCHAR(128)")
                if 'department' not in col_names:
                    conn.exec_driver_sql("ALTER TABLE authors ADD COLUMN department VARCHAR(128)")
                if 'user_id' not in col_names:
                    conn.exec_driver_sql("ALTER TABLE authors ADD COLUMN user_id INTEGER")
            else:
                conn.exec_driver_sql("ALTER TABLE authors ADD COLUMN IF NOT EXISTS faculty VARCHAR(128)")
                conn.exec_driver_sql("ALTER TABLE authors ADD COLUMN IF NOT EXISTS department VARCHAR(128)")
                conn.exec_driver_sql("ALTER TABLE authors ADD COLUMN IF NOT EXISTS user_id INTEGER")
    except Exception:
        # continue even if migration fails; the query below may fail and show the reason
        pass

    db = SessionLocal()
    try:
        users: List[User] = db.execute(select(User)).scalars().all()
        authors: List[Author] = db.execute(select(Author)).scalars().all()

        u_by_norm: Dict[str, User] = {}
        fuzzy_idx: Dict[Tuple[str, str], List[User]] = {}
        for u in users:
            nm = (u.full_name or '').strip()
            if not nm:
                continue
            u_by_norm[_norm_name(nm)] = u
            key = _key_last_init(nm)
            fuzzy_idx.setdefault(key, []).append(u)

        matched_exact = 0
        matched_fuzzy = 0
        updated_authors = 0
        ambiguous: List[str] = []
        not_found: List[str] = []

        for a in authors:
            nm = (a.display_name or '').strip()
            if not nm:
                continue
            # skip if already linked and has faculty/department
            if a.user_id and (a.faculty or a.department):
                continue

            user = u_by_norm.get(_norm_name(nm))
            method = 'exact'
            if user is None:
                key = _key_last_init(nm)
                cand = fuzzy_idx.get(key, [])
                if len(cand) == 1:
                    user = cand[0]
                    method = 'fuzzy'
                elif len(cand) > 1:
                    ambiguous.append(nm)
                    continue
                else:
                    not_found.append(nm)
                    continue

            if user is None:
                continue

            changed = False
            if (a.user_id or None) != user.id:
                a.user_id = user.id
                changed = True
            if (a.faculty or '').strip() != (user.faculty or '').strip():
                a.faculty = user.faculty or a.faculty
                changed = True
            if (a.department or '').strip() != (user.department or '').strip():
                a.department = user.department or a.department
                changed = True

            if changed and not dry_run:
                db.add(a)
                updated_authors += 1
            if method == 'exact':
                matched_exact += 1
            else:
                matched_fuzzy += 1

        if updated_authors and not dry_run:
            db.commit()

        return {
            'matched_exact': matched_exact,
            'matched_fuzzy': matched_fuzzy,
            'updated_authors': updated_authors,
            'ambiguous_sample': ambiguous[:20],
            'not_found_sample': not_found[:20],
            'total_users': len(users),
            'total_authors': len(authors),
        }
    finally:
        db.close()


def backfill_publications_user_id(dry_run: bool = False, max_rows: int | None = None) -> dict:
    """Set Publication.user_id from any linked Author.user_id (prefer earliest author order)
    for Kokson publications where user_id is NULL.
    """
    db = SessionLocal()
    try:
        # Base: kokson publications with no user_id
        base = select(Publication.id).where(
            and_(Publication.upload_source == 'kokson', Publication.user_id.is_(None))
        )
        if max_rows:
            base = base.limit(max_rows)
        pub_ids = [pid for (pid,) in db.execute(base).all()]
        if not pub_ids:
            return {'updated_publications': 0, 'scanned': 0}
        updated = 0
        scanned = 0
        for pid in pub_ids:
            scanned += 1
            # fetch authors in order; find first with user_id
            rows = db.execute(
                select(Author.id, Author.user_id)
                .select_from(publication_authors)
                .join(Author, Author.id == publication_authors.c.author_id)
                .where(publication_authors.c.publication_id == pid)
                .order_by(publication_authors.c.author_order)
            ).all()
            uid = None
            for _, au_uid in rows:
                if au_uid:
                    uid = au_uid
                    break
            if not uid:
                continue
            pub = db.get(Publication, pid)
            if not pub:
                continue
            pub.user_id = uid
            if not dry_run:
                db.add(pub)
                updated += 1
        if updated and not dry_run:
            db.commit()
        return {'updated_publications': updated, 'scanned': scanned}
    finally:
        db.close()


def main():
    import argparse
    p = argparse.ArgumentParser(description='Link authors to users and copy faculty/department; backfill Publication.user_id')
    p.add_argument('--dry-run', action='store_true', help='Do not write changes to DB')
    p.add_argument('--backfill', action='store_true', help='Also set Publication.user_id from linked Authors')
    args = p.parse_args()
    res = link_authors_to_users(dry_run=args.dry_run)
    print('[link-authors] result:', res)
    if args.backfill:
        res2 = backfill_publications_user_id(dry_run=args.dry_run)
        print('[backfill-publications] result:', res2)


if __name__ == '__main__':
    main()
