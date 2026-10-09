# Stage 1: build the frontend, so deploying is just "git pull && docker compose up -d --build".
FROM node:22-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/index.html frontend/tsconfig.json frontend/vite.config.ts ./
COPY frontend/src ./src
RUN npm run build

# Stage 2: the app. Only runtime source enters the image: databases, backups, logs, uploads and tests never do.
FROM python:3.12-slim
WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/main.py backend/security.py backend/pdf_export.py ./
COPY --from=frontend /app/frontend/dist /app/frontend/dist
ENV ORG_DB=/data/orgchart.db
EXPOSE 8010
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8010"]
