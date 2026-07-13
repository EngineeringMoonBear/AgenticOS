# `decompose.py` — spec → ownership.yml → partitioned issues

Build partner of the CEO **Group-coding decomposition** routine
([GOL-154](https://github.com/Goldberry-Playground/AgenticOS)). It turns one
**spec** (a single intended change set) plus each repo's `ownership.yml`
([GOL-152](https://github.com/Goldberry-Playground/AgenticOS)) into a set of
**D2-partitioned child issues** — one per touched partition — each carrying
acceptance criteria, an owner (assignee), reviewer(s), and a `wave` number for
sequencing. Every touched path lands in **exactly one** owned partition (no path
double-assigned); any path that matches no partition is surfaced in an
`UNMAPPED` bucket, never dropped.

Zero-dependency (Python 3.8+ stdlib only), same style/parser as
`scripts/lint-ownership.py`.

## Spec format

```yaml
version: 1
title: "Preview-droplet provisioning"   # used in emitted issue titles
umbrella: GOL-123                        # REQUIRED: parentId for emitted issues
goal: GOL-456                            # optional: goalId
summary: "One-paragraph what/why."        # copied into every emitted issue
acceptance:                              # GLOBAL acceptance, applied to all
  - "Feature X works end to end"
changes:                                 # touched surface, grouped by repo
  - repo: grove-sites                    # spec repo key (see mapping below)
    paths: [ "apps/hub/**", "packages/ui/**" ]
    acceptance: [ "Hub renders droplet card" ]   # optional, ADDED to global
  - repo: odoocker
    paths: [ "postgres/**" ]
```

`repo` is the **spec key** you reference; it is mapped to an `ownership.yml`
either explicitly (`--ownership <key>=<path>`) or by directory under
`--repos-root` (a subdir whose name starts with the key is accepted, so spec
`odoocker` resolves the `odoocker-goldberrygrove/` checkout).

## Partition algorithm (most-specific-wins)

For each `(repo, path)`, among all partitions with a glob that matches `path`
(gitignore-style with `**` globstar), pick exactly one:

1. longest literal (non-wildcard) prefix of the matching glob;
2. then fewest wildcard segments;
3. then earliest declaration order.

## Owner / reviewer resolution

Ownership slug **==** agent `urlKey`. Resolved from `--agents-file` (JSON list
of `{urlKey,id,name}`) when given, else live via
`GET /api/companies/{id}/agents`. An unknown slug is a **hard error**.

## Wave gate & idempotency

- **Wave gate:** an emitted issue in wave *N* gets `blockedByIssueIds` = every
  emitted issue in waves `< N`, so Paperclip auto-resumes later waves as earlier
  ones complete.
- **Idempotency:** each issue carries a stable marker
  `decompose:{specId}:{repo}:{partition}`. Re-running the same spec **updates**
  the matching issue instead of duplicating. `specId` = `spec.id` or a hash of
  the spec content.

## Usage

```bash
# Dry-run (default): preview table + wave DAG + UNMAPPED list, creates nothing.
python3 scripts/decompose.py --spec spec.yml \
    --ownership grove-sites=/path/grove-sites/ownership.yml \
    --ownership odoocker=/path/odoocker/ownership.yml \
    --ownership grove-odoo-modules=/path/grove-odoo-modules/ownership.yml \
    --agents-file agents.json

# ...or point at a dir of checkouts:
python3 scripts/decompose.py --spec spec.yml --repos-root /path/checkouts

# Apply — create/update issues via the Paperclip API (idempotent):
python3 scripts/decompose.py --spec spec.yml --repos-root /path/checkouts \
    --apply --company-id "$PAPERCLIP_COMPANY_ID"
```

`--apply` refuses to run while any path is `UNMAPPED` unless `--allow-unmapped`
is passed. API base defaults to `$PAPERCLIP_API_URL`; operators inside the
Paperclip host can pass `--api-url http://localhost:3100`.

Exit codes: `0` ok · `1` decomposition error (unmapped / unknown slug / API) ·
`2` usage/parse error.

## Tests

```bash
python3 scripts/tests/test_decompose.py      # 22 unit tests, stdlib only
```

Fixtures live in `scripts/tests/fixtures/` — the three real `ownership.yml`
files, an offline `agents.json`, and the `sample-spec.yml` acceptance fixture
(`sample-spec-literal.yml` preserves the verbatim GOL-154 §8 draft).
