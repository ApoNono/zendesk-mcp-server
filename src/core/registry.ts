import { Tool, ToolDescriptor } from './types.js';
import { ToolNotFoundError } from '../utils/errors.js';
import { Logger } from '../utils/logger.js';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  registerTool(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool ${tool.name} is already registered, overwriting`);
    }
    this.tools.set(tool.name, tool);
    this.logger.info(`Registered tool: ${tool.name}`);
  }

  getTool(toolName: string): Tool | null {
    return this.tools.get(toolName) || null;
  }

  hasTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  listTools(): ToolDescriptor[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
    }));
  }

  size(): number {
    return this.tools.size;
  }

  async invokeTool(toolName: string, params: unknown): Promise<unknown> {
    const tool = this.tools.get(toolName);
    if (!tool) throw new ToolNotFoundError(toolName);
    return tool.execute(params);
  }
}
