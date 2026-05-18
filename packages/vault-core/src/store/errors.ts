/**
 * Thrown when a wiki path fails the safe-resolve check (e.g. `..` traversal,
 * absolute path, null byte).
 */
export class VaultPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultPathError";
  }
}

/**
 * Thrown when markdown parsing fails for a specific file.
 */
export class VaultParseError extends Error {
  readonly filePath: string;
  constructor(filePath: string, message: string) {
    super(`Parse error in ${filePath}: ${message}`);
    this.name = "VaultParseError";
    this.filePath = filePath;
  }
}

/**
 * Thrown when the vault store is locked (e.g. concurrent revalidation in
 * progress) and the operation cannot proceed.
 */
export class VaultLockedError extends Error {
  constructor(message = "Vault store is locked; try again shortly") {
    super(message);
    this.name = "VaultLockedError";
  }
}
