import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseLtImportSnbt } from '../src/lt-import-parser.mjs';
import { collectRenderableFaceCandidateSummary } from '../src/gltf-writer.mjs';
import { resolveRuntimeFaceBehaviorProfile } from '../src/gltf-writer/runtime-face-behavior-profile.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const parityDir = path.join(repoRoot, 'fixtures/outputs/parity-debug');

const FIXTURES = [
  'basic_lever.json',
  'contemporary style house.json',
  'double_door.json',
  'empty wooden bucket.json',
  'light_switch.json',
  'simple_light.json',
  'stone_plate.json',
  'wooden_plate.json',
];

for (const fixtureName of FIXTURES) {
  test(`face-state parity candidates: ${fixtureName}`, () => {
    const debug = readDebugFixture(fixtureName);
    const parsed = parseLtImportSnbt(String(debug.normalizedSnbt));
    const actual = collectRenderableFaceCandidateSummary(parsed, {
      evaluateInternalOcclusion: true,
      runtime: debug.runtime,
      geometryMode: resolveFixtureGeometryMode(debug),
    });
    const expected = summarizeDebugRenderableFaceStates(debug.root);

    assert.equal(actual.totalVisibleCandidates, expected.totalVisibleCandidates);
    assert.deepEqual(actual.byFacing, expected.byFacing);
    assert.deepEqual(actual.byOutside, expected.byOutside);
  });
}

function resolveFixtureGeometryMode(debug) {
  const mode = typeof debug?.geometryMode === 'string' ? debug.geometryMode.trim().toLowerCase() : '';
  return mode === 'client' || mode === 'server' ? mode : 'server';
}

test('runtime face behavior profile: runtime profile resolver', () => {
  const profile = resolveRuntimeFaceBehaviorProfile({
    runtime: {
      minecraftVersion: '1.21.1',
      littleTilesVersion: '1.6.0-pre205',
    },
  });

  assert.equal(profile.profileId, 'mc1.21.1-lt1.6.x');
});

function readDebugFixture(name) {
  const filePath = path.join(parityDir, name);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function summarizeDebugRenderableFaceStates(root) {
  const byFacing = Object.fromEntries(['DOWN', 'UP', 'NORTH', 'SOUTH', 'WEST', 'EAST'].map((key) => [key, 0]));
  const byOutside = { inside: 0, outside: 0 };

  let totalVisibleCandidates = 0;
  const stack = [root];
  while (stack.length > 0) {
    const group = stack.pop();
    if (!group || typeof group !== 'object')
      continue;

    for (const tile of group.tiles ?? []) {
      for (const box of tile.boxes ?? []) {
        for (const face of box.faceStates ?? []) {
          if (face?.renderable !== true)
            continue;

          totalVisibleCandidates++;
          const facing = String(face.facing ?? '');
          if (Object.hasOwn(byFacing, facing))
            byFacing[facing]++;
          if (face.outside === true)
            byOutside.outside++;
          else
            byOutside.inside++;
        }
      }
    }

    for (const child of group.children ?? [])
      stack.push(child);
  }

  return {
    totalVisibleCandidates,
    byFacing,
    byOutside,
  };
}
