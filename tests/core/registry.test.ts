import { ToolRegistry } from '../../src/core/registry.js';
import { Tool } from '../../src/core/types.js';
import { Logger } from '../../src/utils/logger.js';
import { ToolNotFoundError } from '../../src/utils/errors.js';

const logger = new Logger({ level: 'fatal' });

function makeTool(name: string): Tool {
  return {
    name,
    description: `tool ${name}`,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ ok: true }),
  };
}

describe('ToolRegistry', () => {
  it('registers and retrieves tools by name', () => {
    const registry = new ToolRegistry(logger);
    const tool = makeTool('zd_test');
    registry.registerTool(tool);

    expect(registry.size()).toBe(1);
    expect(registry.hasTool('zd_test')).toBe(true);
    expect(registry.getTool('zd_test')).toBe(tool);
    expect(registry.getTool('missing')).toBeNull();
  });

  it('lists tool descriptors with name, description, and inputSchema', () => {
    const registry = new ToolRegistry(logger);
    registry.registerTool(makeTool('zd_a'));
    registry.registerTool(makeTool('zd_b'));

    const list = registry.listTools();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ name: 'zd_a', description: 'tool zd_a' });
    expect(list[0].inputSchema).toBeDefined();
  });

  it('invokeTool throws ToolNotFoundError for unknown tools', async () => {
    const registry = new ToolRegistry(logger);
    await expect(registry.invokeTool('missing', {})).rejects.toThrow(ToolNotFoundError);
  });

  it('invokeTool dispatches to the registered tool', async () => {
    const registry = new ToolRegistry(logger);
    registry.registerTool(makeTool('zd_test'));
    await expect(registry.invokeTool('zd_test', {})).resolves.toEqual({ ok: true });
  });
});
