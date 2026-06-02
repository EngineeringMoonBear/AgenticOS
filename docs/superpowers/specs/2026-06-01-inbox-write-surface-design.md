# Inbox Write-Surface Design (promote/discard)

**Date:** 2026-06-01
**Status:** Approved (brainstorming) — pending spec review → implementation plan
**Context:** The "write" half of Phase E. The Memory tab's inbox is the human
validation gate (captures land in `inbox/`, get promoted into `wiki/` or
discarded). The read side (tree/page/stats/inbox-list/recent-changes/skills)
is live. Today the dashboard's promote/discard actions are stubs
(`RemoteVaultClient` throws "deferred to Phase E").

---

## Goal

Let the operator triage inbox captures from the dashboard Memory tab —
**discard** directly (a sanctioned, reversible cloud write) and **promote**
via a human-applied Obsidian hand-off (zero cloud write to `wiki/`) — while
guaranteeing the cloud can never write curated knowledge.

## Locked decisions (from brainstorming)

1. **Hybrid write model:** discard is a dashboard-initiated write; promotion is
   drafted in the dashboard but **applied by the human in Obsidian**.
2. **Promote hand-off:** the review drawer renders the drafted page
   (frontmatter + body) with Copy + an `obsidian://` deep link to the inbox
   note. No `/promote` server call.
3. **Write boundary is a mount flag, not a convention:** the cloud can write
   only `inbox/`.

## Constraints (from the vault charter + this session)

- `vault/CLAUDE.md`: agents write via `/api/vault/*`, never bind-mount; promotion
  needs content-connection + frontmatter; **discard = move to `inbox/archived/`,
  never delete**; Obsidian is the human editing surface.
- vault-server currently mounts `/opt/vault:ro`.
- Mac Syncthing folder `agenticos-vault` is currently `sendonly`.
- The real vault is git-backed (rollback safety net).

---

## Architecture

### Write boundary (infra)

```
docker-compose vault-server volumes:
  - /opt/vault:/app/vault:ro              # whole vault: read-only
  - /opt/vault/inbox:/app/vault/inbox:rw  # nested override: inbox writable
```

Nested bind mounts let the more-specific path win, so vault-server can write
`inbox/` (incl. creating `inbox/archived/`) but is **physically unable** to
write `wiki/`, `sources/`, or anything else.

Mac Syncthing folder `agenticos-vault`: **`sendonly → sendreceive`**, so the
Droplet-side archive move propagates back into the Obsidian vault. Without it,
the Mac (as source) would re-assert the discarded file on the next scan and the
discard would not stick.

### Discard flow (write)

```
InboxQueue "Discard"
  → POST /api/vault/discard { inboxPath }           (dashboard route)
  → vault-server POST /discard { inboxPath }
  → store.discardInbox(inboxPath)                   (moves inbox/x.md → inbox/archived/x.md)
  → TanStack invalidates inbox-list; item leaves the queue
  → Syncthing propagates the move to Obsidian
```

`RemoteVaultClient.discardInbox` (currently throws) is wired to call the route.

### Promote flow (no cloud write)

```
InboxQueue "Promote"
  → open PromoteReviewDrawer
  → readInbox(inboxPath)                            (READ: fetch the capture body)
  → operator picks target wiki/<Category>, edits title + tags
  → drawer renders final markdown (frontmatter + body)
      + Copy button
      + obsidian:// deep link to the inbox note
  → operator creates wiki/<Category>/<name>.md in Obsidian, then (optionally)
    Discards the now-promoted inbox item from the dashboard
```

`store.promoteInbox` is **not used in remote mode** — promotion is a
client-side draft. `RemoteVaultClient.promoteInbox` stays a no-op/unsupported.

---

## Components & interfaces

