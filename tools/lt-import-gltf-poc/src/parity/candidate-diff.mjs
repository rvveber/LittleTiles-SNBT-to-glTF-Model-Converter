import { buildFaceCandidates, iterateRenderableFaceCandidates } from '../gltf-writer/face-candidates.mjs';
import { collectTransformableDiagnostics } from '../gltf-writer/transformable-cache.mjs';
import { resolveRuntimeFaceBehaviorProfile } from '../gltf-writer/runtime-face-behavior-profile.mjs';
import { normalizeTilesForRendering } from '../gltf-writer/tile-normalization.mjs';
import { isDebugFaceRenderable } from './face-state-summary.mjs';

export function buildCandidateDiffReport(parsedNormalized, debugRoot, options = {}) {
  const runtimeFaceBehaviorProfile = resolveRuntimeFaceBehaviorProfile({
    runtime: options.runtime,
  });
  const tiles = normalizeTilesForRendering(parsedNormalized);
  const standaloneBoxMeta = buildParsedBoxMetaMap(parsedNormalized.root);
  const standaloneCounts = collectStandaloneCandidateMultiset(tiles, standaloneBoxMeta, runtimeFaceBehaviorProfile, options);
  const standaloneFaceCacheIndex = buildStandaloneFaceCacheIndex(tiles);
  const debugCounts = collectDebugCandidateMultiset(debugRoot);
  const debugFaceStateContextIndex = buildDebugFaceStateContextIndex(debugRoot);
  const diff = diffCandidateMultisets(debugCounts, standaloneCounts);
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 12;

  enrichDiffEntriesWithStandaloneCache(diff.missingEntries, standaloneFaceCacheIndex);
  enrichDiffEntriesWithStandaloneCache(diff.extraEntries, standaloneFaceCacheIndex);
  enrichDiffEntriesWithDebugFaceStateContext(diff.missingEntries, debugFaceStateContextIndex);
  enrichDiffEntriesWithDebugFaceStateContext(diff.extraEntries, debugFaceStateContextIndex);

  return {
    missingTotal: diff.missingTotal,
    extraTotal: diff.extraTotal,
    missingEntries: summarizeDiffEntries(diff.missingEntries, limit),
    extraEntries: summarizeDiffEntries(diff.extraEntries, limit),
    focus: summarizeFocusedCandidateDiff(diff, limit),
  };
}

function collectStandaloneCandidateMultiset(tiles, boxMetaMap, runtimeFaceBehaviorProfile, options = {}) {
  const counts = new Map();

  for (const { tile, box, face, faceState, outside } of iterateRenderableFaceCandidates(tiles, {
    evaluateInternalOcclusion: true,
    runtimeFaceBehaviorProfile,
    geometryMode: options.geometryMode,
  })) {
    const meta = boxMetaMap.get(box.id) ?? {};
    const sample = {
      boxId: box.id,
      facing: face.facing,
      outside: outside === true,
      kind: box.kind,
      state: faceState?.state ?? null,
      reason: faceState?.reason ?? null,
      blockState: tile.blockState,
      color: tile.color,
      groupPath: meta.groupPath ?? null,
      tileIndex: meta.tileIndex ?? null,
      boxIndex: meta.boxIndex ?? null,
      minX: box.minX,
      minY: box.minY,
      minZ: box.minZ,
      maxX: box.maxX,
      maxY: box.maxY,
      maxZ: box.maxZ,
      transformData: Array.isArray(box.transformData) ? box.transformData.slice() : null,
    };
    const key = buildCandidateSignature(sample);
    addCandidateCount(counts, key, {
      ...sample,
      transformDataSignature: signatureArray(sample.transformData),
    });
  }

  return counts;
}

