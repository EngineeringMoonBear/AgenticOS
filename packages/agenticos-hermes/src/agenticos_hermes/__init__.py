"""AgenticOS Spec 1 plugins and internal modules.

Submodules:
  - workers.slm_runner    — Ollama HTTP client (internal, not a Hermes plugin)
  - workers.codex_coder   — codex exec --json subprocess wrapper (internal)
  - routing               — slm_router decision tree (pure function)
  - tasks.daily_brief     — cron task (07:00 ET)
  - tasks.cost_report     — cron task (23:00 ET)
  - tasks.inbox_triage    — triggered by daemons/inbox-watcher
  - db                    — Postgres connection helper
  - pricing               — per-call cost math (incl. cached_input_tokens discount)

Sibling top-level dirs (NOT inside src/):
  - plugins/cost-recorder/  — Hermes hook plugin bind-mounted into the container
  - daemons/inbox-watcher/  — Standalone Docker daemon
"""
__version__ = "0.1.0"
