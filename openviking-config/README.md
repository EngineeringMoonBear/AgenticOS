# OpenViking configuration (`ov.conf`)

This directory holds the production `ov.conf` for the OpenViking service in
`docker-compose.yml`. Cloud-init copies the whole directory from the cloned
repo to `/opt/agenticos/openviking-config/`, and the compose service
bind-mounts it read-only at `/app/.openviking/`.

## Format

JSON, despite the `.conf` extension. Confirmed by reading
`openviking.server.config.load_server_config` in image
`ghcr.io/volcengine/openviking:v0.3.19` — it calls `load_json_config(path)`,
not a TOML loader. (The earlier verified-shapes spec said "TOML/INI"; that
turned out to be wrong — the probe corrected it.)

## Schema

Top-level model is
`openviking_cli.utils.config.open_viking_config.OpenVikingConfig`. All
Pydantic models in the chain set `extra="forbid"`, so unknown keys (including
JSON comments like `_comment`) cause validation failure on startup. Keep the
file lean and put explanation here instead.

Sections we set, and why:

- **`default_account` / `default_user` / `default_agent`** — namespace defaults
  used when a request doesn't supply `X-OpenViking-*` headers. Hermes will set
  these per-call, but defaults keep direct `curl` probes useful.
- **`server.host = "0.0.0.0"`** — binds inside the container to all interfaces
  so docker's port mapping (`127.0.0.1:1933:1933` in compose) can forward AND
  the sibling Hermes container can reach it via the compose-network name
  `http://openviking:1933`. The host-side bind is what controls external
  reachability; UFW belt-and-suspenders.
- **`server.auth_mode = "api_key"` + `server.root_api_key`** — required by
  OpenViking's startup security check: `auth_mode="dev"` (the default when
  `root_api_key` is unset) refuses to bind to a non-loopback host. We need
  non-loopback inside the container for the docker-compose network to work,
  so we use `api_key` mode. The repo ships `ov.conf` with the literal string
  `__OPENVIKING_ROOT_API_KEY__` as a placeholder; cloud-init generates a
  random key on first boot, stores it in `/opt/agenticos/.env`, and `sed`s
  it into `/opt/agenticos/openviking-config/ov.conf` before bringing the
  stack up. The actual secret never lives in git.
- **`storage.workspace = "/app/.openviking/data"`** — OpenViking's internal
  sqlite + vectordb workspace. Lives inside the `openviking-config` named
  volume so hot DB files are **not** Syncthing-paired. (User-visible memory
  content lives in `/app/vault`, which IS Syncthing-paired — separate.)
- **`embedding.dense`** — points OpenViking at the sibling `ollama`
  container on the compose network. `nomic-embed-text` is pre-pulled by
  cloud-init (`runcmd` step). Ollama provider requires no api_key per
  `EmbeddingModelConfig` validation. The `/v1` suffix on `api_base` matters:
  OpenViking routes Ollama embeddings through `OpenAIDenseEmbedder`
  (`embedding_config.py:610-620` — Ollama is OpenAI-API-compatible at
  `/v1/embeddings`). Without `/v1`, requests 404 and the embedding
  circuit breaker trips.
- **`memory.extraction_enabled = true`** — runs the memory-extraction
  pipeline on session commit. This is the default but we set it explicitly
  so it's visible in the config.

## What we deliberately left as defaults

- `memory.version` defaults to `"v2"` (new templating system).
- `memory.eager_prefetch` defaults to `true` (prefetches top-N content,
  no read tool exposed to LLM).
- `memory.agent_memory_enabled` defaults to `false` — we'll enable when
  Phase 1.1 wires up agent-scope trajectory memory.
- No `vlm`, `rerank`, `retrieval`, `feishu`, `oauth`, `telemetry` blocks:
  defaults work.
- No `encryption` block: file-level AES-GCM encryption is off for now;
  data is protected by the Droplet's disk-level encryption + UFW.

## Schema derivation log (for future maintainers)

1. `OPENVIKING_CONFIG_FILE=/app/.openviking/ov.conf` (from container env).
2. Loader: `openviking/server/config.py:load_server_config` →
   `load_json_config(path)`. JSON, not TOML.
3. Top model: `openviking_cli/utils/config/open_viking_config.py:OpenVikingConfig`.
4. Sub-schemas read from sibling files in the same directory
   (`storage_config.py`, `embedding_config.py`, `memory_config.py`, etc.).
5. Ollama provider branch: `embedding_config.py:158-160` —
   `provider == "ollama"` requires no api_key; just `model` and `api_base`.
