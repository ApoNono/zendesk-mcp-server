import { jest } from '@jest/globals';
import { UpdateArticleTool } from '../../src/tools/articles/update-article.js';
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

describe('UpdateArticleTool', () => {
  it('rejects unknown brand with a helpful error', async () => {
    const tool = new UpdateArticleTool(makeRegistry(), logger);
    const result = (await tool.execute({
      id: 123,
      brand: 'nope',
      title: 'x',
    })) as Record<string, unknown>;
    expect(result.error).toMatch(/not configured/);
  });

  it('rejects when no update fields are provided', async () => {
    const tool = new UpdateArticleTool(makeRegistry(), logger);
    const result = (await tool.execute({
      id: 123,
      brand: 'help-admin',
    })) as Record<string, unknown>;
    expect(result.error).toMatch(/No update fields provided/);
  });

  it('only sends title/body via translation endpoint when only title is passed', async () => {
    const registry = makeRegistry();
    const client = registry.getClient('help-admin');
    const put = jest.spyOn(client, 'put').mockResolvedValueOnce(undefined as never);
    const get = jest.spyOn(client, 'get').mockResolvedValueOnce({
      article: {
        id: 123,
        title: 'New title',
        html_url: 'https://help-admin.zendesk.com/...',
        section_id: 5,
        label_names: [],
        draft: false,
        promoted: false,
        outdated: false,
        updated_at: '2026-01-01',
      },
    } as never);

    const tool = new UpdateArticleTool(registry, logger);
    const result = (await tool.execute({
      id: 123,
      brand: 'help-admin',
      title: 'New title',
      update_reason: 'Rebrand',
    })) as Record<string, unknown>;

    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('/help_center/articles/123/translations/en-us.json', {
      translation: { title: 'New title' },
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.changed_fields).toEqual(['title']);
    expect(result.update_reason).toBe('Rebrand');
  });

  it('sends article-level PUT for metadata fields', async () => {
    const registry = makeRegistry();
    const client = registry.getClient('help-admin');
    const put = jest.spyOn(client, 'put').mockResolvedValue(undefined as never);
    jest.spyOn(client, 'get').mockResolvedValue({
      article: {
        id: 123,
        title: 'x',
        html_url: 'x',
        section_id: 99,
        label_names: ['a'],
        draft: false,
        promoted: true,
        outdated: true,
        updated_at: '2026',
      },
    } as never);

    const tool = new UpdateArticleTool(registry, logger);
    const result = (await tool.execute({
      id: 123,
      brand: 'help-admin',
      section_id: 99,
      outdated: true,
    })) as Record<string, unknown>;

    expect(put).toHaveBeenCalledWith('/help_center/articles/123.json', {
      article: { section_id: 99, outdated: true },
    });
    expect((result as { changed_fields: string[] }).changed_fields).toEqual([
      'section_id',
      'outdated',
    ]);
  });
});
