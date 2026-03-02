import { z } from "zod";

export const CircuitBreakerConfigSchema = z.object({
  maxConsecutiveErrors: z.number().int().min(0).default(3),
  maxStallIterations: z.number().int().min(0).default(5),
  maxCostUsd: z.number().min(0).default(0),
  maxTokens: z.number().int().min(0).default(0),
  maxIterations: z.number().int().min(0).default(0),
});

export const ProjectConfig = z.object({
  name: z.string().min(1),
  circuitBreakers: CircuitBreakerConfigSchema.default({}),
  defaultType: z.string().default("feature-dev"),
  reviewAfterCompletion: z.boolean().default(true),
});
export type ProjectConfig = z.infer<typeof ProjectConfig>;

export const NodeConfig = z.object({
  hostname: z.string().min(1),
  projectsDir: z.string().default("/home/ralph/projects"),
  logsDir: z.string().default("/home/ralph/logs"),
  maxConcurrentLoops: z.number().int().min(1).default(1),
});
export type NodeConfig = z.infer<typeof NodeConfig>;

export const ClientConfig = z.object({
  nodes: z.record(
    z.string(),
    z.object({
      host: z.string().min(1),
      user: z.string().default("ralph"),
      port: z.number().int().default(22),
      identityFile: z.string().optional(),
    })
  ).default({}),
});
export type ClientConfig = z.infer<typeof ClientConfig>;
