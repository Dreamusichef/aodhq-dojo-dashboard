'use strict';

const CLIP_PATTERN = /youtu\.?be|youtube\.com|vimeo\.com|streamable\.com|clips\.twitch|photos\.app\.goo\.gl|photos\.google\.com|drive\.google\.com[/]file/i;
const GIF_PATTERN = /tenor\.com|giphy\.com|gfycat\.com|imgur\.com\/.*\.gif|media\.discordapp\.net\/.*\.gif/i;

function normalizeAttachments(attachments) {
  if (!attachments) return new Map();
  if (attachments instanceof Map) return attachments;

  const list = Array.isArray(attachments)
    ? attachments
    : typeof attachments === 'object'
      ? Object.values(attachments)
      : [];

  return new Map(list.map((a, i) => {
    const id = a.id || a.filename || String(i);
    return [id, {
      contentType: a.contentType || a.content_type || null,
      name: a.name || a.filename || '',
      size: a.size ?? null,
      duration_secs: a.duration_secs ?? null,
      width: a.width ?? null,
      height: a.height ?? null,
    }];
  }));
}

/** Discord strips content/attachments/embeds when Message Content Intent is off. */
function isMessagePayloadEmpty(msg) {
  if (!msg || msg.author?.bot) return false;
  const hasContent = Boolean(msg.content && msg.content.length > 0);
  const hasAttachments = Array.isArray(msg.attachments) && msg.attachments.length > 0;
  const hasEmbeds = Array.isArray(msg.embeds) && msg.embeds.length > 0;
  return !hasContent && !hasAttachments && !hasEmbeds;
}

function isVideoAttachment(a) {
  if (a.contentType && a.contentType.startsWith('image/')) return false;
  if (a.contentType && a.contentType.startsWith('video/')) return true;
  if (/\.(mp4|mov|webm|avi|mkv)$/i.test(a.name || '')) return true;
  if (a.duration_secs != null && a.duration_secs > 0) return true;
  if (a.width && a.height) return true;
  return false;
}

function shouldSkipSmallAttachment(a) {
  return a.size && a.size < 2 * 1024 * 1024 && a.duration_secs == null
    && !/practice|clip|drum|bpm/i.test(a.name || '');
}

function countEmbedClip(e) {
  if (e.type === 'gifv' || e.type === 'image') return 0;
  if (e.provider && GIF_PATTERN.test(e.provider.url || '')) return 0;
  if (e.url && GIF_PATTERN.test(e.url)) return 0;
  if (e.type === 'video' || (e.video && e.video.url)) return 1;
  if (e.url && CLIP_PATTERN.test(e.url)) return 1;
  return 0;
}

/** Discord REST JSON or discord.js message → normalized shape for counting */
function normalizeMessage(msg) {
  if (msg.attachments instanceof Map) {
    return {
      content: msg.content || '',
      attachments: msg.attachments,
      embeds: msg.embeds || [],
    };
  }

  return {
    content: msg.content || '',
    attachments: normalizeAttachments(msg.attachments),
    embeds: msg.embeds || [],
  };
}

function fromRestMessage(msg) {
  return normalizeMessage(msg);
}

function countClipsInMessage(msg) {
  const normalized = normalizeMessage(msg);
  let count = 0;

  for (const [, a] of normalized.attachments) {
    if (!isVideoAttachment(a)) continue;
    if (shouldSkipSmallAttachment(a)) continue;
    count++;
  }

  if (normalized.content) {
    const urls = normalized.content.match(/https?:\/\/[^\s<>]+/gi) || [];
    for (const url of urls) {
      if (GIF_PATTERN.test(url)) continue;
      if (CLIP_PATTERN.test(url)) count++;
    }
  }

  if (count === 0 && normalized.embeds) {
    for (const e of normalized.embeds) {
      count += countEmbedClip(e);
    }
  }

  return count;
}

function isClipMessage(msg) {
  return countClipsInMessage(msg) > 0;
}

/**
 * The actual clip links in a message, by the SAME rules and in the SAME order as
 * countClipsInMessage. `matched` mirrors the counter's clip count (a clip is counted
 * whether or not its URL resolves), so the embed fallback fires on exactly the same
 * condition the counter uses (`matched === 0`). Invariant:
 *   extractClipLinks(m).length <= countClipsInMessage(m)
 * with equality whenever every detected clip resolves to a URL (live discord.js
 * attachments always carry a CDN url, so equality holds in production). Used by the
 * /feedback review list; does NOT change the counter.
 *   - video attachments  → attachment url (url → proxy_url fallback)
 *   - clip URLs in text  → the url (GIF sources skipped)
 *   - embed fallback     → only when nothing else matched (mirrors the counter)
 */
function extractClipLinks(msg) {
  const links = [];
  let matched = 0; // clips DETECTED, regardless of whether a URL resolved

  const rawAttachments = msg.attachments instanceof Map
    ? Array.from(msg.attachments.values())
    : Array.isArray(msg.attachments) ? msg.attachments
      : (msg.attachments && typeof msg.attachments === 'object') ? Object.values(msg.attachments)
        : [];
  for (const a of rawAttachments) {
    const norm = {
      contentType: a.contentType || a.content_type || null,
      name: a.name || a.filename || '',
      size: a.size ?? null,
      duration_secs: a.duration_secs ?? null,
      width: a.width ?? null,
      height: a.height ?? null,
    };
    if (!isVideoAttachment(norm)) continue;
    if (shouldSkipSmallAttachment(norm)) continue;
    matched++;
    const url = a.url || a.proxy_url || a.proxyURL;
    if (url) links.push(url);
  }

  const content = msg.content || '';
  if (content) {
    const urls = content.match(/https?:\/\/[^\s<>]+/gi) || [];
    for (const url of urls) {
      if (GIF_PATTERN.test(url)) continue;
      if (CLIP_PATTERN.test(url)) { matched++; links.push(url); }
    }
  }

  // Fallback ONLY when nothing matched — the same gate countClipsInMessage uses
  // (`count === 0`), keyed on matches not on resolved URLs so the two never diverge.
  if (matched === 0 && Array.isArray(msg.embeds)) {
    for (const e of msg.embeds) {
      if (countEmbedClip(e) === 1) {
        const url = (e.video && e.video.url) || e.url || (e.thumbnail && e.thumbnail.url);
        if (url) links.push(url);
      }
    }
  }

  return links;
}

module.exports = {
  CLIP_PATTERN,
  GIF_PATTERN,
  fromRestMessage,
  normalizeMessage,
  isMessagePayloadEmpty,
  countClipsInMessage,
  isClipMessage,
  extractClipLinks,
};
