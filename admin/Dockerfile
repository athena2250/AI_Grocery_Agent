# Build from the repository root: docker build -f admin/Dockerfile -t hearth-admin .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 APP_ENV=production
WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
COPY backend/pyproject.toml ./backend/pyproject.toml
COPY backend/app ./backend/app
COPY admin/pyproject.toml ./admin/pyproject.toml
COPY admin/hearth_admin ./admin/hearth_admin
RUN pip install --no-cache-dir ./backend ./admin \
    && useradd --create-home hearth
USER hearth
ENV PORT=8100
EXPOSE 8100
CMD ["sh", "-c", "uvicorn hearth_admin.main:app --host 0.0.0.0 --port ${PORT}"]
