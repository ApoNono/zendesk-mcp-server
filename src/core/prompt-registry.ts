import { Prompt, PromptDescriptor, PromptMessage } from './types.js';
import { Logger } from '../utils/logger.js';
import { MCPError } from '../utils/errors.js';

export class PromptNotFoundError extends MCPError {
  constructor(name: string) {
    super(`Prompt not found: ${name}`, 'PROMPT_NOT_FOUND', 404, { name });
    this.name = 'PromptNotFoundError';
    Object.setPrototypeOf(this, PromptNotFoundError.prototype);
  }
}

export class PromptRegistry {
  private prompts: Map<string, Prompt> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  registerPrompt(prompt: Prompt): void {
    if (this.prompts.has(prompt.name)) {
      this.logger.warn(`Prompt ${prompt.name} is already registered, overwriting`);
    }
    this.prompts.set(prompt.name, prompt);
    this.logger.info(`Registered prompt: ${prompt.name}`);
  }

  hasPrompt(name: string): boolean {
    return this.prompts.has(name);
  }

  getPrompt(name: string): Prompt | null {
    return this.prompts.get(name) || null;
  }

  listPrompts(): PromptDescriptor[] {
    return Array.from(this.prompts.values()).map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    }));
  }

  size(): number {
    return this.prompts.size;
  }

  renderPrompt(name: string, args: Record<string, string> = {}): PromptMessage[] {
    const prompt = this.prompts.get(name);
    if (!prompt) throw new PromptNotFoundError(name);
    this.validateArguments(prompt, args);
    return prompt.render(args);
  }

  private validateArguments(prompt: Prompt, args: Record<string, string>): void {
    for (const arg of prompt.arguments ?? []) {
      if (arg.required && !(arg.name in args)) {
        throw new MCPError(
          `Prompt ${prompt.name} requires argument: ${arg.name}`,
          'PROMPT_MISSING_ARGUMENT',
          400,
          { argument: arg.name },
        );
      }
    }
  }
}
