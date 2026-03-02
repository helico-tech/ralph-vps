import { join } from "node:path";
import type { Command } from "commander";
import { pendingMigrations } from "../../domain/migration";
import { RALPH_LOCAL_DIR } from "../../constants";

export function registerMigrateCommand(
  program: Command,
  projectRoot: string
): void {
  program
    .command("migrate")
    .description("Run pending migrations")
    .option("--dry-run", "Show what would be migrated without applying")
    .action(async (opts) => {
      // Check git state
      const statusResult = Bun.spawnSync(
        ["git", "status", "--porcelain"],
        { cwd: projectRoot, stdout: "pipe", stderr: "pipe" }
      );
      const dirty = statusResult.stdout.toString().trim();
      if (dirty && !opts.dryRun) {
        console.error("Git working tree is not clean. Commit or stash changes first.");
        process.exit(1);
      }

      // Load applied migrations
      const migrationsFile = join(projectRoot, RALPH_LOCAL_DIR, "migrations.json");
      let appliedIds: string[] = [];
      const file = Bun.file(migrationsFile);
      if (await file.exists()) {
        appliedIds = await file.json();
      }

      const pending = pendingMigrations(appliedIds);

      if (pending.length === 0) {
        console.log("No pending migrations.");
        return;
      }

      if (opts.dryRun) {
        console.log("Pending migrations:");
        for (const m of pending) {
          console.log(`  ${m.id}: ${m.description}`);
        }
        return;
      }

      for (const m of pending) {
        console.log(`Applying: ${m.id} — ${m.description}`);
        await m.apply(projectRoot);
        appliedIds.push(m.id);

        // Auto-commit
        Bun.spawnSync(["git", "add", "."], { cwd: projectRoot });
        Bun.spawnSync(
          ["git", "commit", "-m", `ralph: migration ${m.id}`],
          { cwd: projectRoot, stdout: "pipe", stderr: "pipe" }
        );
      }

      // Save applied list
      await Bun.write(migrationsFile, JSON.stringify(appliedIds, null, 2));

      // Push
      Bun.spawnSync(["git", "push"], { cwd: projectRoot, stdout: "pipe", stderr: "pipe" });

      console.log(`\n${pending.length} migration(s) applied.`);
    });
}
