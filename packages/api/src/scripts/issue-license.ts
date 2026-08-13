/**
 * Issue unclaimed license keys (the "purchase" step).
 * Usage: pnpm --filter @taro/api issue-license [count]
 */
import '../config/env';
import { connectDB } from '../db/mongo';
import { LicenseModel } from '../db/models';
import { generateLicenseKey } from '../lib/licenseKey';

async function main() {
  const count = Math.max(1, parseInt(process.argv[2] || '1', 10) || 1);
  await connectDB();

  for (let i = 0; i < count; i++) {
    const license = await LicenseModel.create({ key: generateLicenseKey() });
    console.log(license.key);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('Failed to issue license:', error);
  process.exit(1);
});
