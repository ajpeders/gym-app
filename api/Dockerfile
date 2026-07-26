FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    GYM_DATA_DIR=/data

WORKDIR /app

# git + ssh are needed to pip-install the `companion` package over SSH.
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first for better layer caching.
# `companion` lives in a PRIVATE Forgejo repo cloned over SSH. The deploy key's
# private half arrives as a BuildKit secret (never baked into an image layer)
# and the whole ~/.ssh is removed in the same RUN. If the secret is absent the
# build still works for a public repo.
COPY requirements.txt .
RUN --mount=type=secret,id=companion_deploy_key \
    mkdir -p /root/.ssh && chmod 700 /root/.ssh && \
    if [ -s /run/secrets/companion_deploy_key ]; then \
      cp /run/secrets/companion_deploy_key /root/.ssh/id_ed25519 && \
      chmod 600 /root/.ssh/id_ed25519 ; \
    fi ; \
    ssh-keyscan git.thelunadog.com >> /root/.ssh/known_hosts 2>/dev/null ; \
    pip install --no-cache-dir -r requirements.txt ; \
    status=$? ; \
    rm -rf /root/.ssh ; \
    exit $status

# Copy application source + tests
COPY app ./app
COPY tests ./tests

RUN mkdir -p /data

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
