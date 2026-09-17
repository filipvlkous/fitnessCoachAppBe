import { createHash } from 'node:crypto';
import { throttlerTracker } from './throttler-tracker';

const req = (headers: Record<string, string>, ip?: string) => ({
  headers,
  ip,
});

const expectedTokenKey = (token: string) =>
  `token:${createHash('sha256').update(token).digest('base64url').slice(0, 22)}`;

describe('throttlerTracker', () => {
  it('keys an authenticated request by its bearer token', () => {
    expect(throttlerTracker(req({ authorization: 'Bearer abc.def.ghi' }))).toBe(
      expectedTokenKey('abc.def.ghi'),
    );
  });

  it('gives two sessions separate budgets', () => {
    const one = throttlerTracker(req({ authorization: 'Bearer token-one' }));
    const two = throttlerTracker(req({ authorization: 'Bearer token-two' }));
    expect(one).not.toBe(two);
  });

  it('never puts the raw token in the key', () => {
    const token = 'a-very-secret-access-token';
    expect(throttlerTracker(req({ authorization: `Bearer ${token}` }))).not.toContain(
      token,
    );
  });

  it('accepts any casing of the bearer scheme', () => {
    expect(throttlerTracker(req({ authorization: 'bearer abc' }))).toBe(
      expectedTokenKey('abc'),
    );
  });

  // Behind nginx every request arrives from 127.0.0.1, so falling back to
  // `req.ip` while `X-Real-IP` is present would put every caller in one bucket.
  it('prefers X-Real-IP over the proxy address when there is no token', () => {
    expect(throttlerTracker(req({ 'x-real-ip': '203.0.113.7' }, '127.0.0.1'))).toBe(
      'ip:203.0.113.7',
    );
  });

  it('falls back to req.ip when X-Real-IP is absent', () => {
    expect(throttlerTracker(req({}, '198.51.100.4'))).toBe('ip:198.51.100.4');
  });

  it('falls back to req.ip when X-Real-IP is blank', () => {
    expect(throttlerTracker(req({ 'x-real-ip': '   ' }, '198.51.100.4'))).toBe(
      'ip:198.51.100.4',
    );
  });

  it('ignores an authorization header that is not a bearer token', () => {
    expect(throttlerTracker(req({ authorization: 'Basic dXNlcjpwYXNz' }, '198.51.100.4'))).toBe(
      'ip:198.51.100.4',
    );
  });

  it('ignores a bearer header with no token', () => {
    expect(throttlerTracker(req({ authorization: 'Bearer' }, '198.51.100.4'))).toBe(
      'ip:198.51.100.4',
    );
  });

  it('still produces a key when nothing identifies the caller', () => {
    expect(throttlerTracker({ headers: {} })).toBe('ip:unknown');
  });
});
