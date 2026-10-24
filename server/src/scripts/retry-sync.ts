import { crmSyncService } from '../services/crmSync.service.js';

async function main() {
  console.log('====================================================');
  console.log(' Zoho CRM Retry Command Line Tool');
  console.log('====================================================');
  console.log('Scanning database for pending or failed CRM sync records...\n');

  try {
    const result = await crmSyncService.retryAllPending();

    console.log('\n----------------------------------------------------');
    console.log(`Scan Complete:`);
    console.log(`Total Pending/Failed Records: ${result.total}`);
    console.log(`Successfully Synced:          ${result.succeeded}`);
    console.log(`Still Pending/Failed:         ${result.failed}`);
    console.log('----------------------------------------------------');

    process.exit(0);
  } catch (err: any) {
    console.error('\n[Error during CLI sync retry]', err);
    process.exit(1);
  }
}

main();
