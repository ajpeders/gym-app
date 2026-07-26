FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    GYM_DATA_DIR=/data

WORKDIR /app

# git is needed to pip-install the `companion` package from its git repo.
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first for better layer caching.
# `companion` lives in a PRIVATE Forgejo repo, so pip's git clone needs
# credentials. They arrive as a BuildKit secret (never baked into an image
# layer) and the credential file is deleted in the same RUN. If the secret is
# absent the build still works for a public repo.
COPY requirements.txt .
RUN --mount=type=secret,id=forgejo_token \
    if [ -s /run/secrets/forgejo_token ]; then \
      git config --global credential.helper store && \
      printf 'https://oauth2:%s@git.thelunadog.com\n' "$(cat /run/secrets/forgejo_token)" \
        > /root/.git-credentials ; \
    fi ; \
    pip install --no-cache-dir -r requirements.txt ; \
    status=$? ; \
    rm -f /root/.git-credentials ; \
    exit $status

# Copy application source + tests
COPY app ./app
COPY tests ./tests

RUN mkdir -p /data

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
