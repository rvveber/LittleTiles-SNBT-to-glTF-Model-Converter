import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMaterial, rgbaFromArgb } from '../src/gltf-writer/material-resolver.mjs';

test('rgbaFromArgb decodes signed int ARGB', () => {
  const rgba = rgbaFromArgb(0x80ff0000);
  assert.equal(rgba[0], 1);
  assert.equal(rgba[1], 0);
  assert.equal(rgba[2], 0);
  assert.ok(Math.abs(rgba[3] - (128 / 255)) < 1e-9);
});

test('resolveMaterial keeps opaque default for solid tiles', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:stone',
    blockId: 'minecraft:stone',
    color: -1,
    providesSolidFace: true,
  });

  assert.equal(material.alphaMode, 'OPAQUE');
  assert.deepEqual(material.baseColorFactor, [1, 1, 1, 1]);
  assert.equal(material.textureKey, null);
});

test('resolveMaterial uses color alpha when present', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:red_stained_glass',
    blockId: 'minecraft:red_stained_glass',
    color: 0x80ff0000,
    providesSolidFace: false,
  });

  assert.equal(material.alphaMode, 'BLEND');
  assert.ok(Math.abs(material.baseColorFactor[0] - 1) < 1e-9);
  assert.ok(Math.abs(material.baseColorFactor[1] - 0) < 1e-9);
  assert.ok(Math.abs(material.baseColorFactor[2] - 0) < 1e-9);
  assert.ok(Math.abs(material.baseColorFactor[3] - (128 / 255)) < 1e-9);
});

test('resolveMaterial uses configurable inferred alpha for translucent blocks', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:glass',
    blockId: 'minecraft:glass',
    color: -1,
    providesSolidFace: false,
  }, {
    translucentAlpha: 0.2,
  });

  assert.equal(material.alphaMode, 'BLEND');
  assert.deepEqual(material.baseColorFactor, [1, 1, 1, 0.2]);
});

test('resolveMaterial resolves texture URI from lookup and includes it in key', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:oak_log[axis=y]',
    blockId: 'minecraft:oak_log',
    color: -1,
    providesSolidFace: true,
  }, {
    textureLookup: {
      byBlockState: {
        'minecraft:oak_log[axis=y]': 'textures/minecraft/block/oak_log.png',
      },
      byBlockId: {},
    },
  });

  assert.equal(material.textureUri, 'textures/minecraft/block/oak_log.png');
  assert.equal(material.textureKey, 'textures/minecraft/block/oak_log.png');
  assert.ok(material.materialKey.includes('textures/minecraft/block/oak_log.png'));
});

test('resolveMaterial resolves texture URI using legacy state aliases', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:stone:2',
    blockId: 'minecraft:stone',
    color: -1,
    providesSolidFace: true,
  }, {
    textureLookup: {
      byBlockState: {
        'minecraft:polished_granite': 'textures/minecraft/block/polished_granite.png',
      },
      byBlockId: {},
    },
  });

  assert.equal(material.textureUri, 'textures/minecraft/block/polished_granite.png');
});

test('resolveMaterial applies tint color from texture lookup metadata', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:birch_leaves',
    blockId: 'minecraft:birch_leaves',
    color: -1,
    providesSolidFace: false,
  }, {
    textureLookup: {
      byBlockState: {},
      byBlockId: {},
      tintByBlockState: {
        'minecraft:birch_leaves': 0x80A755,
      },
      tintByBlockId: {},
    },
    translucentAlpha: 1,
  });

  assert.ok(material.baseColorFactor[0] < 1);
  assert.ok(material.baseColorFactor[1] < 1);
  assert.ok(material.baseColorFactor[2] < 1);
});

test('resolveMaterial does not apply tint when lookup has no tint metadata', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:leaves:2',
    blockId: 'minecraft:leaves',
    color: -1,
    providesSolidFace: false,
  }, {
    textureLookup: {
      byBlockState: {},
      byBlockId: {},
    },
    translucentAlpha: 1,
  });

  assert.equal(material.baseColorFactor[0], 1);
  assert.equal(material.baseColorFactor[1], 1);
  assert.equal(material.baseColorFactor[2], 1);
});

test('resolveMaterial forwards texture animation metadata from lookup', () => {
  const material = resolveMaterial({
    blockState: 'example:animated_block',
    blockId: 'example:animated_block',
    color: -1,
    providesSolidFace: true,
  }, {
    textureLookup: {
      byBlockState: {
        'example:animated_block': 'textures/example/block/animated.png',
      },
      byBlockId: {},
      animationByTextureUri: {
        'textures/example/block/animated.png': {
          frameCount: 4,
          frameTime: 2,
          uvTransform: {
            scale: [1, 0.25],
            offset: [0, 0],
          },
        },
      },
    },
  });

  assert.equal(material.textureUri, 'textures/example/block/animated.png');
  assert.equal(material.textureAnimation.frameCount, 4);
  assert.deepEqual(material.textureAnimation.uvTransform.scale, [1, 0.25]);
});

test('resolveMaterial sets BLEND when texture has alpha channel metadata', () => {
  const material = resolveMaterial({
    blockState: 'example:glass_panel',
    blockId: 'example:glass_panel',
    color: -1,
    providesSolidFace: true,
  }, {
    textureLookup: {
      byBlockState: {
        'example:glass_panel': 'textures/example/block/glass_panel.png',
      },
      byBlockId: {},
      alphaByTextureUri: {
        'textures/example/block/glass_panel.png': true,
      },
    },
  });

  assert.equal(material.alphaMode, 'BLEND');
  assert.equal(material.doubleSided, true);
  assert.equal(material.baseColorFactor[3], 1);
});
