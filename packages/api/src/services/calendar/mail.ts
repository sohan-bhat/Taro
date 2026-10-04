/**
 * Turns what a mail provider posts into the three things Taro reads from an invitation: who sent
 * it, who it was addressed to, and its text/calendar parts. Everything else in the mail (bodies,
 * other attachments, links) is ignored. Two shapes arrive: Postmark's inbound JSON, and a raw
 * MIME message (a Cloudflare Email Worker, or any provider that forwards mail as is).
 */

import PostalMime, { type Address } from 'postal-mime';
import { emailFrom } from './ics';

export interface InboundMail {
  // The From address, lowercased
  from?: string;
  // Envelope recipients first, then To and Cc, lowercased and deduplicated
  recipients: string[];
  // The text of each calendar part, duplicates removed
  calendars: string[];
}

const MAX_CALENDARS = 4;
const MAX_CALENDAR_BYTES = 512 * 1024;
const MAX_RECIPIENTS = 50;
const MAX_RAW_CHARS = 12 * 1024 * 1024;

/** text/calendar, application/ics, or a file named .ics. */
export function isCalendarPart(mimeType: unknown, filename?: unknown): boolean {
  const type = typeof mimeType === 'string' ? mimeType.split(';')[0].trim().toLowerCase() : '';
  if (type === 'text/calendar' || type === 'application/ics' || type === 'text/x-vcalendar') return true;
  return typeof filename === 'string' && /\.ics$/i.test(filename.trim());
}

function collect(into: Set<string>, value: unknown) {
  if (into.size >= MAX_RECIPIENTS) return;
  const email = emailFrom(value);
  if (email) into.add(email);
}

function flatten(addresses: Address[] | undefined): string[] {
  const out: string[] = [];
  for (const address of addresses ?? []) {
    if (address.group) out.push(...address.group.map((member) => member.address));
    else if (address.address) out.push(address.address);
  }
  return out;
}

function decodeText(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CALENDAR_BYTES) return null;
  return new TextDecoder('utf-8').decode(bytes);
}

function addCalendar(calendars: string[], text: string | null) {
  if (!text || calendars.length >= MAX_CALENDARS) return;
  // Calendar mail often carries the same invitation twice: inline, and as invite.ics.
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized && !calendars.some((c) => c.replace(/\r\n/g, '\n').trim() === normalized)) calendars.push(text);
}

/** A raw message, as a Cloudflare Email Worker or Postmark's RawEmail delivers it. */
export async function readRawMail(raw: Buffer | string, envelopeTo: string[] = []): Promise<InboundMail> {
  if (raw.length > MAX_RAW_CHARS) return { recipients: [], calendars: [] };
  // A message forwarded as an attachment is read too, so a member can forward an invitation to Taro.
  const email = await PostalMime.parse(raw, {
    attachmentEncoding: 'arraybuffer',
    maxNestingDepth: 20,
    maxHeadersSize: 256 * 1024,
  });

  const recipients = new Set<string>();
  for (const address of [...envelopeTo, email.deliveredTo, ...flatten(email.to), ...flatten(email.cc)]) collect(recipients, address);

  const calendars: string[] = [];
  for (const part of email.attachments) {
    if (!isCalendarPart(part.mimeType, part.filename)) continue;
    const content = part.content;
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content as ArrayBuffer);
    addCalendar(calendars, decodeText(bytes));
  }

  const sender = email.from && !email.from.group ? email.from.address : undefined;
  return { from: emailFrom(sender), recipients: [...recipients], calendars };
}

interface PostmarkAddress {
  Email?: unknown;
}

interface PostmarkAttachment {
  Name?: unknown;
  Content?: unknown;
  ContentType?: unknown;
}

const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value.slice(0, MAX_RECIPIENTS) as T[]) : []);

function looksLikePostmark(body: unknown): body is Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  return 'FromFull' in b || 'ToFull' in b || 'OriginalRecipient' in b || 'RawEmail' in b;
}

/**
 * Postmark's inbound JSON. With "include raw email content" on, RawEmail carries the whole message,
 * which is the only way to see a calendar part Outlook sends inline rather than as a file.
 */
export async function readPostmark(body: unknown): Promise<InboundMail | null> {
  if (!looksLikePostmark(body)) return null;
  const envelope = [body.OriginalRecipient].filter((v): v is string => typeof v === 'string');

  if (typeof body.RawEmail === 'string' && body.RawEmail) {
    const mail = await readRawMail(body.RawEmail, envelope);
    if (mail.calendars.length > 0) return mail;
  }

  const recipients = new Set<string>();
  collect(recipients, body.OriginalRecipient);
  for (const field of ['ToFull', 'CcFull', 'BccFull']) {
    for (const address of list<PostmarkAddress>(body[field])) collect(recipients, address?.Email);
  }

  const calendars: string[] = [];
  for (const attachment of list<PostmarkAttachment>(body.Attachments)) {
    if (!attachment || !isCalendarPart(attachment.ContentType, attachment.Name)) continue;
    if (typeof attachment.Content !== 'string' || attachment.Content.length > (MAX_CALENDAR_BYTES * 4) / 3 + 4) continue;
    addCalendar(calendars, decodeText(Buffer.from(attachment.Content, 'base64')));
  }

  const fromFull = body.FromFull as PostmarkAddress | undefined;
  return { from: emailFrom(fromFull?.Email ?? body.From), recipients: [...recipients], calendars };
}
