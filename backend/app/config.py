from pydantic_settings import BaseSettings
from functools import lru_cache
import os


class Settings(BaseSettings):
    APP_NAME: str = "Zhubanov Science API"
    DEBUG: bool = True

    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite+pysqlite:///c:/Users/user/Desktop/zhs/backend/zhubanov.db")

    # CORS
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    # Pagination defaults
    PAGE_SIZE_DEFAULT: int = 20
    PAGE_SIZE_MAX: int = 100

    # Admin/User tokens (used by client)
    ADMIN_TOKEN: str = os.getenv("ADMIN_TOKEN", "1234")
    USER_TOKEN: str = os.getenv("USER_TOKEN", "123")

    # Simple login credentials (no registration)
    ADMIN_LOGIN: str = os.getenv("ADMIN_LOGIN", "sezim")
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "1234")
    USER_LOGIN: str = os.getenv("USER_LOGIN", "user")
    USER_PASSWORD: str = os.getenv("USER_PASSWORD", "123")

    # Password hashing
    PASSWORD_SALT: str = os.getenv("PASSWORD_SALT", "change-me-salt")


@lru_cache()
def get_settings() -> Settings:
    return Settings()
