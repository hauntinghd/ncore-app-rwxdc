/**
 * NCore message markdown
 *
 * Discord-flavoured subset:
 *   **bold**            *italic*            ~~strike~~          ||spoiler||
 *   `inline code`       ```code fence```    > blockquote
 *   [text](url)         autolink            @mentions / <@uuid>  / <#channel>
 *
 * The parser produces a tree of {@link MarkdownNode}s. The renderer in
 * {@link MarkdownContent.tsx} walks the tree and emits React nodes.
 *
 * Mentions are NOT re-parsed here - we leave them as plain runs so the
 * existing `lib/mentions.ts` segment splitter can decorate them in the
 * renderer. Code blocks short-circuit all formatting (Discord behaviour).
 */
import { splitMentionText } from './mentions';

// ---------------------------------------------------------------------------
// Tree shape
// ---------------------------------------------------------------------------

export type InlineMark = 'bold' | 'italic' | 'strike' | 'spoiler' | 'inlineCode';

export type MarkdownNode =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string }
  | { type: 'link'; href: string; children: MarkdownNode[] }
  | { type: 'autolink'; href: string }
  | { type: 'softbreak' }
  | { type: 'hardbreak' }
  | { type: 'mark'; mark: InlineMark; children: MarkdownNode[] }
  | { type: 'codeblock'; lang?: string | null; value: string }
  | { type: 'blockquote'; children: MarkdownNode[] };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseMarkdown(input: unknown): MarkdownNode[] {
  const text = String(input ?? '');
  if (!text) return [];

  const blocks = splitBlocks(text);
  const nodes: MarkdownNode[] = [];

  for (const block of blocks) {
    if (block.kind === 'codefence') {
      nodes.push({ type: 'codeblock', lang: block.lang, value: block.value });
      continue;
    }
    if (block.kind === 'blockquote') {
      const inner = parseInlineWithMentions(block.value);
      nodes.push({ type: 'blockquote', children: inner });
      continue;
    }
    const inline = parseInlineWithMentions(block.value);
    if (inline.length > 0) nodes.push(...inline);
    if (block.trailingBreak) nodes.push({ type: 'hardbreak' });
  }

  return nodes;
}

/**
 * Strip markdown to a plain-text approximation. Used for push notification
 * previews and unread-message summaries.
 */
