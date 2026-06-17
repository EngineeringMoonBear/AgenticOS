/**
 * Build the canonical viking:// URI for a vault-relative path.
 *
 * Ports `viking_uri_for` from vault_ingest.py (~line 101). The reader
 * (vault-reader.ts) already yields vault-relative POSIX paths, so unlike the
 * Python version we don't need a separate scope/root distinction:
 *
 *   Loose top-level note:  HELLO.md          → viking://resources/notes/HELLO.md
 *   Scoped path:           farming/x/y.md    → viking://resources/farming/x/y.md
 *
 * A "loose top-level note" is a *.md file with no directory component (no "/").
 * Those live under the synthetic `notes/` scope; everything else keeps its
 * vault-relative path verbatim.
 */
export function vikingUriFor(vaultPath: string): string {
  const isLooseTopLevel = !vaultPath.includes("/");
  const rel = isLooseTopLevel ? `notes/${vaultPath}` : vaultPath;
  return `viking://resources/${rel}`;
}
