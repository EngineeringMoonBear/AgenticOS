/**
 * RemoteVaultClient — a VaultStore implementation that proxies READ operations
 * to the vault-server HTTP API (Phase B) running on the Droplet.
 *
 * The dashboard runs on DigitalOcean App Platform, which is remote from the
 * vault (the vault lives on the Droplet). When `VAULT_SERVER_URL` is set, the
 * store-singleton instantiates this client instead of the local
 * `InMemoryVaultStore` (which reads the local filesystem and cannot see the
 * Droplet's vault).
 *
 * The read and inbox-curation methods wired to vault-server endpoints are:
 * list, read, search, getBacklinks, listInbox, stats, readInbox, discardInbox.
 * The following methods remain deferred (no vault-server endpoint yet):
 * getOutgoing, getAllTags, lint, promoteInbox, revalidate. Rather than fail
 * silently, they throw a clear error so a missing endpoint surfaces loudly.
 */
import type {
  WikiPath,
  InboxPath,
  WikiPage,
  InboxNote,
  TagInfo,
  VaultStats,
  TreeNode,
  LintIssue,
  VaultStore,
} from "@agenticos/vault-core";

interface RemoteVaultClientConfig {
  baseUrl: string;
}

export class RemoteVaultClient implements VaultStore {
  private readonly baseUrl: string;

  constructor(config: RemoteVaultClientConfig) {
    // Strip a trailing slash so `${baseUrl}/tree` never produces a double slash.
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  private notSupported(method: string): never {
    throw new Error(
      `RemoteVaultClient.${method}() is not supported in VAULT_SERVER_URL (remote) mode; deferred to Phase E (vault-server write/extra endpoints).`
    );
  }

  async list(): Promise<{ tree: TreeNode; flat: WikiPath[] }> {
    const res = await fetch(`${this.baseUrl}/tree`, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`vault-server /tree -> HTTP ${res.status}`);
    }
    const body = (await res.json()) as { tree: TreeNode; flatPaths: WikiPath[] };
    return { tree: body.tree, flat: body.flatPaths };
  }

  async read(path: WikiPath): Promise<WikiPage | null> {
    const res = await fetch(
      `${this.baseUrl}/page?path=${encodeURIComponent(path)}`,
      { cache: "no-store" }
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`vault-server /page -> HTTP ${res.status}`);
    }
    return (await res.json()) as WikiPage;
  }

  async search(
    query: string,
    opts?: { tags?: string[]; limit?: number }
  ): Promise<WikiPage[]> {
    const params = new URLSearchParams();
    params.set("q", query);
    if (opts?.tags && opts.tags.length > 0) {
      params.set("tags", opts.tags.join(","));
    }
    if (opts?.limit !== undefined) {
      params.set("limit", String(opts.limit));
    }
    const res = await fetch(`${this.baseUrl}/search?${params.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`vault-server /search -> HTTP ${res.status}`);
    }
    const body = (await res.json()) as { results: WikiPage[]; total: number };
    return body.results;
  }

  async getBacklinks(path: WikiPath): Promise<WikiPath[]> {
    const res = await fetch(
      `${this.baseUrl}/backlinks?path=${encodeURIComponent(path)}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      throw new Error(`vault-server /backlinks -> HTTP ${res.status}`);
    }
    const body = (await res.json()) as { backlinks: WikiPath[] };
    return body.backlinks;
  }

  async listInbox(): Promise<InboxNote[]> {
    const res = await fetch(`${this.baseUrl}/inbox`, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`vault-server /inbox -> HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      items: { path: InboxPath; title: string; capturedAt: string }[];
    };
    // vault-server's /inbox response omits the note body; fill it with "".
    return body.items.map((i) => ({
      path: i.path,
      title: i.title,
      capturedAt: i.capturedAt,
      body: "",
    }));
  }

  async stats(): Promise<VaultStats> {
    const res = await fetch(`${this.baseUrl}/stats`, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`vault-server /stats -> HTTP ${res.status}`);
    }
    return (await res.json()) as VaultStats;
  }

  // --- Deferred to Phase E (no vault-server endpoint yet) ---

  async getOutgoing(): Promise<WikiPath[]> {
    return this.notSupported("getOutgoing");
  }

  async getAllTags(): Promise<TagInfo[]> {
    return this.notSupported("getAllTags");
  }

  async readInbox(inboxPath: InboxPath): Promise<InboxNote | null> {
    const segs = inboxPath.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${this.baseUrl}/inbox/${segs}`, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`vault-server /inbox/${inboxPath} -> HTTP ${res.status}`);
    return (await res.json()) as InboxNote;
  }

  async lint(): Promise<LintIssue[]> {
    return this.notSupported("lint");
  }

  async promoteInbox(): Promise<WikiPage> {
    return this.notSupported("promoteInbox");
  }

  async discardInbox(inboxPath: InboxPath): Promise<void> {
    const res = await fetch(`${this.baseUrl}/discard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inboxPath }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`vault-server /discard -> HTTP ${res.status}`);
  }

  async revalidate(): Promise<void> {
    return this.notSupported("revalidate");
  }
}
