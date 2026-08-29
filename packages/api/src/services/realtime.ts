/**
 * Realtime meeting sessions. MeetingBaas dials our WebSocket endpoint
 * (one shared bidirectional socket, the same shape its own reference bots
 * use) and streams 16 kHz s16le mono audio as binary frames plus speaker
 * roster updates as JSON text frames. We push the confirmation ding back
 * on the same socket.
 *
 * MeetingBaas connects while the bot is still in the lobby and reconnects
 * on the lobby -> admitted transition, so a session must outlive any single
 * socket: it only closes after a grace period with no sockets attached.
 *
 * Audio -> sherpa-onnx streaming ASR -> finalized utterances -> wake-word
 * scan -> execute command mid-meeting -> ding + Slack thread reply.
 */

import type { WebSocket } from 'ws';
import { MeetingModel } from '../db/models';
import { createAsrBackend, asrBackendLabel, type AsrBackend } from './asrBackend';
import { makeDingPcm } from './audio';
import { extractCommands } from './transcript';
import { executeCommand } from './executor';
import { SlackService } from './slack';
import { debugLog, captureAudio } from './debugLog';

// Rolling window of finalized speech kept per meeting for wake-word scans
const MAX_ROLLING_CHARS = 1000;
// How long a session waits for MeetingBaas to reconnect before giving up
const RECONNECT_GRACE_MS = 60_000;
const HEARTBEAT_MS = 30_000;
// Wait for speech to settle after a wake phrase before executing, so a command
// spoken across several finalized utterances assembles into one.
const COMMAND_DEBOUNCE_MS = 2_800;

