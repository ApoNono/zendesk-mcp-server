import { BrandRegistry } from '../../src/api/brand-registry.js';
import { AuthenticationManager } from '../../src/auth/manager.js';
import { RateLimiter } from '../../src/middleware/rateLimiter.js';
import { Logger } from '../../src/utils/logger.js';
import { ConfigurationError } from '../../src/utils/errors.js';

const logger = new Logger({ level: 'fatal' });
const auth = new AuthenticationManager({ email: 'a@b.com', apiToken: 't' }, logger);
const rateLimiter = new RateLimiter(100, 60000);
const apiConfig = { timeout: 10000, retryAttempts: 3, retryDelay: 1000 };

describe('BrandRegistry', () => {
  it('throws when no brands provided', () => {
    expect(() => new BrandRegistry([], apiConfig, auth, logger, rateLimiter)).toThrow(
      ConfigurationError,
    );
  });

  it('instantiates one client per brand and identifies the primary', () => {
    const registry = new BrandRegistry(
      [{ subdomain: 'help-admin' }, { subdomain: 'help-partners' }],
      apiConfig,
      auth,
      logger,
      rateLimiter,
    );

    expect(registry.size()).toBe(2);
    expect(registry.list()).toHaveLength(2);
    expect(registry.primary().subdomain).toBe('help-admin');
    expect(registry.hasBrand('help-admin')).toBe(true);
    expect(registry.hasBrand('help-partners')).toBe(true);
    expect(registry.hasBrand('nope')).toBe(false);
  });

  it('getClient returns distinct clients per brand', () => {
    const registry = new BrandRegistry(
      [{ subdomain: 'help-admin' }, { subdomain: 'help-partners' }],
      apiConfig,
      auth,
      logger,
      rateLimiter,
    );

    const admin = registry.getClient('help-admin');
    const partner = registry.getClient('help-partners');
    expect(admin).toBeDefined();
    expect(partner).toBeDefined();
    expect(admin).not.toBe(partner);
  });

  it('getClient throws for an unknown brand with a helpful message', () => {
    const registry = new BrandRegistry(
      [{ subdomain: 'help-admin' }],
      apiConfig,
      auth,
      logger,
      rateLimiter,
    );
    expect(() => registry.getClient('help-partners')).toThrow(/not configured/);
  });

  it('primaryClient returns the client for the first brand', () => {
    const registry = new BrandRegistry(
      [{ subdomain: 'help-admin' }, { subdomain: 'help-partners' }],
      apiConfig,
      auth,
      logger,
      rateLimiter,
    );
    expect(registry.primaryClient()).toBe(registry.getClient('help-admin'));
  });
});
