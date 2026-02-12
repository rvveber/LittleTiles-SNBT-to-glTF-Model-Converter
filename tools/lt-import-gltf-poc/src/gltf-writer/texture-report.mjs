import path from 'node:path';
import { readFileSync } from 'node:fs';

import { BUILT_IN_TEXTURE_OVERRIDES } from './built-in-overrides.mjs';

export function buildTextureLookupFromExportReport(report, options = {}) {
  const byBlockState = Object.create(null);
  const byBlockId = Object.create(null);
  const byTextureId = Object.create(null);
  const animationByTextureUri = Object.create(null);
  const alphaByTextureUri = Object.create(null);
  const tintByBlockState = Object.create(null);
  const tintByBlockId = Object.create(null);
  const uriPrefix = normalizeUriPrefix(options.uriPrefix);
  const reportDir = resolveReportDir(options);

  for (const texture of report?.textures ?? []) {
    if (texture?.exported !== true)
      continue;
    const id = String(texture.id ?? '').trim();
    const uri = String(texture.uri ?? '').trim();
    if (!id || !uri)
      continue;
    const resolvedUri = `${uriPrefix}${uri}`;
    byTextureId[id] = resolvedUri;

    const textureMeta = loadTextureMetadata(texture, uri, reportDir);
    if (textureMeta?.hasAlpha)
      alphaByTextureUri[resolvedUri] = true;
    const animation = textureMeta?.animation;
    if (animation)
      animationByTextureUri[resolvedUri] = animation;
  }

  // 1. Load built-in overrides first (so explicit report entries can overwrite them later if needed)
  applyOverrides(BUILT_IN_TEXTURE_OVERRIDES, byBlockState, byBlockId, byTextureId);

  for (const block of report?.blockStates ?? []) {
    const textureIds = Array.isArray(block?.textureIds) ? block.textureIds : [];
    const uri = firstResolvedUri(textureIds, byTextureId);
    
    // Support per-face texture mapping if provided
    let textureEntry = uri;
    if (block?.textures && typeof block.textures === 'object') {
      const map = {};
      let hasUrl = false;
      for (const [face, texId] of Object.entries(block.textures)) {
        if (texId === null) {
          map[face] = null; // Explicit cull
          hasUrl = true; // null is a valid entry (instruction to cull)
        } else {
          const u = byTextureId[texId];
          if (u) {
            map[face] = u;
            hasUrl = true;
          }
        }
      }
      if (hasUrl) textureEntry = map;
    }

    const rawState = String(block?.blockState ?? '').trim();
    const canonicalState = String(block?.canonicalState ?? '').trim();
    const blockId = String(block?.blockId ?? '').trim();
    const tintColor = normalizeTintColor(block?.tintColor);

    if (textureEntry) {
      if (rawState)
        byBlockState[rawState] = textureEntry;
      if (canonicalState)
        byBlockState[canonicalState] = textureEntry;
      if (blockId && byBlockId[blockId] == null)
        byBlockId[blockId] = textureEntry;
    }

    if (tintColor != null) {
      if (rawState) tintByBlockState[rawState] = tintColor;
      if (canonicalState) tintByBlockState[canonicalState] = tintColor;
      if (blockId) tintByBlockId[blockId] = tintColor;
    }
  }

  return {
    byBlockState,
    byBlockId,
    // ... rest of exports
    animationByTextureUri,
    alphaByTextureUri,
    tintByBlockState,
    tintByBlockId,
  };
}

function applyOverrides(overrides, byBlockState, byBlockId, byTextureId) {
  if (!overrides || typeof overrides !== 'object') return;
  
  for (const [key, rules] of Object.entries(overrides)) {
    if (!rules?.textures) continue;
    
    // Resolve texture IDs to URIs if possible, otherwise keep IDs or nulls
    const resolvedTextures = {};
    let hasEntry = false;
    for (const [face, val] of Object.entries(rules.textures)) {
        if (val === null) {
            resolvedTextures[face] = null;
            hasEntry = true;
        } else if (typeof val === 'string') {
            const uri = byTextureId[val];
            if (uri) {
                resolvedTextures[face] = uri;
            } else {
                // Keep the ID if we don't have a resolution (no report provided fallback)
                resolvedTextures[face] = val;
            }
            hasEntry = true;
        }
    }

    if (hasEntry) {
       byBlockId[key] = resolvedTextures;
       byBlockState[key] = resolvedTextures;
    }
  }
}

function firstResolvedUri(textureIds, byTextureId) {
  for (const idRaw of textureIds) {
    const id = String(idRaw ?? '').trim();
    if (!id)
      continue;
    const uri = byTextureId[id];
    if (uri)
      return uri;
  }
  return null;
}

