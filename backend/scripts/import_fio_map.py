from __future__ import annotations
import os
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

# ensure backend package importable when run standalone
import sys
SCRIPT_DIR = os.path.dirname(__file__)
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, '..'))
if BACKEND_DIR not in sys.path:
    sys.path.append(BACKEND_DIR)

from app.db import SessionLocal, Base, engine
from app.models import User

def _norm_name(s: str) -> str:
    return (
        (s or "")
        .lower()
        .replace("\u00A0", " ")
        .replace(" ", "")
        .replace(".", "")
        .replace(",", "")
        .strip()
    )

UPLOAD_DIR = os.path.abspath(os.path.join(BACKEND_DIR, 'uploads'))


def import_fio_map_from_excel(db: Session, excel_path: str) -> dict:
    if not os.path.exists(excel_path):
        return {"status": "skip", "reason": f"file not found: {excel_path}"}
    xls = pd.ExcelFile(excel_path)
    df = xls.parse(0)
    cols = {str(c).strip().lower(): c for c in df.columns}
    col_fio = cols.get('фио') or cols.get('ф.и.о') or cols.get('фио авторы')
    col_dep = cols.get('кафедра')
    col_fac = cols.get('факультет')
    if not (col_fio and col_dep and col_fac):
        return {"status": "error", "detail": "Columns 'ФИО','Кафедра','Факультет' not found"}

    # Load existing dept map
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    map_path = os.path.join(UPLOAD_DIR, '_dept_map.json')
    import json
    dept_map: dict[str, str] = {}
    if os.path.isfile(map_path):
        try:
            with open(map_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict):
                dept_map = {str(k): str(v) for k, v in data.items()}
        except Exception:
            dept_map = {}

    # Build indices
    users = db.execute(select(User)).scalars().all()
    u_by_norm: dict[str, User] = {}
    fuzzy_index: dict[tuple[str, str], list[User]] = {}
    for u in users:
        nm = (u.full_name or '').replace('\u00A0', ' ').strip()
        if not nm:
            continue
        u_by_norm[_norm_name(nm)] = u
        parts = [p for p in nm.split() if p]
        if not parts:
            continue
        last = parts[0].lower()
        first_init = parts[1][0].lower() if len(parts) > 1 and parts[1] else ''
        fuzzy_index.setdefault((last, first_init), []).append(u)

    updated_users = 0
    merged_pairs = 0
    ambiguous: list[str] = []
    not_found: list[str] = []

    for _, row in df.iterrows():
        fio = str(row[col_fio]).strip()
        dep = str(row[col_dep]).strip()
        fac = str(row[col_fac]).strip()
        if not fio or not dep or not fac or fio.lower() == 'nan' or dep.lower() == 'nan' or fac.lower() == 'nan':
            continue
        # merge mapping
        if dept_map.get(dep) != fac:
            dept_map[dep] = fac
            merged_pairs += 1
        # match user
        u = u_by_norm.get(_norm_name(fio))
        if u is None:
            parts = [p for p in fio.replace('\u00A0',' ').split() if p]
            if parts:
                last = parts[0].lower()
                first_init = parts[1][0].lower() if len(parts) > 1 and parts[1] else ''
                cands = fuzzy_index.get((last, first_init), [])
                if len(cands) == 1:
                    u = cands[0]
                elif len(cands) > 1:
                    ambiguous.append(fio)
                else:
                    not_found.append(fio)
        if u is None:
            continue
        changed = False
        if (u.department or '').strip() != dep:
            u.department = dep; changed = True
        if (u.faculty or '').strip() != fac:
            u.faculty = fac; changed = True
        if changed:
            db.add(u)
            updated_users += 1

    if updated_users:
        db.commit()

    with open(map_path, 'w', encoding='utf-8') as f:
        json.dump(dept_map, f, ensure_ascii=False, indent=2)

    return {
        "status": "ok",
        "users_updated": int(updated_users),
        "pairs_merged": int(merged_pairs),
        "ambiguous": ambiguous[:10],
        "not_found": not_found[:10],
    }


def main():
    # convenience CLI
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        excel_path = os.path.abspath(os.path.join(BACKEND_DIR, '..', 'faculties_departments_fio.xlsx'))
        if not os.path.exists(excel_path):
            excel_path = os.path.abspath(os.path.join(BACKEND_DIR, 'faculties_departments_fio.xlsx'))
        res = import_fio_map_from_excel(db, excel_path)
        print(f"[fio-map] {res}")
    finally:
        db.close()

if __name__ == '__main__':
    main()
