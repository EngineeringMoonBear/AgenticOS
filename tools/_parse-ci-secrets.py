#!/usr/bin/env python3
"""Minimal, dependency-free parser for infra/ci-secrets.yaml (GOL-342).

CI runners reliably ship python3 but not PyYAML, so we parse the fixed,
intentionally-simple manifest shape ourselves instead of adding a dependency:

    secrets:
      - op_ref: op://...
        repo:   owner/name
        name:   SECRET_NAME
        gate:   optional reason      # skip row when present

Emits one TAB-separated row per entry to stdout:  op_ref<TAB>repo<TAB>name<TAB>gate
Only the manifest STRUCTURE is handled here — this never reads or prints secret
VALUES (that is `op read` in the shell). Fields may be quoted or bare; '#'
comments and blank lines are ignored.
"""
import sys

FIELDS = ("op_ref", "repo", "name", "gate")


def strip_comment(s: str) -> str:
    # Drop an unquoted trailing '# comment'. Values in this manifest never
    # contain '#', so a simple split is safe and keeps the parser tiny.
    if s and s[0] not in "\"'":
        return s.split(" #", 1)[0].split("\t#", 1)[0]
    return s


def unquote(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        return s[1:-1]
    return s


def parse(path: str):
    rows, cur = [], None
    in_secrets = False
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if not line.startswith(" ") and stripped.rstrip() == "secrets:":
                in_secrets = True
                continue
            if not in_secrets:
                continue
            if stripped.startswith("- "):
                if cur is not None:
                    rows.append(cur)
                cur = {}
                stripped = stripped[2:].strip()
                if not stripped:
                    continue
            if cur is None:
                continue
            if ":" in stripped:
                key, _, val = stripped.partition(":")
                key = key.strip()
                if key in FIELDS:
                    cur[key] = unquote(strip_comment(val.strip()))
    if cur is not None:
        rows.append(cur)
    return rows


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write("usage: _parse-ci-secrets.py <manifest.yaml> [owner/repo filter]\n")
        return 2
    repo_filter = sys.argv[2] if len(sys.argv) > 2 else None
    for r in parse(sys.argv[1]):
        op_ref, repo, name = r.get("op_ref", ""), r.get("repo", ""), r.get("name", "")
        if not (op_ref and repo and name):
            sys.stderr.write(f"warn: incomplete entry skipped: {r}\n")
            continue
        if repo_filter and repo != repo_filter:
            continue
        sys.stdout.write("\t".join((op_ref, repo, name, r.get("gate", ""))) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
