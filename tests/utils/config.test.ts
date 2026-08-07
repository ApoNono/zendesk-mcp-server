import { ConfigManager, brandBaseUrl } from '../../src/utils/config.js';

describe('ConfigManager', () => {
  const ORIG_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIG_ENV };
    delete process.env.ZENDESK_SUBDOMAIN;
    delete process.env.ZENDESK_BRANDS;
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
    expect(result.errors).toContain('Either ZENDESK_SUBDOMAIN or ZENDESK_BRANDS is required');
    expect(result.errors).toContain('ZENDESK_EMAIL is required');
    expect(result.errors).toContain('ZENDESK_API_TOKEN is required');
  });

  it('accepts single-brand config via ZENDESK_SUBDOMAIN', () => {
    process.env.ZENDESK_SUBDOMAIN = 'acme';
    process.env.ZENDESK_EMAIL = 'a@b.com';
    process.env.ZENDESK_API_TOKEN = 'tok';

    const manager = new ConfigManager();
    expect(manager.validate().valid).toBe(true);
    const cfg = manager.get();
    expect(cfg.auth.brands).toEqual([{ subdomain: 'acme' }]);
  });

  it('parses ZENDESK_BRANDS into multiple brands in order', () => {
    process.env.ZENDESK_BRANDS = 'help-admin, help-partners ,help-legacy';
    process.env.ZENDESK_EMAIL = 'a@b.com';
    process.env.ZENDESK_API_TOKEN = 'tok';

    const manager = new ConfigManager();
    expect(manager.validate().valid).toBe(true);
    expect(manager.get().auth.brands).toEqual([
      { subdomain: 'help-admin' },
      { subdomain: 'help-partners' },
      { subdomain: 'help-legacy' },
    ]);
  });

  it('prefers ZENDESK_BRANDS over ZENDESK_SUBDOMAIN when both are set', () => {
    process.env.ZENDESK_BRANDS = 'help-admin,help-partners';
    process.env.ZENDESK_SUBDOMAIN = 'ignored';
    process.env.ZENDESK_EMAIL = 'a@b.com';
    process.env.ZENDESK_API_TOKEN = 'tok';

    const manager = new ConfigManager();
    expect(manager.get().auth.brands).toEqual([
      { subdomain: 'help-admin' },
      { subdomain: 'help-partners' },
    ]);
  });

  it('builds the base URL from a brand', () => {
    expect(brandBaseUrl({ subdomain: 'acme' })).toBe('https://acme.zendesk.com/api/v2');
  });
});
