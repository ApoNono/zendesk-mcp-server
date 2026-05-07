export interface RetryOptions {
  maxAttempts: number;
  backoffStrategy: 'exponential' | 'linear';
  initialDelay: number;
  maxDelay: number;
  retryCondition?: (error: unknown) => boolean;
}

export class RetryHandler {
  private readonly options: RetryOptions;

  constructor(options: RetryOptions) {
    this.options = {
      ...options,
      retryCondition: options.retryCondition || (() => true),
    };
  }

  async withRetries<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === this.options.maxAttempts || !this.options.retryCondition!(error)) {
          throw error;
        }
        await this.sleep(this.calculateDelay(attempt));
      }
    }

    throw lastError;
  }

  private calculateDelay(attempt: number): number {
    const delay =
      this.options.backoffStrategy === 'exponential'
        ? this.options.initialDelay * Math.pow(2, attempt - 1)
        : this.options.initialDelay * attempt;
    return Math.min(delay, this.options.maxDelay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
