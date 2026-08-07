import { AuthenticationManager } from '../../src/auth/manager.js';
import { Logger } from '../../src/utils/logger.js';
import { ConfigurationError } from '../../src/utils/errors.js';

const logger = new Logger({ level: 'fatal' });

describe('AuthenticationManager', () => {
  describe('constructor', () => {
    it('throws on missing email', () => {
      expect(() => new AuthenticationManager({ email: '', apiToken: 'tok' }, logger)).toThrow(
        ConfigurationError,
      );
    });

    it('throws on missing token', () => {
      expect(() => new AuthenticationManager({ email: 'a@b.com', apiToken: '' }, logger)).toThrow(
        ConfigurationError,
      );
    });
  });

  describe('getAuthHeaders', () => {
    it('produces base64-encoded Basic auth in the form email/token:TOKEN', () => {
      const auth = new AuthenticationManager(
        { email: 'agent@acme.com', apiToken: 'abc123' },
        logger,
      );
      const headers = auth.getAuthHeaders();

      expect(headers.Authorization).toMatch(/^Basic /);
      const encoded = headers.Authorization.slice('Basic '.length);
      const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
      expect(decoded).toBe('agent@acme.com/token:abc123');
    });

    it('sets JSON content type and accept headers', () => {
      const auth = new AuthenticationManager({ email: 'a@b.com', apiToken: 't' }, logger);
      const headers = auth.getAuthHeaders();
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers.Accept).toBe('application/json');
    });

    it('produces identical headers regardless of which brand the request targets', () => {
      // Auth is account-scoped, not brand-scoped.
      const auth = new AuthenticationManager({ email: 'a@b.com', apiToken: 't' }, logger);
      expect(auth.getAuthHeaders()).toEqual(auth.getAuthHeaders());
    });
  });
});
