import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';

import mojangson from 'mojangson';

import { parseLtImportSnbt } from '../src/lt-import-parser.mjs';
import {
  parseSnbtToObject as parseDefaultSnbtToObject,
  sanitizeSnbt,
  sanitizeSnbtForMojangsonArrayPairBug,
} from '../src/snbt-parser.mjs';
import { countGroupStats } from './helpers/stats.mjs';
import { canonicalGroupFromParsed } from './helpers/canonicalizer.mjs';
import { firstDiff } from './helpers/diff.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, '../../..');
const parityDir = path.join(repoRoot, 'fixtures/outputs/parity-debug');

const parserImplementations = [
  {
    name: 'default-parser-path',
    parse(rawSnbt) {
      return parseLtImportSnbt(rawSnbt);
    },
  },
  {
    name: 'boundary-injected-default-parser',
    parse(rawSnbt) {
      return parseLtImportSnbt(rawSnbt, {
        parseSnbtToObject: parseDefaultSnbtToObject,
      });
    },
  },
  {
    name: 'boundary-injected-independent-mojangson-parser',
    parse(rawSnbt) {
      return parseLtImportSnbt(rawSnbt, {
        parseSnbtToObject: parseSnbtToObjectIndependent,
      });
    },
  },
];

const differentialCases = [
  ...loadParityRawCases(),
  {
    name: 'edge-empty-typed-array-legacy',
    rawSnbt: '{tiles:[{bBox:[I;0,0,0,1,1,1],tile:{block:"minecraft:stone"}}],structure:{blocks:[I;]}}',
  },
  {
    name: 'edge-tickets-empty-list-legacy',
    rawSnbt: '{tiles:[{bBox:[I;0,0,0,1,1,1],tile:{block:"minecraft:stone"}}],structure:{signal:[{mode:"EQUAL",con:"c0.b0",delay:1,tickets:[],index:1}]}}',
  },
  {
    name: 'edge-unquoted-keys-current',
    rawSnbt: '{grid:16,t:{"minecraft:stone":[[I;0,0,0,1,1,1]]},c:[],e:{}}',
  },
];

for (const caseDef of differentialCases) {
  test(`parser differential parity: ${caseDef.name}`, () => {
    const baselineImpl = parserImplementations[0];
    const baselineParsed = baselineImpl.parse(caseDef.rawSnbt);
    const baselineSnapshot = semanticSnapshot(baselineParsed);

    for (const impl of parserImplementations.slice(1)) {
      const candidateParsed = impl.parse(caseDef.rawSnbt);
      const candidateSnapshot = semanticSnapshot(candidateParsed);

      assert.equal(
        candidateSnapshot.schema,
        baselineSnapshot.schema,
        `${impl.name}: schema drift`
      );

      assert.deepEqual(
        candidateSnapshot.stats,
        baselineSnapshot.stats,
        `${impl.name}: stats drift`
      );

      assert.deepEqual(
        candidateSnapshot.flatten,
        baselineSnapshot.flatten,
        `${impl.name}: flatten output drift`
      );

      const diff = firstDiff(candidateSnapshot.root, baselineSnapshot.root);
      assert.equal(
        diff,
        null,
        diff
          ? `${impl.name}: semantic tree drift at ${diff.path}`
          : `${impl.name}: semantic tree drift`
      );
    }
  });
}

function loadParityRawCases() {
  const fixtureFiles = readdirSync(parityDir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .sort();

  const cases = [];
  for (const name of fixtureFiles) {
    const debugPath = path.join(parityDir, name);
    const debug = JSON.parse(readFileSync(debugPath, 'utf8'));
    const rawInputPath = path.resolve(String(debug.inputPath));
    const rawSnbt = readFileSync(rawInputPath, 'utf8');
    cases.push({
      name: `${name} (raw)`,
      rawSnbt,
    });
  }

  return cases;
}

function semanticSnapshot(parsed) {
  return {
    schema: parsed.schema,
    stats: countGroupStats(parsed.root),
    flatten: {
      tiles: parsed.tiles.length,
      boxes: parsed.boxes.length,
      transformableBoxes: parsed.boxes.filter((box) => box.kind === 'transformable').length,
    },
    root: canonicalGroupFromParsed(parsed.root),
  };
}

function parseSnbtToObjectIndependent(rawText, options = {}) {
  const createParseError = typeof options.createParseError === 'function'
    ? options.createParseError
    : (message) => new Error(message);

  const primary = sanitizeSnbt(String(rawText ?? ''));

  let tag;
  try {
    tag = mojangson.parse(primary);
  } catch (primaryError) {
    const fallback = sanitizeSnbtForMojangsonArrayPairBug(primary);
    if (fallback !== primary) {
      try {
        tag = mojangson.parse(fallback);
      } catch (fallbackError) {
        throw createParseError(`SNBT parse failed after fallback: ${shortError(fallbackError)}`);
      }
    } else {
      throw createParseError(`SNBT parse failed: ${shortError(primaryError)}`);
    }
  }

  return unwrapMojangsonTag(tag);
}

function shortError(error) {
  const raw = String(error?.message ?? error ?? 'unknown parse error');
  if (raw.includes("Cannot read properties of undefined (reading 'type')"))
    return 'mojangson array/list parser bug (likely untyped numeric list in list-compound payload)';
  if (raw.startsWith('Error parsing text'))
    return 'invalid SNBT text';
  return raw;
}

function unwrapMojangsonTag(tag) {
  if (Array.isArray(tag))
    return tag.map(unwrapMojangsonTag);

  if (!isObject(tag))
    return tag;

  if (typeof tag.type === 'string') {
    const value = tag.value;

    if (tag.type === 'compound' && isObject(value))
      return unwrapMojangsonTag(value);

    if (tag.type === 'list') {
      const values = Array.isArray(value?.value) ? value.value : [];
      return values.map(unwrapMojangsonTag);
    }

    return unwrapMojangsonTag(value);
  }

  const out = {};
  for (const [k, v] of Object.entries(tag))
    out[k] = unwrapMojangsonTag(v);
  return out;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
