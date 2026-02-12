const DEFAULT_TRANSLUCENT_ALPHA = 0.35;
const DEFAULT_ALPHA_CUTOFF = 0.5;

export function resolveMaterial(input, options = {}) {
  const blockState = String(input?.blockState ?? 'minecraft:air');
  const blockId = String(input?.blockId ?? blockStateName(blockState));
  const argb = Number.isInteger(input?.color) ? input.color : -1;
  const textureUri = resolveTextureUri(blockState, blockId, options);

  if (!textureUri)
    return null;

  const rgba = rgbaFromArgb(argb);
  const inferredTranslucent = input?.providesSolidFace === false;
  const assumeTextureAlpha = options.assumeTextureAlpha !== false;
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
  const textureSupportsAlpha = (
    assumeTextureAlpha &&
    typeof textureUri === 'string' &&
    textureUri.length > 0
  );

  let alphaMode = 'OPAQUE';
  let alphaCutoff = null;

  if (baseAlpha < 1) {
    alphaMode = 'BLEND';
  } else if (textureSupportsAlpha) {
    alphaMode = 'MASK';
    alphaCutoff = normalizeAlphaCutoff(options.alphaCutoff, DEFAULT_ALPHA_CUTOFF);
  }

  const hasTranslucency = alphaMode !== 'OPAQUE';

  return {
    materialKey: materialKey({
      blockId,
      textureUri,
      rgba: [rgba[0], rgba[1], rgba[2], baseAlpha],
    }),
    materialName: blockState,
    baseColorFactor: [rgba[0], rgba[1], rgba[2], baseAlpha],
    alphaMode,
    alphaCutoff,
    doubleSided: hasTranslucency,
    textureKey: textureUri,
    textureUri,
    textureAnimation: null,
  };
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

function resolveTextureUri(blockState, blockId, options = {}) {
  const derivedBlockId = resolveTextureBlockId(blockState, blockId);
  return deriveTextureUriFromBlockId(derivedBlockId, options.textureUriPrefix);
}

function resolveTextureBlockId(blockState, blockId) {
  const stateWithProps = normalizeLegacyStateKey(String(blockState ?? '').trim());
  if (stateWithProps) {
    const stateAlias = LEGACY_TEXTURE_ALIAS_MAP[stateWithProps];
    if (stateAlias)
      return stateAlias;
  }

  const primary = blockStateName(String(blockId ?? '').trim());
  const fallback = blockStateName(String(blockState ?? '').trim());

  for (const candidate of [fallback, primary]) {
    const normalized = normalizeLegacyStateKey(candidate);
    if (!normalized)
      continue;

    const directAlias = LEGACY_TEXTURE_ALIAS_MAP[normalized];
    if (directAlias)
      return directAlias;

    const strippedLegacyMeta = normalized.replace(/:-?\d+$/, '');
    if (strippedLegacyMeta !== normalized) {
      const strippedAlias = LEGACY_TEXTURE_ALIAS_MAP[strippedLegacyMeta];
      if (strippedAlias)
        return strippedAlias;
      return strippedLegacyMeta;
    }

    return normalized;
  }

  return null;
}

function normalizeLegacyStateKey(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw;
}

function deriveTextureUriFromBlockId(blockId, uriPrefixRaw) {
  const raw = String(blockId ?? '').trim();
  if (!raw)
    return null;

  const [namespaceRaw, pathRaw] = raw.includes(':')
    ? raw.split(':', 2)
    : ['minecraft', raw];
  const namespace = namespaceRaw.trim();
  const pathPart = pathRaw.trim();
  if (!namespace || !pathPart)
    return null;

  const uriPrefix = normalizeUriPrefix(uriPrefixRaw);
  return `${uriPrefix}textures/${namespace}/block/${pathPart}.png`;
}

function normalizeUriPrefix(valueRaw) {
  const value = String(valueRaw ?? '').trim();
  if (!value)
    return '';
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeAlphaCutoff(value, fallback) {
  if (!Number.isFinite(value))
    return fallback;
  return clamp01(value);
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
  'kirosblocks:rainbow_pillar_block': 'kirosblocks:rainbow_stripes_block',
  'kirosblocks:rainbow_pillar_block[axis=y]': 'kirosblocks:rainbow_stripes_block',
  'kirosblocks:rainbow_pillar_block[axis=z]': 'kirosblocks:rainbow_stripes_block',
});
