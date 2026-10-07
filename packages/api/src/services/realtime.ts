/**
 * Realtime meeting sessions. MeetingBaas dials our WebSocket endpoints and
 * streams 16 kHz s16le mono audio as binary frames (plus roster updates as
 * text frames); we push the confirmation ding back the same way.
 *
 * MeetingBaas connects while the bot is still in the lobby and reconnects on
 * the lobby to admitted transition, so a session outlives any single socket
 * and only closes after a grace period with no sockets attached.
 *
 * Audio -> the workspace's transcription -> finalized utterances -> wake-word
 * scan -> the workspace's AI model -> action -> ding + Slack thread reply.
 */

import type { WebSocket } from 'ws';
import { COPY } from '@taro/shared';
import { MeetingModel } from '../db/models';
import { safeEqual, sha256 } from '../lib/crypto';
import { log, errorMessage } from '../lib/logger';
import { createSttBackend, type SttBackend } from './stt';
import { CHIME_PCM } from './chime';
import { extractCommands } from './transcript';
import { executeCommand } from './executor';
import { SlackService } from './slack';
import { loadProviders } from './workspaceProviders';
import type { LlmConfig } from './llm';
import { debugLog } from './debugLog';

// Rolling window of finalized speech kept per meeting for wake-word scans
const MAX_ROLLING_CHARS = 1000;
// How long a session waits for MeetingBaas to reconnect before giving up
const RECONNECT_GRACE_MS = 60_000;
const HEARTBEAT_MS = 30_000;
// Wait for speech to settle after a wake phrase so a command spoken across
// several utterances assembles into one before it runs.
const COMMAND_DEBOUNCE_MS = 2_800;

// The stale sweep's thresholds. A bot waits at most 10 minutes in a lobby
// (see timeout_config in meetingbaas.ts), so 45 minutes with no audio at all is safe.
const STALE_AUDIO_MS = 10 * 60 * 1000;
const NEVER_ADMITTED_MS = 45 * 60 * 1000;


export type Direction = 'in' | 'out' | 'shared';

interface Attached {
  direction: Direction;
  socket: WebSocket;
}

class RealtimeSession {
  readonly meetingId: string;
  private companyId: string | null = null;
  private slackChannelId?: string;
  private slackThreadTs?: string;
  private llm: LlmConfig | null = null;
  private backend: SttBackend | null = null;
  private rollingText = '';
  private liveTranscript = '';
  private executed = new Set<string>();
  private executing = Promise.resolve();
  private pendingCommand: string | null = null;
  private commandTimer: NodeJS.Timeout | null = null;
  private sockets = new Map<number, Attached>();
  private nextSocketId = 1;
  private audioSourceId: number | null = null;
  private closed = false;
  private frames = 0;
  private bytes = 0;
  private markedActive = false;
  private graceTimer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private lastLivenessWrite = 0;
  private reportedFatal = false;

  constructor(
    meetingId: string,
    private onClosed: () => void
  ) {
    this.meetingId = meetingId;
  }

  async init(): Promise<boolean> {
    const meeting = await MeetingModel.findById(this.meetingId);
    if (!meeting) {
      log.warn(`[Realtime] No meeting found for ${this.meetingId}`);
      return false;
    }
    this.companyId = meeting.companyId;
    this.slackChannelId = meeting.slackChannelId ?? undefined;
    this.slackThreadTs = meeting.slackThreadTs ?? undefined;
    // Picking up after a restart or a long reconnect: keep what was already heard
    this.liveTranscript = meeting.liveTranscript ?? '';
    this.markedActive = meeting.status === 'active';

    const providers = await loadProviders(meeting.companyId);
    this.llm = providers?.llm ?? null;
    this.backend = createSttBackend(
      providers?.stt ?? null,
      (text) => this.handleUtterance(text),
      (message) => this.reportFatal(message)
    );
    if (!this.backend) {
      log.warn(`[Realtime] Meeting ${this.meetingId} has no transcription configured, so live commands are off`);
      this.reportFatal(COPY.noTranscription);
      return false;
    }
    log.info(`[Realtime] Session started for meeting ${this.meetingId} (${this.backend.label})`);
    debugLog({ event: 'session_start', meetingId: this.meetingId });
    this.heartbeat = setInterval(() => {
      debugLog({
        event: 'heartbeat',
        meetingId: this.meetingId,
        sockets: [...this.sockets.values()].map((a) => a.direction),
        frames: this.frames,
        bytes: this.bytes,
      });
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
    return true;
  }

  addSocket(direction: Direction, socket: WebSocket) {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    const id = this.nextSocketId++;
    this.sockets.set(id, { direction, socket });
    debugLog({ event: 'socket_connected', meetingId: this.meetingId, direction, id });

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        // Whichever socket delivers audio first is the source; the other carries the ding.
        if (this.audioSourceId === null) {
          this.audioSourceId = id;
          debugLog({ event: 'audio_source', meetingId: this.meetingId, direction, id });
        }
        if (this.audioSourceId === id) this.onAudio(data);
        return;
      }
      debugLog({ event: 'text_frame', meetingId: this.meetingId, direction, id, raw: data.toString().slice(0, 500) });
    });

