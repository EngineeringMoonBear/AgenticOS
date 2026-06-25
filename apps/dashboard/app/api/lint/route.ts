import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { LintIssue } from "@agenticos/vault-core";
import { getVaultStore } from "@/lib/vault/store-singleton";

type LintKind = LintIssue["kind"];

const VALID_KINDS: LintKind[] = ["broken-link", "orphan", "todo"];

function isValidKind(value: string): value is LintKind {
  return VALID_KINDS.includes(value as LintKind);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const kindParam = request.nextUrl.searchParams.get("kind");
  const kind: LintKind | undefined =
    kindParam && isValidKind(kindParam) ? kindParam : undefined;

  // In remote mode (App Platform), the vault store is RemoteVaultClient, whose
  // lint() is an intentional notSupported() stub — there is no vault-server
  // /lint endpoint yet. Calling it would throw and return a 500 on every poll.
  // Degrade gracefully to an empty result instead of spamming errors. The
  // `unavailable` flag lets the UI distinguish "no issues" from "not computed".
  // (Selection mirrors store-singleton.ts, which picks RemoteVaultClient when
  // VAULT_SERVER_URL is set.)
  if (process.env.VAULT_SERVER_URL) {
    return NextResponse.json({ issues: [], unavailable: true });
  }

  try {
    const store = await getVaultStore();
    const allIssues = await store.lint();
    const issues = kind ? allIssues.filter((i) => i.kind === kind) : allIssues;
    return NextResponse.json({ issues });
  } catch (err) {
    console.error("[GET /api/lint]", err);
    return NextResponse.json(
      { error: "Failed to run lint" },
      { status: 500 }
    );
  }
}
