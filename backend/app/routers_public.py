from __future__ import annotations
from typing import Optional, List
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import select, or_, asc, desc

from .db import get_db
from .models import User
from .schemas import PublicUserOut

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/users", response_model=List[PublicUserOut])
def list_users_public(
    q: Optional[str] = Query(default=None, description="search by full_name/login/email"),
    order: str = Query(default="name_asc", description="name_asc|name_desc"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
):
    stmt = select(User)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.full_name.ilike(like), User.login.ilike(like), User.email.ilike(like)))
    if order == "name_desc":
        stmt = stmt.order_by(desc(User.full_name))
    else:
        stmt = stmt.order_by(asc(User.full_name))
    offset = (page - 1) * per_page
    stmt = stmt.offset(offset).limit(per_page)
    rows = db.execute(stmt).scalars().all()
    return [PublicUserOut.model_validate(u) for u in rows]
