export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "INVALID_TRANSITION"
  | "PROVIDER_UNCONFIGURED"
  | "BAD_SIGNATURE"
  | "RATE_LIMITED";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  INVALID_TRANSITION: 409,
  PROVIDER_UNCONFIGURED: 503,
  BAD_SIGNATURE: 400,
  RATE_LIMITED: 429,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

/** Consistent JSON error envelope: { error: { code, message, fieldErrors? } } */
export function errorEnvelope(e: AppError) {
  return { error: { code: e.code, message: e.message, ...(e.fieldErrors ? { fieldErrors: e.fieldErrors } : {}) } };
}
