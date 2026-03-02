import type { Task } from "../domain/task";
import type { PromptCompiler, CompileContext, CompiledPrompt } from "../ports/prompt-compiler";

const DEFAULT_TEMPLATE = `You are working on a task. Complete it thoroughly.

## Task
{{TASK_BODY}}
`;

export class TemplatePromptCompiler implements PromptCompiler {
  compile(task: Task, typePromptTemplate: string, context: CompileContext): CompiledPrompt {
    const template = typePromptTemplate || DEFAULT_TEMPLATE;

    const prompt = template
      .replace(/\{\{TASK_TITLE\}\}/g, task.title)
      .replace(/\{\{TASK_ID\}\}/g, task.id)
      .replace(/\{\{TASK_TYPE\}\}/g, task.type)
      .replace(/\{\{TASK_BODY\}\}/g, task.body)
      .replace(/\{\{ITERATION\}\}/g, String(context.iteration))
      .replace(/\{\{PROJECT_NAME\}\}/g, context.projectName)
      .replace(/\{\{PREVIOUS_ERRORS\}\}/g, context.previousErrors?.join("\n") ?? "None");

    const flags = [
      "--verbose",
      "--output-format", "stream-json",
    ];

    return { prompt, flags };
  }
}
