import { LogLevel } from './logger.js';

export interface AuthConfig {
  subdomain: string;
  email: string;
  apiToken: string;
}

export interface APIConfig {
  baseUrl: string;
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
    const subdomain = env.ZENDESK_SUBDOMAIN || '';
    const baseUrl = subdomain ? `https://${subdomain}.zendesk.com/api/v2` : '';

    return {
      auth: {
        subdomain,
        email: env.ZENDESK_EMAIL || '',
        apiToken: env.ZENDESK_API_TOKEN || '',
      },
      api: {
        baseUrl,
        timeout: parseInt(env.ZENDESK_API_TIMEOUT || '10000'),
        retryAttempts: parseInt(env.API_RETRY_ATTEMPTS || '3'),
        retryDelay: parseInt(env.API_RETRY_DELAY || '1000'),
      },
      rateLimit: {
        global: parseInt(env.RATE_LIMIT_GLOBAL || '100'),
        windowMs: parseInt(env.RATE_LIMIT_WINDOW_MS || '60000'),
        perTool: {
          // Zendesk search endpoint allows ~2,500/min on standard plans
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

    if (!auth.subdomain) errors.push('ZENDESK_SUBDOMAIN is required');
    if (!auth.email) errors.push('ZENDESK_EMAIL is required');
    if (!auth.apiToken) errors.push('ZENDESK_API_TOKEN is required');

    return { valid: errors.length === 0, errors };
  }
}
