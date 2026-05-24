# AgenticOS Hermes Agent overlay image.
#
# Extends the upstream `nousresearch/hermes-agent:main` image with our
# `agenticos-hermes` Python package pip-installed into Hermes's bundled venv.
# This lets hook plugins (e.g. plugins/cost-recorder/) `import agenticos_hermes`
# at runtime without PYTHONPATH gymnastics or per-plugin code duplication.
#
# Why this exists: Hermes's plugin loader runs each plugin's `__init__.py` in
# Hermes's own Python interpreter. The cost-recorder plugin imports
#   from agenticos_hermes.db import connect
#   from agenticos_hermes.pricing import cost_cents
# Without our package on the venv's sys.path, those imports raise
# ModuleNotFoundError and the hook silently fails (Hermes 0.14 doesn't log
# plugin discovery errors). Pip-installing here makes the imports resolve
# like any other site-packages dependency, and brings psycopg/httpx/PyYAML
# in as transitive deps automatically.
#
# IMPORTANT: This image is LOCAL-ONLY. docker-compose builds it on the Droplet
# (or wherever) under the tag `agenticos/hermes-agent:local`. It is never pushed
# to any public registry. The base layer is upstream Nous's image; everything
# we add on top stays inside our infrastructure.

FROM nousresearch/hermes-agent:main

# Layer our package source inside the image. /opt/agenticos-hermes is a path
# Hermes's own code does not touch (it lives at /opt/hermes/), so the overlay
# stays cleanly namespaced.
#
# Build context = `./packages/agenticos-hermes` (see docker-compose.yml). `.`
# here therefore resolves to the package root. This mirrors inbox-watcher's
# setup and keeps BuildKit from tripping on the /opt/agenticos/packages
# symlink that exists on the Droplet (BuildKit refuses to follow symlinks
# that escape the build-context root).
COPY . /opt/agenticos-hermes

# Install into Hermes's existing venv using uv, which the upstream image
# ships at /usr/local/bin/uv. The upstream venv was built with uv and has
# pip, pip-the-module, and ensurepip all stripped to keep the image lean —
# uv is the only way to install anything into it from a Dockerfile RUN.
#
# `--python` targets Hermes's venv interpreter so installs land in
# `/opt/hermes/.venv/lib/python3.13/site-packages/`. `--no-cache` skips the
# uv cache (we won't reinstall in this image). pyproject.toml deps
# (psycopg[binary], httpx, watchdog, pydantic, PyYAML) come along
# automatically as transitive deps.
RUN /usr/local/bin/uv pip install \
        --python /opt/hermes/.venv/bin/python \
        --no-cache \
        /opt/agenticos-hermes

# Sanity check: ensure the imports the plugin needs actually resolve at
# build time. If this fails the image build fails — much better than a silent
# runtime failure where the plugin loads but hooks never fire.
RUN /opt/hermes/.venv/bin/python -c "from agenticos_hermes.db import connect; from agenticos_hermes.pricing import cost_cents; print('agenticos_hermes imports verified')"
