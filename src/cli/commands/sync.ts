import { join } from "node:path";
import { readdir, mkdir } from "node:fs/promises";
import type { Command } from "commander";
import { decideSyncAction, hashContent, type SyncManifest } from "../../domain/sync";
import { TYPES_DIR, SYNC_MANIFEST_FILE } from "../../constants";

const BUILT_IN_TYPES_DIR = join(import.meta.dir, "../../built-in/types");

export function registerSyncCommand(
  program: Command,
  projectRoot: string
): void {
  program
    .command("sync")
    .description("Sync built-in types to project")
    .option("--force", "Overwrite all, ignoring local modifications")
    .action(async (opts) => {
      const projectTypesDir = join(projectRoot, TYPES_DIR);
      await mkdir(projectTypesDir, { recursive: true });

      // Load manifest
      const manifestPath = join(projectRoot, SYNC_MANIFEST_FILE);
      let manifest: SyncManifest = { files: {}, lastSyncedAt: "" };
      const manifestFile = Bun.file(manifestPath);
      if (await manifestFile.exists()) {
        manifest = await manifestFile.json();
      }

      // List built-in types
      const typeNames = await readdir(BUILT_IN_TYPES_DIR);
      let created = 0;
      let overwritten = 0;
      let skipped = 0;

      for (const typeName of typeNames) {
        const srcDir = join(BUILT_IN_TYPES_DIR, typeName);
        const dstDir = join(projectTypesDir, typeName);
        await mkdir(dstDir, { recursive: true });

        const files = await readdir(srcDir);
        for (const file of files) {
          const srcPath = join(srcDir, file);
          const dstPath = join(dstDir, file);
          const manifestKey = `${typeName}/${file}`;

          const sourceContent = await Bun.file(srcPath).text();
          const sourceHash = hashContent(sourceContent);

          const dstFile = Bun.file(dstPath);
          const targetExists = await dstFile.exists();
          const targetHash = targetExists ? hashContent(await dstFile.text()) : null;
          const manifestHash = manifest.files[manifestKey] ?? null;

          const action = opts.force
            ? (targetExists ? "overwrite" : "create")
            : decideSyncAction(sourceHash, targetExists, targetHash, manifestHash);

          if (action === "skip") {
            skipped++;
            console.log(`  skip: ${manifestKey} (locally modified)`);
          } else {
            await Bun.write(dstPath, sourceContent);
            manifest.files[manifestKey] = sourceHash;
            if (action === "create") {
              created++;
              console.log(`  create: ${manifestKey}`);
            } else {
              overwritten++;
              console.log(`  overwrite: ${manifestKey}`);
            }
          }
        }
      }

      // Save manifest
      manifest.lastSyncedAt = new Date().toISOString();
      await mkdir(join(projectRoot, ".ralph-local"), { recursive: true });
      await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));

      console.log(`\nSync complete: ${created} created, ${overwritten} overwritten, ${skipped} skipped`);
    });
}