function collectDebugCandidateMultiset(root) {
  const counts = new Map();
  let boxId = 0;

  walkGroupTree(root, 'root', (group, groupPath) => {
    for (let tileIndex = 0; tileIndex < (group.tiles ?? []).length; tileIndex++) {
      const tile = group.tiles[tileIndex];
      const resolvedTileIndex = Number.isInteger(tile?.index) ? tile.index : tileIndex;

      for (let localBoxIndex = 0; localBoxIndex < (tile?.boxes ?? []).length; localBoxIndex++) {
        const box = tile.boxes[localBoxIndex];
        const resolvedBoxIndex = Number.isInteger(box?.index) ? box.index : localBoxIndex;
        const currentBoxId = boxId++;
        const kind = String(box?.kind ?? 'aabb');

        if (!Array.isArray(box?.faceStates))
          continue;

        for (const face of box.faceStates) {
          if (!isDebugFaceRenderable(face))
            continue;

          const facing = String(face?.facing ?? '');
          const outside = face?.outside === true;
          const sample = {
            boxId: currentBoxId,
            facing,
            outside,
            kind,
            state: String(face?.state ?? ''),
            reason: String(face?.reason ?? ''),
            blockState: tile?.blockState ?? null,
            color: Number.isInteger(tile?.color) ? tile.color : null,
            groupPath,
            tileIndex: resolvedTileIndex,
            boxIndex: resolvedBoxIndex,
            minX: Number.isFinite(box?.minX) ? box.minX : null,
            minY: Number.isFinite(box?.minY) ? box.minY : null,
            minZ: Number.isFinite(box?.minZ) ? box.minZ : null,
            maxX: Number.isFinite(box?.maxX) ? box.maxX : null,
            maxY: Number.isFinite(box?.maxY) ? box.maxY : null,
            maxZ: Number.isFinite(box?.maxZ) ? box.maxZ : null,
            transformData: Array.isArray(box?.array) && box.array.length > 6
              ? box.array.slice(6)
              : null,
            debugTransformableCache: normalizeDebugTransformableCache(face?.transformableCache),
          };
          const key = buildCandidateSignature(sample);
          addCandidateCount(counts, key, {
            ...sample,
            transformDataSignature: signatureArray(sample.transformData),
          });
        }
      }
    }
  });

  return counts;
}

function buildDebugFaceStateContextIndex(root) {
  const exact = new Map();
  const noOutside = new Map();

  walkGroupTree(root, 'root', (group, groupPath) => {
    for (let tileIndex = 0; tileIndex < (group.tiles ?? []).length; tileIndex++) {
      const tile = group.tiles[tileIndex];
      const resolvedTileIndex = Number.isInteger(tile?.index) ? tile.index : tileIndex;

      for (let localBoxIndex = 0; localBoxIndex < (tile?.boxes ?? []).length; localBoxIndex++) {
        const box = tile.boxes[localBoxIndex];
        const resolvedBoxIndex = Number.isInteger(box?.index) ? box.index : localBoxIndex;
        const kind = String(box?.kind ?? 'aabb');
        if (!Array.isArray(box?.faceStates))
          continue;

        for (const face of box.faceStates) {
          const sample = {
            facing: String(face?.facing ?? ''),
            outside: face?.outside === true,
            kind,
            state: String(face?.state ?? ''),
            reason: String(face?.reason ?? ''),
            renderable: isDebugFaceRenderable(face),
            coveredFully: face?.coveredFully === true,
            partially: face?.partially === true,
            blockState: tile?.blockState ?? null,
            color: Number.isInteger(tile?.color) ? tile.color : null,
            groupPath,
            tileIndex: resolvedTileIndex,
            boxIndex: resolvedBoxIndex,
            minX: Number.isFinite(box?.minX) ? box.minX : null,
            minY: Number.isFinite(box?.minY) ? box.minY : null,
            minZ: Number.isFinite(box?.minZ) ? box.minZ : null,
            maxX: Number.isFinite(box?.maxX) ? box.maxX : null,
            maxY: Number.isFinite(box?.maxY) ? box.maxY : null,
            maxZ: Number.isFinite(box?.maxZ) ? box.maxZ : null,
            transformData: Array.isArray(box?.array) && box.array.length > 6
              ? box.array.slice(6)
              : null,
            debugTransformableCache: normalizeDebugTransformableCache(face?.transformableCache),
          };

          const exactKey = buildCandidateSignature(sample);
          const noOutsideKey = buildCandidateSignatureIgnoringOutside(sample);
          addDebugFaceStateContext(exact, exactKey, sample);
          addDebugFaceStateContext(noOutside, noOutsideKey, sample);
        }
      }
    }
  });

  return { exact, noOutside };
}

