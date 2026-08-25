import { jest } from '@jest/globals';
import { GetArticleTool } from '../../src/tools/articles/get-article.js';
import { BrandRegistry } from '../../src/api/brand-registry.js';
import { APINotFoundError } from '../../src/api/errors.js';
import { AuthenticationManager } from '../../src/auth/manager.js';
import { RateLimiter } from '../../src/middleware/rateLimiter.js';
import { Logger } from '../../src/utils/logger.js';

const logger = new Logger({ level: 'fatal' });
const auth = new AuthenticationManager({ email: 'a@b.com', apiToken: 't' }, logger);
const rateLimiter = new RateLimiter(100, 60000);
const apiConfig = { timeout: 10000, retryAttempts: 3, retryDelay: 1000 };

function makeRegistry(): BrandRegistry {
  return new BrandRegistry(
    [
      { subdomain: 'help-admin' },
      { subdomain: 'help-partners' },
      { subdomain: 'help-portal' },
    ],
    apiConfig,
    auth,
    logger,
    rateLimiter,
  );
}

function articleResponse(overrides: Record<string, unknown> = {}): { article: Record<string, unknown> } {
  return {
    article: {
      id: 41102852477709,
      title: 'Tabs',
      html_url: 'https://help-portal.zendesk.com/hc/tabs',
      locale: 'en-us',
      section_id: 5,
      label_names: ['snippet'],
      draft: false,
      promoted: false,
      outdated: false,
      body: '<div class="tabs">...</div>',
      created_at: '2026-01-01',
      updated_at: '2026-08-01',
      ...overrides,
    },
  };
}

describe('GetArticleTool', () => {
  it('rejects unknown brand with a helpful error', async () => {
    const tool = new GetArticleTool(makeRegistry(), logger);
    const result = (await tool.execute({ id: 1, brand: 'nope' })) as Record<string, unknown>;
    expect(result.error).toMatch(/not configured/);
    expect(result.error).toMatch(/help-admin/);
  });

  it('when brand is passed, uses only that brand', async () => {
    const registry = makeRegistry();
    const adminClient = registry.getClient('help-admin');
    const portalClient = registry.getClient('help-portal');
    const adminGet = jest.spyOn(adminClient, 'get').mockResolvedValue(articleResponse() as never);
    const portalGet = jest.spyOn(portalClient, 'get');

    const tool = new GetArticleTool(registry, logger);
    const result = (await tool.execute({ id: 41102852477709, brand: 'help-admin' })) as Record<
      string,
      unknown
    >;

    expect(adminGet).toHaveBeenCalledTimes(1);
    expect(portalGet).not.toHaveBeenCalled();
    expect(result.brand).toBe('help-admin');
    expect(result.title).toBe('Tabs');
  });

  it('falls back through brands and returns from the first that has the article', async () => {
    const registry = makeRegistry();
    const admin = registry.getClient('help-admin');
    const partners = registry.getClient('help-partners');
    const portal = registry.getClient('help-portal');

    const adminGet = jest
      .spyOn(admin, 'get')
      .mockRejectedValue(new APINotFoundError('not found') as never);
    const partnersGet = jest
      .spyOn(partners, 'get')
      .mockRejectedValue(new APINotFoundError('not found') as never);
    const portalGet = jest.spyOn(portal, 'get').mockResolvedValue(articleResponse() as never);

    const tool = new GetArticleTool(registry, logger);
    const result = (await tool.execute({ id: 41102852477709 })) as Record<string, unknown>;

    expect(adminGet).toHaveBeenCalledTimes(1);
    expect(partnersGet).toHaveBeenCalledTimes(1);
    expect(portalGet).toHaveBeenCalledTimes(1);
    expect(result.brand).toBe('help-portal');
    expect(result.id).toBe(41102852477709);
  });

  it('returns a not-found error listing brands searched when article is nowhere', async () => {
    const registry = makeRegistry();
    for (const sub of ['help-admin', 'help-partners', 'help-portal']) {
      jest
        .spyOn(registry.getClient(sub), 'get')
        .mockRejectedValue(new APINotFoundError('not found') as never);
    }

    const tool = new GetArticleTool(registry, logger);
    const result = (await tool.execute({ id: 999 })) as Record<string, unknown>;

    expect(result.error).toMatch(/999/);
    expect(result.error).toMatch(/not found in any configured brand/);
    expect(result.brands_searched).toEqual(['help-admin', 'help-partners', 'help-portal']);
  });

  it('propagates non-404 errors instead of swallowing them', async () => {
    const registry = makeRegistry();
    const admin = registry.getClient('help-admin');
    jest.spyOn(admin, 'get').mockRejectedValue(new Error('boom') as never);

    const tool = new GetArticleTool(registry, logger);
    await expect(tool.execute({ id: 1, brand: 'help-admin' })).rejects.toThrow(/boom/);
  });

  it('respects the locale param in the API path', async () => {
    const registry = makeRegistry();
    const admin = registry.getClient('help-admin');
    const adminGet = jest.spyOn(admin, 'get').mockResolvedValue(articleResponse() as never);

    const tool = new GetArticleTool(registry, logger);
    await tool.execute({ id: 42, brand: 'help-admin', locale: 'fr' });

    expect(adminGet).toHaveBeenCalledWith('/help_center/fr/articles/42.json');
  });
});
