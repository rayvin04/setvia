export class MetaConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaConfigurationError";
  }
}

export class InvalidModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidModelOutputError";
  }
}

export class InvalidImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidImageError";
  }
}

export type MetaApiErrorCode =
  | "authentication"
  | "forbidden"
  | "not_found"
  | "rate_limit"
  | "timeout"
  | "server"
  | "request"
  | "connection"
  | "invalid_response"
  | "unexpected_model"
  | "request_limit"
  | "accounting";

export class MetaApiError extends Error {
  readonly code: MetaApiErrorCode;
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(
    code: MetaApiErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "MetaApiError";
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}
