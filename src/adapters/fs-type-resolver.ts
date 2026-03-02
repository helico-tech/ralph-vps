import { join } from "node:path";
import { readdir } from "node:fs/promises";
import type { TypeDefinition } from "../domain/types";
import { TYPES_DIR } from "../constants";

const BUILT_IN_DIR = join(import.meta.dir, "../built-in/types");

export class FsTypeResolver {
  constructor(private readonly projectRoot: string) {}

  private get projectTypesDir(): string {
    return join(this.projectRoot, TYPES_DIR);
  }

  async resolve(typeName: string): Promise<TypeDefinition | null> {
    // Project-level types take precedence
    const projectType = await this.loadFromDir(
      join(this.projectTypesDir, typeName),
      typeName
    );
    if (projectType) return projectType;

    // Fall back to built-in
    return this.loadFromDir(join(BUILT_IN_DIR, typeName), typeName);
  }

  async listTypes(): Promise<string[]> {
    const types = new Set<string>();

    // Built-in types
    try {
      const builtIn = await readdir(BUILT_IN_DIR);
      for (const name of builtIn) types.add(name);
    } catch {
      // No built-in dir
    }

    // Project types (can override built-in)
    try {
      const project = await readdir(this.projectTypesDir);
      for (const name of project) types.add(name);
    } catch {
      // No project types dir
    }

    return [...types].sort();
  }

  private async loadFromDir(
    dir: string,
    typeName: string
  ): Promise<TypeDefinition | null> {
    const promptPath = join(dir, "prompt.md");
    const templatePath = join(dir, "template.md");

    const promptFile = Bun.file(promptPath);
    if (!(await promptFile.exists())) return null;

    const promptTemplate = await promptFile.text();

    let taskTemplate = "";
    const templateFile = Bun.file(templatePath);
    if (await templateFile.exists()) {
      taskTemplate = await templateFile.text();
    }

    return {
      name: typeName,
      promptTemplate,
      taskTemplate,
    };
  }
}
