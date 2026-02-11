#!/usr/bin/env node
import { ParseError } from './lt-import-parser.mjs';
import { expandJsonInputs, parsePositiveIntArg } from './parity/io.mjs';
import { checkFile, buildFatalFileResult } from './parity/check-file.mjs';
import { printResult, buildJsonReport } from './parity/reporting.mjs';
import { GEOMETRY_MODES } from './gltf-writer/postprocess-faces.mjs';

function main(argv) {
  const args = parseArgs(argv);
  if (args.help || args.inputs.length === 0) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const files = expandJsonInputs(args.inputs);
  if (files.length === 0)
    throw new ParseError('No JSON files found in provided inputs.');

  let failures = 0;
  let total = 0;
  const results = [];

  for (const file of files) {
    total++;
    let result;
    try {
      result = checkFile(file, {
        requireFaceStates: args.requireFaceStates,
        candidateDiff: args.candidateDiff,
        candidateDiffLimit: args.candidateDiffLimit,
        geometryMode: args.geometryMode,
      });
    } catch (error) {
      result = buildFatalFileResult(file, error);
    }
    results.push(result);
    if (result.failures.length > 0)
      failures++;

    if (!args.json)
      printResult(result);
  }

  const status = failures === 0 ? 'PASS' : 'FAIL';
  if (args.json) {
    console.log(JSON.stringify(buildJsonReport(results, {
      status,
      total,
      failures,
      requireFaceStates: args.requireFaceStates,
      candidateDiff: args.candidateDiff,
      geometryMode: args.geometryMode,
    }), null, 2));
  } else {
    console.log(`\nSummary: ${status} (${total - failures}/${total} files clean)`);
  }

  if (failures > 0)
    process.exit(1);
}

function parseArgs(argv) {
  const out = {
    help: false,
    json: false,
    requireFaceStates: false,
    candidateDiff: false,
    candidateDiffLimit: 12,
    geometryMode: null,
    inputs: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      out.help = true;
      continue;
    }
    if (arg === '--json') {
      out.json = true;
      continue;
    }
    if (arg === '--require-face-states') {
      out.requireFaceStates = true;
      continue;
    }
    if (arg === '--candidate-diff') {
      out.candidateDiff = true;
      continue;
    }
    if (arg === '--candidate-diff-limit') {
      const next = argv[i + 1];
      out.candidateDiffLimit = parsePositiveIntArg(next, '--candidate-diff-limit');
      i++;
      continue;
    }
    if (arg.startsWith('--candidate-diff-limit=')) {
      const [, raw] = arg.split('=', 2);
      out.candidateDiffLimit = parsePositiveIntArg(raw, '--candidate-diff-limit');
      continue;
    }
    if (arg === '--geometry-mode') {
      out.geometryMode = normalizeGeometryMode(argv[++i], '--geometry-mode');
      continue;
    }
    if (arg.startsWith('--geometry-mode=')) {
      const [, raw] = arg.split('=', 2);
      out.geometryMode = normalizeGeometryMode(raw, '--geometry-mode');
      continue;
    }
    out.inputs.push(arg);
  }

  return out;
}

function printHelp() {
  console.log(`Check standalone parser/cull parity against lt-debug-export JSON fixtures.
If fixture includes per-box faceStates, candidate-level face parity is also checked.

Usage:
  lt-parity-debug-check [--json] [--require-face-states] [--candidate-diff] [--candidate-diff-limit N] [--geometry-mode server|client] <debug.json ...>
  lt-parity-debug-check [--json] [--require-face-states] [--candidate-diff] [--candidate-diff-limit N] [--geometry-mode server|client] <directory>

Examples:
  bun run src/parity-debug-check.mjs ../../fixtures/outputs/parity-debug
  node src/parity-debug-check.mjs --json ../../fixtures/outputs/parity-debug
  node src/parity-debug-check.mjs --require-face-states ../../fixtures/outputs/parity-debug
  node src/parity-debug-check.mjs --geometry-mode server ../../fixtures/outputs/parity-debug
  node src/parity-debug-check.mjs --candidate-diff --candidate-diff-limit 20 ../../fixtures/outputs/parity-debug/contemporary\\ style\\ house.json
  node src/parity-debug-check.mjs ../../fixtures/outputs/parity-debug/simple_light.json

Notes:
  --geometry-mode defaults to fixture metadata ("geometryMode"); if missing, fallback is server.
  valid geometry modes: ${GEOMETRY_MODES.join(', ')}
`);
}

function normalizeGeometryMode(raw, flagName) {
  const mode = String(raw ?? '').trim().toLowerCase();
  if (GEOMETRY_MODES.includes(mode))
    return mode;
  throw new ParseError(`Invalid ${flagName} value: ${raw}. Expected one of: ${GEOMETRY_MODES.join(', ')}`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const isKnown = error instanceof ParseError;
  console.error(`Error: ${error.message}`);
  if (!isKnown && error?.stack)
    console.error(error.stack);
  process.exit(1);
}
