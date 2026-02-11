export function summarizeDebugFaceStates(root) {
  const byFacingAll = Object.fromEntries(['DOWN', 'UP', 'NORTH', 'SOUTH', 'WEST', 'EAST'].map((key) => [key, 0]));
  const byFacingRenderable = Object.fromEntries(['DOWN', 'UP', 'NORTH', 'SOUTH', 'WEST', 'EAST'].map((key) => [key, 0]));
  const byOutsideAll = { inside: 0, outside: 0 };
  const byOutsideRenderable = { inside: 0, outside: 0 };

  let seenAny = false;
  let totalFaces = 0;
  let totalRenderableFaces = 0;

  const stack = [root];
  while (stack.length > 0) {
    const group = stack.pop();
    if (!group || typeof group !== 'object')
      continue;

    for (const tile of group.tiles ?? []) {
      for (const box of tile.boxes ?? []) {
        if (!Array.isArray(box.faceStates))
          continue;

        for (const face of box.faceStates) {
          seenAny = true;
          totalFaces++;

          const facing = String(face?.facing ?? '');
          if (Object.hasOwn(byFacingAll, facing))
            byFacingAll[facing]++;

          const outside = face?.outside === true;
          if (outside)
            byOutsideAll.outside++;
          else
            byOutsideAll.inside++;

          if (isDebugFaceRenderable(face)) {
            totalRenderableFaces++;
            if (Object.hasOwn(byFacingRenderable, facing))
              byFacingRenderable[facing]++;
            if (outside)
              byOutsideRenderable.outside++;
            else
              byOutsideRenderable.inside++;
          }
        }
      }
    }

    for (const child of group.children ?? [])
      stack.push(child);
  }

  if (!seenAny)
    return null;

  return {
    totalFaces,
    totalRenderableFaces,
    byFacingAll,
    byFacingRenderable,
    byOutsideAll,
    byOutsideRenderable,
  };
}

export function isDebugFaceRenderable(face) {
  const state = String(face?.state ?? '');
  const coveredFully = face?.coveredFully === true || state === 'INSIDE_COVERED' || state === 'OUTISDE_COVERED';
  const isUnloaded = state === 'UNLOADED';
  return !isUnloaded && !coveredFully;
}

export function sanitizeDebugFaceStateSummary(summary) {
  if (!summary || typeof summary !== 'object')
    return null;

  return {
    totalFaces: Number.isInteger(summary.totalFaces) ? summary.totalFaces : null,
    renderableFaces: Number.isInteger(summary.renderableFaces) ? summary.renderableFaces : null,
    insideFaces: Number.isInteger(summary.insideFaces) ? summary.insideFaces : null,
    outsideFaces: Number.isInteger(summary.outsideFaces) ? summary.outsideFaces : null,
  };
}

export function sanitizeTransformableDiagnosticsSummary(summary) {
  if (!summary || typeof summary !== 'object')
    return null;

  return {
    transformableFacesEvaluated: Number.isInteger(summary.transformableFacesEvaluated)
      ? summary.transformableFacesEvaluated
      : null,
    currentVsFreshCacheMismatchFaces: Number.isInteger(summary.currentVsFreshCacheMismatchFaces)
      ? summary.currentVsFreshCacheMismatchFaces
      : null,
    generateFaceCurrentVsFreshMismatchFaces: Number.isInteger(summary.generateFaceCurrentVsFreshMismatchFaces)
      ? summary.generateFaceCurrentVsFreshMismatchFaces
      : null,
    setCurrentVsFreshMismatchFaces: Number.isInteger(summary.setCurrentVsFreshMismatchFaces)
      ? summary.setCurrentVsFreshMismatchFaces
      : null,
  };
}
