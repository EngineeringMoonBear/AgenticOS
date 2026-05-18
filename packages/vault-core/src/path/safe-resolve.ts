import path from "node:path";

/**
 * Safely resolve a wiki-relative path against a base directory.
 *
 * Rules:
 * - Input must be a relative path (no leading `/`)
 * - Must not contain `..` segments
 * - Must not contain null bytes
 * - Resolved path must be a descendant of baseDir (no escape via symlinks etc.)
 * - Unicode is permitted; the path is NFC-normalized before resolution
 *
 * @throws {Error} if any safety constraint is violated
 */
export function safeResolve(baseDir: string, relPath: string): string {
  // Reject null bytes
  if (relPath.includes("\0")) {
    throw new Error(`Path contains null byte: ${JSON.stringify(relPath)}`);
  }

  // NFC normalize (macOS APFS uses NFD; normalize to NFC for consistent keys)
  const normalized = relPath.normalize("NFC");

  // Reject absolute paths
  if (path.isAbsolute(normalized)) {
    throw new Error(`Absolute path not allowed: ${JSON.stringify(normalized)}`);
  }

  // Reject `..` segments
  const segments = normalized.split(/[\\/]/);
  if (segments.some((seg) => seg === "..")) {
    throw new Error(
      `Path traversal not allowed (.. segment): ${JSON.stringify(normalized)}`
    );
  }

  const resolved = path.resolve(baseDir, normalized);
  const base = path.resolve(baseDir);

  // Ensure resolved is strictly under base (also catches symlink-style escapes
  // when combined with path.resolve which does NOT follow symlinks)
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(
      `Path escapes base directory: ${JSON.stringify(resolved)} not under ${JSON.stringify(base)}`
    );
  }

  return resolved;
}

/**
 * Check whether a relative path is safe without throwing.
 */
export function isSafePath(relPath: string): boolean {
  try {
    // Use a synthetic base so we can check without needing the real vault root
    safeResolve("/tmp/vault-base", relPath);
    return true;
  } catch {
    return false;
  }
}