function addDebugFaceStateContext(map, key, sample) {
  const existing = map.get(key);
  if (existing) {
    existing.count++;
    existing.states[sample.state] = (existing.states[sample.state] ?? 0) + 1;
    existing.reasons[sample.reason] = (existing.reasons[sample.reason] ?? 0) + 1;
    return;
  }

  map.set(key, {
    count: 1,
    states: { [sample.state]: 1 },
    reasons: { [sample.reason]: 1 },
    sample,
  });
}

function buildParsedBoxMetaMap(root) {
  const map = new Map();
  let boxId = 0;

  walkGroupTree(root, 'root', (group, groupPath) => {
    for (let tileIndex = 0; tileIndex < (group.tiles ?? []).length; tileIndex++) {
      const tile = group.tiles[tileIndex];
      if (!Array.isArray(tile?.boxes) || tile.boxes.length === 0)
        continue;

      for (let localBoxIndex = 0; localBoxIndex < tile.boxes.length; localBoxIndex++) {
        map.set(boxId, {
          groupPath,
          tileIndex,
          boxIndex: localBoxIndex,
        });
        boxId++;
      }
    }
  });

  return map;
}

function walkGroupTree(group, groupPath, onGroup) {
  if (!group || typeof group !== 'object')
    return;
  onGroup(group, groupPath);
  const children = Array.isArray(group.children) ? group.children : [];
  for (let i = 0; i < children.length; i++)
    walkGroupTree(children[i], `${groupPath}.children[${i}]`, onGroup);
}

function addCandidateCount(map, key, sample) {
  const existing = map.get(key);
  if (existing) {
    existing.count++;
    return;
  }

  map.set(key, {
    count: 1,
    sample,
  });
}

function normalizeDebugTransformableCache(value) {
  if (!value || typeof value !== 'object')
    return null;

  const current = normalizeDebugTransformableCacheSnapshot(value.current ?? value);
  const fresh = normalizeDebugTransformableCacheSnapshot(value.fresh);
  const fieldMismatches = normalizeDebugTransformableFieldMismatches(value.fieldMismatches, current, fresh);
  const derivedCacheMismatch = deriveCurrentVsFreshMismatch(fieldMismatches);
  const currentVsFreshMismatch = boolOrNull(value.currentVsFreshMismatch);

  return {
    axisStripCount: current?.axisStripCount ?? null,
    tiltedRenderCount: current?.tiltedRenderCount ?? null,
    hasAxisStrip: current?.hasAxisStrip === true,
    hasTiltedStrip: current?.hasTiltedStrip === true,
    isCompletelyFilled: current?.isCompletelyFilled === true,
    current,
    fresh,
    currentVsFreshMismatch: currentVsFreshMismatch ?? derivedCacheMismatch,
    fieldMismatches,
    generateFaceCurrentNull: boolOrNull(value.generateFaceCurrentNull),
    generateFaceFreshNull: boolOrNull(value.generateFaceFreshNull),
    generateFaceNullMismatch: boolOrNull(value.generateFaceNullMismatch),
    setCurrentResult: boolOrNull(value.setCurrentResult),
    setFreshResult: boolOrNull(value.setFreshResult),
    setResultMismatch: boolOrNull(value.setResultMismatch),
  };
}

