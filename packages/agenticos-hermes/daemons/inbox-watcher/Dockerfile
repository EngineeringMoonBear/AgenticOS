# inbox-watcher standalone daemon.
#
# Build context: ./packages/agenticos-hermes (the agenticos-hermes package root).
# Dockerfile path: daemons/inbox-watcher/Dockerfile
#
# This Dockerfile installs the agenticos-hermes package from the build context
# so that `python -m agenticos_hermes.tasks.inbox_triage` resolves at runtime
# (once that module lands in Task 25). Until then, the subprocess call logs and
# moves on — see watcher.py.
FROM python:3.11-slim

WORKDIR /app

# Copy the whole agenticos-hermes package (build context root).
# This includes src/, pyproject.toml, plugins/, daemons/, tests/.
COPY . /app/agenticos-hermes

# Install runtime deps + the package itself (editable so import paths resolve
# against /app/agenticos-hermes/src).
RUN pip install --no-cache-dir \
        'watchdog>=4.0' \
        'httpx>=0.27' \
        'PyYAML>=6.0' \
        'psycopg[binary]>=3.2' \
    && pip install --no-cache-dir -e /app/agenticos-hermes

# Run as non-root (UID 10000 matches the vault bind-mount ownership convention).
RUN useradd -m -u 10000 watcher
USER watcher

ENV PYTHONUNBUFFERED=1

CMD ["python", "/app/agenticos-hermes/daemons/inbox-watcher/watcher.py"]
