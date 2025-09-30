# Multi-stage optional, but we keep it simple for Render
FROM python:3.11-slim

# System deps (optional): build base for wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install backend deps first (better layer caching)
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy backend source
COPY backend/ /app/backend/

# Optional dataset import: if you want to auto-import Excel on startup,
# either bake the file into the image in your own fork (uncomment COPY below)
# or provide it via volume/env (e.g., set AUTO_IMPORT_ON_STARTUP=1 and mount the file).
# COPY zhubanov_scopus_issn.xlsx /app/zhubanov_scopus_issn.xlsx

# Expose Render's required port for Docker web services
EXPOSE 10000

# Start FastAPI via uvicorn; Render expects the app to listen on port 10000 in Docker
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "10000", "--app-dir", "backend"]
