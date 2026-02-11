import path from 'node:path';
import { readFileSync } from 'node:fs';
import { ParseError, parseLtImportSnbt } from '../lt-import-parser.mjs';
import {
  boxesToPrimitiveMeshes,
  collectFaceDebugSummary,
  collectRenderableFaceCandidateSummary,
} from '../gltf-writer.mjs';
import { resolveGeometryMode } from '../gltf-writer/postprocess-faces.mjs';
import { buildCandidateDiffReport } from './candidate-diff.mjs';
import {
  summarizeDebugFaceStates,
  sanitizeDebugFaceStateSummary,
  sanitizeTransformableDiagnosticsSummary,
} from './face-state-summary.mjs';
import {
  sanitizeStats,
  countGroupStats,
  canonicalGroupFromParsed,
  canonicalGroupFromDebug,
  firstDiff,
} from './schema-tree-compare.mjs';
import { sanitizeRuntimeMetadata } from './io.mjs';

export function checkFile(file, options = {}) {
  const debug = JSON.parse(readFileSync(file, 'utf8'));
  const failures = [];
  const runtime = sanitizeRuntimeMetadata(debug);
  const geometryMode = resolveParityGeometryMode(options, debug);

  if (typeof debug.inputPath !== 'string')
    throw new ParseError(`${file}: missing required string field "inputPath".`);
  if (typeof debug.normalizedSnbt !== 'string')
    throw new ParseError(`${file}: missing required string field "normalizedSnbt".`);

  const rawInputPath = path.resolve(debug.inputPath);
  const rawSnbt = readFileSync(rawInputPath, 'utf8');

  const parsedRaw = parseLtImportSnbt(rawSnbt);
  const parsedNormalized = parseLtImportSnbt(debug.normalizedSnbt);

  if (debug.outsideNeighborPolicy !== 'air') {
    failures.push(
      `outsideNeighborPolicy mismatch: debug=${JSON.stringify(debug.outsideNeighborPolicy)}, expected=\"air\"`
    );
  }

  if (parsedRaw.schema !== debug.schema)
    failures.push(`schema mismatch: debug=${debug.schema}, standalone(raw)=${parsedRaw.schema}`);

  const expectedStats = sanitizeStats(debug.stats);
  const actualStats = countGroupStats(parsedNormalized.root);
  for (const key of ['groups', 'tiles', 'boxes', 'transformableBoxes']) {
    if (expectedStats[key] !== actualStats[key]) {
      failures.push(`stats.${key} mismatch: debug=${expectedStats[key]}, standalone(normalized)=${actualStats[key]}`);
    }
  }

  const expectedRoot = canonicalGroupFromDebug(debug.root);
  const actualRoot = canonicalGroupFromParsed(parsedNormalized.root);
  const treeDiff = firstDiff(actualRoot, expectedRoot);
  if (treeDiff)
    failures.push(`tree mismatch at ${treeDiff.path}`);

  const cullRaw = boxesToPrimitiveMeshes(parsedRaw, {
    evaluateInternalOcclusion: true,
    runtime,
    geometryMode,
  }).stats;
  const cullNormalized = boxesToPrimitiveMeshes(parsedNormalized, {
    evaluateInternalOcclusion: true,
    runtime,
    geometryMode,
  }).stats;
  const faceSummary = collectFaceDebugSummary(parsedNormalized, {
    evaluateInternalOcclusion: true,
    runtime,
    geometryMode,
  });
  const renderableFaceCandidates = collectRenderableFaceCandidateSummary(parsedNormalized, {
    evaluateInternalOcclusion: true,
    runtime,
    geometryMode,
  });

  const debugFaceStates = summarizeDebugFaceStates(debug.root);
  const debugFaceStateSummary = sanitizeDebugFaceStateSummary(debug.faceStateSummary);
  const debugTransformableDiagnosticsSummary = sanitizeTransformableDiagnosticsSummary(
    debug.transformableDiagnosticsSummary
  );
  const candidateDiffReport = options.candidateDiff
    ? buildCandidateDiffReport(parsedNormalized, debug.root, {
        runtime,
        limit: options.candidateDiffLimit,
        geometryMode,
      })
    : null;

  if (options.requireFaceStates) {
    if (!debugFaceStates)
      failures.push('fixture missing per-box faceStates arrays (required by --require-face-states)');
    if (!debugFaceStateSummary)
      failures.push('fixture missing top-level faceStateSummary (required by --require-face-states)');
  }

  if (debugFaceStates) {
    if (debugFaceStates.totalRenderableFaces !== renderableFaceCandidates.totalVisibleCandidates) {
      failures.push(
        `face candidates mismatch: debugRenderable=${debugFaceStates.totalRenderableFaces}, standaloneVisible=${renderableFaceCandidates.totalVisibleCandidates}`
      );
    }

    for (const facing of ['DOWN', 'UP', 'NORTH', 'SOUTH', 'WEST', 'EAST']) {
      if (debugFaceStates.byFacingRenderable[facing] !== renderableFaceCandidates.byFacing[facing]) {
        failures.push(
          `face candidates byFacing.${facing} mismatch: debug=${debugFaceStates.byFacingRenderable[facing]}, standalone=${renderableFaceCandidates.byFacing[facing]}`
        );
      }
    }

    for (const key of ['inside', 'outside']) {
      if (debugFaceStates.byOutsideRenderable[key] !== renderableFaceCandidates.byOutside[key]) {
        failures.push(
          `face candidates byOutside.${key} mismatch: debug=${debugFaceStates.byOutsideRenderable[key]}, standalone=${renderableFaceCandidates.byOutside[key]}`
        );
      }
    }
  }

  if (debugFaceStateSummary) {
    if (
      debugFaceStateSummary.renderableFaces != null &&
      debugFaceStateSummary.renderableFaces !== renderableFaceCandidates.totalVisibleCandidates
    ) {
      failures.push(
        `faceStateSummary.renderableFaces mismatch: debug=${debugFaceStateSummary.renderableFaces}, standaloneVisible=${renderableFaceCandidates.totalVisibleCandidates}`
      );
    }

    if (debugFaceStateSummary.totalFaces != null && debugFaceStates) {
      if (debugFaceStateSummary.totalFaces !== debugFaceStates.totalFaces) {
        failures.push(
          `faceStateSummary.totalFaces mismatch: summary=${debugFaceStateSummary.totalFaces}, faceStates=${debugFaceStates.totalFaces}`
        );
      }
    }

    if (
      debugFaceStateSummary.totalFaces != null &&
      debugFaceStateSummary.insideFaces != null &&
      debugFaceStateSummary.outsideFaces != null &&
      debugFaceStateSummary.insideFaces + debugFaceStateSummary.outsideFaces !== debugFaceStateSummary.totalFaces
    ) {
      failures.push(
        `faceStateSummary inside/outside mismatch: inside(${debugFaceStateSummary.insideFaces}) + outside(${debugFaceStateSummary.outsideFaces}) != total(${debugFaceStateSummary.totalFaces})`
      );
    }
  }

  if (candidateDiffReport && (candidateDiffReport.missingTotal > 0 || candidateDiffReport.extraTotal > 0)) {
    failures.push(
      `candidate diff keys mismatch: missing=${candidateDiffReport.missingTotal}, extra=${candidateDiffReport.extraTotal}`
    );
  }

  return {
    file,
    inputPath: rawInputPath,
    debugSchema: debug.schema,
    normalizedSchema: parsedNormalized.schema,
    runtime,
    geometryMode,
    failures,
    stats: actualStats,
    cullRaw,
    cullNormalized,
    faceSummary,
    renderableFaceCandidates,
    debugFaceStates,
    debugFaceStateSummary,
    debugTransformableDiagnosticsSummary,
    candidateDiffReport,
  };
}