function normalizeDebugTransformableCacheSnapshot(value) {
  if (!value || typeof value !== 'object')
    return null;

  const axisStripCount = Number(value.axisStripCount);
  const tiltedRenderCount = Number(value.tiltedRenderCount);
  const hasAxisStrip = boolOrNull(value.hasAxisStrip);
  const hasTiltedStrip = boolOrNull(value.hasTiltedStrip);
  const isCompletelyFilled = boolOrNull(value.isCompletelyFilled);

  if (
    !Number.isFinite(axisStripCount) &&
    !Number.isFinite(tiltedRenderCount) &&
    hasAxisStrip == null &&
    hasTiltedStrip == null &&
    isCompletelyFilled == null
  ) {
    return null;
  }

  return {
    axisStripCount: Number.isFinite(axisStripCount) ? axisStripCount : null,
    tiltedRenderCount: Number.isFinite(tiltedRenderCount) ? tiltedRenderCount : null,
    hasAxisStrip,
    hasTiltedStrip,
    isCompletelyFilled,
  };
}

function normalizeDebugTransformableFieldMismatches(value, current, fresh) {
  const fromValue = value && typeof value === 'object' ? {
    axisStripCount: boolOrNull(value.axisStripCount),
    tiltedRenderCount: boolOrNull(value.tiltedRenderCount),
    hasAxisStrip: boolOrNull(value.hasAxisStrip),
    hasTiltedStrip: boolOrNull(value.hasTiltedStrip),
    isCompletelyFilled: boolOrNull(value.isCompletelyFilled),
  } : null;

  const derived = deriveFieldMismatchFromSnapshots(current, fresh);
  if (!fromValue)
    return derived;

  return {
    axisStripCount: fromValue.axisStripCount ?? derived?.axisStripCount ?? null,
    tiltedRenderCount: fromValue.tiltedRenderCount ?? derived?.tiltedRenderCount ?? null,
    hasAxisStrip: fromValue.hasAxisStrip ?? derived?.hasAxisStrip ?? null,
    hasTiltedStrip: fromValue.hasTiltedStrip ?? derived?.hasTiltedStrip ?? null,
    isCompletelyFilled: fromValue.isCompletelyFilled ?? derived?.isCompletelyFilled ?? null,
  };
}

function deriveFieldMismatchFromSnapshots(current, fresh) {
  if (!current || !fresh)
    return null;

  return {
    axisStripCount: current.axisStripCount !== fresh.axisStripCount,
    tiltedRenderCount: current.tiltedRenderCount !== fresh.tiltedRenderCount,
    hasAxisStrip: current.hasAxisStrip !== fresh.hasAxisStrip,
    hasTiltedStrip: current.hasTiltedStrip !== fresh.hasTiltedStrip,
    isCompletelyFilled: current.isCompletelyFilled !== fresh.isCompletelyFilled,
  };
}

function deriveCurrentVsFreshMismatch(fieldMismatches) {
  if (!fieldMismatches || typeof fieldMismatches !== 'object')
    return null;

  for (const key of ['axisStripCount', 'tiltedRenderCount', 'hasAxisStrip', 'hasTiltedStrip', 'isCompletelyFilled']) {
    if (fieldMismatches[key] === true)
      return true;
  }
  for (const key of ['axisStripCount', 'tiltedRenderCount', 'hasAxisStrip', 'hasTiltedStrip', 'isCompletelyFilled']) {
    if (fieldMismatches[key] === false)
      return false;
  }
  return null;
}

function boolOrNull(value) {
  if (value === true)
    return true;
  if (value === false)
    return false;
  return null;
}

