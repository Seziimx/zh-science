from __future__ import annotations
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.db import SessionLocal, engine, Base
from app.models import Author, Source, Publication


def ensure_demo_data(db: Session):
    # Check if any publications exist
    existing = db.execute(select(Publication.id)).first()
    if existing:
        print("Demo data already present. Skipping.")
        return

    # Create demo authors
    a1 = Author(display_name="A. Zhubanov", normalized_name="zhubanov a")
    a2 = Author(display_name="B. Researcher", normalized_name="researcher b")

    # Create demo source
    s1 = Source(name="International Journal of Science", type="journal", issn="1234-5678", sjr_quartile="Q2")

    # Create demo publication
    p1 = Publication(
        year=2023,
        title="Sample Publication on Data Processing",
        doi="10.1234/demo.2023.001",
        pdf_url=None,
        citations_count=12,
        quartile="Q2",
        source=s1,
        status="approved",
    )
    p1.authors = [a1, a2]

    p2 = Publication(
        year=2021,
        title="Kazakh Morphology in Information Retrieval",
        doi=None,
        pdf_url=None,
        citations_count=5,
        quartile="Q3",
        source=s1,
        status="approved",
    )
    p2.authors = [a2]

    db.add_all([p1, p2])
    db.commit()
    print("Inserted demo data: 2 publications, 2 authors, 1 source.")


def main():
    # Ensure tables exist
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        ensure_demo_data(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
