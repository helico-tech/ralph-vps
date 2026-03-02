import { beforeAll } from "bun:test";
import { startTestVps } from "../helpers/docker";

// Start Docker if not already running (idempotent).
// Teardown is manual: `bun run docker:down`
beforeAll(async () => {
  await startTestVps();
}, 120000); // 2 min timeout for docker build
