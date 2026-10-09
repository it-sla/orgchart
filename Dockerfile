FROM python:3.12-slim
WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Only runtime source: databases, backups, logs, uploads and tests never enter the image.
COPY backend/main.py backend/security.py backend/pdf_export.py ./
COPY frontend/dist /app/frontend/dist
ENV ORG_DB=/data/orgchart.db
EXPOSE 8010
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8010"]