function normalizeUriPrefix(uriPrefix) {
  const value = String(uriPrefix ?? '').trim();
  if (!value)
    return '';
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeTintColor(value) {
  if (!Number.isInteger(value))
    return null;
  return value & 0xFFFFFF;
}

function resolveReportDir(options) {
  const reportPath = String(options?.reportPath ?? '').trim();
  if (!reportPath)
    return null;
  return path.dirname(path.resolve(reportPath));
}

function loadTextureMetadata(texture, rawUri, reportDir) {
  const out = {
    hasAlpha: false,
    animation: null,
  };
  if (!reportDir)
    return out;

  const localTexturePath = path.resolve(reportDir, rawUri);
  const pngMeta = readPngMetadata(localTexturePath);
  if (pngMeta)
    out.hasAlpha = pngMeta.hasAlpha;

  if (texture?.hasMcmeta) {
    const localMetaPath = `${localTexturePath}.mcmeta`;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(localMetaPath, 'utf8'));
    } catch {
      return out;
    }

    const animation = toAnimationMetadata(parsed?.animation, pngMeta);
    if (animation) {
      out.animation = {
        ...animation,
        mcmetaUri: `${rawUri}.mcmeta`,
      };
    }
  }

  return out;
}

function toAnimationMetadata(raw, pngMeta) {
  if (!raw || typeof raw !== 'object')
    return null;

  const frameTime = normalizePositiveInt(raw.frametime, 1);
  const interpolate = raw.interpolate === true;
  const normalizedFrames = normalizeAnimationFrames(raw.frames, frameTime);
  const frameHeight = resolveFrameHeight(raw, pngMeta);
  const frameCount = resolveFrameCount(normalizedFrames, frameHeight, pngMeta);

  if (!Number.isInteger(frameCount) || frameCount <= 1)
    return null;

  const firstFrameIndex = normalizedFrames.length > 0
    ? clampFrameIndex(normalizedFrames[0].index, frameCount)
    : 0;
  const vScale = clamp01(1 / frameCount);
  const vOffset = clamp01(firstFrameIndex / frameCount);

  return {
    frameTime,
    interpolate,
    frameCount,
    frameHeight,
    frames: normalizedFrames,
    uvTransform: {
      scale: [1, vScale],
      offset: [0, vOffset],
    },
  };
}

function normalizeAnimationFrames(framesRaw, defaultFrameTime) {
  if (!Array.isArray(framesRaw))
    return [];

  const out = [];
  for (const entry of framesRaw) {
    if (Number.isInteger(entry)) {
      out.push({
        index: entry,
        time: defaultFrameTime,
      });
      continue;
    }
    if (!entry || typeof entry !== 'object')
      continue;
    const index = Number(entry.index);
    if (!Number.isInteger(index))
      continue;
    out.push({
      index,
      time: normalizePositiveInt(entry.time, defaultFrameTime),
    });
  }
  return out;
}

function resolveFrameHeight(rawAnimation, imageSize) {
  const explicit = normalizePositiveInt(rawAnimation?.height, null);
  if (Number.isInteger(explicit))
    return explicit;
  if (!imageSize)
    return null;
  return imageSize.width;
}

function resolveFrameCount(normalizedFrames, frameHeight, imageSize) {
  if (normalizedFrames.length > 0) {
    const maxFrame = normalizedFrames.reduce((max, frame) => (
      frame.index > max ? frame.index : max
    ), 0);
    return maxFrame + 1;
  }
  if (!imageSize || !Number.isInteger(frameHeight) || frameHeight <= 0)
    return null;
  return Math.floor(imageSize.height / frameHeight);
}

function clampFrameIndex(index, frameCount) {
  if (!Number.isInteger(index) || frameCount <= 0)
    return 0;
  if (index < 0)
    return 0;
  if (index >= frameCount)
    return frameCount - 1;
  return index;
}

function clamp01(value) {
  if (!Number.isFinite(value))
    return 0;
  if (value <= 0)
    return 0;
  if (value >= 1)
    return 1;
  return value;
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0)
    return fallback;
  return parsed;
}

function readPngMetadata(filePath) {
  let data;
  try {
    data = readFileSync(filePath);
  } catch {
    return null;
  }

  // PNG signature (8 bytes) + IHDR chunk marker at byte 12.
  if (data.length < 24)
    return null;
  if (
    data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4E || data[3] !== 0x47 ||
    data[4] !== 0x0D || data[5] !== 0x0A || data[6] !== 0x1A || data[7] !== 0x0A
  ) {
    return null;
  }
  if (
    data[12] !== 0x49 || data[13] !== 0x48 || data[14] !== 0x44 || data[15] !== 0x52
  ) {
    return null;
  }

  const colorType = data[25];
  const hasDirectAlpha = colorType === 4 || colorType === 6;
  const hasPaletteTransparency = hasTrnsChunk(data);

  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    hasAlpha: hasDirectAlpha || hasPaletteTransparency,
  };
}

function hasTrnsChunk(data) {
  // Starts after PNG signature; each chunk is length(4) + type(4) + data + crc(4).
  let offset = 8;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const next = dataStart + length + 4;
    if (next > data.length)
      return false;

    const type = data.toString('ascii', typeStart, typeStart + 4);
    if (type === 'tRNS')
      return true;
    if (type === 'IEND')
      return false;
    offset = next;
  }
  return false;
}
