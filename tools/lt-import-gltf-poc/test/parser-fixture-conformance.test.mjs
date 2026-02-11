import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';

import { parseLtImportSnbt } from '../src/lt-import-parser.mjs';
import { countGroupStats } from './helpers/stats.mjs';
import { canonicalGroupFromDebug, canonicalGroupFromParsed } from './helpers/canonicalizer.mjs';
import { firstDiff } from './helpers/diff.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, '../../..');
const parityDir = path.join(repoRoot, 'fixtures/outputs/parity-debug');

const fixtureFiles = readdirSync(parityDir)
  .filter((name) => name.toLowerCase().endsWith('.json'))
  .sort();

for (const name of fixtureFiles) {
  test(`parser fixture conformance: ${name}`, () => {
    const debugPath = path.join(parityDir, name);
    const debug = JSON.parse(readFileSync(debugPath, 'utf8'));

    const rawInputPath = path.resolve(String(debug.inputPath));
    const rawSnbt = readFileSync(rawInputPath, 'utf8');

    const parsedRaw = parseLtImportSnbt(rawSnbt);
    const parsedNormalized = parseLtImportSnbt(String(debug.normalizedSnbt));

    assert.equal(parsedRaw.schema, debug.schema, 'raw schema mismatch');
    assert.equal(parsedNormalized.schema, 'current', 'normalized schema should be current');

    const expectedStats = sanitizeStats(debug.stats);
    const actualStats = countGroupStats(parsedNormalized.root);
    assert.deepEqual(actualStats, expectedStats, 'normalized stats mismatch');

    const expectedRoot = canonicalGroupFromDebug(debug.root);
    const actualRoot = canonicalGroupFromParsed(parsedNormalized.root);
    const diff = firstDiff(actualRoot, expectedRoot);
    assert.equal(diff, null, diff ? `tree mismatch at ${diff.path}` : 'tree mismatch');
  });
}

function sanitizeStats(stats) {
  const inStats = stats && typeof stats === 'object' ? stats : {};
  return {
    groups: intOrZero(inStats.groups),
    tiles: intOrZero(inStats.tiles),
    boxes: intOrZero(inStats.boxes),
    transformableBoxes: intOrZero(inStats.transformableBoxes),
  };
}

function intOrZero(value) {
  return Number.isInteger(value) ? value : 0;
}
