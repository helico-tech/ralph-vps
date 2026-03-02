import { beforeAll, afterAll } from "bun:test";
import { startTestVps, stopTestVps } from "../helpers/docker";

beforeAll(async () => {
  await startTestVps();
}, 120000); // 2 min timeout for docker build

afterAll(async () => {
  await stopTestVps();
});
