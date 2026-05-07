import { ConfigManager } from '../../src/utils/config.js';

describe('ConfigManager', () => {
  const ORIG_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIG_ENV };
    delete process.env.ZENDESK_SUBDOMAIN;
    delete process.env.ZENDESK_EMAIL;
    delete process.env.ZENDESK_API_TOKEN;
  });

  afterAll(() => {
    process.env = ORIG_ENV;
  });

  it('reports validation errors when required env vars are missing', () => {
    const manager = new ConfigManager();
    const result = manager.validate();
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('ZENDESK_SUBDOMAIN is required');
    expect(result.errors).toContain('ZENDESK_EMAIL is required');
    expect(result.errors).toContain('ZENDESK_API_TOKEN is required');
  });

  it('builds the base URL from the subdomain', () => {
    process.env.ZENDESK_SUBDOMAIN = 'acme';
    process.env.ZENDESK_EMAIL = 'a@b.com';
    process.env.ZENDESK_API_TOKEN = 'tok';

    const manager = new ConfigManager();
    expect(manager.validate().valid).toBe(true);
    expect(manager.get().api.baseUrl).toBe('https://acme.zendesk.com/api/v2');
  });
});
