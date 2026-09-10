export class ClearingError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, httpStatus = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ClearingError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export function fail(
  code: string,
  message: string,
  httpStatus = 400,
  details?: Record<string, unknown>,
): never {
  throw new ClearingError(code, message, httpStatus, details);
}
