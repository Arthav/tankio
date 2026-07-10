import { Readable } from 'node:stream';
import type http from 'node:http';
import { describe, expect, it } from 'vitest';
import { HttpError, normalizeGuestRequestBody, readJsonBody } from './httpJson';

describe('HTTP JSON helpers', () => {
  it('reads valid JSON bodies', async () => {
    await expect(readJsonBody(requestFrom('{"name":"Tester"}'))).resolves.toEqual({ name: 'Tester' });
  });

  it('turns malformed JSON into a 400 error', async () => {
    await expect(readJsonBody(requestFrom('{"name":'))).rejects.toMatchObject({
      status: 400,
      message: 'Request body must be valid JSON.',
    } satisfies Partial<HttpError>);
  });

  it('rejects oversized JSON bodies', async () => {
    await expect(readJsonBody(requestFrom('{"name":"Too large"}'), 4)).rejects.toMatchObject({
      status: 413,
      message: 'Request body is too large.',
    } satisfies Partial<HttpError>);
  });

  it('normalizes only valid guest request shapes', () => {
    expect(normalizeGuestRequestBody({ token: 'abc', name: 'Pilot' })).toEqual({ token: 'abc', name: 'Pilot' });
    expect(normalizeGuestRequestBody({})).toEqual({ name: 'Pilot' });
    expect(() => normalizeGuestRequestBody({ token: 123 })).toThrow(HttpError);
    expect(() => normalizeGuestRequestBody({ name: false })).toThrow(HttpError);
  });
});

function requestFrom(body: string): http.IncomingMessage {
  return Readable.from([body]) as unknown as http.IncomingMessage;
}
