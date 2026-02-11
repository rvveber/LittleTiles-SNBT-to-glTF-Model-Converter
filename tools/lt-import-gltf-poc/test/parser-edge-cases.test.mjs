import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { ParseError, parseLtImportSnbt } from '../src/lt-import-parser.mjs';
import { countGroupStats } from './helpers/stats.mjs';

test('regression: light_switch fixture parses successfully', () => {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(thisDir, '../../..');
  const lightSwitch = path.join(repoRoot, 'fixtures/inputs/light_switch.struct');
  const raw = readFileSync(lightSwitch, 'utf8');
  const parsed = parseLtImportSnbt(raw);

  assert.equal(parsed.schema, 'legacy');
  assert.ok(parsed.boxes.length > 0);
});

test('edge case: tickets empty list in list-compound payload parses', () => {
  const input = '{tiles:[{bBox:[I;0,0,0,1,1,1],tile:{block:"minecraft:stone"}}],structure:{signal:[{mode:"EQUAL",con:"c0.b0",delay:1,tickets:[],index:1}]}}';
  const parsed = parseLtImportSnbt(input);

  assert.equal(parsed.schema, 'legacy');
  assert.equal(parsed.boxes.length, 1);
});

test('edge case: typed empty arrays sanitize path parses', () => {
  const input = '{tiles:[{bBox:[I;0,0,0,1,1,1],tile:{block:"minecraft:stone"}}],structure:{blocks:[I;]}}';
  const parsed = parseLtImportSnbt(input);

  assert.equal(parsed.schema, 'legacy');
  assert.equal(parsed.boxes.length, 1);
});

test('edge case: quoted and unquoted required keys parse equivalently', () => {
  const unquoted = '{grid:16,t:{"minecraft:stone":[[I;0,0,0,1,1,1]]},c:[],e:{}}';
  const quoted = '{"grid":16,"t":{"minecraft:stone":[[I;0,0,0,1,1,1]]},"c":[],"e":{}}';

  const parsedUnquoted = parseLtImportSnbt(unquoted);
  const parsedQuoted = parseLtImportSnbt(quoted);

  assert.equal(parsedUnquoted.schema, 'current');
  assert.equal(parsedQuoted.schema, 'current');
  assert.deepEqual(countGroupStats(parsedUnquoted.root), countGroupStats(parsedQuoted.root));
});

test('edge case: numeric suffix payload presence parses', () => {
  const input = '{tiles:[{bBox:[I;0,0,0,1,1,1],tile:{block:"minecraft:stone"}}],structure:{activateParent:0b,volume:1.0f,ratio:1.0d,big:2l}}';
  const parsed = parseLtImportSnbt(input);

  assert.equal(parsed.schema, 'legacy');
  assert.equal(parsed.boxes.length, 1);
});

test('malformed SNBT throws ParseError', () => {
  assert.throws(
    () => parseLtImportSnbt('{"a":'),
    ParseError
  );
});

test('DI: parseSnbtToObject hook is invoked and respected', () => {
  let calls = 0;
  const parsed = parseLtImportSnbt('ignored', {
    parseSnbtToObject(rawText) {
      calls++;
      assert.equal(rawText, 'ignored');
      return {
        grid: 32,
        t: {
          'minecraft:stone': [
            [0, 0, 0, 1, 1, 1],
          ],
        },
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(parsed.schema, 'current');
  assert.equal(parsed.root.grid, 32);
  assert.equal(parsed.boxes.length, 1);
});

test('DI: custom parser errors are surfaced as ParseError', () => {
  assert.throws(
    () => parseLtImportSnbt('ignored', {
      parseSnbtToObject() {
        throw new Error('custom parser failed');
      },
    }),
    ParseError
  );
});
