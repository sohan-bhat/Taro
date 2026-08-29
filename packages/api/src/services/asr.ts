/**
 * Local streaming speech-to-text via sherpa-onnx (zipformer transducer).
 * Runs fully in-process: no API keys, no network, $0.
 *
 * The recognizer is a heavyweight singleton (loads ~300MB of ONNX models);
 * each meeting gets its own lightweight stream from it.
 */

import path from 'path';
import fs from 'fs';
import { SAMPLE_RATE } from './audio';

// sherpa-onnx-node ships no TypeScript types
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MODEL_DIR = path.resolve(
  __dirname,
  '../../models/sherpa-onnx-streaming-zipformer-en-2023-06-26'
);

export interface AsrStream {
  /** Feed s16le-derived Float32 samples; returns finalized utterance text when an endpoint (pause) is reached, else null */
  accept(samples: Float32Array): string | null;
  destroy(): void;
}

interface SherpaOnlineStream {
  acceptWaveform(obj: { sampleRate: number; samples: Float32Array }): void;
}

interface SherpaOnlineRecognizer {
  createStream(): SherpaOnlineStream;
  isReady(s: SherpaOnlineStream): boolean;
  decode(s: SherpaOnlineStream): void;
  isEndpoint(s: SherpaOnlineStream): boolean;
  reset(s: SherpaOnlineStream): void;
  getResult(s: SherpaOnlineStream): { text: string };
}

let recognizer: SherpaOnlineRecognizer | null = null;
let loadFailed = false;

const F = `${MODEL_DIR}/encoder-epoch-99-avg-1-chunk-16-left-128.onnx`;
const F_JOIN = `${MODEL_DIR}/joiner-epoch-99-avg-1-chunk-16-left-128.onnx`;
const INT8_ENC = `${MODEL_DIR}/encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx`;
const INT8_JOIN = `${MODEL_DIR}/joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx`;
const DECODER = `${MODEL_DIR}/decoder-epoch-99-avg-1-chunk-16-left-128.onnx`;
const TOKENS = `${MODEL_DIR}/tokens.txt`;
// bpe.vocab (token + score per line), needed for hotword biasing, is generated
// once from bpe.model at setup (see README); if it's missing, skip the
// hotwords tier instead of crashing the native module.
const BPE_VOCAB = `${MODEL_DIR}/bpe.vocab`;
const HOTWORDS = path.resolve(__dirname, 'asr-hotwords.txt');
const HOTWORDS_OK = fs.existsSync(BPE_VOCAB) && fs.existsSync(HOTWORDS);

// Common endpoint rules (control when an utterance finalizes, not accuracy).
const ENDPOINT = {
  enableEndpoint: true,
  rule1MinTrailingSilence: 2.4, // from silence
  rule2MinTrailingSilence: 1.2, // mid-speech pause
  rule3MinUtteranceLength: 20,
};

// Config tiers, best accuracy first. Each falls back to the next if the
// native loader rejects it, so we never regress below today's working setup:
//   1. float models + beam search + hotword biasing (best)
//   2. float models + beam search (no hotwords)
//   3. int8 models + greedy (original, fastest, lowest accuracy)
function buildConfigs() {
  const base = (encoder: string, joiner: string, extraModel = {}) => ({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: { encoder, decoder: DECODER, joiner },
      tokens: TOKENS,
      numThreads: 4,
      provider: 'cpu',
      debug: 0,
      ...extraModel,
    },
    ...ENDPOINT,
  });
  const tiers = [];
  if (HOTWORDS_OK) {
    tiers.push({
      label: 'float + beam search + hotwords',
      config: {
        ...base(F, F_JOIN, { modelingUnit: 'bpe', bpeVocab: BPE_VOCAB }),
        decodingMethod: 'modified_beam_search',
        maxActivePaths: 6,
        hotwordsFile: HOTWORDS,
        hotwordsScore: 1.6,
      },
    });
  }
  tiers.push({
    label: 'float + beam search',
    config: { ...base(F, F_JOIN), decodingMethod: 'modified_beam_search', maxActivePaths: 6 },
  });
  tiers.push({
    label: 'int8 + greedy (fallback)',
    config: { ...base(INT8_ENC, INT8_JOIN), decodingMethod: 'greedy_search' },
  });
  return tiers;
}

function getRecognizer(): SherpaOnlineRecognizer | null {
  if (recognizer) return recognizer;
  if (loadFailed) return null;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let sherpa: { OnlineRecognizer: new (c: unknown) => SherpaOnlineRecognizer };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sherpa = require('sherpa-onnx-node');
  } catch (error) {
    loadFailed = true;
    console.error('═'.repeat(60));
    console.error('[ASR] ❌ Failed to load sherpa-onnx native module - realtime commands DISABLED.');
    console.error('[ASR] Post-meeting command processing still works.');
    console.error('[ASR]', error instanceof Error ? error.message : error);
    console.error('═'.repeat(60));
    return null;
  }

  for (const tier of buildConfigs()) {
    try {
      recognizer = new sherpa.OnlineRecognizer(tier.config);
      console.log(`[ASR] sherpa-onnx recognizer loaded (${tier.label})`);
      return recognizer;
    } catch (error) {
      console.warn(
        `[ASR] Config "${tier.label}" failed, trying next:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  loadFailed = true;
  console.error('[ASR] ❌ All recognizer configs failed - realtime commands DISABLED.');
  return null;
}

/** Whether the local ASR engine is available (models present, native lib loads). */
export function asrAvailable(): boolean {
  return getRecognizer() !== null;
}

export function createAsrStream(): AsrStream | null {
  const rec = getRecognizer();
  if (!rec) return null;

  const stream = rec.createStream();
  let destroyed = false;

  return {
    accept(samples: Float32Array): string | null {
      if (destroyed) return null;
      stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
      while (rec.isReady(stream)) rec.decode(stream);

      if (rec.isEndpoint(stream)) {
        const text = rec.getResult(stream).text.trim();
        rec.reset(stream);
        return text.length > 0 ? text : null;
      }
      return null;
    },
    destroy() {
      destroyed = true;
    },
  };
}
