import type http from 'node:http';

export const DEFAULT_JSON_BODY_LIMIT_BYTES = 16 * 1024;

export interface GuestRequestBody {
  token?: string;
  name: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export async function readJsonBody<T = unknown>(
  request: http.IncomingMessage,
  maxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES,
): Promise<T> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) throw new HttpError(413, 'Request body is too large.');
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {} as T;

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

export function normalizeGuestRequestBody(body: unknown): GuestRequestBody {
  if (!isRecord(body)) throw new HttpError(400, 'Request body must be a JSON object.');

  const token = body.token;
  const name = body.name;

  if (token !== undefined && typeof token !== 'string') {
    throw new HttpError(400, 'Guest token must be a string.');
  }

  if (name !== undefined && typeof name !== 'string') {
    throw new HttpError(400, 'Guest name must be a string.');
  }

  return {
    token,
    name: name ?? 'Pilot',
  };
}

export function errorResponse(error: unknown): { status: number; body: { error: string } } {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: { error: error.message },
    };
  }

  return {
    status: 500,
    body: { error: 'Internal server error.' },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
