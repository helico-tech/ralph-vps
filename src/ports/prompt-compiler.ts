import type { Task } from "../domain/task";

export interface CompileContext {
  iteration: number;
  projectName: string;
  previousErrors?: string[];
}

export interface CompiledPrompt {
  prompt: string;
  flags: string[];
}

export interface PromptCompiler {
  compile(task: Task, typePromptTemplate: string, context: CompileContext): CompiledPrompt;
}
