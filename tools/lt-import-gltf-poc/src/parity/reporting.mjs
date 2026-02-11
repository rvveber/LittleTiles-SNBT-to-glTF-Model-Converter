export function printResult(result) {
  const status = result.failures.length === 0 ? 'PASS' : 'FAIL';
  console.log(`\n[${status}] ${result.file}`);
  console.log(`  input: ${result.inputPath}`);
  console.log(`  schema: debug=${result.debugSchema}, normalized=${result.normalizedSchema}`);
  console.log(
    `  stats: groups=${result.stats.groups}, tiles=${result.stats.tiles}, boxes=${result.stats.boxes}, transformables=${result.stats.transformableBoxes}`
  );
  console.log(
    `  cull(raw): faces=${result.cullRaw.faceCount}, primitives=${result.cullRaw.primitiveCount}, transformableFaces=${result.cullRaw.transformableFaceCount}`
  );
  console.log(
    `  cull(normalized): faces=${result.cullNormalized.faceCount}, primitives=${result.cullNormalized.primitiveCount}, transformableFaces=${result.cullNormalized.transformableFaceCount}`
  );
  console.log(`  geometryMode: ${result.geometryMode ?? 'server'}`);
  if (result.runtime) {
    console.log(
      `  runtime: minecraft=${result.runtime.minecraftVersion ?? '-'}, littletiles=${result.runtime.littleTilesVersion ?? '-'}, creativecore=${result.runtime.creativeCoreVersion ?? '-'}, exporter=${result.runtime.parityExporterVersion ?? '-'}`
    );
  }
  const byFaceType = result.faceSummary.byFaceType;
  const byOutside = result.faceSummary.byOutside;
  console.log(
    `  faceSummary(normalized): axis=${byFaceType.axis}, tilted=${byFaceType.tilted}, inside=${byOutside.inside}, outside=${byOutside.outside}`
  );
  console.log(
    `  renderableFaceCandidates(normalized): total=${result.renderableFaceCandidates.totalVisibleCandidates}, inside=${result.renderableFaceCandidates.byOutside.inside}, outside=${result.renderableFaceCandidates.byOutside.outside}`
  );
  if (result.debugFaceStates) {
    console.log(
      `  debugFaceStates: total=${result.debugFaceStates.totalFaces}, renderable=${result.debugFaceStates.totalRenderableFaces}, renderableInside=${result.debugFaceStates.byOutsideRenderable.inside}, renderableOutside=${result.debugFaceStates.byOutsideRenderable.outside}`
    );
  } else {
    console.log('  debugFaceStates: absent (no faceStates arrays in fixture)');
  }
  if (result.debugFaceStateSummary) {
    console.log(
      `  faceStateSummary(debug): total=${result.debugFaceStateSummary.totalFaces ?? '-'}, renderable=${result.debugFaceStateSummary.renderableFaces ?? '-'}, inside=${result.debugFaceStateSummary.insideFaces ?? '-'}, outside=${result.debugFaceStateSummary.outsideFaces ?? '-'}`
    );
  }
  if (result.debugTransformableDiagnosticsSummary) {
    const summary = result.debugTransformableDiagnosticsSummary;
    console.log(
      `  transformableDiagnostics(debug): faces=${summary.transformableFacesEvaluated ?? '-'}, cacheMismatch=${summary.currentVsFreshCacheMismatchFaces ?? '-'}, generateFaceMismatch=${summary.generateFaceCurrentVsFreshMismatchFaces ?? '-'}, setMismatch=${summary.setCurrentVsFreshMismatchFaces ?? '-'}`
    );
  }
  if (result.failures.length > 0) {
    for (const failure of result.failures)
      console.log(`  - ${failure}`);
  }
  if (result.candidateDiffReport) {
    console.log(
      `  candidateDiff(keys): missing=${result.candidateDiffReport.missingTotal}, extra=${result.candidateDiffReport.extraTotal}`
    );
    const focus = result.candidateDiffReport.focus;
    console.log(
      `  candidateDiff focus (outside=${focus.filter.outside}, facing=${focus.filter.facing}, kind=${focus.filter.kind}): missing=${focus.missingTotal}, extra=${focus.extraTotal}`
    );
    for (const entry of focus.missingEntries) {
      const sample = entry.sample ?? {};
      const cacheText = formatStandaloneTransformableCache(sample.standaloneFaceCache);
      const debugCacheText = formatDebugTransformableCache(sample.debugTransformableCache);
      const debugFaceStateText = formatDebugFaceStateContext(sample.debugFaceStateContext);
      console.log(
        `    missing delta=${entry.delta} key=${entry.key} group=${sample.groupPath ?? '-'} tileIndex=${sample.tileIndex ?? '-'} boxIndex=${sample.boxIndex ?? '-'} reason=${sample.reason ?? '-'}${cacheText}${debugCacheText}${debugFaceStateText}`
      );
    }
    for (const entry of focus.extraEntries) {
      const sample = entry.sample ?? {};
      const cacheText = formatStandaloneTransformableCache(sample.standaloneFaceCache);
      const debugCacheText = formatDebugTransformableCache(sample.debugTransformableCache);
      const debugFaceStateText = formatDebugFaceStateContext(sample.debugFaceStateContext);
      console.log(
        `    extra delta=${entry.delta} key=${entry.key} group=${sample.groupPath ?? '-'} tileIndex=${sample.tileIndex ?? '-'} boxIndex=${sample.boxIndex ?? '-'} reason=${sample.reason ?? '-'}${cacheText}${debugCacheText}${debugFaceStateText}`
      );
    }

    if (
      focus.missingEntries.length === 0 &&
      focus.extraEntries.length === 0 &&
      (result.candidateDiffReport.missingEntries.length > 0 || result.candidateDiffReport.extraEntries.length > 0)
    ) {
      console.log('  candidateDiff sampled entries (non-focus):');

      for (const entry of result.candidateDiffReport.missingEntries.slice(0, 3)) {
        const sample = entry.sample ?? {};
        const cacheText = formatStandaloneTransformableCache(sample.standaloneFaceCache);
        const debugCacheText = formatDebugTransformableCache(sample.debugTransformableCache);
        const debugFaceStateText = formatDebugFaceStateContext(sample.debugFaceStateContext);
        console.log(
          `    missing delta=${entry.delta} key=${entry.key} group=${sample.groupPath ?? '-'} tileIndex=${sample.tileIndex ?? '-'} boxIndex=${sample.boxIndex ?? '-'} reason=${sample.reason ?? '-'}${cacheText}${debugCacheText}${debugFaceStateText}`
        );
      }
      for (const entry of result.candidateDiffReport.extraEntries.slice(0, 3)) {
        const sample = entry.sample ?? {};
        const cacheText = formatStandaloneTransformableCache(sample.standaloneFaceCache);
        const debugCacheText = formatDebugTransformableCache(sample.debugTransformableCache);
        const debugFaceStateText = formatDebugFaceStateContext(sample.debugFaceStateContext);
        console.log(
          `    extra delta=${entry.delta} key=${entry.key} group=${sample.groupPath ?? '-'} tileIndex=${sample.tileIndex ?? '-'} boxIndex=${sample.boxIndex ?? '-'} reason=${sample.reason ?? '-'}${cacheText}${debugCacheText}${debugFaceStateText}`
        );
      }
    }
  }
}

