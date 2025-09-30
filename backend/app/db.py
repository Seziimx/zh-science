from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from sqlalchemy.pool import NullPool
from .config import get_settings


settings = get_settings()

# For SQLite: NullPool + check_same_thread=False.
# For Postgres: enable pooling with pre_ping and recycling to survive idle disconnects (e.g., Neon pooler).
connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
    engine = create_engine(
        settings.DATABASE_URL,
        echo=False,
        connect_args=connect_args,
        poolclass=NullPool,
    )
else:
    # Default QueuePool with health checks.
    engine = create_engine(
        settings.DATABASE_URL,
        echo=False,
        connect_args=connect_args,
        pool_pre_ping=True,      # validate connections before use
        pool_recycle=300,        # recycle connections periodically (seconds)
        pool_size=5,
        max_overflow=10,
        pool_use_lifo=True,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