| Unit | Responsibility | Depends on |
|---|---|---|
| vault-server `POST /discard` | call `store.discardInbox`, 400 on bad path, 200 `{archivedPath}` | vault-core store, inbox-rw mount |
| vault-server `GET /inbox/:path` | return one inbox note via `store.readInbox` (404 if absent) | vault-core store |
| dashboard `POST /api/vault/discard` | proxy to vault-server `/discard` | `RemoteVaultClient` |
| dashboard `GET /api/vault/inbox/[...path]` | proxy to vault-server `/inbox/:path` | `RemoteVaultClient` |
| `RemoteVaultClient.discardInbox` | real fetch (was: throw) | discard route |
| `RemoteVaultClient.readInbox` | real fetch (was: throw) | inbox route |
| `PromoteReviewDrawer` | render draft md + Copy + obsidian deep link | `readInbox`, category list from tree |
| `InboxQueue` | wire Discard → mutation; Promote → open drawer | the two hooks |

`buildFrontmatter`/page-rendering logic for the draft is reused from
`vault-core` (the same shape `promoteInbox` would have written), but executed
client-side to render the preview rather than to write a file.

## Data flow / shapes

- `POST /discard` request `{ inboxPath: string }` → `200 { archivedPath: string }`
  or `400 { error }` (path traversal / not found).
- `GET /inbox/:path` → `200 InboxNote { path, title, capturedAt, body }` or `404`.
- Discard mutation invalidates the `inbox-list` query key on success.

## Error handling

- vault-server discard: `safeResolve` guards path traversal (throws → 400). If
  the inbox file is missing → 404. If the inbox mount is unexpectedly read-only
  (misconfig) → the write throws → 500 surfaced honestly (not swallowed).
- `obsidian://` deep link: best-effort; the Copy button is the fallback if the
  OS has no Obsidian handler.
- Discard is reversible by design (archive, not delete), so a wrong discard is
  recoverable from `inbox/archived/` in Obsidian.

## Charter update (`vault/CLAUDE.md`)

Amend the boundaries table / "What Not to Do":
- The AgenticOS `/memory` view may **discard** (archive) inbox items directly
  via `/api/vault/discard`. This is the one sanctioned dashboard write.
- **Promotion remains human-applied in Obsidian.** The dashboard only drafts the
  page and hands off via `obsidian://`.
- The cloud writes **only `inbox/`** (enforced by the read-only `wiki/` mount).

## Testing

- vault-server: `POST /discard` (archives, path-guard 400, missing 404) and
  `GET /inbox/:path` (returns note, 404) — TDD, Fastify `inject`.
- `RemoteVaultClient.readInbox` + `discardInbox` — mocked-fetch unit tests
  (success, 404/error → throw or null per contract).
- `PromoteReviewDrawer` — renders frontmatter+body from a fixture inbox note;
  builds the correct `obsidian://` deep link; Copy populates clipboard.
- `InboxQueue` — Discard triggers the mutation + optimistic removal; Promote
  opens the drawer.
- Deploy verification: discard an item live → it moves to `inbox/archived/` on
  the Droplet AND appears archived in Obsidian (sendreceive round-trip).

## Acceptance criteria

1. Discard from the dashboard moves the item to `inbox/archived/` on the Droplet
   and the change reaches Obsidian.
2. vault-server cannot write `wiki/` (verified: attempting a wiki write fails on
   the read-only mount).
3. Promote opens a review drawer showing valid frontmatter+body and a working
   `obsidian://` deep link; no file is written by the cloud.
4. `RemoteVaultClient.readInbox`/`discardInbox` no longer throw "deferred".
5. Full CI green; deploy-droplet redeploys vault-server with the new mount.

## Out of scope (YAGNI)

- LLM-suggested categories/tags for promotion (operator picks manually).
- Auto-promotion, bulk triage, lint-driven promotion.
- `getOutgoing`/`getAllTags`/`lint`/`revalidate` client stubs (separate work;
  not needed for promote/discard).
- Restoring archived items from the dashboard (done in Obsidian).
