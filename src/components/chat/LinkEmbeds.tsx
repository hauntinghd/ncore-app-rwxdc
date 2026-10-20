import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, ImageOff } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  displayHost,
  extractEmbeddableUrls,
  isRenderable,
  resolveLinkEmbeds,
  type LinkEmbed,
} from '../../lib/linkEmbeds';
import { safeOpenExternalUrl } from '../../lib/safeExternal';
import { getRolloutFlag, getStreamerModeSettings } from '../../lib/streamerMode';

interface LinkEmbedsProps {
  /** Raw message text. URLs are extracted here rather than passed in so the
   *  caller does not have to think about code fences or `<url>` suppression. */
  content: string;
}

/**
 * Open Graph preview cards for the links in a message.
 *
 * Renders nothing at all — no skeleton, no placeholder — until a preview
 * actually resolves. A card that pops in is a smaller annoyance than a row of
 * grey boxes under every message that happens to contain a URL.
 */
export function LinkEmbeds({ content }: LinkEmbedsProps) {
  const { profile } = useAuth();
  const [embeds, setEmbeds] = useState<LinkEmbed[]>([]);

  // Two gates, deliberately: the account-level preference follows the user
  // between devices, and Settings → Chat → "Inline Media Previews" turns cards
  // off on this device only (a laptop on tethered data, say).
  const previewsEnabled =
    profile?.link_previews_enabled !== false && getRolloutFlag('chat_media_embed', true);

  const urls = useMemo(
    () => (previewsEnabled ? extractEmbeddableUrls(content) : []),
    [content, previewsEnabled],
  );
  const urlKey = urls.join('\n');

  useEffect(() => {
    if (urls.length === 0) {
      setEmbeds([]);
      return;
    }

    let cancelled = false;
    void resolveLinkEmbeds(urls).then((resolved) => {
      if (cancelled) return;
      setEmbeds(resolved.filter(isRenderable));
    });

    return () => {
      cancelled = true;
    };
    // `urlKey` is the stable identity of `urls`; depending on the array itself
    // would re-run on every render because `useMemo` returns a new array
    // whenever `content` changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);

  if (embeds.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      {embeds.map((embed) => (
        <LinkEmbedCard key={embed.urlHash} embed={embed} />
      ))}
    </div>
  );
}

function LinkEmbedCard({ embed }: { embed: LinkEmbed }) {
  const { profile } = useAuth();
  const [imageFailed, setImageFailed] = useState(false);
  const openingRef = useRef(false);

  const target = embed.canonicalUrl || embed.url;
  const host = displayHost(embed);

  // Streamer mode hides message previews; a link card is a message preview with
  // a picture attached, so it follows the same rule.
  const hideMedia = getStreamerModeSettings().enabled;

  async function open(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (openingRef.current) return;
    openingRef.current = true;
    try {
      await safeOpenExternalUrl(target, { label: 'Link', userId: profile?.id ?? null });
    } catch {
      // safeOpenExternalUrl throws when the shield blocks the destination.
      // The card is not the right place to explain that; the shield surfaces it
      // when the user clicks through from the message body.
    } finally {
      openingRef.current = false;
    }
  }

  const showImage = Boolean(embed.imageUrl) && !imageFailed && !hideMedia;

  // A bare image link is the picture itself — no card chrome around it.
  if (embed.embedType === 'image') {
    if (!showImage) return null;
    return (
      <a
        href={target}
        onClick={open}
        className="block w-fit overflow-hidden rounded-lg border border-surface-700/80 transition-colors hover:border-surface-600"
      >
        <img
          src={embed.imageUrl ?? ''}
          alt={embed.title || host}
          loading="lazy"
          onError={() => setImageFailed(true)}
          className="max-h-72 w-auto bg-black/20 object-contain"
        />
      </a>
    );
  }

  return (
    <a
      href={target}
      onClick={open}
      className="flex max-w-xl gap-3 overflow-hidden rounded-lg border-l-4 border-surface-600 bg-surface-800/60 p-3 transition-colors hover:bg-surface-800"
    >
      <div className="min-w-0 flex-1">
        {(embed.siteName || host) && (
          <div className="mb-0.5 flex items-center gap-1.5 text-xs text-surface-500">
            {embed.faviconUrl && !hideMedia && (
              <img
                src={embed.faviconUrl}
                alt=""
                aria-hidden="true"
                loading="lazy"
                className="h-3.5 w-3.5 rounded-sm object-contain"
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            )}
            <span className="truncate">{embed.siteName || host}</span>
          </div>
        )}

        {embed.title && (
          <div className="mb-1 line-clamp-2 text-sm font-semibold text-nyptid-200">
            {embed.title}
          </div>
        )}

        {embed.description && (
          <p className="line-clamp-3 text-xs leading-relaxed text-surface-400">
            {embed.description}
          </p>
        )}

        {hideMedia && embed.imageUrl && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-surface-600">
            <ImageOff size={11} />
            <span>Preview image hidden by Streamer Mode</span>
          </div>
        )}

        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-surface-600">
          <ExternalLink size={10} />
          <span className="truncate">{host}</span>
        </div>
      </div>

      {showImage && (
        <img
          src={embed.imageUrl ?? ''}
          alt=""
          aria-hidden="true"
          loading="lazy"
          onError={() => setImageFailed(true)}
          className="h-20 w-20 flex-shrink-0 rounded-md bg-black/20 object-cover"
        />
      )}
    </a>
  );
}