function buildCandidateSignature(sample) {
  return JSON.stringify([
    sample.blockState ?? '',
    Number.isInteger(sample.color) ? sample.color : '',
    sample.kind ?? '',
    sample.facing ?? '',
    sample.outside === true ? 1 : 0,
    sample.minX,
    sample.minY,
    sample.minZ,
    sample.maxX,
    sample.maxY,
    sample.maxZ,
    signatureArray(sample.transformData),
  ]);
}

function buildCandidateSignatureIgnoringOutside(sample) {
  return JSON.stringify([
    sample.blockState ?? '',
    Number.isInteger(sample.color) ? sample.color : '',
    sample.kind ?? '',
    sample.facing ?? '',
    sample.minX,
    sample.minY,
    sample.minZ,
    sample.maxX,
    sample.maxY,
    sample.maxZ,
    signatureArray(sample.transformData),
  ]);
}

function signatureArray(value) {
  if (!Array.isArray(value) || value.length === 0)
    return '';
  return value.join(',');
}

function diffCandidateMultisets(expected, actual) {
  const keys = new Set([...expected.keys(), ...actual.keys()]);
  const missingEntries = [];
  const extraEntries = [];
  let missingTotal = 0;
  let extraTotal = 0;

  for (const key of keys) {
    const expectedEntry = expected.get(key);
    const actualEntry = actual.get(key);
    const expectedCount = expectedEntry?.count ?? 0;
    const actualCount = actualEntry?.count ?? 0;

    if (expectedCount > actualCount) {
      const delta = expectedCount - actualCount;
      missingTotal += delta;
      missingEntries.push({
        key,
        delta,
        expectedCount,
        actualCount,
        sample: expectedEntry?.sample ?? actualEntry?.sample ?? null,
      });
      continue;
    }

    if (actualCount > expectedCount) {
      const delta = actualCount - expectedCount;
      extraTotal += delta;
      extraEntries.push({
        key,
        delta,
        expectedCount,
        actualCount,
        sample: actualEntry?.sample ?? expectedEntry?.sample ?? null,
      });
    }
  }

  const sortFn = (a, b) => {
    if (b.delta !== a.delta)
      return b.delta - a.delta;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  };

  missingEntries.sort(sortFn);
  extraEntries.sort(sortFn);

  return {
    missingTotal,
    extraTotal,
    missingEntries,
    extraEntries,
  };
}

function summarizeDiffEntries(entries, limit) {
  return entries.slice(0, limit).map((entry) => ({
    key: entry.key,
    delta: entry.delta,
    expectedCount: entry.expectedCount,
    actualCount: entry.actualCount,
    sample: entry.sample,
  }));
}

function summarizeFocusedCandidateDiff(diff, limit) {
  const focusPredicate = (entry) => {
    const sample = entry.sample;
    return sample?.outside === true && sample?.facing === 'DOWN' && sample?.kind === 'transformable';
  };

  const missingEntries = diff.missingEntries.filter(focusPredicate);
  const extraEntries = diff.extraEntries.filter(focusPredicate);

  return {
    filter: {
      outside: true,
      facing: 'DOWN',
      kind: 'transformable',
    },
    missingTotal: missingEntries.reduce((sum, entry) => sum + entry.delta, 0),
    extraTotal: extraEntries.reduce((sum, entry) => sum + entry.delta, 0),
    missingEntries: summarizeDiffEntries(missingEntries, limit),
    extraEntries: summarizeDiffEntries(extraEntries, limit),
  };
}

