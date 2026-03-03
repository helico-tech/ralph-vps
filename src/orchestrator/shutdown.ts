// Shutdown handler — process signal registration, graceful shutdown flag

let shuttingDown = false;
let resolveShutdown: (() => void) | null = null;
let shutdownPromise = createShutdownPromise();

function createShutdownPromise(): Promise<void> {
  return new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });
}

export function registerShutdownHandlers(): void {
  const handler = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[ralph] received ${signal}, shutting down gracefully\n`);
    resolveShutdown?.();
  };

  process.once("SIGTERM", () => handler("SIGTERM"));
  process.once("SIGINT", () => handler("SIGINT"));
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function waitForShutdown(): Promise<void> {
  return shutdownPromise;
}

/** Test-only: reset module state between test runs. */
export function _resetShutdownState(): void {
  shuttingDown = false;
  shutdownPromise = createShutdownPromise();
}