function resolveParityGeometryMode(options, debug) {
  if (typeof options.geometryMode === 'string' && options.geometryMode.trim().length > 0) {
    return resolveGeometryMode({
      geometryMode: options.geometryMode,
    });
  }

  if (typeof debug?.geometryMode === 'string' && debug.geometryMode.trim().length > 0) {
    return resolveGeometryMode({
      geometryMode: debug.geometryMode,
    });
  }

  return 'server';
}

export function buildFatalFileResult(file, error) {
  const message = error?.message ? String(error.message) : String(error);
  return {
    file,
    inputPath: '(unresolved)',
    debugSchema: '(unresolved)',
    normalizedSchema: '(unresolved)',
    runtime: null,
    failures: [`fatal check error: ${message}`],
    stats: {
      groups: 0,
      tiles: 0,
      boxes: 0,
      transformableBoxes: 0,
    },
    cullRaw: {
      faceCount: 0,
      primitiveCount: 0,
      transformableFaceCount: 0,
    },
    cullNormalized: {
      faceCount: 0,
      primitiveCount: 0,
      transformableFaceCount: 0,
    },
    faceSummary: {
      byFaceType: { axis: 0, tilted: 0 },
      byOutside: { inside: 0, outside: 0 },
    },
    renderableFaceCandidates: {
      totalVisibleCandidates: 0,
      byOutside: { inside: 0, outside: 0 },
    },
    debugFaceStates: null,
    debugFaceStateSummary: null,
    debugTransformableDiagnosticsSummary: null,
    candidateDiffReport: null,
  };
}
