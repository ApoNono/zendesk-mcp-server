import { jest } from '@jest/globals';
import { ReplaceTextInArticlesTool } from '../../src/tools/articles/replace-text.js';
import { BrandRegistry } from '../../src/api/brand-registry.js';
import { AuthenticationManager } from '../../src/auth/manager.js';
import { RateLimiter } from '../../src/middleware/rateLimiter.js';
import { Logger } from '../../src/utils/logger.js';

const logger = new Logger({ level: 'fatal' });
const auth = new AuthenticationManager({ email: 'a@b.com', apiToken: 't' }, logger);
const rateLimiter = new RateLimiter(100, 60000);
const apiConfig = { timeout: 10000, retryAttempts: 3, retryDelay: 1000 };

function makeRegistry(): BrandRegistry {
  return new BrandRegistry([{ subdomain: 'help-admin' }], apiConfig, auth, logger, rateLimiter);
}

describe('ReplaceTextInArticlesTool', () => {
  it('rejects unknown brand', async () => {
    const tool = new ReplaceTextInArticlesTool(makeRegistry(), logger);
    const result = (await tool.execute({
      find: 'foo',
      replace_with: 'bar',
      brand: 'nope',
      article_ids: [1],
    })) as Record<string, unknown>;
    expect(result.error).toMatch(/not configured/);
  });

  it('applies HTML-safe replacement to body and skips code blocks', async () => {
    const registry = makeRegistry();
    const client = registry.getClient('help-admin');

    jest.spyOn(client, 'get').mockImplementation(async (url: unknown): Promise<never> => {
      const path = String(url);
      if (path.includes('translations/en-us')) {
        return {
          translation: {
            locale: 'en-us',
            title: 'About Unifyr One',
            body:
              '<p>Welcome to Unifyr One!</p>' +
              '<code>const x = "Unifyr One"</code>' +
              '<p>See <a href="https://unifyrone.com">docs</a> for Unifyr One.</p>',
          },
        } as never;
      }
      if (path.endsWith('.json') && path.includes('articles/1')) {
        return { article: { html_url: 'https://help-admin.zendesk.com/hc/1' } } as never;
      }
      throw new Error(`unexpected GET ${path}`);
    });
    const put = jest.spyOn(client, 'put').mockResolvedValue(undefined as never);

    const tool = new ReplaceTextInArticlesTool(registry, logger);
    const result = (await tool.execute({
      find: 'Unifyr One',
      replace_with: 'Unifyr',
      brand: 'help-admin',
      article_ids: [1],
    })) as Record<string, unknown>;

    expect(put).toHaveBeenCalledTimes(1);
    const putArgs = put.mock.calls[0] as [
      string,
      { translation: { title?: string; body?: string } },
    ];
    const payload = putArgs[1].translation;

    // Title: "Unifyr One" replaced → "Unifyr"
    expect(payload.title).toBe('About Unifyr');
    // Body: replaced inside <p> tags (2 hits — welcome + "for Unifyr One"), NOT
    // inside <code>, NOT in the href URL.
    expect(payload.body).toContain('Welcome to Unifyr!');
    expect(payload.body).toContain('const x = "Unifyr One"'); // untouched in code
    expect(payload.body).toContain('href="https://unifyrone.com"'); // URL untouched
    expect(payload.body).toContain('for Unifyr.'); // second body hit

    const results = (result as { results: Array<Record<string, unknown>> }).results;
    expect(results[0].title_replacements).toBe(1);
    expect(results[0].body_replacements).toBe(2);
  });

  it('reports skipped articles with zero replacements', async () => {
    const registry = makeRegistry();
    const client = registry.getClient('help-admin');

    jest.spyOn(client, 'get').mockImplementation(async (url: unknown): Promise<never> => {
      const path = String(url);
      if (path.includes('translations/en-us')) {
        return {
          translation: {
            locale: 'en-us',
            title: 'No match here',
            body: '<p>Nothing to replace.</p>',
          },
        } as never;
      }
      return { article: { html_url: 'x' } } as never;
    });
    const put = jest.spyOn(client, 'put').mockResolvedValue(undefined as never);

    const tool = new ReplaceTextInArticlesTool(registry, logger);
    const result = (await tool.execute({
      find: 'xyz',
      replace_with: 'abc',
      brand: 'help-admin',
      article_ids: [1],
    })) as Record<string, unknown>;

    expect(put).not.toHaveBeenCalled();
    expect(result.articles_skipped).toBe(1);
    expect(result.articles_updated).toBe(0);
  });
});
