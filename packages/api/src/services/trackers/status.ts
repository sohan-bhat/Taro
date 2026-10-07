/** What Setup shows for Linear and Jira, and cleaning both up when a workspace goes away. */

import { DEFAULT_TICKET_ACTIONS, type TrackerStatus } from '@taro/shared';
import { jiraConfigured, linearConfigured } from '../../config/env';
import { JiraConnectionModel, LinearConnectionModel, LinearGrantModel } from '../../db/models';
import type { JiraConnectionDoc } from '../../db/models/JiraConnection';
import type { LinearConnectionDoc } from '../../db/models/LinearConnection';
import { decryptSecret } from '../../lib/crypto';
import { log, errorMessage } from '../../lib/logger';
import { accessContext, revokeLinearToken } from './linear';

export function linearStatus(conn: LinearConnectionDoc | null): TrackerStatus {
  if (!conn) return { connected: false, configured: linearConfigured() };
  const teams = conn.teams ?? [];
  const chosen = teams.find((t) => t.id === conn.defaultTeamId) ?? (teams.length === 1 ? teams[0] : undefined);
  return {
    connected: true,
    configured: linearConfigured(),
    siteName: conn.organizationName,
    siteUrl: conn.urlKey ? `https://linear.app/${conn.urlKey}` : undefined,
    spaces: teams.map((t) => ({ id: t.id, key: t.key, name: t.name })),
    defaultSpace: chosen?.id,
    enabledActions: conn.enabledActions ? [...conn.enabledActions] : [...DEFAULT_TICKET_ACTIONS],
    needsReconnect: !!conn.needsReconnect || undefined,
    connectedAt: conn.createdAt?.toISOString(),
  };
}

export function jiraStatus(conn: JiraConnectionDoc | null): TrackerStatus {
  if (!conn) return { connected: false, configured: jiraConfigured() };
  const projects = conn.projects ?? [];
  const chosen = projects.find((p) => p.key === conn.defaultProjectKey) ?? (projects.length === 1 ? projects[0] : undefined);
  return {
    connected: true,
    configured: jiraConfigured(),
    siteName: conn.siteName,
    siteUrl: conn.siteUrl,
    // Jira projects are chosen by key
    spaces: projects.map((p) => ({ id: p.key, key: p.key, name: p.name })),
    defaultSpace: chosen?.key,
    enabledActions: conn.enabledActions ? [...conn.enabledActions] : [...DEFAULT_TICKET_ACTIONS],
    needsReconnect: !!conn.needsReconnect || undefined,
    connectedAt: conn.createdAt?.toISOString(),
  };
}

/** Revokes Taro's Linear token and drops both connections. */
export async function forgetTrackers(companyId: string): Promise<void> {
  const linear = await LinearConnectionModel.findOne({ companyId });
  if (linear) {
    try {
      await revokeLinearToken(decryptSecret(linear.accessTokenEnc, accessContext(companyId)));
    } catch (error) {
      log.warn('[Linear] Revoke failed during cleanup:', errorMessage(error));
    }
  }
  await Promise.all([
    LinearConnectionModel.deleteMany({ companyId }),
    LinearGrantModel.deleteMany({ companyId }),
    JiraConnectionModel.deleteMany({ companyId }),
  ]);
}