function buildStandaloneFaceCacheIndex(tiles) {
  const out = new Map();

  for (const tile of tiles) {
    for (const box of tile.boxes ?? []) {
      if (box.kind !== 'transformable')
        continue;

      // Warm transform cache for this box via existing candidate builder path.
      buildFaceCandidates(tile, box);

      const faceCache = box.transformCache?.faces;
      if (!faceCache || typeof faceCache !== 'object')
        continue;

      const signature = buildBoxSignature({
        blockState: tile.blockState,
        color: tile.color,
        kind: box.kind,
        minX: box.minX,
        minY: box.minY,
        minZ: box.minZ,
        maxX: box.maxX,
        maxY: box.maxY,
        maxZ: box.maxZ,
        transformData: box.transformData,
      });
      if (out.has(signature))
        continue;

      const byFacing = {};
      const diagnostics = collectTransformableDiagnostics(box) ?? {};

      for (const facing of ['DOWN', 'UP', 'NORTH', 'SOUTH', 'WEST', 'EAST']) {
        const entry = faceCache[facing];
        const diag = diagnostics[facing];
        byFacing[facing] = {
          axisStrips: Array.isArray(entry?.axisStrips) ? entry.axisStrips.length : 0,
          tiltedRender: Array.isArray(entry?.tiltedRender) ? entry.tiltedRender.length : 0,
          isCompletelyFilled: entry?.isCompletelyFilled === true,
          rawAxisStrips: diag ? diag.rawAxisStripCount : null,
          rawTiltedRender: diag ? diag.rawTiltedRenderCount : null,
          rawAxisDegenerate: diag ? diag.rawAxisDegenerateCount : null,
          rawTiltedDegenerate: diag ? diag.rawTiltedDegenerateCount : null,
        };
      }
      out.set(signature, byFacing);
    }
  }

  return out;
}

function enrichDiffEntriesWithStandaloneCache(entries, standaloneFaceCacheIndex) {
  for (const entry of entries) {
    const sample = entry.sample;
    if (!sample || typeof sample !== 'object')
      continue;
    if (sample.kind !== 'transformable')
      continue;

    const signature = buildBoxSignature(sample);
    const byFacing = standaloneFaceCacheIndex.get(signature);
    if (!byFacing)
      continue;

    const facing = String(sample.facing ?? '');
    sample.standaloneFaceCache = {
      facing,
      ...(byFacing[facing] ?? null),
    };
  }
}

function enrichDiffEntriesWithDebugFaceStateContext(entries, debugFaceStateContextIndex) {
  for (const entry of entries) {
    const sample = entry.sample;
    if (!sample || typeof sample !== 'object')
      continue;

    const exact = debugFaceStateContextIndex?.exact?.get(entry.key);
    if (exact) {
      sample.debugFaceStateContext = {
        match: 'exact',
        count: exact.count,
        states: exact.states,
        reasons: exact.reasons,
        state: exact.sample.state,
        reason: exact.sample.reason,
        outside: exact.sample.outside,
        renderable: exact.sample.renderable,
        coveredFully: exact.sample.coveredFully,
        partially: exact.sample.partially,
      };
      if (!sample.debugTransformableCache && exact.sample.debugTransformableCache)
        sample.debugTransformableCache = exact.sample.debugTransformableCache;
      continue;
    }

    const noOutsideKey = buildCandidateSignatureIgnoringOutside(sample);
    const nearest = debugFaceStateContextIndex?.noOutside?.get(noOutsideKey);
    if (!nearest)
      continue;

    sample.debugFaceStateContext = {
      match: 'ignoringOutside',
      count: nearest.count,
      states: nearest.states,
      reasons: nearest.reasons,
      state: nearest.sample.state,
      reason: nearest.sample.reason,
      outside: nearest.sample.outside,
      renderable: nearest.sample.renderable,
      coveredFully: nearest.sample.coveredFully,
      partially: nearest.sample.partially,
    };
    if (!sample.debugTransformableCache && nearest.sample.debugTransformableCache)
      sample.debugTransformableCache = nearest.sample.debugTransformableCache;
  }
}

function buildBoxSignature(sample) {
  return JSON.stringify([
    sample.blockState ?? '',
    Number.isInteger(sample.color) ? sample.color : '',
    sample.kind ?? '',
    sample.minX,
    sample.minY,
    sample.minZ,
    sample.maxX,
    sample.maxY,
    sample.maxZ,
    signatureArray(sample.transformData),
  ]);
}
