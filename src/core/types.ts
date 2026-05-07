import { Schema } from '../middleware/validator.js';

export interface Tool {
  name: string;
  description: string;
  parameters: Schema;
  execute(params: unknown): Promise<unknown>;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Schema;
}

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: { type: 'text'; text: string };
}

export interface Prompt {
  name: string;
  description: string;
  arguments?: PromptArgument[];
  render(args: Record<string, string>): PromptMessage[];
}

export interface PromptDescriptor {
  name: string;
  description: string;
  arguments?: PromptArgument[];
}