    socket.on('close', () => {
      debugLog({ event: 'socket_closed', meetingId: this.meetingId, direction, id });
      this.sockets.delete(id);
      if (this.audioSourceId === id) this.audioSourceId = null;
      if (this.sockets.size === 0) {
        this.graceTimer = setTimeout(() => this.close(), RECONNECT_GRACE_MS);
      }
    });

    socket.on('error', (error: Error) => {
      log.warn(`[Realtime] Socket error (${direction}) for ${this.meetingId}: ${error.message}`);
    });
  }

  private onAudio(chunk: Buffer) {
    if (this.closed || !this.backend) return;

    this.frames += 1;
    this.bytes += chunk.length;
    if (!this.markedActive) {
      this.markedActive = true;
      MeetingModel.updateOne(
        { _id: this.meetingId, status: { $nin: ['ended', 'error'] } },
        { status: 'active', startedAt: new Date() }
      ).catch(() => {});
    }
    // Liveness for the dashboard ("audio is reaching Taro right now"), throttled
    const now = Date.now();
    if (now - this.lastLivenessWrite > 3000) {
      this.lastLivenessWrite = now;
      MeetingModel.updateOne({ _id: this.meetingId }, { lastAudioAt: new Date(now) }).catch(() => {});
    }

    this.backend.push(chunk);
  }

  private handleUtterance(finalized: string) {
    if (this.closed) return;

    log.debug(`[Realtime] Utterance: "${finalized}"`);
    debugLog({ event: 'utterance', meetingId: this.meetingId, text: finalized });
    this.liveTranscript = `${this.liveTranscript} ${finalized}`.trim();
    this.rollingText = `${this.rollingText} ${finalized}`.trim().slice(-MAX_ROLLING_CHARS);
    MeetingModel.updateOne(
      { _id: this.meetingId },
      { liveTranscript: this.liveTranscript.slice(-4000), lastAudioAt: new Date() }
    ).catch(() => {});

    // Re-arm the debounce on the latest wake phrase, so fragmented utterances
    // only execute once the speaker pauses.
    const commands = extractCommands(this.rollingText);
    if (commands.length > 0) {
      const latest = commands[commands.length - 1];
      if (!this.executed.has(latest)) {
        this.pendingCommand = latest;
        if (this.commandTimer) clearTimeout(this.commandTimer);
        this.commandTimer = setTimeout(() => this.flushCommand(), COMMAND_DEBOUNCE_MS);
      }
    }
  }

  private flushCommand() {
    this.commandTimer = null;
    const command = this.pendingCommand;
    this.pendingCommand = null;
    if (!command || this.executed.has(command)) return;
    this.executed.add(command);
    // Reset the wake-scan buffer so the same wake phrase can't fire twice.
    this.rollingText = '';
    this.executing = this.executing.then(() => this.runCommand(command));
  }

  private async runCommand(command: string) {
    if (!this.companyId) return;
    log.debug(`[Realtime] Live command for ${this.meetingId}: "${command}"`);
    debugLog({ event: 'live_command', meetingId: this.meetingId, command });

    const result = await executeCommand(
      this.meetingId,
      this.companyId,
      command,
      'live',
      this.liveTranscript.slice(-3000),
      this.llm
    );
    log.info(`[Realtime] Command in ${this.meetingId} finished: ${result.status}`);
    debugLog({ event: 'command_result', meetingId: this.meetingId, status: result.status, summary: result.summary });

    if (result.status === 'success') this.playDing();
    // Tell the thread right away instead of waiting for the meeting to end
    this.postThreadUpdate(result.summary).catch((error) =>
      log.warn('[Realtime] Thread update failed:', errorMessage(error))
    );
  }

  private reportFatal(message: string) {
    if (this.reportedFatal) return;
    this.reportedFatal = true;
    MeetingModel.updateOne({ _id: this.meetingId }, { errorMessage: message }).catch(() => {});
    this.postThreadUpdate(message).catch(() => {});
  }

  private async postThreadUpdate(text: string) {
    if (!this.companyId || !this.slackChannelId || !this.slackThreadTs) return;
    const slack = await SlackService.fromCompanyId(this.companyId);
    if (!slack) return;
    await slack.postToChannelId(this.slackChannelId, text, this.slackThreadTs);
  }

  private playDing() {
    // Prefer a socket other than the audio source; on a single shared socket
    // the audio socket is also the way back in.
    const open = [...this.sockets.entries()].filter(([, a]) => a.socket.readyState === a.socket.OPEN);
    let targets = open.filter(([id]) => id !== this.audioSourceId);
    if (targets.length === 0) targets = open;
    if (targets.length === 0) {
      debugLog({ event: 'ding_skipped', meetingId: this.meetingId });
      return;
    }
    for (const [, a] of targets) {
      try {
        a.socket.send(CHIME_PCM);
      } catch (error) {
        log.warn('[Realtime] Failed to send ding:', errorMessage(error));
      }
    }
    debugLog({ event: 'ding_sent', meetingId: this.meetingId, targets: targets.map(([, a]) => a.direction) });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.graceTimer) clearTimeout(this.graceTimer);
    // Run anything still pending (the speaker finished right as the call ended)
    if (this.commandTimer) {
      clearTimeout(this.commandTimer);
      this.flushCommand();
    }
    this.backend?.destroy();
    log.info(
      `[Realtime] Session closed for meeting ${this.meetingId} ` +
        `(${this.executed.size} live command(s), ${this.liveTranscript.length} chars heard)`
    );
    debugLog({
      event: 'session_close',
      meetingId: this.meetingId,
      frames: this.frames,
      bytes: this.bytes,
      liveCommands: this.executed.size,
    });
    // Status is deliberately left alone: a quiet socket or a deploy isn't the end of
    // the call. bot.completed, "Make Taro leave", or the stale sweep ends it.
    this.onClosed();
  }
}

