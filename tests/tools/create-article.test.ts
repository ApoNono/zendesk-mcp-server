import { jest } from '@jest/globals';
import { CreateArticleTool } from '../../src/tools/articles/create-article.js';
import { BrandRegistry } from '../../src/api/brand-registry.js';
import { AuthenticationManager } from '../../src/auth/manager.js';
import { RateLimiter } from '../../src/middleware/rateLimiter.js';
import { Logger } from '../../src/utils/logger.js';

const logger = new Logger({ level: 'fatal' });
const auth = new AuthenticationManager({ email: 'a@b.com', apiToken: 't' }, logger);
const rateLimiter = new RateLimiter(100, 60000);
const apiConfig = { timeout: 10000, retryAttempts: 3, retryDelay: 1000 };

function makeRegistry(): BrandRegistry {
  return new BrandRegistry(
    [{ subdomain: 'help-admin' }, { subdomain: 'help-partners' }],
    apiConfig,
    auth,
    logger,
    rateLimiter,
  );
}

describe('CreateArticleTool', () => {
  it('rejects unknown brand', async () => {
    const tool = new CreateArticleTool(makeRegistry(), logger);
    const result = (await tool.execute({
      brand: 'nope',
      section_id: 1,
      title: 'x',
      body: '<p>x</p>',
    })) as Record<string, unknown>;
    expect(result.error).toMatch(/not configured/);
  });

  it('POSTs to the section-scoped articles endpoint with default draft=true', async () => {
    const registry = makeRegistry();
    const client = registry.getClient('help-admin');
    const post = jest.spyOn(client, 'post').mockResolvedValue({
      article: {
        id: 999,
        title: 'New article',
        html_url: 'https://help-admin.zendesk.com/hc/999',
        section_id: 42,
        locale: 'en-us',
        draft: true,
        promoted: false,
        outdated: false,
        label_names: [],
        created_at: '2026',
        updated_at: '2026',
      },
    } as never);

    const tool = new CreateArticleTool(registry, logger);
    const result = (await tool.execute({
      brand: 'help-admin',
      section_id: 42,
      title: 'New article',
      body: '<p>Hello</p>',
      create_reason: 'Q3 release notes',
    })) as Record<string, unknown>;

    expect(post).toHaveBeenCalledTimes(1);
    const args = post.mock.calls[0] as [string, { article: Record<string, unknown> }];
    expect(args[0]).toBe('/help_center/sections/42/articles.json');
    expect(args[1].article).toMatchObject({
      title: 'New article',
      body: '<p>Hello</p>',
      locale: 'en-us',
      draft: true,
      promoted: false,
    });
    expect(result.success).toBe(true);
    expect(result.id).toBe(999);
    expect(result.draft).toBe(true);
    expect(result.create_reason).toBe('Q3 release notes');
    expect(result.note).toMatch(/draft/i);
  });

  it('publishes immediately when draft=false is passed explicitly', async () => {
    const registry = makeRegistry();
    const client = registry.getClient('help-admin');
    jest.spyOn(client, 'post').mockResolvedValue({
      article: {
        id: 1,
        title: 't',
        html_url: 'x',
        section_id: 1,
        locale: 'en-us',
        draft: false,
        promoted: false,
        outdated: false,
        label_names: [],
        created_at: '2026',
        updated_at: '2026',
      },
    } as never);

    const tool = new CreateArticleTool(registry, logger);
    const result = (await tool.execute({
      brand: 'help-admin',
      section_id: 1,
      title: 't',
      body: '<p>b</p>',
      draft: false,
    })) as Record<string, unknown>;

    expect(result.draft).toBe(false);
    expect(result.note).toMatch(/published/i);
  });

  it('passes optional fields (labels, permission_group_id, user_segment_id, author_id) through when provided', async () => {
    const registry = makeRegistry();
    const client = registry.getClient('help-admin');
    const post = jest.spyOn(client, 'post').mockResolvedValue({
      article: {
        id: 1,
        title: 't',
        html_url: 'x',
        section_id: 1,
        locale: 'en-us',
        draft: true,
        promoted: false,
        outdated: false,
        label_names: ['a', 'b'],
        created_at: '2026',
        updated_at: '2026',
      },
    } as never);

    const tool = new CreateArticleTool(registry, logger);
    await tool.execute({
      brand: 'help-admin',
      section_id: 1,
      title: 't',
      body: '<p>b</p>',
      label_names: ['a', 'b'],
      permission_group_id: 500,
      user_segment_id: 700,
      author_id: 900,
    });

    const args = post.mock.calls[0] as [string, { article: Record<string, unknown> }];
    expect(args[1].article).toMatchObject({
      label_names: ['a', 'b'],
      permission_group_id: 500,
      user_segment_id: 700,
      author_id: 900,
    });
  });
});
