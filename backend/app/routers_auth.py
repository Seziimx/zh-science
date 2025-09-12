from __future__ import annotations
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from .config import get_settings
from .db import get_db
from sqlalchemy.orm import Session
from sqlalchemy import select
from .models import User
import hashlib

router = APIRouter(prefix="/auth", tags=["auth"])

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    role: str  # guest|user|admin
    token: str | None
    user_id: int | None = None

def _hash_password(pw: str, salt: str) -> str:
    return hashlib.sha256((salt + pw).encode("utf-8")).hexdigest()


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    s = get_settings()
    u = payload.username.strip()
    p = payload.password.strip()

    # 1) Try DB users first (login-based auth)
    user = db.execute(select(User).where(User.login == u)).scalar_one_or_none()
    if user is not None and user.active:
        if user.password_hash == _hash_password(p, s.PASSWORD_SALT):
            role = user.role or "user"
            token = s.ADMIN_TOKEN if role == "admin" else s.USER_TOKEN
            return LoginResponse(role=role, token=token, user_id=user.id)

    # 2) Fallback to legacy static creds (optional)
    if u == s.ADMIN_LOGIN and p == s.ADMIN_PASSWORD:
        return LoginResponse(role="admin", token=s.ADMIN_TOKEN, user_id=None)
    if u == s.USER_LOGIN and p == s.USER_PASSWORD:
        return LoginResponse(role="user", token=s.USER_TOKEN, user_id=None)
    raise HTTPException(status_code=401, detail="Неверный логин или пароль")
