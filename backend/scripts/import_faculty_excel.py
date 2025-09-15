from __future__ import annotations
import os
import json
import pandas as pd
from typing import Dict, List, Optional, Tuple

# Make backend package importable when running as: python -m backend.scripts.import_faculty_excel "факультет.xlsx"
import sys
SCRIPT_DIR = os.path.dirname(__file__)
BACKEND_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, '..'))
if BACKEND_DIR not in sys.path:
    sys.path.append(BACKEND_DIR)

from app.db import SessionLocal
from app.models import User

# Header aliases (kaz/rus)
ALIASES = {
    'name': {
        'оқытушының аты-жөні', 'аты-жөні', 'фио', 'фамилия имя отчество', 'fullname', 'full name'
    },
    'position': { 'қызметі', 'должность', 'position' },
    'degree': { 'ғылыми атағы', 'ғылыми атағы, дәрежесі', 'степень', 'звание', 'degree' },
    'fac_or_dept': {
        'факультет(кафедра)', 'факультет (кафедра)', 'факультет', 'faculty',
        'факультеті', 'факультет атауы', 'факультет/кафедра', 'факультет, кафедра'
    },
    'department': { 'кафедра', 'кафедрасы', 'department', 'кафедра атауы' },
}


def _clean(s: Optional[object]) -> str:
    """Convert cell to clean string; treat NaN/None/'nan' as empty."""
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return ''
    txt = str(s).replace('\xa0', ' ').strip()
    if txt.lower() in ('nan', 'none'):
        return ''
    return txt


def _norm_col(col: str) -> str:
    c = str(col).strip().lower()
    for key, names in ALIASES.items():
        if c in names:
            return key
    return c


def _translit_ru_to_en(s: str) -> str:
    table = {
        "А":"A","Б":"B","В":"V","Г":"G","Д":"D","Е":"E","Ё":"E","Ж":"Zh","З":"Z","И":"I","Й":"Y","К":"K","Л":"L","М":"M","Н":"N","О":"O","П":"P","Р":"R","С":"S","Т":"T","У":"U","Ф":"F","Х":"Kh","Ц":"Ts","Ч":"Ch","Ш":"Sh","Щ":"Sch","Ы":"Y","Э":"E","Ю":"Yu","Я":"Ya",
        "а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"e","ж":"zh","з":"z","и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"kh","ц":"ts","ч":"ch","ш":"sh","щ":"sch","ы":"y","э":"e","ю":"yu","я":"ya",
    }
    return "".join([table.get(ch, ch) for ch in s])


def _name_variants(full_name: str) -> List[str]:
    raw = _clean(full_name)
    parts = [p for p in raw.split() if p]
    if not parts:
        return []
    last_ru = parts[0]
    initials_list = [p[0] + '.' for p in parts[1:]]
    initials_compact = ''.join(initials_list)  # A.Z.
    initials_spaced = ' '.join(initials_list)  # A. Z.

    last_en = _translit_ru_to_en(last_ru)

    cand = set()
    cand.add(raw)
    if initials_list:
        cand.add(f"{last_ru} {initials_compact}")
        cand.add(f"{last_ru} {initials_spaced}")
        cand.add(f"{initials_compact} {last_ru}")
        cand.add(f"{initials_spaced} {last_ru}")
    if last_en and initials_list:
        cand.add(f"{last_en} {initials_compact}")
        cand.add(f"{last_en} {initials_spaced}")
        cand.add(f"{initials_compact} {last_en}")
        cand.add(f"{initials_spaced} {last_en}")
        cand.add(f"{last_en}, {initials_spaced}")
        cand.add(f"{last_en}, {initials_compact}")
    return sorted({c.strip() for c in cand if c.strip()})


def import_faculty_from_excel(path: str) -> dict:
    if not os.path.exists(path):
        raise FileNotFoundError(path)

    df = pd.read_excel(path)
    df.columns = [_norm_col(c) for c in df.columns]

    created = 0
    updated = 0
    current_faculty = ""

    db = SessionLocal()
    try:
        # Determine known keys set from normalized columns
        known_keys = set(ALIASES.keys())
        for _, row in df.iterrows():
            name = _clean(row.get('name'))
            if not name:
                continue
            position = _clean(row.get('position'))
            degree = _clean(row.get('degree'))
            department = _clean(row.get('department'))
            fac_or_dept = _clean(row.get('fac_or_dept'))

            # Heuristic: some Excel files keep faculty/department as a merged section column (no header match).
            # Try to pick a non-empty cell from columns that are not recognized aliases to use as a section label.
            section_candidates: List[str] = []
            for col in df.columns:
                key = _norm_col(col)
                if key in known_keys:
                    continue
                val = _clean(row.get(col))
                if val:
                    section_candidates.append(val)
            if section_candidates:
                # Take the first non-empty as current section (often the rightmost column with rotated text)
                sec = section_candidates[0]
                # Only update if it looks like a meaningful label (length >= 5 characters)
                if len(sec.replace(' ', '')) >= 5:
                    current_faculty = sec

            faculty = ''
            if fac_or_dept:
                faculty = fac_or_dept
                lod = faculty.lower()
                if any(k in lod for k in ['кафедра', 'кафедрасы', 'каф.']) and not department:
                    department = faculty
            # If still empty, use last seen section label as faculty/department accordingly
            if not faculty and not department and current_faculty:
                sec = current_faculty
                lod = sec.lower()
                if any(k in lod for k in ['кафедра', 'кафедрасы', 'каф.']):
                    department = sec
                else:
                    faculty = sec

            u = db.query(User).filter(User.full_name == name).first()
            if not u:
                u = User(
                    full_name=name,
                    email=None,
                    role='teacher',
                    faculty=faculty,
                    department=department,
                    position=position,
                    degree=degree,
                    login=name.replace(' ', '.').lower(),
                    password_hash='',
                    name_variants=json.dumps(_name_variants(name), ensure_ascii=False),
                    active=1,
                )
                db.add(u)
                created += 1
            else:
                changed = False
                fields = {
                    'faculty': faculty,
                    'department': department,
                    'position': position,
                    'degree': degree,
                }
                for f, v in fields.items():
                    v = v or ''
                    if getattr(u, f) != v:
                        setattr(u, f, v)
                        changed = True
                # refresh name_variants if empty
                if not u.name_variants:
                    u.name_variants = json.dumps(_name_variants(name), ensure_ascii=False)
                    changed = True
                if changed:
                    updated += 1
            db.flush()
        db.commit()
    finally:
        db.close()

    return {'created': created, 'updated': updated}


def main():
    # Default path one level above repo root (файл лежит в корне проекта по снимку)
    default_path = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..', 'факультет.xlsx'))
    path = sys.argv[1] if len(sys.argv) > 1 else default_path
    res = import_faculty_from_excel(path)
    print(res)


if __name__ == '__main__':
    main()
