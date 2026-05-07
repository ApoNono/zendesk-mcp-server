import { Tool } from '../core/types.js';
import { Schema, Validator } from '../middleware/validator.js';
import { ZendeskAPIClient } from '../api/index.js';
import { ValidationError, ToolExecutionError } from '../utils/errors.js';
import { Logger } from '../utils/logger.js';

export abstract class BaseTool<TParams = unknown> implements Tool {
  public readonly name: string;
  public readonly description: string;
  public readonly parameters: Schema;

  protected validator: Validator;
  protected apiClient: ZendeskAPIClient;
  protected logger: Logger;

  constructor(
    name: string,
    description: string,
    parameters: Schema,
    apiClient: ZendeskAPIClient,
    logger: Logger,
  ) {
    this.name = name;
    this.description = description;
    this.parameters = parameters;
    this.apiClient = apiClient;
    this.logger = logger;
    this.validator = new Validator();
  }

  async execute(params: unknown): Promise<unknown> {
    const validation = this.validator.validateSchema(params || {}, this.parameters);
    if (!validation.valid) {
      throw new ValidationError(`Invalid parameters for tool ${this.name}`, validation.errors);
    }

    try {
      return await this.executeInternal((params || {}) as TParams);
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      if (error instanceof Error) {
        throw new ToolExecutionError(
          `Tool ${this.name} execution failed: ${error.message}`,
          this.name,
          error,
        );
      }
      throw error;
    }
  }

  protected abstract executeInternal(params: TParams): Promise<unknown>;
}
