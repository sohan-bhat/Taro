/**
 * Bring-your-own-key settings. Every key is checked against the real provider
 * before it's stored, stored encrypted, and never sent back; responses carry
 * only the masked settings.
 */

import { Router, type Router as RouterType } from 'express';
import { getLlmProvider, getSttProvider } from '@taro/shared';
import { CompanyModel } from '../db/models';
import { serverSttAvailable } from '../config/env';
import { asyncHandler } from '../middleware/errorHandler';
import { requireAdmin, requireAuth, type AuthedRequest } from '../middleware/auth';
import { NotFoundError, ValidationError } from '../lib/errors';
import { encryptSecret, keyHint } from '../lib/crypto';
import { rateLimit } from '../lib/rateLimit';
import { validateLlmKey } from '../services/llm';
import { assertEndpointAllowed } from '../services/llm/safeFetch';
import { validateSttKey } from '../services/stt';
import { MeetingBaasClient } from '../services/meetingbaas';
import { keyContext, providerSettings, resolveProviders } from '../services/workspaceProviders';
import { afterProvidersChange } from '../services/calendar/bots';

export const providersRouter: RouterType = Router();
providersRouter.use(requireAuth, requireAdmin);

// Each save makes a live call to the provider; this keeps Taro from being used as a key-testing oracle.
const validateLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: 30,
  key: (req) => `providers:${(req as AuthedRequest).companyId}`,
  message: 'Too many key checks. Wait a few minutes and try again.',
});

function readKey(body: unknown): string | undefined {
  const raw = (body as { apiKey?: unknown } | undefined)?.apiKey;
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') throw new ValidationError('apiKey must be a string.');
  const key = raw.trim();
  if (key.length < 8 || key.length > 512 || /\s/.test(key)) {
    throw new ValidationError('That does not look like an API key.');
  }
  return key;
}

async function loadCompany(req: AuthedRequest) {
  const company = await CompanyModel.findById(req.companyId);
  if (!company) throw new NotFoundError('Workspace');
  return company;
}

providersRouter.put(
  '/meeting-bot',
  validateLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const apiKey = readKey(req.body);
    if (!apiKey) throw new ValidationError('Paste your MeetingBaas API key.');

    const check = await MeetingBaasClient.validate(apiKey);
    if (!check.ok) return res.status(400).json({ error: check.error, code: 'KEY_REJECTED' });

    const company = await loadCompany(req);
    const replaced = resolveProviders(company).meetingBaasKey;
    company.set('providers.meetingBaas', {
      keyEnc: encryptSecret(apiKey, keyContext(req.companyId!, 'meetingBaas')),
      keyHint: keyHint(apiKey),
      validatedAt: new Date(),
    });
    await company.save();
    // Bots already scheduled for calendar meetings were made with the old key; it cancels them.
    afterProvidersChange(req.companyId!, replaced && replaced !== apiKey ? replaced : null);
    res.json({ providers: providerSettings(company) });
  })
);