export function stripMarkdown(input: unknown, maxLength = 140): string {
  const nodes = parseMarkdown(input);
  const acc: string[] = [];
  walk(nodes);
  let out = acc.join('').replace(/\s+/g, ' ').trim();
  if (out.length > maxLength) out = out.slice(0, Math.max(0, maxLength - 1)) + '\u2026';
  return out;

  function walk(list: MarkdownNode[]) {
    for (const node of list) {
      switch (node.type) {
        case 'text':
        case 'mention':
          acc.push(node.value);
          break;
        case 'autolink':
          acc.push(node.href);
          break;
        case 'codeblock':
          acc.push(node.value);
          break;
        case 'softbreak':
        case 'hardbreak':
          acc.push(' ');
          break;
        case 'link':
          walk(node.children);
          break;
        case 'mark':
        case 'blockquote':
          walk(node.children);
          break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Block-level pass: code fences, blockquotes, raw paragraphs
// ---------------------------------------------------------------------------

interface RawBlock {
  kind: 'paragraph' | 'codefence' | 'blockquote';
  value: string;
  lang?: string | null;
  trailingBreak?: boolean;
}

function splitBlocks(text: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  const lines = text.split(/\r?\n/);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // ```lang code fence
    const fenceMatch = /^```([\w+\-.]*)\s*$/.exec(line);
    if (fenceMatch) {
      const lang = fenceMatch[1] || null;
      const buf: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) {
        buf.push(lines[j]);
        j += 1;
      }
      blocks.push({ kind: 'codefence', value: buf.join('\n'), lang });
      i = j + 1; // skip closing fence (or end)
      continue;
    }

    // > blockquote (consume contiguous quoted lines)
    if (/^> ?/.test(line)) {
      const buf: string[] = [];
      let j = i;
      while (j < lines.length && /^> ?/.test(lines[j])) {
        buf.push(lines[j].replace(/^> ?/, ''));
        j += 1;
      }
      blocks.push({ kind: 'blockquote', value: buf.join('\n') });
      i = j;
      continue;
    }

    // Paragraph (consume contiguous non-blank, non-special lines)
    const buf: string[] = [];
    let j = i;
    while (j < lines.length) {
      const l = lines[j];
      if (l === '') break;
      if (/^```[\w+\-.]*\s*$/.test(l)) break;
      if (/^> ?/.test(l)) break;
      buf.push(l);
      j += 1;
    }
    if (buf.length > 0) {
      // preserve trailing blank lines as paragraph breaks (one hardbreak per gap)
      let trailingBreak = false;
      let k = j;
      while (k < lines.length && lines[k] === '') {
        trailingBreak = true;
        k += 1;
      }
      blocks.push({ kind: 'paragraph', value: buf.join('\n'), trailingBreak });
      i = k;
    } else {
      i = j + 1;
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Inline-level pass: emphasis, links, autolinks, inline code
// ---------------------------------------------------------------------------

function parseInlineWithMentions(text: string): MarkdownNode[] {
  // First slice out fenced inline code (`...`) ranges so we don't match
  // markdown inside them.
  const segments: Array<{ kind: 'plain' | 'code'; value: string }> = [];
  const codeRe = /(`+)([^`\n][\s\S]*?)\1/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(text))) {
    if (m.index > last) segments.push({ kind: 'plain', value: text.slice(last, m.index) });
    segments.push({ kind: 'code', value: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ kind: 'plain', value: text.slice(last) });

  const out: MarkdownNode[] = [];
  for (const seg of segments) {
    if (seg.kind === 'code') {
      out.push({ type: 'mark', mark: 'inlineCode', children: [{ type: 'text', value: seg.value }] });
      continue;
    }
    parseInlinePlain(seg.value, out);
  }
  return out;
}

function parseInlinePlain(text: string, out: MarkdownNode[]) {
  // Walk char-by-char to pick out emphasis pairs, links, autolinks, breaks.
  let i = 0;
  let plainStart = 0;

  const flushPlain = (until: number) => {
    if (until > plainStart) {
      const slice = text.slice(plainStart, until);
      out.push(...mentionSplit(slice));
    }
  };

  while (i < text.length) {
    const ch = text[i];

    // Newline → softbreak (block-level breaks were already consumed)
    if (ch === '\n') {
      flushPlain(i);
      out.push({ type: 'softbreak' });
      i += 1;
      plainStart = i;
      continue;
    }

    // [text](url)
    if (ch === '[') {
      const close = findMatching(text, i, '[', ']');
      if (close > i && text[close + 1] === '(') {
        const urlClose = text.indexOf(')', close + 2);
        if (urlClose > close + 1) {
          const label = text.slice(i + 1, close);
          const url = text.slice(close + 2, urlClose).trim();
          if (url && /^[a-z][a-z0-9+.-]*:/i.test(url)) {
            flushPlain(i);
            out.push({ type: 'link', href: url, children: parseInlineWithMentions(label) });
            i = urlClose + 1;
            plainStart = i;
            continue;
          }
        }
      }
    }

    // Spoiler ||...||
    if (ch === '|' && text[i + 1] === '|') {
      const end = text.indexOf('||', i + 2);
      if (end > i + 2) {
        flushPlain(i);
        const inner = text.slice(i + 2, end);
        out.push({ type: 'mark', mark: 'spoiler', children: parseInlineWithMentions(inner) });
        i = end + 2;
        plainStart = i;
        continue;
      }
    }

    // Strike ~~...~~
    if (ch === '~' && text[i + 1] === '~') {
      const end = text.indexOf('~~', i + 2);
      if (end > i + 2) {
        flushPlain(i);
        const inner = text.slice(i + 2, end);
        out.push({ type: 'mark', mark: 'strike', children: parseInlineWithMentions(inner) });
        i = end + 2;
        plainStart = i;
        continue;
      }
    }

    // Bold **...** (must come before italic)
    if (ch === '*' && text[i + 1] === '*') {
      const end = findClose(text, i + 2, '**');
      if (end > i + 2) {
        flushPlain(i);
        const inner = text.slice(i + 2, end);
        out.push({ type: 'mark', mark: 'bold', children: parseInlineWithMentions(inner) });
        i = end + 2;
        plainStart = i;
        continue;
      }
    }

    // Bold __...__
    if (ch === '_' && text[i + 1] === '_') {
      const end = findClose(text, i + 2, '__');
      if (end > i + 2) {
        flushPlain(i);
        const inner = text.slice(i + 2, end);
        out.push({ type: 'mark', mark: 'bold', children: parseInlineWithMentions(inner) });
        i = end + 2;
        plainStart = i;
        continue;
      }
    }

    // Italic *...*
    if (ch === '*') {
      const end = findClose(text, i + 1, '*');
      if (end > i + 1 && /\S/.test(text.slice(i + 1, end))) {
        flushPlain(i);
        const inner = text.slice(i + 1, end);
        out.push({ type: 'mark', mark: 'italic', children: parseInlineWithMentions(inner) });
        i = end + 1;
        plainStart = i;
        continue;
      }
    }

    // Italic _..._  (only if surrounded by non-word boundaries)
    if (ch === '_') {
      const before = text[i - 1] || ' ';
      if (!/\w/.test(before)) {
        const end = findClose(text, i + 1, '_');
        if (end > i + 1) {
          const after = text[end + 1] || ' ';
          if (!/\w/.test(after)) {
            flushPlain(i);
            const inner = text.slice(i + 1, end);
            out.push({ type: 'mark', mark: 'italic', children: parseInlineWithMentions(inner) });
            i = end + 1;
            plainStart = i;
            continue;
          }
        }
      }
    }

    // Autolink http(s)://... or https URL terminator
    if (ch === 'h' || ch === 'H') {
      const m = /^(https?:\/\/[^\s<>"]+[^\s<>".,!?:;)\]}'])/i.exec(text.slice(i));
      if (m) {
        // Make sure preceding char isn't already part of a link/text run
        const before = text[i - 1] || ' ';
        if (!/[a-z0-9_/]/i.test(before) || before === ' ') {
          flushPlain(i);
          out.push({ type: 'autolink', href: m[1] });
          i += m[1].length;
          plainStart = i;
          continue;
        }
      }
    }

    i += 1;
  }

  flushPlain(text.length);
}

function mentionSplit(slice: string): MarkdownNode[] {
  if (!slice) return [];
  const segments = splitMentionText(slice);
  if (segments.length === 0) return [{ type: 'text', value: slice }];
  return segments.map((seg) =>
    seg.isMention
      ? ({ type: 'mention', value: seg.text } as const)
      : ({ type: 'text', value: seg.text } as const),
  );
}

// Find the matching closing bracket for a balanced delimiter pair.
function findMatching(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Find the next un-escaped occurrence of `marker` starting at `start`.
function findClose(text: string, start: number, marker: string): number {
  for (let i = start; i <= text.length - marker.length; i++) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text.startsWith(marker, i)) return i;
  }
  return -1;
}
