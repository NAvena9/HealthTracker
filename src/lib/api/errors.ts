import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export type ApiErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'not_found'
  | 'week_closed'
  | 'confirmation_required'
  | 'conflict'
  | 'payload_too_large'
  | 'rate_limited'
  | 'internal_error';

export interface ApiIssue {
  path: (string | number)[];
  message: string;
}

const STATUS: Record<ApiErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  not_found: 404,
  week_closed: 409,
  confirmation_required: 409,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal_error: 500,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly issues?: ApiIssue[],
    readonly headers?: Record<string, string>,
    /** Extra top-level keys inside `error` (e.g. `warnings`). */
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const validationError = (message: string, issues?: ApiIssue[]) => new ApiError('validation_error', message, issues);
export const notFound = (message = 'Not found') => new ApiError('not_found', message);
export const weekClosed = (message = 'This week is closed. Reopen it to make changes.') => new ApiError('week_closed', message);
export const conflict = (message: string) => new ApiError('conflict', message);

/** Shape of errors returned by supabase-js (PostgREST / storage). */
export interface PgLikeError {
  code?: string;
  message?: string;
  hint?: string | null;
  details?: string | null;
}

/**
 * Throw the right ApiError for a supabase-js error. Never leaks SQL.
 * P0001 + hint closed_week -> 409 week_closed; 23505 -> 409 conflict;
 * 23514 / 22xxx -> 400 validation_error; everything else -> 500.
 */
export function throwDbError(error: PgLikeError | null | undefined, context = 'database'): void {
  if (!error) return;
  const code = error.code ?? '';
  if (code === 'P0001' && (error.hint === 'closed_week' || /closed/i.test(error.message ?? ''))) throw weekClosed();
  if (code === '23505') throw conflict('Already exists');
  if (code === '23514' || code === '23502' || code.startsWith('22')) throw validationError('Value rejected by the database');
  console.error(`[${context}] db error`, code, error.message);
  throw new ApiError('internal_error', 'Unexpected error');
}

export function toResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, ...(err.issues ? { issues: err.issues } : {}), ...(err.extra ?? {}) } },
      { status: err.status, headers: err.headers },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_error',
          message: 'Invalid request',
          issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  console.error('[api] unexpected error', err instanceof Error ? err.message : err);
  return NextResponse.json({ error: { code: 'internal_error', message: 'Unexpected error' } }, { status: 500 });
}

/** Wrap a route handler so every thrown error becomes the standard envelope. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      return toResponse(err);
    }
  };
}

/** Parse a JSON body; bad JSON -> 400 validation_error. Empty body -> {}. */
export async function readJson(req: Request, maxBytes = 512 * 1024): Promise<unknown> {
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new ApiError('payload_too_large', 'Request body too large');
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw validationError('Body is not valid JSON');
  }
}
