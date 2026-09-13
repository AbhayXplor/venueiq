# VenueIQ agent brain — the Python LangGraph decision service.
#
# It listens on $PORT (the platform's injected port) and binds 0.0.0.0 by
# default, so it is reachable from outside the container. Both are handled in
# app/config.py — a container that binds 127.0.0.1 comes up healthy and cannot
# be called, which is the failure this image is written to avoid.
#
# IMPORTANT — the build context must be THIS directory, `mini-services/agent-brain`,
# not the repo root. The COPY paths below are relative to the context, so building
# from the repo root fails with "requirements.txt not found". Render and Railway call
# this the service's Root Directory; Northflank calls it the build context.
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Requirements first, so a source-only change does not reinstall the wheel set.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Documentation only — the platform overrides this with its own $PORT.
EXPOSE 3004

CMD ["python", "-m", "app.main"]
