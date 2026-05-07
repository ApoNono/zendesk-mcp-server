import { PromptRegistry, PromptNotFoundError } from '../../src/core/prompt-registry.js';
import { Prompt, PromptMessage } from '../../src/core/types.js';
import { Logger } from '../../src/utils/logger.js';
import { MCPError } from '../../src/utils/errors.js';

const logger = new Logger({ level: 'fatal' });

function makePrompt(
  name: string,
  args: { name: string; required?: boolean }[] = [],
  text = 'rendered',
): Prompt {
  return {
    name,
    description: `prompt ${name}`,
    arguments: args,
    render: (provided): PromptMessage[] => [
      {
        role: 'user',
        content: { type: 'text', text: `${text}: ${JSON.stringify(provided)}` },
      },
    ],
  };
}

describe('PromptRegistry', () => {
  it('registers and lists prompts with their argument schemas', () => {
    const registry = new PromptRegistry(logger);
    const args = [{ name: 'ticket_id', required: true }];
    registry.registerPrompt(makePrompt('test_prompt', args));

    const list = registry.listPrompts();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'test_prompt',
      description: 'prompt test_prompt',
      arguments: args,
    });
  });

  it('renders a prompt with valid arguments', () => {
    const registry = new PromptRegistry(logger);
    registry.registerPrompt(makePrompt('p', [{ name: 'x', required: true }]));

    const messages = registry.renderPrompt('p', { x: '42' });
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content.text).toContain('"x":"42"');
  });

  it('throws PromptNotFoundError for unknown prompts', () => {
    const registry = new PromptRegistry(logger);
    expect(() => registry.renderPrompt('missing')).toThrow(PromptNotFoundError);
  });

  it('throws when a required argument is missing', () => {
    const registry = new PromptRegistry(logger);
    registry.registerPrompt(makePrompt('p', [{ name: 'required_arg', required: true }]));
    expect(() => registry.renderPrompt('p', {})).toThrow(MCPError);
  });

  it('allows missing optional arguments', () => {
    const registry = new PromptRegistry(logger);
    registry.registerPrompt(makePrompt('p', [{ name: 'optional_arg', required: false }]));
    expect(() => registry.renderPrompt('p', {})).not.toThrow();
  });
});