export function buildJsonReport(results, summary) {
  return {
    generatedAt: new Date().toISOString(),
    options: {
      requireFaceStates: summary.requireFaceStates === true,
      candidateDiff: summary.candidateDiff === true,
      geometryMode: summary.geometryMode ?? 'auto',
    },
    summary: {
      status: summary.status,
      totalFiles: summary.total,
      cleanFiles: summary.total - summary.failures,
      failedFiles: summary.failures,
    },
    results,
  };
}

function formatStandaloneTransformableCache(standaloneCache) {
  if (!standaloneCache)
    return '';
  const base = ` axisStrips=${standaloneCache.axisStrips ?? '-'} tiltedRender=${standaloneCache.tiltedRender ?? '-'} isCompletelyFilled=${standaloneCache.isCompletelyFilled === true}`;
  if (
    standaloneCache.rawAxisStrips == null &&
    standaloneCache.rawTiltedRender == null &&
    standaloneCache.rawAxisDegenerate == null &&
    standaloneCache.rawTiltedDegenerate == null
  ) {
    return base;
  }
  return `${base} rawAxisStrips=${standaloneCache.rawAxisStrips ?? '-'} rawTiltedRender=${standaloneCache.rawTiltedRender ?? '-'} rawAxisDegenerate=${standaloneCache.rawAxisDegenerate ?? '-'} rawTiltedDegenerate=${standaloneCache.rawTiltedDegenerate ?? '-'}`;
}

