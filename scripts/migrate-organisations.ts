import { runOrganisationMigration } from '../apps/api/src/services/migrate-organisations.js';

export { runOrganisationMigration };

if (import.meta.url === `file://${process.argv[1]}`) {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');
  runOrganisationMigration({ dryRun: isDryRun })
    .then((res) => {
      console.log('Organisation migration result:', res);
      process.exit(res.errors > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Fatal organisation migration error:', err);
      process.exit(1);
    });
}
