import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { buildTextureLookupFromExportReport } from '../src/gltf-writer/texture-report.mjs';

test('buildTextureLookupFromExportReport maps block states and ids to exported URIs', () => {
  const report = {
    textures: [
      { id: 'minecraft:block/oak_log', uri: 'textures/minecraft/block/oak_log.png', exported: true },
      { id: 'minecraft:block/oak_log_top', uri: 'textures/minecraft/block/oak_log_top.png', exported: true },
      { id: 'minecraft:block/missing', uri: 'textures/minecraft/block/missing.png', exported: false },
    ],
    blockStates: [
      {
        blockState: 'minecraft:oak_log[axis=y]',
        canonicalState: 'minecraft:oak_log[axis=y]',
        blockId: 'minecraft:oak_log',
        tintColor: 0x80A755,
        textureIds: ['minecraft:block/oak_log', 'minecraft:block/oak_log_top'],
      },
    ],
  };

  const lookup = buildTextureLookupFromExportReport(report);
  assert.equal(lookup.byBlockState['minecraft:oak_log[axis=y]'], 'textures/minecraft/block/oak_log.png');
  assert.equal(lookup.byBlockId['minecraft:oak_log'], 'textures/minecraft/block/oak_log.png');
  assert.equal(lookup.tintByBlockState['minecraft:oak_log[axis=y]'], 0x80A755);
  assert.equal(lookup.tintByBlockId['minecraft:oak_log'], 0x80A755);
});

test('buildTextureLookupFromExportReport applies URI prefix', () => {
  const report = {
    textures: [
      { id: 'minecraft:block/stone', uri: 'textures/minecraft/block/stone.png', exported: true },
    ],
    blockStates: [
      {
        blockState: 'minecraft:stone',
        canonicalState: 'minecraft:stone',
        blockId: 'minecraft:stone',
        textureIds: ['minecraft:block/stone'],
      },
    ],
  };

  const lookup = buildTextureLookupFromExportReport(report, { uriPrefix: '/assets' });
  assert.equal(lookup.byBlockState['minecraft:stone'], '/assets/textures/minecraft/block/stone.png');
});

test('buildTextureLookupFromExportReport parses texture animation metadata from mcmeta', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lt-texture-report-'));
  try {
    const textureDir = path.join(tempDir, 'textures', 'example', 'block');
    mkdirSync(textureDir, { recursive: true });
    const mcmetaPath = path.join(textureDir, 'animated.png.mcmeta');
    writeFileSync(mcmetaPath, JSON.stringify({
      animation: {
        frametime: 3,
        interpolate: true,
        frames: [0, { index: 1, time: 5 }, 2],
      },
    }, null, 2));

    const reportPath = path.join(tempDir, 'animated.textures.json');
    const report = {
      textures: [
        {
          id: 'example:block/animated',
          uri: 'textures/example/block/animated.png',
          exported: true,
          hasMcmeta: true,
        },
      ],
      blockStates: [],
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));

    const lookup = buildTextureLookupFromExportReport(report, { reportPath });
    const animation = lookup.animationByTextureUri['textures/example/block/animated.png'];

    assert.equal(animation.frameTime, 3);
    assert.equal(animation.interpolate, true);
    assert.equal(animation.frameCount, 3);
    assert.deepEqual(animation.uvTransform.scale, [1, 1 / 3]);
    assert.deepEqual(animation.uvTransform.offset, [0, 0]);
    assert.equal(animation.frames.length, 3);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildTextureLookupFromExportReport keeps object frame entries with index 0', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lt-texture-report-zero-index-'));
  try {
    const textureDir = path.join(tempDir, 'textures', 'example', 'block');
    mkdirSync(textureDir, { recursive: true });
    const mcmetaPath = path.join(textureDir, 'animated_zero.png.mcmeta');
    writeFileSync(mcmetaPath, JSON.stringify({
      animation: {
        frametime: 4,
        frames: [
          { index: 0, time: 9 },
          { index: 1, time: 3 },
        ],
      },
    }, null, 2));

    const reportPath = path.join(tempDir, 'animated_zero.textures.json');
    const report = {
      textures: [
        {
          id: 'example:block/animated_zero',
          uri: 'textures/example/block/animated_zero.png',
          exported: true,
          hasMcmeta: true,
        },
      ],
      blockStates: [],
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));

    const lookup = buildTextureLookupFromExportReport(report, { reportPath });
    const animation = lookup.animationByTextureUri['textures/example/block/animated_zero.png'];

    assert.equal(animation.frames.length, 2);
    assert.equal(animation.frames[0].index, 0);
    assert.equal(animation.frames[0].time, 9);
    assert.equal(animation.frameCount, 2);
    assert.deepEqual(animation.uvTransform.scale, [1, 0.5]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildTextureLookupFromExportReport marks textures with PNG alpha channels', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lt-texture-alpha-'));
  try {
    const textureDir = path.join(tempDir, 'textures', 'example', 'block');
    mkdirSync(textureDir, { recursive: true });
    const pngPath = path.join(textureDir, 'with_alpha.png');
    // 1x1 RGBA PNG
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP4z8AAAAMBAQAY2N4AAAAASUVORK5CYII=';
    writeFileSync(pngPath, Buffer.from(pngBase64, 'base64'));

    const reportPath = path.join(tempDir, 'alpha.textures.json');
    const report = {
      textures: [
        {
          id: 'example:block/with_alpha',
          uri: 'textures/example/block/with_alpha.png',
          exported: true,
          hasMcmeta: false,
        },
      ],
      blockStates: [],
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));

    const lookup = buildTextureLookupFromExportReport(report, { reportPath });
    assert.equal(lookup.alphaByTextureUri['textures/example/block/with_alpha.png'], true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