function formatDebugTransformableCache(debugCache) {
  if (!debugCache)
    return '';

  const parts = [];
  const current = debugCache.current ?? null;
  const fresh = debugCache.fresh ?? null;

  if (current || fresh) {
    if (current) {
      parts.push(
        `debugCurrent(axis=${current.axisStripCount ?? '-'},tilted=${current.tiltedRenderCount ?? '-'},filled=${formatBoolValue(current.isCompletelyFilled)})`
      );
    }
    if (fresh) {
      parts.push(
        `debugFresh(axis=${fresh.axisStripCount ?? '-'},tilted=${fresh.tiltedRenderCount ?? '-'},filled=${formatBoolValue(fresh.isCompletelyFilled)})`
      );
    }
    if (typeof debugCache.currentVsFreshMismatch === 'boolean')
      parts.push(`debugCacheMismatch=${debugCache.currentVsFreshMismatch}`);

    const mismatchFields = Object.entries(debugCache.fieldMismatches ?? {})
      .filter(([, mismatch]) => mismatch === true)
      .map(([field]) => field);
    if (mismatchFields.length > 0)
      parts.push(`debugMismatchFields=${mismatchFields.join('|')}`);
  } else if (
    debugCache.axisStripCount != null ||
    debugCache.tiltedRenderCount != null ||
    debugCache.isCompletelyFilled != null
  ) {
    parts.push(
      `debugAxisStrips=${debugCache.axisStripCount ?? '-'} debugTiltedRender=${debugCache.tiltedRenderCount ?? '-'} debugIsCompletelyFilled=${debugCache.isCompletelyFilled === true}`
    );
  }

  if (
    debugCache.generateFaceCurrentNull != null ||
    debugCache.generateFaceFreshNull != null ||
    debugCache.generateFaceNullMismatch != null
  ) {
    parts.push(
      `debugGenerateFace(currentNull=${formatBoolValue(debugCache.generateFaceCurrentNull)},freshNull=${formatBoolValue(debugCache.generateFaceFreshNull)},mismatch=${formatBoolValue(debugCache.generateFaceNullMismatch)})`
    );
  }
  if (
    debugCache.setCurrentResult != null ||
    debugCache.setFreshResult != null ||
    debugCache.setResultMismatch != null
  ) {
    parts.push(
      `debugSet(current=${formatBoolValue(debugCache.setCurrentResult)},fresh=${formatBoolValue(debugCache.setFreshResult)},mismatch=${formatBoolValue(debugCache.setResultMismatch)})`
    );
  }

  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

function formatDebugFaceStateContext(context) {
  if (!context || typeof context !== 'object')
    return '';

  const states = Object.entries(context.states ?? {})
    .map(([state, count]) => `${state}:${count}`)
    .join('|');
  const reasons = Object.entries(context.reasons ?? {})
    .map(([reason, count]) => `${reason}:${count}`)
    .join('|');

  const parts = [
    `debugFaceState(match=${context.match ?? '-'},state=${context.state ?? '-'},reason=${context.reason ?? '-'},outside=${formatBoolValue(context.outside)},renderable=${formatBoolValue(context.renderable)})`,
  ];

  if (context.count != null)
    parts.push(`debugFaceStateCount=${context.count}`);
  if (states)
    parts.push(`debugFaceStateStates=${states}`);
  if (reasons)
    parts.push(`debugFaceStateReasons=${reasons}`);

  return ` ${parts.join(' ')}`;
}

function formatBoolValue(value) {
  if (value === true)
    return 'true';
  if (value === false)
    return 'false';
  return '-';
}
