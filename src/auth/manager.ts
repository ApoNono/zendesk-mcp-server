import axios, { AxiosError } from 'axios';
import { Logger } from '../utils/logger.js';
import { ConfigurationError } from '../utils/errors.js';

export interface AuthHeaders {
  Authorization: string;
  [key: string]: string;
}

export interface ZendeskAuthConfig {
  subdomain: string;
  email: string;
  apiToken: string;
}

/**
 * Zendesk API token auth: basic auth where the username is `${email}/token`
 * and the password is the API token. The pair is base64-encoded into the
 * Authorization header.
 *
 * https://developer.zendesk.com/api-reference/introduction/security-and-auth/
 */
export class AuthenticationManager {
  private readonly subdomain: string;
  private readonly email: string;
  private readonly apiToken: string;
  private readonly logger: Logger;
  private readonly encoded: string;

  constructor(config: ZendeskAuthConfig, logger: Logger) {
    if (!config.subdomain) throw new ConfigurationError('Zendesk subdomain is required');
    if (!config.email) throw new ConfigurationError('Zendesk email is required');
    if (!config.apiToken) throw new ConfigurationError('Zendesk API token is required');

    this.subdomain = config.subdomain;
    this.email = config.email;
    this.apiToken = config.apiToken;
    this.logger = logger;
    this.encoded = Buffer.from(`${this.email}/token:${this.apiToken}`).toString('base64');
  }

  getAuthHeaders(): AuthHeaders {
    return {
      Authorization: `Basic ${this.encoded}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /**
   * Hit a low-cost authenticated endpoint to confirm credentials work.
   * `/users/me` returns the authenticated user; 401 means bad creds.
   */
  async validateCredentials(): Promise<boolean> {
    const url = `https://${this.subdomain}.zendesk.com/api/v2/users/me.json`;
    try {
      const response = await axios.get(url, {
        headers: this.getAuthHeaders(),
        timeout: 5000,
      });
      this.logger.debug('Auth validated', { status: response.status });
      return response.status === 200;
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 401) {
        return false;
      }
      this.logger.error('Auth validation request failed', error);
      throw error;
    }
  }
}
