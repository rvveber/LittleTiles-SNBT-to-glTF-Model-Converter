const DEFAULT_TRANSLUCENT_ALPHA = 0.35;

export function resolveMaterial(input, options = {}) {
  const blockState = String(input?.blockState ?? 'minecraft:air');
  const blockId = String(input?.blockId ?? blockStateName(blockState));
  const argb = Number.isInteger(input?.color) ? input.color : -1;
  const textureUri = resolveTextureUri(blockState, blockId, options.textureLookup);
  const textureAnimation = resolveTextureAnimation(textureUri, options.textureLookup);
  const textureHasAlpha = resolveTextureHasAlpha(textureUri, options.textureLookup);
  const tintRgb = resolveTintRgb(blockState, blockId, options.textureLookup);
  const rgba = rgbaFromArgb(argb);
  const inferredTranslucent = input?.providesSolidFace === false;
  const inferredAlpha = clamp01(
    Number.isFinite(options.translucentAlpha)
      ? options.translucentAlpha
      : DEFAULT_TRANSLUCENT_ALPHA
  );

  const baseAlpha = (
    rgba[3] < 1
      ? rgba[3]
      : (inferredTranslucent ? inferredAlpha : 1)
  );
  const hasTranslucency = baseAlpha < 1 || textureHasAlpha;

  const tintedRgb = applyTintRgb([rgba[0], rgba[1], rgba[2]], tintRgb);

  const out = {
    materialKey: materialKey({
      blockId,
      textureUri,
      rgba: [tintedRgb[0], tintedRgb[1], tintedRgb[2], baseAlpha],
    }),
    materialName: blockState,
    baseColorFactor: [tintedRgb[0], tintedRgb[1], tintedRgb[2], baseAlpha],
    alphaMode: hasTranslucency ? 'BLEND' : 'OPAQUE',
    alphaCutoff: null,
    doubleSided: hasTranslucency,
    textureKey: textureUri,
    textureUri,
    textureAnimation,
  };

  return out;
}

export function rgbaFromArgb(argb) {
  const a = ((argb >>> 24) & 255) / 255;
  const r = ((argb >>> 16) & 255) / 255;
  const g = ((argb >>> 8) & 255) / 255;
  const b = (argb & 255) / 255;
  return [r, g, b, a];
}

function materialKey(input) {
  const [r, g, b, a] = input.rgba;
  return [
    input.blockId,
    input.textureUri ?? '',
    quantizeColor(r),
    quantizeColor(g),
    quantizeColor(b),
    quantizeColor(a),
  ].join('|');
}

