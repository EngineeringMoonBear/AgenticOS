export class HermesOfflineError extends Error {
  constructor(public readonly path: string) {
    super(`Hermes daemon is offline (attempting ${path})`);
    this.name = "HermesOfflineError";
  }
}

export class HermesTimeoutError extends Error {
  constructor(public readonly path: string, public readonly timeoutMs: number) {
    super(`Hermes request to ${path} timed out after ${timeoutMs}ms`);
    this.name = "HermesTimeoutError";
  }
}

export class HermesRunNotFoundError extends Error {
  constructor(public readonly runId: string) {
    super(`Hermes run not found: ${runId}`);
    this.name = "HermesRunNotFoundError";
  }
}
