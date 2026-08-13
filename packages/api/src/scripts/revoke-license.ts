/**
 * Revoke a license (entitlement kill switch). All the workspace's access
 * tokens keep failing auth from the next request onward.
 * Usage: pnpm --filter @taro/api revoke-license TARO-XXXX-XXXX-XXXX
 */
import '../config/env';
import { connectDB } from '../db/mongo';
import { LicenseModel } from '../db/models';
import { normalizeLicenseKey } from '../lib/licenseKey';

async function main() {
  const key = process.argv[2];
  if (!key) {
    console.error('Usage: pnpm --filter @taro/api revoke-license <key>');
    process.exit(1);
  }
  await connectDB();

  const license = await LicenseModel.findOneAndUpdate(
    { key: normalizeLicenseKey(key) },
    { revokedAt: new Date() },
    { new: true }
  );
  if (!license) {
    console.error('License not found');
    process.exit(1);
  }
  console.log(`Revoked ${license.key} (company: ${license.companyId ?? 'unclaimed'})`);
  process.exit(0);
}

main().catch((error) => {
  console.error('Failed:', error);
  process.exit(1);
});
