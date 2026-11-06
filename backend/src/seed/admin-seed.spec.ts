import { readAdminSeedConfig } from './admin-seed';

const VALID_ENV = {
  SEED_ADMIN_NAME: '  Platform Admin ',
  SEED_ADMIN_EMAIL: ' Admin@Example.COM ',
  SEED_ADMIN_PASSWORD: 'Secret1234',
};

describe('readAdminSeedConfig', () => {
  it('returns a normalized config for a valid environment', () => {
    expect(readAdminSeedConfig(VALID_ENV)).toEqual({
      config: {
        name: 'Platform Admin',
        email: 'admin@example.com',
        password: 'Secret1234',
      },
      errors: [],
    });
  });

  it.each(['SEED_ADMIN_NAME', 'SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD'])(
    'reports missing %s by name',
    (name) => {
      const result = readAdminSeedConfig({ ...VALID_ENV, [name]: undefined });

      expect(result.config).toBeUndefined();
      expect(result.errors).toEqual([`${name} is required`]);
    },
  );

  it('treats an empty value as missing', () => {
    const result = readAdminSeedConfig({ ...VALID_ENV, SEED_ADMIN_NAME: '  ' });

    expect(result.errors).toEqual(['SEED_ADMIN_NAME is required']);
  });

  it('rejects an invalid email', () => {
    const result = readAdminSeedConfig({
      ...VALID_ENV,
      SEED_ADMIN_EMAIL: 'not-an-email',
    });

    expect(result.config).toBeUndefined();
    expect(result.errors).toEqual([
      'SEED_ADMIN_EMAIL must be a valid email address',
    ]);
  });

  it.each([
    ['no digit', 'abcdefgh'],
    ['no letter', '12345678'],
    ['too short', 'ab1'],
  ])('rejects a password with %s without echoing it', (_label, password) => {
    const result = readAdminSeedConfig({
      ...VALID_ENV,
      SEED_ADMIN_PASSWORD: password,
    });

    expect(result.config).toBeUndefined();
    expect(result.errors).toEqual([
      'SEED_ADMIN_PASSWORD must be at least 8 characters and contain a letter and a digit',
    ]);
    for (const error of result.errors) {
      expect(error).not.toContain(password);
    }
  });
});
