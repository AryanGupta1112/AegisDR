FROM node:24-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# A PostgreSQL base keeps pg_dump/pg_restore exactly aligned with the demo server.
FROM postgres:17-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r backend/requirements.txt
COPY backend /app/backend
COPY --from=frontend /build/frontend/dist /app/frontend/dist
ENV PATH="/opt/venv/bin:${PATH}" PYTHONUNBUFFERED=1 AEGIS_DATA_DIR=/data
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-proxy-headers"]
