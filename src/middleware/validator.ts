import { Validator as JSONSchemaValidator, ValidationError as JSONSchemaError } from 'jsonschema';

export interface Schema {
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  description?: string;
  default?: unknown;
  additionalProperties?: boolean | Schema;
  [key: string]: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  value?: unknown;
}

export class Validator {
  private jsonValidator: JSONSchemaValidator;

  constructor() {
    this.jsonValidator = new JSONSchemaValidator();
  }

  validateSchema(data: unknown, schema: Schema): ValidationResult {
    const result = this.jsonValidator.validate(data, schema);
    if (result.valid) return { valid: true, errors: [] };

    const errors: ValidationError[] = result.errors.map((error: JSONSchemaError) => ({
      path: error.property,
      message: error.message,
      value: error.instance,
    }));
    return { valid: false, errors };
  }
}
