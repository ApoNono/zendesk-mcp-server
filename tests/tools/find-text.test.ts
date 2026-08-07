import { jest } from '@jest/globals';
import { FindTextInArticlesTool } from '../../src/tools/articles/find-text.js';
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

describe('FindTextInArticlesTool', () => {
  it('finds matches in title and body, HTML-safe (skips code blocks and URLs)', async () => {
    const registry = makeRegistry();
    const admin = registry.getClient('help-admin');
    const partners = registry.getClient('help-partners');

    const adminArticles = [
      {
        id: 1,
        title: 'Deal Registration Overview',
        body:
          '<p>Deal Registration lets you...</p>' +
          '<code>deal_registration_form()</code>' +
          '<a href="https://dealregistration.example.com">docs</a>',
        html_url: 'https://help-admin.zendesk.com/hc/1',
        updated_at: '2026',
        locale: 'en-us',
        section_id: 1,
        url: 'x',
      },
      {
        id: 2,
        title: 'No matches here',
        body: '<p>Nothing relevant.</p>',
        html_url: 'https://help-admin.zendesk.com/hc/2',
        updated_at: '2026',
        locale: 'en-us',
        section_id: 1,
        url: 'x',
      },
    ];
    const partnerArticles = [
      {
        id: 3,
        title: 'Deal Registration for Partners',
        body: '<p>Details on Deal Registration flow.</p>',
        html_url: 'https://help-partners.zendesk.com/hc/3',
        updated_at: '2026',
        locale: 'en-us',
        section_id: 2,
        url: 'x',
      },
    ];

    jest
      .spyOn(admin, 'get')
      .mockResolvedValue({ articles: adminArticles, next_page: null } as never);
    jest
      .spyOn(partners, 'get')
      .mockResolvedValue({ articles: partnerArticles, next_page: null } as never);

    const tool = new FindTextInArticlesTool(registry, logger);
    const result = (await tool.execute({
      query: 'Deal Registration',
    })) as Record<string, unknown>;

    expect(result.articles_matched).toBe(2); // articles 1 and 3
    const results = result.results as Array<Record<string, unknown>>;
    const ids = results.map((r) => r.id);
    expect(ids).toContain(1);
    expect(ids).toContain(3);
    expect(ids).not.toContain(2);

    // Article 1 title hit + body hit (in <p>, not in <code> or href)
    const article1 = results.find((r) => r.id === 1)!;
    expect(article1.title_matches).toBe(1);
    expect(article1.body_matches).toBe(1); // Only the <p> hit; <code> and href stripped
  });

  it('respects case_insensitive default (true)', async () => {
    const registry = new BrandRegistry(
      [{ subdomain: 'help-admin' }],
      apiConfig,
      auth,
      logger,
      rateLimiter,
    );
    const client = registry.getClient('help-admin');

    jest.spyOn(client, 'get').mockResolvedValue({
      articles: [
        {
          id: 1,
          title: 'UPPERCASE HEADING',
          body: '<p>lowercase body</p>',
          html_url: 'x',
          updated_at: 'x',
          locale: 'en-us',
          section_id: 1,
          url: 'x',
        },
      ],
      next_page: null,
    } as never);

    const tool = new FindTextInArticlesTool(registry, logger);
    const result = (await tool.execute({ query: 'heading' })) as Record<string, unknown>;
    expect(result.articles_matched).toBe(1);
  });

  it('respects case_insensitive=false', async () => {
    const registry = new BrandRegistry(
      [{ subdomain: 'help-admin' }],
      apiConfig,
      auth,
      logger,
      rateLimiter,
    );
    const client = registry.getClient('help-admin');

    jest.spyOn(client, 'get').mockResolvedValue({
      articles: [
        {
          id: 1,
          title: 'UPPERCASE HEADING',
          body: '<p>lowercase body</p>',
          html_url: 'x',
          updated_at: 'x',
          locale: 'en-us',
          section_id: 1,
          url: 'x',
        },
      ],
      next_page: null,
    } as never);

    const tool = new FindTextInArticlesTool(registry, logger);
    const result = (await tool.execute({
      query: 'heading',
      case_insensitive: false,
    })) as Record<string, unknown>;
    expect(result.articles_matched).toBe(0);
  });
});
