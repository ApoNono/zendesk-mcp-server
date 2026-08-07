import { LogLevel } from './logger.js';

export interface Brand {
  /** Zendesk subdomain — the part before `.zendesk.com` */
  subdomain: string;
}

export interface AuthConfig {
  email: string;
  apiToken: string;
  /** One or more brand subdomains. Primary brand is at index 0. */
  brands: Brand[];
}

export interface APIConfig {
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
}

export interface RateLimitConfig {
  global: number;
  windowMs: number;
  perTool?: Record<string, number>;
}

export interface Config {
  auth: AuthConfig;
  api: APIConfig;
  rateLimit: RateLimitConfig;
  logLevel: LogLevel;
  logPretty: boolean;
  nodeEnv: string;
}

export class ConfigManager {
  private config: Config;

  constructor() {
    this.config = this.fromEnv();
  }

  private fromEnv(): Config {
    const env = process.env;

    // Prefer ZENDESK_BRANDS (comma-separated). Fall back to ZENDESK_SUBDOMAIN
    // for single-brand setups.
    const brands = parseBrands(env.ZENDESK_BRANDS, env.ZENDESK_SUBDOMAIN);

    return {
      auth: {
        email: env.ZENDESK_EMAIL || '',
        apiToken: env.ZENDESK_API_TOKEN || '',
        brands,
      },
      api: {
        timeout: parseInt(env.ZENDESK_API_TIMEOUT || '10000'),
        retryAttempts: parseInt(env.API_RETRY_ATTEMPTS || '3'),
        retryDelay: parseInt(env.API_RETRY_DELAY || '1000'),
      },
      rateLimit: {
        global: parseInt(env.RATE_LIMIT_GLOBAL || '100'),
        windowMs: parseInt(env.RATE_LIMIT_WINDOW_MS || '60000'),
        perTool: {
          zd_article_search: 200,
          zd_ticket_search: 200,
        },
      },
      logLevel: (env.LOG_LEVEL as LogLevel) || 'info',
      logPretty: env.LOG_PRETTY === 'true',
      nodeEnv: env.NODE_ENV || 'development',
    };
  }

  get(): Config {
    return { ...this.config };
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const { auth } = this.config;

    if (auth.brands.length === 0) {
      errors.push('Either ZENDESK_SUBDOMAIN or ZENDESK_BRANDS is required');
    }
    if (!auth.email) errors.push('ZENDESK_EMAIL is required');
    if (!auth.apiToken) errors.push('ZENDESK_API_TOKEN is required');

    return { valid: errors.length === 0, errors };
  }
}

function parseBrands(brandsEnv: string | undefined, subdomainEnv: string | undefined): Brand[] {
  if (brandsEnv && brandsEnv.trim().length > 0) {
    return brandsEnv
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((subdomain) => ({ subdomain }));
  }
  if (subdomainEnv && subdomainEnv.trim().length > 0) {
    return [{ subdomain: subdomainEnv.trim() }];
  }
  return [];
}

export function brandBaseUrl(brand: Brand): string {
  return `https://${brand.subdomain}.zendesk.com/api/v2`;
}