function quantizeColor(value) {
  const scaled = Math.round(clamp01(value) * 255);
  return scaled.toString(16).padStart(2, '0');
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

function blockStateName(state) {
  const index = state.indexOf('[');
  if (index >= 0)
    return state.slice(0, index);
  return state;
}

function resolveTextureUri(blockState, blockId, textureLookup) {
  if (!textureLookup || typeof textureLookup !== 'object')
    return null;

  const byBlockState = textureLookup.byBlockState;
  const byBlockId = textureLookup.byBlockId;
  if (byBlockState && typeof byBlockState === 'object') {
    const direct = byBlockState[blockState];
    if (typeof direct === 'string' && direct.length > 0)
      return direct;

    const canonical = canonicalizeBlockState(blockState);
    const fromCanonical = byBlockState[canonical];
    if (typeof fromCanonical === 'string' && fromCanonical.length > 0)
      return fromCanonical;
  }

  if (byBlockId && typeof byBlockId === 'object') {
    const fromId = byBlockId[blockId];
    if (typeof fromId === 'string' && fromId.length > 0)
      return fromId;
  }

  const aliases = legacyTextureAliases(blockState, blockId);
  for (const alias of aliases) {
    if (byBlockState && typeof byBlockState === 'object') {
      const fromState = byBlockState[alias];
      if (typeof fromState === 'string' && fromState.length > 0)
        return fromState;
      const fromCanonicalAlias = byBlockState[canonicalizeBlockState(alias)];
      if (typeof fromCanonicalAlias === 'string' && fromCanonicalAlias.length > 0)
        return fromCanonicalAlias;
    }
    if (byBlockId && typeof byBlockId === 'object') {
      const fromAliasId = byBlockId[alias];
      if (typeof fromAliasId === 'string' && fromAliasId.length > 0)
        return fromAliasId;
    }
  }
  return null;
}

function resolveTextureAnimation(textureUri, textureLookup) {
  const key = String(textureUri ?? '').trim();
  if (!key)
    return null;
  if (!textureLookup || typeof textureLookup !== 'object')
    return null;
  const byTextureUri = textureLookup.animationByTextureUri;
  if (!byTextureUri || typeof byTextureUri !== 'object')
    return null;
  const metadata = byTextureUri[key];
  if (!metadata || typeof metadata !== 'object')
    return null;
  return metadata;
}

function resolveTextureHasAlpha(textureUri, textureLookup) {
  const key = String(textureUri ?? '').trim();
  if (!key)
    return false;
  if (!textureLookup || typeof textureLookup !== 'object')
    return false;
  const byTextureUri = textureLookup.alphaByTextureUri;
  if (!byTextureUri || typeof byTextureUri !== 'object')
    return false;
  return byTextureUri[key] === true;
}

function resolveTintRgb(blockState, blockId, textureLookup) {
  if (!textureLookup || typeof textureLookup !== 'object')
    return null;

  const byBlockState = textureLookup.tintByBlockState;
  const byBlockId = textureLookup.tintByBlockId;

  const stateCandidates = [
    blockState,
    canonicalizeBlockState(blockState),
  ];
  for (const candidate of stateCandidates) {
    if (!candidate || !byBlockState || typeof byBlockState !== 'object')
      continue;
    const tint = normalizeTintRgb(byBlockState[candidate]);
    if (tint)
      return tint;
  }

  if (byBlockId && typeof byBlockId === 'object') {
    const tint = normalizeTintRgb(byBlockId[blockId]);
    if (tint)
      return tint;
  }

  const aliases = legacyTextureAliases(blockState, blockId);
  for (const alias of aliases) {
    if (byBlockState && typeof byBlockState === 'object') {
      const tint = normalizeTintRgb(byBlockState[alias] ?? byBlockState[canonicalizeBlockState(alias)]);
      if (tint)
        return tint;
    }
    if (byBlockId && typeof byBlockId === 'object') {
      const tint = normalizeTintRgb(byBlockId[alias]);
      if (tint)
        return tint;
    }
  }

  return null;
}

function canonicalizeBlockState(state) {
  const raw = String(state ?? '').trim();
  const index = raw.indexOf('[');
  if (index < 0)
    return raw;

  const name = raw.slice(0, index);
  const end = raw.lastIndexOf(']');
  const body = end > index ? raw.slice(index + 1, end) : '';
  if (!body.trim())
    return name;

  const map = new Map();
  for (const partRaw of body.split(',')) {
    const part = partRaw.trim();
    if (!part)
      continue;
    const eq = part.indexOf('=');
    if (eq <= 0 || eq >= part.length - 1)
      continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key || !value)
      continue;
    map.set(key, value);
  }
  if (map.size === 0)
    return name;

  const pairs = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return `${name}[${pairs.map(([k, v]) => `${k}=${v}`).join(',')}]`;
}

function applyTintRgb(rgb, tintRgb) {
  if (!Array.isArray(tintRgb))
    return rgb;
  return [
    clamp01(rgb[0] * tintRgb[0]),
    clamp01(rgb[1] * tintRgb[1]),
    clamp01(rgb[2] * tintRgb[2]),
  ];
}

function normalizeTintRgb(value) {
  if (!Number.isInteger(value))
    return null;
  const tint = value & 0xFFFFFF;
  return [
    ((tint >>> 16) & 255) / 255,
    ((tint >>> 8) & 255) / 255,
    (tint & 255) / 255,
  ];
}

function legacyTextureAliases(blockState, blockId) {
  const out = [];
  const normalizedState = normalizeLegacyStateKey(blockState);
  const normalizedId = normalizeLegacyStateKey(blockId);

  pushLegacyAlias(out, LEGACY_TEXTURE_ALIAS_MAP[normalizedState]);
  pushLegacyAlias(out, LEGACY_TEXTURE_ALIAS_MAP[normalizedId]);

  // Legacy variant IDs can include metadata suffixes (`namespace:block:meta`).
  if (normalizedState.includes(':')) {
    const strippedState = normalizedState.replace(/:-?\d+$/, '');
    if (strippedState !== normalizedState)
      pushLegacyAlias(out, LEGACY_TEXTURE_ALIAS_MAP[strippedState]);
  }
  if (normalizedId.includes(':')) {
    const strippedId = normalizedId.replace(/:-?\d+$/, '');
    if (strippedId !== normalizedId)
      pushLegacyAlias(out, LEGACY_TEXTURE_ALIAS_MAP[strippedId]);
  }

  return out;
}

function normalizeLegacyStateKey(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw;
}

function pushLegacyAlias(out, alias) {
  if (!alias || typeof alias !== 'string')
    return;
  if (out.includes(alias))
    return;
  out.push(alias);
}

const LEGACY_TEXTURE_ALIAS_MAP = Object.freeze({
  'littletiles:ltcoloredblock': 'littletiles:colored_clean',
  'littletiles:ltcoloredblock:10': 'littletiles:colored_clay',
  'littletiles:ltcoloredblock2:2': 'littletiles:colored_stone',
  'minecraft:planks': 'minecraft:oak_planks',
  'minecraft:stone:0': 'minecraft:stone',
  'minecraft:stone:2': 'minecraft:polished_granite',
  'minecraft:stone:4': 'minecraft:polished_diorite',
  'minecraft:leaves:2': 'minecraft:birch_leaves',
});