class RealtimeSessionManager {
  private sessions = new Map<string, RealtimeSession>();
  private initializing = new Map<string, Promise<RealtimeSession | null>>();

  /** Only MeetingBaas, holding this meeting's secret, may open its audio sockets. */
  async authorize(meetingId: string, token: string): Promise<boolean> {
    const meeting = await MeetingModel.findById(meetingId).select('+secretHash status');
    if (!meeting?.secretHash) return false;
    if (meeting.status === 'ended' || meeting.status === 'error') return false;
    return safeEqual(sha256(token), meeting.secretHash);
  }

  async handleConnection(meetingId: string, direction: Direction, socket: WebSocket) {
    let session = this.sessions.get(meetingId);
    if (!session) {
      // MeetingBaas opens the in and out sockets together; share one init between them.
      let pending = this.initializing.get(meetingId);
      if (!pending) {
        pending = (async () => {
          const created = new RealtimeSession(meetingId, () => this.sessions.delete(meetingId));
          const ok = await created.init();
          if (ok) this.sessions.set(meetingId, created);
          return ok ? created : null;
        })().finally(() => this.initializing.delete(meetingId));
        this.initializing.set(meetingId, pending);
      }
      session = (await pending) ?? undefined;
      if (!session) {
        socket.close();
        return;
      }
    }
    session.addSocket(direction, socket);
  }

  get activeCount(): number {
    return this.sessions.size;
  }

  /**
   * Ends meetings whose audio stopped without a completion callback (the bot
   * was removed, the call died), so they don't show as live forever. Meetings
   * with a session on this instance are left alone.
   */
  async sweepStale(): Promise<void> {
    const now = Date.now();
    const stale = await MeetingModel.find({
      status: { $in: ['pending', 'joining', 'active'] },
      $or: [
        { lastAudioAt: { $lt: new Date(now - STALE_AUDIO_MS) } },
        { lastAudioAt: { $exists: false }, createdAt: { $lt: new Date(now - NEVER_ADMITTED_MS) } },
      ],
    })
      .select('_id')
      .limit(500)
      .lean();
    const ids = stale.map((m) => String(m._id)).filter((id) => !this.sessions.has(id));
    if (ids.length === 0) return;
    await MeetingModel.updateMany(
      { _id: { $in: ids }, status: { $in: ['pending', 'joining', 'active'] } },
      { status: 'ended', endedAt: new Date(now) }
    );
    log.info(`[Realtime] Closed out ${ids.length} meeting(s) that stopped sending audio`);
  }

  closeAll() {
    for (const session of this.sessions.values()) session.close();
  }
}

export const realtimeSessions = new RealtimeSessionManager();
