FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    GYM_DATA_DIR=/data

WORKDIR /app

# git is needed to pip-install `companion` from its repo.
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first for better layer caching.
# `companion` was private once and arrived over SSH with a BuildKit secret. It
# has been public since 2026-07-26 and clones anonymously over https, so the
# key, openssh-client and the secret mount are all gone — and with them the
# BuildKit requirement, which is what stopped this image building on a host
# without buildx. Anyone can now build it with plain `docker build`.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source + tests
COPY app ./app
COPY tests ./tests

RUN mkdir -p /data

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
