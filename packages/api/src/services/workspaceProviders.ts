/**
 * Turns a workspace's stored provider settings into runtime configs, decrypting
 * keys only at the moment they're needed. Nothing here ever returns a key to
 * a client; routes use providerSettings() for the masked view.
 */

import type { ProviderSettings } from '@taro/shared';
import { getLlmProvider, getSttProvider, LLM_PROVIDERS } from '@taro/shared';
import { CompanyModel, type CompanyDoc } from '../db/models/Company';
import { decryptSecret } from '../lib/crypto';
import { log, errorMessage } from '../lib/logger';
import { serverSttAvailable } from '../config/env';
import type { LlmConfig } from './llm';
import type { SttRuntimeConfig } from './stt';

export type ProviderSlot = 'meetingBaas' | 'llm' | 'stt';

type CompanyLike = CompanyDoc & { _id: unknown };

/** Bound into each ciphertext so a stored key only decrypts for its own workspace and slot. */
export function keyContext(companyId: string, slot: ProviderSlot): string {
  return `company:${companyId}:${slot}`;
}

function decrypt(company: CompanyLike, slot: ProviderSlot, value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decryptSecret(value, keyContext(String(company._id), slot));
  } catch (error) {
    log.error(`[Providers] Could not decrypt the ${slot} key for workspace ${String(company._id)}: ${errorMessage(error)}`);
    return null;
  }
}

export interface WorkspaceProviders {
  meetingBaasKey: string | null;
  llm: LlmConfig | null;
  stt: SttRuntimeConfig | null;
}

export function resolveProviders(company: CompanyLike): WorkspaceProviders {
  const p = company.providers ?? {};

  const meetingBaasKey = decrypt(company, 'meetingBaas', p.meetingBaas?.keyEnc);

  let llm: LlmConfig | null = null;
  const llmInfo = getLlmProvider(p.llm?.provider);
  const llmKey = decrypt(company, 'llm', p.llm?.keyEnc);
  if (p.llm && llmInfo && llmKey) {
    llm = { provider: llmInfo.id, apiKey: llmKey, model: p.llm.model, baseUrl: p.llm.baseUrl };
  }

  let stt: SttRuntimeConfig | null = null;
  const sttInfo = getSttProvider(p.stt?.provider);
  if (p.stt && sttInfo) {
    if (sttInfo.id === 'server') {
      stt = serverSttAvailable() ? { provider: 'server' } : null;
    } else {
      const model = p.stt.model || sttInfo.defaultModel;
      const key =
        p.stt.useLlmKey && llm && llmInfo?.sttProvider === sttInfo.id
          ? llm.apiKey
          : decrypt(company, 'stt', p.stt.keyEnc);
      if (key) stt = { provider: sttInfo.id, apiKey: key, model };
    }
  } else if (serverSttAvailable()) {
    // No choice made but the operator hosts transcription: use it rather than go deaf
    stt = { provider: 'server' };
  }

  return { meetingBaasKey, llm, stt };
}

export async function loadProviders(companyId: string): Promise<WorkspaceProviders | null> {
  const company = await CompanyModel.findById(companyId);
  return company ? resolveProviders(company) : null;
}

/** Masked settings for the dashboard: provider, model, a key hint, never the key. */
export function providerSettings(company: CompanyLike): ProviderSettings {
  const p = company.providers ?? {};
  const llmInfo = getLlmProvider(p.llm?.provider);
  const sttUsesLlm = !!(p.stt?.useLlmKey && llmInfo?.sttProvider && llmInfo.sttProvider === p.stt.provider);

  return {
    meetingBot: {
      provider: 'meetingbaas',
      configured: !!p.meetingBaas?.keyEnc,
      keyHint: p.meetingBaas?.keyHint,
      validatedAt: p.meetingBaas?.validatedAt?.toISOString(),
    },
    llm: {
      configured: !!p.llm?.keyEnc,
      provider: llmInfo?.id,
      model: p.llm?.model,
      baseUrl: p.llm?.baseUrl,
      keyHint: p.llm?.keyHint,
      validatedAt: p.llm?.validatedAt?.toISOString(),
    },
    stt: {
      configured:
        p.stt?.provider === 'server'
          ? serverSttAvailable()
          : sttUsesLlm
            ? !!p.llm?.keyEnc
            : !!p.stt?.keyEnc || (!p.stt && serverSttAvailable()),
      provider: (p.stt?.provider as ProviderSettings['stt']['provider']) ?? (serverSttAvailable() ? 'server' : undefined),
      model: p.stt?.model,
      usesLlmKey: sttUsesLlm,
      keyHint: sttUsesLlm ? p.llm?.keyHint : p.stt?.keyHint,
      validatedAt: (sttUsesLlm ? p.llm?.validatedAt : p.stt?.validatedAt)?.toISOString(),
    },
  };
}

export function providerReadiness(company: CompanyLike) {
  const s = providerSettings(company);
  return { meetingBot: s.meetingBot.configured, llm: s.llm.configured, stt: s.stt.configured };
}

// Re-exported for routes that validate a provider id from a request body
export const KNOWN_LLM_PROVIDERS = new Set<string>(LLM_PROVIDERS.map((p) => p.id));
