/**
 * Data migrations, run at boot. Each one runs once per database (recorded in
 * the `migrations` collection) and is safe to repeat, so two replicas booting
 * together is harmless.
 */

import { mongoose } from './mongo';
import {
  ActionLogModel,
  CompanyModel,
  GithubConnectionModel,
  GithubGrantModel,
  LoginCodeModel,
  MeetingModel,
  SessionModel,
  SlackConnectionModel,
  UserModel,
} from './models';
import { sealSlackToken } from '../services/slack';
import { log, errorMessage } from '../lib/logger';

async function dropIndexIfPresent(collection: string, index: string) {
  const db = mongoose.connection.db;
  if (!db) return;
  try {
    const exists = (await db.collection(collection).indexes()).some((i) => i.name === index);
    if (exists) {
      await db.collection(collection).dropIndex(index);
      log.info(`[Migrate] Dropped index ${collection}.${index}`);
    }
  } catch (error) {
    // Collection may not exist yet on a fresh database
    log.debug(`[Migrate] Skipped ${collection}.${index}: ${errorMessage(error)}`);
  }
}

async function once(id: string, run: () => Promise<void>) {
  const db = mongoose.connection.db;
  if (!db) return;
  const markers = db.collection<{ _id: string; at: Date }>('migrations');
  if (await markers.findOne({ _id: id })) return;
  await run();
  await markers.updateOne({ _id: id }, { $set: { at: new Date() } }, { upsert: true });
}

export async function runMigrations(): Promise<void> {
  await once('2026-10-retire-licenses', async () => {
    // License-era workspaces were unique by email domain; workspaces are now keyed by Slack team.
    await dropIndexIfPresent('companies', 'domain_1');
    await dropIndexIfPresent('companies', 'licenseKey_1');
    // License-era bearer tokens weren't tied to a person; everyone signs in with Slack now.
    const db = mongoose.connection.db;
    if (db && (await db.listCollections({ name: 'accesstokens' }).hasNext())) {
      await db.collection('accesstokens').drop();
      log.info('[Migrate] Retired license-era access tokens');
    }
  });

  await once('2026-10-github-repo-scopes', async () => {
    // Personal-token connections predate the GitHub App, and connections made before
    // repo-level checks have no record of what the connecting person could push to.
    const result = await GithubConnectionModel.deleteMany({
      $or: [{ installationId: { $exists: false } }, { allowedRepos: { $exists: false } }],
    });
    if (result.deletedCount) log.info(`[Migrate] Removed ${result.deletedCount} GitHub connection(s); they need connecting again`);
  });

  await once('2026-10-encrypt-slack-tokens', async () => {
    const plaintext = await SlackConnectionModel.find({ accessToken: { $not: /^enc:v1:/ } });
    for (const connection of plaintext) {
      connection.accessToken = sealSlackToken(connection.accessToken, connection.teamId);
      await connection.save();
    }
    if (plaintext.length) log.info(`[Migrate] Encrypted ${plaintext.length} Slack bot token(s)`);
  });

  await once('2026-10-owner-claims', async () => {
    // Workspaces whose owner was decided before claims were recorded
    const owned = await UserModel.distinct('companyId', { role: 'owner' });
    const result = await CompanyModel.updateMany(
      { _id: { $in: owned }, ownerClaimedAt: { $exists: false } },
      { ownerClaimedAt: new Date() }
    );
    if (result.modifiedCount) log.info(`[Migrate] Recorded owners for ${result.modifiedCount} workspace(s)`);
  });

  // Build any indexes the models declare (unique, TTL) before serving traffic.
  const models = [
    CompanyModel,
    UserModel,
    SessionModel,
    LoginCodeModel,
    SlackConnectionModel,
    GithubConnectionModel,
    GithubGrantModel,
    MeetingModel,
    ActionLogModel,
  ];
  await Promise.all(models.map((model) => model.createIndexes()));
}
