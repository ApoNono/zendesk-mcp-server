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