providersRouter.put(
  '/llm',
  validateLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = (req.body ?? {}) as { provider?: unknown; model?: unknown; baseUrl?: unknown };
    const info = getLlmProvider(typeof body.provider === 'string' ? body.provider : undefined);
    if (!info) throw new ValidationError('Choose an AI provider.');

    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim().slice(0, 120) : info.defaultModel;
    if (!model) throw new ValidationError('Enter the model name your API expects.');

    let baseUrl: string | undefined;
    if (info.needsBaseUrl) {
      if (typeof body.baseUrl !== 'string' || !body.baseUrl.trim()) throw new ValidationError('Enter the base URL of your API.');
      try {
        baseUrl = assertEndpointAllowed(body.baseUrl.trim()).toString().replace(/\/$/, '');
      } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : 'That URL is not allowed.');
      }
    }

    const company = await loadCompany(req);
    // Changing only the model keeps the stored key. A new endpoint needs the key typed
    // again, or an admin could send the saved key to a server of their choosing.
    let apiKey = readKey(req.body);
    const current = resolveProviders(company).llm;
    if (!apiKey) {
      const sameTarget = current && current.provider === info.id && (current.baseUrl ?? '') === (baseUrl ?? '');
      if (sameTarget) apiKey = current.apiKey;
      else if (current && current.provider === info.id) throw new ValidationError('Paste the API key again to use a new endpoint.');
      else throw new ValidationError(`Paste your ${info.name} API key.`);
    }

    const check = await validateLlmKey({ provider: info.id, apiKey, model, baseUrl });
    if (!check.ok) return res.status(400).json({ error: check.error, code: 'KEY_REJECTED' });

    company.set('providers.llm', {
      provider: info.id,
      model,
      baseUrl,
      keyEnc: encryptSecret(apiKey, keyContext(req.companyId!, 'llm')),
      keyHint: keyHint(apiKey),
      validatedAt: new Date(),
    });
    await company.save();
    afterProvidersChange(req.companyId!);
    res.json({ providers: providerSettings(company) });
  })
);

providersRouter.put(
  '/stt',
  validateLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = (req.body ?? {}) as { provider?: unknown; useLlmKey?: unknown };
    const info = getSttProvider(typeof body.provider === 'string' ? body.provider : undefined);
    if (!info) throw new ValidationError('Choose a transcription provider.');
    const company = await loadCompany(req);

    if (info.id === 'server') {
      if (!serverSttAvailable()) throw new ValidationError('This server does not host transcription.');
      company.set('providers.stt', { provider: 'server' });
      await company.save();
      afterProvidersChange(req.companyId!);
      return res.json({ providers: providerSettings(company) });
    }

    if (body.useLlmKey === true) {
      const llm = resolveProviders(company).llm;
      if (!llm || getLlmProvider(llm.provider)?.sttProvider !== info.id) {
        throw new ValidationError(`Your AI model's key isn't a ${info.id === 'groq' ? 'Groq' : 'OpenAI'} key, so it can't run ${info.name}. Paste a separate key instead.`);
      }
      company.set('providers.stt', { provider: info.id, model: info.defaultModel, useLlmKey: true });
      await company.save();
      afterProvidersChange(req.companyId!);
      return res.json({ providers: providerSettings(company) });
    }

    let apiKey = readKey(req.body);
    if (!apiKey) {
      const current = resolveProviders(company).stt;
      if (current && current.provider === info.id) apiKey = current.apiKey;
      else throw new ValidationError(`Paste your ${info.name} API key.`);
    }
    const check = await validateSttKey(info.id, apiKey);
    if (!check.ok) return res.status(400).json({ error: check.error, code: 'KEY_REJECTED' });

    company.set('providers.stt', {
      provider: info.id,
      model: info.defaultModel,
      useLlmKey: false,
      keyEnc: encryptSecret(apiKey, keyContext(req.companyId!, 'stt')),
      keyHint: keyHint(apiKey),
      validatedAt: new Date(),
    });
    await company.save();
    afterProvidersChange(req.companyId!);
    res.json({ providers: providerSettings(company) });
  })
);

const SLOTS: Record<string, string> = { 'meeting-bot': 'meetingBaas', llm: 'llm', stt: 'stt' };

providersRouter.delete(
  '/:slot',
  asyncHandler(async (req: AuthedRequest, res) => {
    const slot = SLOTS[req.params.slot];
    if (!slot) throw new NotFoundError('Provider');
    const company = await loadCompany(req);
    const removedKey = slot === 'meetingBaas' ? resolveProviders(company).meetingBaasKey : null;
    company.set(`providers.${slot}`, undefined);
    await company.save();
    // Without the key or another piece, Taro can't join meetings, so scheduled calendar bots are canceled.
    afterProvidersChange(req.companyId!, removedKey);
    res.json({ providers: providerSettings(company) });
  })
);
