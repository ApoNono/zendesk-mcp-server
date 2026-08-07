import { ZendeskAPIClient } from './client.js';
import { APIConfig, Brand, brandBaseUrl } from '../utils/config.js';
import { AuthenticationManager } from '../auth/index.js';
import { Logger } from '../utils/logger.js';
import { RateLimiter } from '../middleware/rateLimiter.js';
import { ConfigurationError } from '../utils/errors.js';

/**
 * Holds one ZendeskAPIClient per configured brand and lets tools look them
 * up by subdomain. Cross-brand tools iterate all brands via `list()`;
 * single-brand tools default to the primary brand at `primary()`.
 */
export class BrandRegistry {
  private readonly clients: Map<string, ZendeskAPIClient> = new Map();
  private readonly brands: Brand[];

  constructor(
    brands: Brand[],
    apiConfig: APIConfig,
    authManager: AuthenticationManager,
    logger: Logger,
    rateLimiter: RateLimiter,
  ) {
    if (brands.length === 0) {
      throw new ConfigurationError('BrandRegistry requires at least one brand');
    }
    this.brands = brands;
    for (const brand of brands) {
      this.clients.set(
        brand.subdomain,
        new ZendeskAPIClient(
          {
            baseUrl: brandBaseUrl(brand),
            timeout: apiConfig.timeout,
            retryAttempts: apiConfig.retryAttempts,
            retryDelay: apiConfig.retryDelay,
          },
          authManager,
          logger,
          rateLimiter,
        ),
      );
    }
  }

  /** All configured brands, primary first. */
  list(): Brand[] {
    return [...this.brands];
  }

  /** The primary brand (index 0). */
  primary(): Brand {
    return this.brands[0];
  }

  /** Client for the primary brand. Convenience for single-brand tools. */
  primaryClient(): ZendeskAPIClient {
    return this.getClient(this.primary().subdomain);
  }

  /**
   * Client for a specific brand subdomain. Throws if the brand isn't
   * configured — tools should validate brand params against `list()` before
   * calling.
   */
  getClient(subdomain: string): ZendeskAPIClient {
    const client = this.clients.get(subdomain);
    if (!client) {
      throw new ConfigurationError(
        `Brand '${subdomain}' is not configured. Configured brands: ${this.brands
          .map((b) => b.subdomain)
          .join(', ')}`,
      );
    }
    return client;
  }

  hasBrand(subdomain: string): boolean {
    return this.clients.has(subdomain);
  }

  size(): number {
    return this.brands.length;
  }
}
