import { Fragment, memo, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { parseMarkdown, type MarkdownNode } from '../../lib/markdown';
import { CUSTOM_EMOJI_TOKEN, isEmojiOnly, type CustomEmoji } from '../../lib/customEmoji';
import { useCustomEmojis } from '../../contexts/CustomEmojiContext';

interface MarkdownContentProps {
  content: string;
  className?: string;
  style?: CSSProperties;
  /**
   * Decorate a mention chunk (e.g. `@username`, `<@uuid>`, `@everyone`).
   * Defaults to a pill style consistent with the rest of the app.
   */
  renderMention?: (text: string) => ReactNode;
  /**
   * Per-link click handler; if it returns true the default href navigation
   * is prevented (e.g. for routing to a Cursor in-app modal). Defaults to a
   * regular `<a target="_blank" rel="noreferrer noopener">`.
   */
  onLinkClick?: (href: string, event: React.MouseEvent<HTMLAnchorElement>) => boolean | void;
}

const DEFAULT_LINK_CLASS =
  'text-nyptid-200 underline decoration-nyptid-300/40 underline-offset-2 hover:text-nyptid-100 hover:decoration-nyptid-200';
const DEFAULT_MENTION_CLASS = 'rounded-md bg-nyptid-300/18 px-1 py-0.5 font-medium text-nyptid-200';

function defaultRenderMention(text: string): ReactNode {
  return <span className={DEFAULT_MENTION_CLASS}>{text}</span>;
}

function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

interface RenderState {
  renderMention: (text: string) => ReactNode;
  onLinkClick?: MarkdownContentProps['onLinkClick'];
  emojiById: Map<string, CustomEmoji>;
  /** Emoji-only messages render large, the way Discord does. */
  jumbo: boolean;
}

/**
 * Replace `<:name:id>` tokens inside a text run with images.
 *
 * This runs on text nodes rather than in the markdown parser, so emoji work
 * inside bold, blockquotes, and links, but stay literal inside code spans and
 * fenced blocks — where a token is almost certainly being discussed, not used.
 */
function renderTextWithEmoji(value: string, state: RenderState, key: string): ReactNode {
  CUSTOM_EMOJI_TOKEN.lastIndex = 0;
  if (!CUSTOM_EMOJI_TOKEN.test(value)) return <Fragment key={key}>{value}</Fragment>;

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let index = 0;

  CUSTOM_EMOJI_TOKEN.lastIndex = 0;
  let match = CUSTOM_EMOJI_TOKEN.exec(value);

  while (match) {
    if (match.index > lastIndex) {
      parts.push(<Fragment key={`${key}-t${index}`}>{value.slice(lastIndex, match.index)}</Fragment>);
    }

    const [token, name, id] = match;
    const emoji = state.emojiById.get(id);
    const size = state.jumbo ? 'h-11 w-11' : 'h-[1.375em] w-[1.375em]';

    if (emoji) {
      parts.push(
        <img
          key={`${key}-e${index}`}
          src={emoji.imageUrl}
          alt={`:${name}:`}
          title={`:${name}:`}
          loading="lazy"
          draggable={false}
          className={`inline-block ${size} object-contain align-text-bottom`}
        />,
      );
    } else {
      // Emoji from a community the viewer is not in. Show the readable name
      // rather than a broken image or the raw token.
      parts.push(
        <span key={`${key}-e${index}`} className="text-surface-400" title="Emoji from another community">
          :{name}:
        </span>,
      );
    }

    lastIndex = match.index + token.length;
    index += 1;
    match = CUSTOM_EMOJI_TOKEN.exec(value);
  }

  if (lastIndex < value.length) {
    parts.push(<Fragment key={`${key}-t${index}`}>{value.slice(lastIndex)}</Fragment>);
  }

  return <Fragment key={key}>{parts}</Fragment>;
}

function renderNodes(nodes: MarkdownNode[], state: RenderState, keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case 'text':
        return renderTextWithEmoji(node.value, state, key);
      case 'mention':
        return <Fragment key={key}>{state.renderMention(node.value)}</Fragment>;
      case 'softbreak':
        return <Fragment key={key}>{'\n'}</Fragment>;
      case 'hardbreak':
        return (
          <Fragment key={key}>
            {'\n'}
            {'\n'}
          </Fragment>
        );
      case 'mark': {
        const inner = renderNodes(node.children, state, key);
        if (node.mark === 'bold') return <strong key={key}>{inner}</strong>;
        if (node.mark === 'italic') return <em key={key}>{inner}</em>;
        if (node.mark === 'strike') return <s key={key}>{inner}</s>;
        if (node.mark === 'inlineCode')
          return (
            <code key={key} className="rounded bg-surface-700/80 px-1 py-0.5 font-mono text-[0.85em] text-surface-100">
              {inner}
            </code>
          );
        if (node.mark === 'spoiler') return <Spoiler key={key}>{inner}</Spoiler>;
        return <Fragment key={key}>{inner}</Fragment>;
      }
      case 'link': {
        const safe = isSafeHref(node.href);
        if (!safe) return <Fragment key={key}>{renderNodes(node.children, state, key)}</Fragment>;
        return (
          <a
            key={key}
            href={node.href}
            className={DEFAULT_LINK_CLASS}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(event) => {
              if (state.onLinkClick && state.onLinkClick(node.href, event) === true) {
                event.preventDefault();
              }
            }}
          >
            {renderNodes(node.children, state, key)}
          </a>
        );
      }
      case 'autolink': {
        const safe = isSafeHref(node.href);
        if (!safe) return <Fragment key={key}>{node.href}</Fragment>;
        return (
          <a
            key={key}
            href={node.href}
            className={DEFAULT_LINK_CLASS}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(event) => {
              if (state.onLinkClick && state.onLinkClick(node.href, event) === true) {
                event.preventDefault();
              }
            }}
          >
            {node.href}
          </a>
        );
      }
      case 'codeblock':
        return (
          <pre
            key={key}
            className="my-1 overflow-x-auto rounded-md bg-surface-900/85 px-3 py-2 font-mono text-[0.85em] leading-snug text-surface-100"
          >
            <code>{node.value}</code>
          </pre>
        );
      case 'blockquote': {
        const inner = renderNodes(node.children, state, key);
        return (
          <blockquote
            key={key}
            className="my-0.5 border-l-2 border-nyptid-300/40 pl-2 text-surface-200/90"
          >
            {inner}
          </blockquote>
        );
      }
    }
  });
}

function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        setRevealed(true);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setRevealed(true);
        }
      }}
      className={
        revealed
          ? 'rounded bg-surface-800/40 px-1 text-surface-100'
          : 'cursor-pointer rounded bg-surface-900 px-1 text-transparent select-none hover:bg-surface-800'
      }
      aria-label={revealed ? undefined : 'Spoiler — click to reveal'}
    >
      {children}
    </span>
  );
}

export const MarkdownContent = memo(function MarkdownContent({
  content,
  className,
  style,
  renderMention = defaultRenderMention,
  onLinkClick,
}: MarkdownContentProps) {
  const tree = useMemo(() => parseMarkdown(content), [content]);
  const { byId: emojiById } = useCustomEmojis();
  const jumbo = useMemo(() => isEmojiOnly(content), [content]);
  const rendered = renderNodes(tree, { renderMention, onLinkClick, emojiById, jumbo }, 'm');
  return (
    <span className={className} style={{ whiteSpace: 'pre-wrap', ...style }}>
      {rendered}
    </span>
  );
});
