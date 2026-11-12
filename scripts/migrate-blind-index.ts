import { runBlindIndexMigration } from '../apps/api/src/services/migrate-blind-index.js';

export { runBlindIndexMigration };

if (import.meta.url === `file://${process.argv[1]}`) {
  const isDryRun = process.argv.includes('--dry-run');
  runBlindIndexMigration({ dryRun: isDryRun })
    .then((res) => {
      process.exit(res.errors > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Fatal migration error:', err);
      process.exit(1);
    });
}
