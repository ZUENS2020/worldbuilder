/**
 * Markdown — the single, system-wide Markdown renderer.
 *
 * Inspector property lists, AI review, and settings.
 * Inspector backstory / AI results, editor modal preview) renders through
 * THIS component. No other file imports `react-markdown` / `remark-*` or
 * writes its own preprocessing — all normalization lives in
 * `normalizeMarkdown` below so behaviour is identical everywhere.
 */

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const HEADING = /^\s{0,3}#{1,6}\s/;
const LIST = /^\s{0,3}([-*+]\s|\d+[.)]\s)/;
const QUOTE = /^\s{0,3}>/;
const TABLE = /^\s*\|/;
const HR = /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s{0,3}(```|~~~)/;

/** A line that starts a block-level construct (not plain prose). */
function isBlockLine(line: string): boolean {
  return (
    HEADING.test(line) ||
    LIST.test(line) ||
    QUOTE.test(line) ||
    TABLE.test(line) ||
    HR.test(line)
  );
}

/**
 * Normalize a chunk of plain prose (no fenced code blocks inside):
 *  - strip trailing whitespace
 *  - ensure a blank line around block-level constructs
 *  - promote single newlines between two prose lines to paragraph breaks
 *    (so AI output that separates paragraphs with a single \n renders with
 *     proper <p> spacing instead of being crammed together)
 *  - collapse 3+ blank lines to 2
 */
function normalizeProse(text: string): string {
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''));
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    out.push(cur);
    const next = lines[i + 1];
    if (next === undefined) break;

    const curBlank = cur.trim() === '';
    const nextBlank = next.trim() === '';
    if (curBlank || nextBlank) continue; // a blank already separates them

    const curBlock = isBlockLine(cur);
    const nextBlock = isBlockLine(next);

    // Insert a blank line when:
    //  - either side is a block construct (keep blocks isolated), OR
    //  - both are plain prose (single newline → new paragraph)
    if (curBlock || nextBlock || (!curBlock && !nextBlock)) {
      out.push('');
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * The one and only Markdown normalizer. Splits out fenced code blocks and
 * leaves them untouched, normalizing only the prose in between.
 */
export function normalizeMarkdown(text: string): string {
  if (!text) return '';
  const lines = text.split('\n');
  const segments: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  let fenceMarker = '';

  const flushProse = () => {
    if (buf.length) {
      segments.push(normalizeProse(buf.join('\n')));
      buf = [];
    }
  };

  for (const line of lines) {
    if (!inFence && FENCE.test(line)) {
      flushProse();
      inFence = true;
      fenceMarker = line.trim().slice(0, 3);
      segments.push(line);
    } else if (inFence) {
      segments.push(line);
      if (line.trim().startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = '';
      }
    } else {
      buf.push(line);
    }
  }
  flushProse();

  return segments.join('\n');
}

interface MarkdownProps {
  children: string | null | undefined;
  className?: string;
  style?: React.CSSProperties;
}

function Markdown({ children, className, style }: MarkdownProps) {
  return (
    <div className={`md-body${className ? ` ${className}` : ''}`} style={style}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {normalizeMarkdown(children ?? '')}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
