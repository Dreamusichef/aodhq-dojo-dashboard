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
    }];
  }));
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
    if (a.contentType && a.contentType.startsWith('image/')) continue;
    if ((a.contentType && a.contentType.startsWith('video/')) ||
        /\.(mp4|mov|webm|avi|mkv)$/i.test(a.name || '')) {
      if (a.size && a.size < 2 * 1024 * 1024 && a.duration_secs == null) {
        if (!/practice|clip|drum|bpm/i.test(a.name || '')) continue;
      }
      count++;
    }
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
      if (e.type === 'gifv' || e.type === 'image') continue;
      if (e.provider && GIF_PATTERN.test(e.provider.url || '')) continue;
      if (e.url && GIF_PATTERN.test(e.url)) continue;
      if (e.type === 'video' || (e.video && e.video.url)) count++;
    }
  }

  return count;
}

function isClipMessage(msg) {
  return countClipsInMessage(msg) > 0;
}

module.exports = {
  CLIP_PATTERN,
  GIF_PATTERN,
  fromRestMessage,
  normalizeMessage,
  countClipsInMessage,
  isClipMessage,
};
