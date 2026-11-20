import { NestFactory } from '@nestjs/core';

import { SeedModule } from './seed.module';
import { SeedService, SeedValidationError } from './seed.service';
import type { SeedReport } from './seed.service';

// Entry point for `npm run seed` (GEN-12, ACC-18). Run it from backend/.
// Never log MONGODB_URI, SEED_ADMIN_PASSWORD or the password hash.

function printReport(report: SeedReport): void {
  const collections = [
    'countries',
    'currencies',
    'cities',
    'airports',
    'attractions',
  ] as const;

  console.log('');
  console.log('collection   | inserted | updated | unchanged');
  console.log('-------------|----------|---------|----------');
  for (const name of collections) {
    const { inserted, updated, unchanged } = report[name];
    console.log(
      `${name.padEnd(12)} | ${String(inserted).padStart(8)} | ${String(updated).padStart(7)} | ${String(unchanged).padStart(9)}`,
    );
  }
  console.log('');
  console.log(`admin: ${report.admin}`);
}

async function main() {
  const app = await NestFactory.createApplicationContext(SeedModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const report = await app.get(SeedService).run();
    printReport(report);
    process.exitCode = 0;
  } catch (err) {
    if (err instanceof SeedValidationError) {
      console.error('Seed aborted: nothing was written.');
    } else {
      console.error(
        `Seed failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main();
