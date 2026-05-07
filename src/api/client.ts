import axios, { AxiosInstance, AxiosError } from 'axios';
import { APIClientConfig, QueryParams, RequestConfig } from './types.js';
import {
  ZendeskAPIError,
  APIValidationError,
  APIAuthenticationError,
  APIAuthorizationError,
  APINotFoundError,
  APIRateLimitError,
  APIServerError,
  isRetryableError,
} from './errors.js';
import { AuthenticationManager } from '../auth/index.js';
import { Logger } from '../utils/logger.js';
import { RetryHandler } from '../utils/retry.js';
import { RateLimiter } from '../middleware/rateLimiter.js';

export class ZendeskAPIClient {
  private readonly axios: AxiosInstance;
  private readonly authManager: AuthenticationManager;
  private readonly logger: Logger;
  private readonly retryHandler: RetryHandler;
  private readonly rateLimiter: RateLimiter;
  private readonly config: APIClientConfig;

  constructor(
    config: APIClientConfig,
    authManager: AuthenticationManager,
    logger: Logger,
    rateLimiter: RateLimiter,
  ) {
    this.config = config;
    this.authManager = authManager;
    this.logger = logger;
    this.rateLimiter = rateLimiter;

    this.retryHandler = new RetryHandler({
      maxAttempts: config.retryAttempts || 3,
      backoffStrategy: 'exponential',
      initialDelay: config.retryDelay || 1000,
      maxDelay: 30000,
      retryCondition: isRetryableError,
    });

    this.axios = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout || 10000,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    this.axios.interceptors.request.use(
      async (config) => {
        const authHeaders = this.authManager.getAuthHeaders();
        config.headers = { ...config.headers, ...authHeaders } as never;
        await this.rateLimiter.waitForSlot('global');
        this.logger.debug('API Request', {
          method: config.method,
          url: config.url,
          params: config.params,
        });
        return config;
      },
      (error) => {
        this.logger.error('Request interceptor error', error);
        return Promise.reject(error);
      },
    );

    this.axios.interceptors.response.use(
      (response) => {
        this.logger.debug('API Response', { status: response.status, url: response.config.url });
        return response;
      },
      (error: AxiosError) => {
        if (error.response) {
          const apiError = this.handleAPIError(error);
          this.logger.error('API Error', apiError.toJSON());
          throw apiError;
        }
        throw error;
      },
    );
  }

  private handleAPIError(error: AxiosError): ZendeskAPIError {
    const status = error.response?.status || 0;
    const data = error.response?.data as Record<string, unknown> | undefined;
    // Zendesk surfaces errors as { error, description } or { error: { title, message } }
    const message =
      (typeof data?.description === 'string' && data.description) ||
      (typeof data?.error === 'string' && data.error) ||
      (data?.error && typeof data.error === 'object' && 'message' in data.error
        ? String((data.error as Record<string, unknown>).message)
        : '') ||
      error.message;

    switch (status) {
      case 400:
      case 422:
        return new APIValidationError(String(message), data);
      case 401:
        return new APIAuthenticationError(String(message));
      case 403:
        return new APIAuthorizationError(String(message));
      case 404:
        return new APINotFoundError(String(message));
      case 429: {
        const retryAfter = parseInt(error.response?.headers['retry-after'] || '60');
        return new APIRateLimitError(String(message), retryAfter);
      }
      default:
        if (status >= 500) return new APIServerError(String(message), status);
        return new ZendeskAPIError(String(message), 'API_ERROR', error, status, data);
    }
  }

  async get<T>(endpoint: string, params?: QueryParams, config?: RequestConfig): Promise<T> {
    return this.retryHandler.withRetries(async () => {
      const response = await this.axios.get<T>(endpoint, { params, ...config });
      return response.data;
    });
  }

  async post<T>(endpoint: string, data: unknown, config?: RequestConfig): Promise<T> {
    return this.retryHandler.withRetries(async () => {
      const response = await this.axios.post<T>(endpoint, data, config);
      return response.data;
    });
  }

  async put<T>(endpoint: string, data: unknown, config?: RequestConfig): Promise<T> {
    return this.retryHandler.withRetries(async () => {
      const response = await this.axios.put<T>(endpoint, data, config);
      return response.data;
    });
  }

  async delete(endpoint: string, config?: RequestConfig): Promise<void> {
    return this.retryHandler.withRetries(async () => {
      await this.axios.delete(endpoint, config);
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.get('/users/me.json');
      return true;
    } catch (error) {
      if (error instanceof APIAuthenticationError) return false;
      throw error;
    }
  }

  getConfig(): APIClientConfig {
    return this.config;
  }
}