const DING_PCM = makeDingPcm();

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
  private backend: AsrBackend | null = null;
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

  constructor(
    meetingId: string,
    private onClosed: () => void
  ) {
    this.meetingId = meetingId;
  }

  async init(): Promise<boolean> {
    const meeting = await MeetingModel.findById(this.meetingId);
    if (!meeting) {
      console.error(`[Realtime] No meeting found for ${this.meetingId}`);
      return false;
    }
    this.companyId = meeting.companyId;
    this.slackChannelId = meeting.slackChannelId ?? undefined;
    this.slackThreadTs = meeting.slackThreadTs ?? undefined;
    this.backend = createAsrBackend((text) => this.handleUtterance(text));
    if (!this.backend) {
      console.warn('[Realtime] ASR unavailable - live commands disabled for this meeting');
      return false;
    }
    console.log(`[Realtime] Session started for meeting ${this.meetingId} (ASR: ${asrBackendLabel()})`);
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
        if (this.audioSourceId === null) {
          this.audioSourceId = id;
          console.log(`[Realtime] Meeting audio arrives on socket #${id} (${direction})`);
          debugLog({ event: 'audio_source', meetingId: this.meetingId, direction, id });
        }
        if (this.audioSourceId === id) {
          this.onAudio(data);
        }
        return;
      }
      // Text frames: the stream header, then speaker roster updates
      const text = data.toString();
      console.log(`[Realtime] Event (${direction}): ${text.slice(0, 160)}`);
      debugLog({ event: 'text_frame', meetingId: this.meetingId, direction, id, raw: text.slice(0, 500) });
    });

    socket.on('close', () => {
      debugLog({ event: 'socket_closed', meetingId: this.meetingId, direction, id });
      this.sockets.delete(id);
      if (this.audioSourceId === id) {
        // The next socket to deliver audio becomes the source
        this.audioSourceId = null;
      }
      if (this.sockets.size === 0) {
        this.graceTimer = setTimeout(() => this.close(), RECONNECT_GRACE_MS);
      }
    });

    socket.on('error', (error: Error) => {
      console.error(`[Realtime] Socket error (${direction}) for ${this.meetingId}:`, error.message);
    });
  }

  private onAudio(chunk: Buffer) {
    if (this.closed || !this.backend) return;

    this.frames += 1;
    this.bytes += chunk.length;
    captureAudio(this.meetingId, chunk);
    if (!this.markedActive) {
      this.markedActive = true;
      MeetingModel.updateOne(
        { _id: this.meetingId, status: { $nin: ['ended', 'error'] } },
        { status: 'active', startedAt: new Date() }
      ).catch(() => {});
    }
    // Liveness for the dashboard: "audio is reaching Taro right now"
    const now = Date.now();
    if (now - this.lastLivenessWrite > 3000) {
      this.lastLivenessWrite = now;
      MeetingModel.updateOne({ _id: this.meetingId }, { lastAudioAt: new Date(now) }).catch(() => {});
    }
    if (this.frames === 1 || this.frames % 200 === 0) {
      // Sampled mean amplitude: 0 = pure silence arriving
      let sum = 0;
      let n = 0;
      for (let i = 0; i + 1 < chunk.length; i += 100) {
        sum += Math.abs(chunk.readInt16LE(i));
        n += 1;
      }
      debugLog({
        event: 'audio_stats',
        meetingId: this.meetingId,
        frames: this.frames,
        bytes: this.bytes,
        chunkBytes: chunk.length,
        meanAbs: n ? Math.round(sum / n) : 0,
      });
    }

    this.backend.push(chunk);
  }

  private handleUtterance(finalized: string) {
    if (this.closed) return;

    console.log(`[Realtime] Utterance: "${finalized}"`);
    debugLog({ event: 'utterance', meetingId: this.meetingId, text: finalized });
    this.liveTranscript = `${this.liveTranscript} ${finalized}`.trim();
    this.rollingText = `${this.rollingText} ${finalized}`.trim().slice(-MAX_ROLLING_CHARS);
    MeetingModel.updateOne(
      { _id: this.meetingId },
      { liveTranscript: this.liveTranscript.slice(-4000), lastAudioAt: new Date() }
    ).catch(() => {});

    // Re-arm the debounce on the latest wake phrase's command-so-far, so fragmented
    // utterances only execute once the speaker pauses.
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
    // Reset the wake-scan buffer so the same wake phrase can't re-fire.
    this.rollingText = '';
    this.executing = this.executing.then(() => this.runCommand(command));
  }

  private async runCommand(command: string) {
    if (!this.companyId) return;
    console.log(`[Realtime] 🎤 Live command: "${command}"`);
    debugLog({ event: 'live_command', meetingId: this.meetingId, command });

    const result = await executeCommand(
      this.meetingId,
      this.companyId,
      command,
      'live',
      this.liveTranscript.slice(-3000)
    );
    console.log(`[Realtime] ${result.summary}`);
    debugLog({ event: 'command_result', meetingId: this.meetingId, status: result.status, summary: result.summary });

    if (result.status === 'success') {
      this.playDing();
    }
    // Tell the thread right away instead of waiting for the meeting to end
    this.postThreadUpdate(result.summary).catch((error) =>
      console.error('[Realtime] Thread update failed:', error)
    );
  }

  private async postThreadUpdate(summary: string) {
    if (!this.companyId || !this.slackChannelId || !this.slackThreadTs) return;
    const slack = await SlackService.fromCompanyId(this.companyId);
    if (!slack) return;
    await slack.postToChannelId(this.slackChannelId, `🎤 ${summary}`, this.slackThreadTs);
  }

  private playDing() {
    // Prefer a socket other than the audio source; on a single shared socket
    // the audio socket is also the way back in.
    const open = [...this.sockets.entries()].filter(
      ([, a]) => a.socket.readyState === a.socket.OPEN
    );
    let targets = open.filter(([id]) => id !== this.audioSourceId);
    if (targets.length === 0) targets = open;

    if (targets.length === 0) {
      console.log('[Realtime] No stream connected - skipping ding');
      debugLog({ event: 'ding_skipped', meetingId: this.meetingId });
      return;
    }
    for (const [, a] of targets) {
      try {
        a.socket.send(DING_PCM);
      } catch (error) {
        console.error('[Realtime] Failed to send ding:', error);
      }
    }
    console.log('[Realtime] 🔔 Ding sent to meeting');
    debugLog({ event: 'ding_sent', meetingId: this.meetingId, targets: targets.map(([, a]) => a.direction) });
  }

  /** Used by the webhook to skip re-executing commands already run live. */
  get liveCommandCount(): number {
    return this.executed.size;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.graceTimer) clearTimeout(this.graceTimer);
    // Execute anything still pending (speaker finished right as the call ended)
    if (this.commandTimer) {
      clearTimeout(this.commandTimer);
      this.flushCommand();
    }
    this.backend?.destroy();
    console.log(
      `[Realtime] Session closed for meeting ${this.meetingId} ` +
        `(${this.executed.size} live command(s), ${this.liveTranscript.length} chars heard)`
    );
    debugLog({
      event: 'session_close',
      meetingId: this.meetingId,
      frames: this.frames,
      bytes: this.bytes,
      liveCommands: this.executed.size,
      heard: this.liveTranscript.slice(0, 2000),
    });
    // The audio socket dropping (after the reconnect grace) is our reliable "call
    // over" signal, since v2 doesn't always send bot.completed.
    MeetingModel.updateOne(
      { _id: this.meetingId, status: { $in: ['pending', 'joining', 'active'] } },
      { status: 'ended', endedAt: new Date() }
    ).catch(() => {});
    this.onClosed();
  }
}

class RealtimeSessionManager {
  private sessions = new Map<string, RealtimeSession>();

  async handleConnection(meetingId: string, direction: Direction, socket: WebSocket) {
    let session = this.sessions.get(meetingId);
    if (!session) {
      session = new RealtimeSession(meetingId, () => this.sessions.delete(meetingId));
      this.sessions.set(meetingId, session);
      const ok = await session.init();
      if (!ok) {
        this.sessions.delete(meetingId);
        socket.close();
        return;
      }
    }
    session.addSocket(direction, socket);
  }

  liveCommandCount(meetingId: string): number {
    return this.sessions.get(meetingId)?.liveCommandCount ?? 0;
  }
}

export const realtimeSessions = new RealtimeSessionManager();
