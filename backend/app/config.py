from pydantic_settings import BaseSettings
from functools import lru_cache
import os


class Settings(BaseSettings):
    APP_NAME: str = "Zhubanov Science API"
    DEBUG: bool = True

    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite+pysqlite:///c:/Users/user/Desktop/zhs/backend/zhubanov.db")

    # Uploads directory (absolute). For Render Disk set to e.g. /var/data/uploads
    UPLOAD_DIR: str = os.getenv(
        "UPLOAD_DIR",
        os.path.abspath(os.path.join(os.path.dirname(__file__), "uploads")),
    )

    # CORS
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://zh-science.vercel.app",
        # Vercel preview/prod domain used now
        "https://zh-science-cikrm5tok-seziimxs-projects.vercel.app",
        # New Vercel preview domain observed
        "https://zh-science-ipqgt79hd-seziimxs-projects.vercel.app",
    ]

    # Pagination defaults
    PAGE_SIZE_DEFAULT: int = 20
    PAGE_SIZE_MAX: int = 100

    # Admin
    ADMIN_TOKEN: str = os.getenv("ADMIN_TOKEN", "1234")
    USER_TOKEN: str = os.getenv("USER_TOKEN", "123")

    # Auth (legacy static creds) and password hashing
    # Used by /auth/login if пользователь из БД не найден
    ADMIN_LOGIN: str = os.getenv("ADMIN_LOGIN", "admin")
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "1234")
    USER_LOGIN: str = os.getenv("USER_LOGIN", "user")
    USER_PASSWORD: str = os.getenv("USER_PASSWORD", "123")
    PASSWORD_SALT: str = os.getenv("PASSWORD_SALT", "dev_salt")


@lru_cache()
def get_settings() -> Settings:
    return Settings()
