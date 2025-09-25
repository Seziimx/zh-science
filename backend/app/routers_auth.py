from __future__ import annotations
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
from .config import get_settings
from .db import get_db
from sqlalchemy.orm import Session
from sqlalchemy import select
from .models import User
import hashlib
try:
    from werkzeug.security import check_password_hash as _wz_check  # type: ignore
except Exception:
    _wz_check = None  # type: ignore

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

def _verify_password(stored_hash: str | None, plain: str, salt: str) -> bool:
    if not stored_hash:
        return False
    # If it's a werkzeug/Flask-style hash (pbkdf2:sha256:... or similar), use its checker
    if _wz_check and (stored_hash.startswith("pbkdf2:") or stored_hash.startswith("scrypt:") or stored_hash.startswith("argon2:")):
        try:
            return bool(_wz_check(stored_hash, plain))
        except Exception:
            pass
    # Fallback to legacy sha256(salt+pw)
    return stored_hash == _hash_password(plain, salt)


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    s = get_settings()
    u = payload.username.replace('\u00A0',' ').strip()
    p = payload.password.strip()

    # 1) Try DB users first (login-based auth)
    user = db.execute(select(User).where(User.login == u)).scalar_one_or_none()
    if user is None:
        # Try normalized lookup: lower(remove spaces,dots,commas,NBSP)
        from sqlalchemy import func
        def norm_expr(col):
            expr = func.replace(col, '\u00A0', ' ')
            expr = func.replace(expr, ' ', '')
            expr = func.replace(expr, '.', '')
            expr = func.replace(expr, ',', '')
            return func.lower(expr)
        u_norm = (u.replace('\u00A0',' ').replace(' ', '').replace('.', '').replace(',', '')).lower()
        user = db.execute(select(User).where(norm_expr(User.login) == u_norm)).scalar_one_or_none()
    if user is not None and user.active:
        if _verify_password(user.password_hash or "", p, s.PASSWORD_SALT):
            role = user.role or "user"
            token = s.ADMIN_TOKEN if role == "admin" else s.USER_TOKEN
            return LoginResponse(role=role, token=token, user_id=user.id)
        # Fallback: if provided password equals initial_password, accept and set proper hash
        try:
            init_pw = getattr(user, 'initial_password', None)
        except Exception:
            init_pw = None
        if init_pw and p == init_pw:
            # Persist legacy sha256(salt+pw) so subsequent logins work consistently
            user.password_hash = _hash_password(p, s.PASSWORD_SALT)
            from .db import get_db as _get_db
            try:
                # We already have db session injected; just commit
                db.add(user)
                db.commit()
            except Exception:
                pass
            role = user.role or "user"
            token = s.ADMIN_TOKEN if role == "admin" else s.USER_TOKEN
            return LoginResponse(role=role, token=token, user_id=user.id)

    # 2) Fallback to legacy static creds (optional)
    if u == s.ADMIN_LOGIN and p == s.ADMIN_PASSWORD:
        return LoginResponse(role="admin", token=s.ADMIN_TOKEN, user_id=None)
    if u == s.USER_LOGIN and p == s.USER_PASSWORD:
        return LoginResponse(role="user", token=s.USER_TOKEN, user_id=None)
    raise HTTPException(status_code=401, detail="Неверный логин или пароль")


class MeResponse(BaseModel):
    id: int
    full_name: str


@router.get("/me", response_model=MeResponse)
def me(
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_user_id: int | None = Header(default=None, alias="X-User-Id"),
    db: Session = Depends(get_db),
):
    """Return current user's id and full_name based on token and X-User-Id header.
    Frontend stores user_id in localStorage after login and sends it via X-User-Id.
    """
    s = get_settings()
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = authorization.split()[-1]
    if token not in (s.USER_TOKEN, s.ADMIN_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid token")
    if x_user_id is None:
        raise HTTPException(status_code=404, detail="User id is not set")
    user = db.execute(select(User).where(User.id == x_user_id)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return MeResponse(id=user.id, full_name=user.full_name or "")
