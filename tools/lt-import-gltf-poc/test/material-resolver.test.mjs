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

test('resolveMaterial defaults textured solid tiles to MASK when alpha metadata is unknown', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:stone',
    blockId: 'minecraft:stone',
    color: -1,
    providesSolidFace: true,
  });

  assert.equal(material.alphaMode, 'MASK');
  assert.equal(material.alphaCutoff, 0.5);
  assert.deepEqual(material.baseColorFactor, [1, 1, 1, 1]);
  assert.equal(material.textureUri, 'textures/minecraft/block/stone.png');
});

test('resolveMaterial keeps textured solid tiles opaque when alpha assumption is disabled', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:stone',
    blockId: 'minecraft:stone',
    color: -1,
    providesSolidFace: true,
  }, {
    assumeTextureAlpha: false,
  });

  assert.equal(material.alphaMode, 'OPAQUE');
  assert.equal(material.alphaCutoff, null);
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

test('resolveMaterial applies legacy texture aliases from block state', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:stone:2',
    blockId: 'minecraft:stone',
    color: -1,
    providesSolidFace: true,
  });

  assert.equal(material.textureUri, 'textures/minecraft/block/polished_granite.png');
});

test('resolveMaterial applies texture URI prefix to derived texture URI', () => {
  const material = resolveMaterial({
    blockState: 'minecraft:stone',
    blockId: 'minecraft:stone',
    color: -1,
    providesSolidFace: true,
  }, {
    textureUriPrefix: '/assets',
  });

  assert.equal(material.textureUri, '/assets/textures/minecraft/block/stone.png');
});
