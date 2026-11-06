import {
  EMAIL_REGEX,
  PASSWORD_MIN_LENGTH,
  PASSWORD_REGEX,
} from '../reference-data/reference-data.constants';

export interface AdminSeedConfig {
  name: string;
  email: string;
  password: string;
}

const ADMIN_ENV_VARS = [
  'SEED_ADMIN_NAME',
  'SEED_ADMIN_EMAIL',
  'SEED_ADMIN_PASSWORD',
] as const;

/**
 * Reads the seeded admin account from the environment (ACC-18). Error
 * messages name the variable but never include the password value.
 */
export function readAdminSeedConfig(env: NodeJS.ProcessEnv): {
  config?: AdminSeedConfig;
  errors: string[];
} {
  const errors: string[] = [];

  for (const name of ADMIN_ENV_VARS) {
    if (!env[name]?.trim()) {
      errors.push(`${name} is required`);
    }
  }
  if (errors.length > 0) return { errors };

  const name = env.SEED_ADMIN_NAME!.trim();
  const email = env.SEED_ADMIN_EMAIL!.trim().toLowerCase();
  const password = env.SEED_ADMIN_PASSWORD!;

  if (!EMAIL_REGEX.test(email)) {
    errors.push('SEED_ADMIN_EMAIL must be a valid email address');
  }
  if (password.length < PASSWORD_MIN_LENGTH || !PASSWORD_REGEX.test(password)) {
    errors.push(
      'SEED_ADMIN_PASSWORD must be at least 8 characters and contain a letter and a digit',
    );
  }

  if (errors.length > 0) return { errors };
  return { config: { name, email, password }, errors };
}
