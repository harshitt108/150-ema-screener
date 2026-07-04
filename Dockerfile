# ── Stage 1: build the React frontend ───────────────────────────────────────
FROM node:20-alpine AS web
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: FastAPI serves API + built frontend from one process ────────────
FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY --from=web /app/frontend/dist frontend/dist

WORKDIR /app/backend
EXPOSE 8000
# $PORT is set by Render/Railway/Fly; defaults to 8000 locally
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
