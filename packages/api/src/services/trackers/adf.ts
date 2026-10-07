/**
 * Jira's REST API takes rich text as Atlassian Document Format, not markdown. Taro's model writes
 * markdown (headings, bullet and numbered lists, checklists, bold, inline code, links), so this
 * turns that subset into ADF. Anything else stays as plain text.
 */

type Mark = { type: 'strong' } | { type: 'code' } | { type: 'link'; attrs: { href: string } };
export interface AdfText {
  type: 'text';
  text: string;
  marks?: Mark[];
}
export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Array<AdfNode | AdfText>;
}
export interface AdfDoc {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function inline(text: string): AdfText[] {
  const out: AdfText[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1]) out.push({ type: 'text', text: m[1], marks: [{ type: 'strong' }] });
    else if (m[2]) out.push({ type: 'text', text: m[2], marks: [{ type: 'code' }] });
    else out.push({ type: 'text', text: m[3], marks: [{ type: 'link', attrs: { href: m[4] } }] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out.filter((t) => t.text.length > 0);
}

const paragraph = (text: string): AdfNode => {
  const content = inline(text);
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
};

export function markdownToAdf(markdown: string): AdfDoc {
  const content: AdfNode[] = [];
  let list: AdfNode | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) content.push(paragraph(para.join(' ')));
    para = [];
  };
  const flushList = () => {
    if (list) content.push(list);
    list = null;
  };

  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);

    if (!line.trim() || /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushPara();
      flushList();
      if (line.trim() && content.length) content.push({ type: 'rule' });
    } else if (heading) {
      flushPara();
      flushList();
      content.push({ type: 'heading', attrs: { level: heading[1].length }, content: inline(heading[2]) });
    } else if (bullet || numbered) {
      flushPara();
      const kind = bullet ? 'bulletList' : 'orderedList';
      if (list && list.type !== kind) flushList();
      list ??= { type: kind, content: [] };
      // Checklists read as boxes; Jira's own task lists aren't allowed in issue descriptions
      const text = bullet ? `${bullet[1] === undefined ? '' : bullet[1] === ' ' ? '☐ ' : '☑ '}${bullet[2]}` : numbered![1];
      list.content!.push({ type: 'listItem', content: [paragraph(text)] });
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph' }] };
}
