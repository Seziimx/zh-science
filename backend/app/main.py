from __future__ import annotations
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .db import engine, Base
from .routers_search import router as search_router
from .routers_publications import router as publications_router
from .routers_admin import router as admin_router
from .routers_auth import router as auth_router

from fastapi import BackgroundTasks
import os


def create_app() -> FastAPI:
    settings = get_settings()

    # Create DB tables (for MVP without Alembic). In production, use migrations.
    Base.metadata.create_all(bind=engine)

    app = FastAPI(title=settings.APP_NAME, debug=settings.DEBUG)

    # Permissive CORS: allow all origins (no credentials). Our API uses token headers, not cookies.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_origin_regex=None,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        max_age=600,
    )

    app.include_router(search_router)
    app.include_router(publications_router)
    app.include_router(admin_router)
    app.include_router(auth_router)

    # Serve uploaded files
    uploads_path = os.path.abspath(os.path.join(os.path.dirname(__file__), 'uploads'))
    if os.path.isdir(uploads_path):
        app.mount("/uploads", StaticFiles(directory=uploads_path), name="uploads")

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/")
    def root():
        return RedirectResponse(url="/docs")

    @app.on_event("startup")
    async def on_startup():
        # Lightweight migration: add percentile_2024 to publications if missing
        try:
            with engine.begin() as conn:
                dialect = conn.engine.dialect.name
                if dialect == "sqlite":
                    cols = conn.exec_driver_sql("PRAGMA table_info('publications')").fetchall()
                    col_names = {row[1] for row in cols}
                    if "percentile_2024" not in col_names:
                        conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN percentile_2024 INTEGER")
                    if "scopus_url" not in col_names:
                        conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN scopus_url VARCHAR(1024)")
                    if "uploader_id" not in col_names:
                        conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN uploader_id VARCHAR(64)")
                    if "uploaded_by_role" not in col_names:
                        conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN uploaded_by_role VARCHAR(16)")
                    if "note" not in col_names:
                        conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN note TEXT")
                    if "user_id" not in col_names:
                        conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN user_id INTEGER")

                    # users table migrations
                    ucols = conn.exec_driver_sql("PRAGMA table_info('users')").fetchall()
                    ucol_names = {row[1] for row in ucols}
                    if "email" not in ucol_names:
                        conn.exec_driver_sql("ALTER TABLE users ADD COLUMN email VARCHAR(255)")
                    if "role" not in ucol_names:
                        conn.exec_driver_sql("ALTER TABLE users ADD COLUMN role VARCHAR(32)")
                    if "name_variants" not in ucol_names:
                        conn.exec_driver_sql("ALTER TABLE users ADD COLUMN name_variants TEXT")
                else:
                    # postgres / others
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS percentile_2024 INTEGER")
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS scopus_url VARCHAR(1024)")
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS uploader_id VARCHAR(64)")
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS uploaded_by_role VARCHAR(16)")
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS note TEXT")
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS user_id INTEGER")
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255)")
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(32)")
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN IF NOT EXISTS name_variants TEXT")
        except Exception as e:
            print(f"[startup] Migration warning: {e}")
        # Optional: import sources from Excel once if file exists
        excel_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "zhubanov_scopus_issn.xlsx"))
        # also check project root
        if not os.path.exists(excel_path):
            excel_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "zhubanov_scopus_issn.xlsx"))
        if os.path.exists(excel_path):
            try:
                # scripts module is at backend/scripts, import as 'scripts.import_excel'
                from scripts.import_excel import load_sources_from_excel, load_publications_from_excel  # type: ignore
                from app.db import SessionLocal
                db = SessionLocal()
                try:
                    load_sources_from_excel(db, excel_path)
                    load_publications_from_excel(db, excel_path)
                finally:
                    db.close()
            except Exception as e:
                # Do not crash app on import errors
                print(f"[startup] Excel import skipped due to error: {e}")

    return app


app = create_app()
