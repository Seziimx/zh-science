from __future__ import annotations
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .db import engine, Base
from .routers_search import router as search_router
from .routers_publications import router as publications_router
from .routers_public import router as public_router
from .routers_admin import router as admin_router
from .routers_auth import router as auth_router

from fastapi import BackgroundTasks
import os


def create_app() -> FastAPI:
    settings = get_settings()

    # Create DB tables (for MVP without Alembic). In production, use migrations.
    Base.metadata.create_all(bind=engine)

    app = FastAPI(title=settings.APP_NAME, debug=settings.DEBUG)

    # CORS (temporary wide-open to unblock preview). TODO: tighten to specific domains after verification.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_origin_regex=None,
        allow_credentials=False,  # tokens, not cookies
        allow_methods=["*"],
        allow_headers=["*", "Authorization"],
        expose_headers=["*", "Authorization", "X-Total-Count"],
        max_age=600,
    )

    app.include_router(search_router)
    # publications_router already defines prefix='/publications'
    app.include_router(publications_router)
    app.include_router(public_router)
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
                    if "language" not in col_names:
                        conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN language VARCHAR(64)")
                    if "url" not in col_names:
                        conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN url VARCHAR(1024)")
                    if "upload_source" not in col_names:
                        conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN upload_source VARCHAR(16)")
                    if "doc_type" not in col_names:
                        conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN doc_type VARCHAR(128)")
                    if "published_date" not in col_names:
                        conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN published_date DATE")
                    if "main_authors_count" not in col_names:
                        conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN main_authors_count INTEGER")

                    # users table migrations
                    ucols = conn.exec_driver_sql("PRAGMA table_info('users')").fetchall()
                    ucol_names = {row[1] for row in ucols}
                    if "email" not in ucol_names:
                        conn.exec_driver_sql("ALTER TABLE users ADD COLUMN email VARCHAR(255)")
                    if "role" not in ucol_names:
                        conn.exec_driver_sql("ALTER TABLE users ADD COLUMN role VARCHAR(32)")
                    if "name_variants" not in ucol_names:
                        conn.exec_driver_sql("ALTER TABLE users ADD COLUMN name_variants TEXT")
                    if "initial_password" not in ucol_names:
                        conn.exec_driver_sql("ALTER TABLE users ADD COLUMN initial_password VARCHAR(255)")
                    if "created_source" not in ucol_names:
                        conn.exec_driver_sql("ALTER TABLE users ADD COLUMN created_source VARCHAR(16)")
                else:
                    # postgres / others
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS percentile_2024 INTEGER")
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS scopus_url VARCHAR(1024)")
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS uploader_id VARCHAR(64)")
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS uploaded_by_role VARCHAR(16)")
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS note TEXT")
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS user_id INTEGER")
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS language VARCHAR(64)")
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS url VARCHAR(1024)")
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS upload_source VARCHAR(16)")
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS doc_type VARCHAR(128)")
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS published_date DATE")
                    conn.exec_driver_sql("ALTER TABLE publications ADD COLUMN IF NOT EXISTS main_authors_count INTEGER")
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255)")
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(32)")
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN IF NOT EXISTS name_variants TEXT")
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN IF NOT EXISTS initial_password VARCHAR(255)")
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN IF NOT EXISTS created_source VARCHAR(16)")
                    # authors table migrations
                    conn.exec_driver_sql("ALTER TABLE authors ADD COLUMN IF NOT EXISTS faculty VARCHAR(128)")
                    conn.exec_driver_sql("ALTER TABLE authors ADD COLUMN IF NOT EXISTS department VARCHAR(128)")
                    conn.exec_driver_sql("ALTER TABLE authors ADD COLUMN IF NOT EXISTS user_id INTEGER")
        except Exception as e:
            print(f"[startup] Migration warning: {e}")
        # Optional: import sources/publications from Excel once if file exists
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

        # Optional: import faculty/users from Excel if file exists (helps first deploys)
        fac_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "факультет.xlsx"))
        if not os.path.exists(fac_path):
            fac_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "факультет.xlsx"))
        if os.path.exists(fac_path):
            try:
                from scripts.import_faculty_excel import import_faculty_from_excel  # type: ignore
                res = import_faculty_from_excel(fac_path)
                print(f"[startup] Faculty import: {res}")
            except Exception as e:
                print(f"[startup] Faculty import skipped due to error: {e}")

        # Optional: import Excel datasets only when explicitly enabled
        if os.getenv("AUTO_IMPORT_ON_STARTUP") == "1":
            # Support project root and backend root locations
            root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
            backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
            excel_candidates = [
                ("Kokson", [
                    os.path.join(root_dir, "Koksost.xlsm"),
                    os.path.join(root_dir, "Koksost.xlsx"),
                    os.path.join(backend_dir, "Koksost.xlsm"),
                    os.path.join(backend_dir, "Koksost.xlsx"),
                    os.path.join(backend_dir, "Коксон.xlsx"),
                    os.path.join(root_dir, "Коксон.xlsx"),
                ]),
                ("Science Authorship", [
                    os.path.join(root_dir, "Science Authorship (All).xlsx"),
                    os.path.join(backend_dir, "Science Authorship (All).xlsx"),
                ]),
                ("Science Book", [
                    os.path.join(root_dir, "Science Book (All).xlsx"),
                    os.path.join(backend_dir, "Science Book (All).xlsx"),
                ]),
                ("Science Konferensia", [
                    os.path.join(root_dir, "Science Konferensia (All).xlsx"),
                    os.path.join(backend_dir, "Science Konferensia (All).xlsx"),
                ]),
            ]
            try:
                from scripts.import_kokson_excel import import_kokson_from_excel  # type: ignore
                from app.db import SessionLocal
                for label, candidates in excel_candidates:
                    path = next((p for p in candidates if os.path.exists(p)), None)
                    if not path:
                        continue
                    db = SessionLocal()
                    try:
                        res = import_kokson_from_excel(db, path)
                        print(f"[startup] {label} import: created={res.get('created')}, updated={res.get('updated')}, skipped={res.get('skipped')}")
                    finally:
                        db.close()
            except Exception as e:
                print(f"[startup] Articles Excel imports skipped due to error: {e}")

        # Optional: import faculties_departments_fio.xlsx to update Users and dept map
        try:
            from scripts.import_fio_map import import_fio_map_from_excel  # type: ignore
            from app.db import SessionLocal
            db = SessionLocal()
            try:
                # search typical locations
                fio_paths = [
                    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "faculties_departments_fio.xlsx")),
                    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "faculties_departments_fio.xlsx")),
                ]
                fio_path = next((p for p in fio_paths if os.path.exists(p)), None)
                if fio_path:
                    res = import_fio_map_from_excel(db, fio_path)
                    print(f"[startup] FIO map import: {res}")
            finally:
                db.close()
        except Exception as e:
            print(f"[startup] FIO map import skipped due to error: {e}")

    return app


app = create_app()
