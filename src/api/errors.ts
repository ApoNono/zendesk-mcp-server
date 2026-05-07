export class ZendeskAPIError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly details?: unknown;
  public readonly cause?: Error;

  constructor(
    message: string,
    code: string,
    cause?: Error,
    statusCode?: number,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ZendeskAPIError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.cause = cause;
    Object.setPrototypeOf(this, ZendeskAPIError.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
      cause: this.cause?.message,
    };
  }
}

export class APIValidationError extends ZendeskAPIError {
  constructor(message: string, details?: unknown) {
    super(message, 'API_VALIDATION_ERROR', undefined, 400, details);
    this.name = 'APIValidationError';
    Object.setPrototypeOf(this, APIValidationError.prototype);
  }
}

export class APIAuthenticationError extends ZendeskAPIError {
  constructor(message: string) {
    super(message, 'API_AUTHENTICATION_ERROR', undefined, 401);
    this.name = 'APIAuthenticationError';
    Object.setPrototypeOf(this, APIAuthenticationError.prototype);
  }
}

export class APIAuthorizationError extends ZendeskAPIError {
  constructor(message: string) {
    super(message, 'API_AUTHORIZATION_ERROR', undefined, 403);
    this.name = 'APIAuthorizationError';
    Object.setPrototypeOf(this, APIAuthorizationError.prototype);
  }
}

export class APINotFoundError extends ZendeskAPIError {
  constructor(message: string, resource?: string) {
    super(message, 'API_NOT_FOUND_ERROR', undefined, 404, { resource });
    this.name = 'APINotFoundError';
    Object.setPrototypeOf(this, APINotFoundError.prototype);
  }
}

export class APIRateLimitError extends ZendeskAPIError {
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message, 'API_RATE_LIMIT_ERROR', undefined, 429, { retryAfter });
    this.name = 'APIRateLimitError';
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, APIRateLimitError.prototype);
  }
}

export class APIServerError extends ZendeskAPIError {
  constructor(message: string, statusCode = 500) {
    super(message, 'API_SERVER_ERROR', undefined, statusCode);
    this.name = 'APIServerError';
    Object.setPrototypeOf(this, APIServerError.prototype);
  }
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof APIRateLimitError) return true;
  if (error instanceof APIServerError && error.statusCode && error.statusCode >= 500) return true;
  if (error instanceof Error && /ECONNRESET|ETIMEDOUT/.test(error.message)) return true;
  if (error instanceof Error && !(error instanceof ZendeskAPIError)) return true;
  return false;
}
