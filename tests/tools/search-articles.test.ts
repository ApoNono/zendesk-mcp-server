import { jest } from '@jest/globals';
import { SearchArticlesTool } from '../../src/tools/articles/search-articles.js';
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

function searchResponse(articles: Array<Record<string, unknown>>, next = false): unknown {
  return {
    results: articles,
    count: articles.length,
    page: 1,
    per_page: 25,
    next_page: next ? 'x' : null,
    previous_page: null,
  };
}

function article(
  id: number,
  brandLabel: string,
  updatedAt: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    title: `Article ${id}`,
    html_url: `https://${brandLabel}.zendesk.com/hc/${id}`,
    locale: 'en-us',
    section_id: 1,
    label_names: [],
    body: '<p>hello</p>',
    updated_at: updatedAt,
    ...overrides,
  };
}

describe('SearchArticlesTool', () => {
  it('errors when no valid brands are requested', async () => {
    const tool = new SearchArticlesTool(makeRegistry(), logger);
    const result = (await tool.execute({ query: 'x', brands: ['nope'] })) as Record<string, unknown>;
    expect(result.error).toMatch(/No valid brands/);
  });

  it('searches every configured brand when `brands` is omitted', async () => {
    const registry = makeRegistry();
    const admin = registry.getClient('help-admin');
    const partners = registry.getClient('help-partners');
    const portal = registry.getClient('help-portal');

    const spies = [admin, partners, portal].map((c) =>
      jest.spyOn(c, 'get').mockResolvedValue(searchResponse([]) as never),
    );

    const tool = new SearchArticlesTool(registry, logger);
    const result = (await tool.execute({ query: 'tabs' })) as Record<string, unknown>;

    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
    expect(result.brands_searched).toEqual(['help-admin', 'help-partners', 'help-portal']);
  });

  it('restricts to specified brands only', async () => {
    const registry = makeRegistry();
    const admin = registry.getClient('help-admin');
    const partners = registry.getClient('help-partners');
    const portal = registry.getClient('help-portal');

    const adminSpy = jest.spyOn(admin, 'get').mockResolvedValue(searchResponse([]) as never);
    const partnersSpy = jest.spyOn(partners, 'get');
    const portalSpy = jest.spyOn(portal, 'get').mockResolvedValue(searchResponse([]) as never);

    const tool = new SearchArticlesTool(registry, logger);
    await tool.execute({ query: 'tabs', brands: ['help-admin', 'help-portal'] });

    expect(adminSpy).toHaveBeenCalledTimes(1);
    expect(portalSpy).toHaveBeenCalledTimes(1);
    expect(partnersSpy).not.toHaveBeenCalled();
  });

  it('merges results across brands and tags each with its brand, sorted by updated_at desc', async () => {
    const registry = makeRegistry();
    const admin = registry.getClient('help-admin');
    const partners = registry.getClient('help-partners');
    const portal = registry.getClient('help-portal');

    jest.spyOn(admin, 'get').mockResolvedValue(
      searchResponse([article(1, 'help-admin', '2026-01-01')]) as never,
    );
    jest.spyOn(partners, 'get').mockResolvedValue(
      searchResponse([article(2, 'help-partners', '2026-03-01')]) as never,
    );
    jest.spyOn(portal, 'get').mockResolvedValue(
      searchResponse([article(3, 'help-portal', '2026-08-01')]) as never,
    );

    const tool = new SearchArticlesTool(registry, logger);
    const result = (await tool.execute({ query: 'tabs' })) as Record<string, unknown>;

    const results = result.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe(3);
    expect(results[0].brand).toBe('help-portal');
    expect(results[1].id).toBe(2);
    expect(results[1].brand).toBe('help-partners');
    expect(results[2].id).toBe(1);
    expect(results[2].brand).toBe('help-admin');
    expect(result.matches_by_brand).toEqual({
      'help-admin': 1,
      'help-partners': 1,
      'help-portal': 1,
    });
  });

  it('propagates per_page as pagination over the merged set', async () => {
    const registry = makeRegistry();
    const admin = registry.getClient('help-admin');
    const partners = registry.getClient('help-partners');
    const portal = registry.getClient('help-portal');

    jest.spyOn(admin, 'get').mockResolvedValue(
      searchResponse([article(1, 'help-admin', '2026-01-01'), article(4, 'help-admin', '2026-05-01')]) as never,
    );
    jest.spyOn(partners, 'get').mockResolvedValue(
      searchResponse([article(2, 'help-partners', '2026-03-01')]) as never,
    );
    jest.spyOn(portal, 'get').mockResolvedValue(
      searchResponse([article(3, 'help-portal', '2026-08-01')]) as never,
    );

    const tool = new SearchArticlesTool(registry, logger);
    const page1 = (await tool.execute({ query: 'tabs', per_page: 2, page: 1 })) as Record<
      string,
      unknown
    >;
    const page2 = (await tool.execute({ query: 'tabs', per_page: 2, page: 2 })) as Record<
      string,
      unknown
    >;

    const r1 = page1.results as Array<Record<string, unknown>>;
    const r2 = page2.results as Array<Record<string, unknown>>;

    expect(r1.map((r) => r.id)).toEqual([3, 4]);
    expect(r2.map((r) => r.id)).toEqual([2, 1]);
    expect(page1.has_more).toBe(true);
    expect(page2.has_more).toBe(false);
  });
});
