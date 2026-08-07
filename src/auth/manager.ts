import axios, { AxiosError } from 'axios';
import { Logger } from '../utils/logger.js';
import { ConfigurationError } from '../utils/errors.js';

export interface AuthHeaders {
  Authorization: string;
  [key: string]: string;
}

export interface ZendeskAuthConfig {
  email: string;
  apiToken: string;
}

/**
 * Zendesk API token auth: basic auth where the username is `${email}/token`
 * and the password is the API token. The pair is base64-encoded into the
 * Authorization header.
 *
 * Credentials are account-scoped, not brand-scoped — the same email/token
 * works across every brand in a multi-brand Zendesk instance. Only the
 * base URL changes per brand.
 *
 * https://developer.zendesk.com/api-reference/introduction/security-and-auth/
 */
export class AuthenticationManager {
  private readonly email: string;
  private readonly apiToken: string;
  private readonly logger: Logger;
  private readonly encoded: string;

  constructor(config: ZendeskAuthConfig, logger: Logger) {
    if (!config.email) throw new ConfigurationError('Zendesk email is required');
    if (!config.apiToken) throw new ConfigurationError('Zendesk API token is required');

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
   * Confirm credentials work against a specific brand subdomain by hitting
   * /users/me.json. Any brand in the account will do — the endpoint is
   * account-level auth check via a brand's URL.
   */
  async validateCredentials(subdomain: string): Promise<boolean> {
    const url = `https://${subdomain}.zendesk.com/api/v2/users/me.json`;
    try {
      const response = await axios.get(url, {
        headers: this.getAuthHeaders(),
        timeout: 5000,
      });
      this.logger.debug('Auth validated', { subdomain, status: response.status });
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
