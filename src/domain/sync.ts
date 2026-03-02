import { createHash } from "node:crypto";

export interface SyncManifest {
  files: Record<string, string>; // path -> hash
  lastSyncedAt: string;
}

export type SyncAction = "create" | "overwrite" | "skip";

export function decideSyncAction(
  sourceHash: string,
  targetExists: boolean,
  targetHash: string | null,
  manifestHash: string | null
): SyncAction {
  if (!targetExists) return "create";

  // If target hasn't been modified since last sync, overwrite
  if (manifestHash && targetHash === manifestHash) return "overwrite";

  // If target was modified locally, skip to avoid losing changes
  if (manifestHash && targetHash !== manifestHash) return "skip";

  // No manifest entry = first sync, target exists = skip
  return "skip";
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}
