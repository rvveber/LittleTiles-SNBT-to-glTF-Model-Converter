import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { facesToPrimitiveMeshes, writeGltf } from '../src/gltf-writer/mesh-assembly.mjs';

function quad(z) {
  return [
    [0, 0, z],
    [1, 0, z],
    [1, 1, z],
    [0, 1, z],
  ];
}

test('facesToPrimitiveMeshes groups by resolved material key', () => {
  const faces = [
    {
      blockState: 'minecraft:stone',
      blockId: 'minecraft:stone',
      color: -1,
      providesSolidFace: true,
      sourceKind: 'aabb',
      facing: 'NORTH',
      faceType: 'axis',
      outside: false,
      vertices: quad(0),
    },
    {
      blockState: 'minecraft:stone',
      blockId: 'minecraft:stone',
      color: 0x80ffffff,
      providesSolidFace: false,
      sourceKind: 'aabb',
      facing: 'SOUTH',
      faceType: 'axis',
      outside: false,
      vertices: quad(1),
    },
  ];

  const assembled = facesToPrimitiveMeshes(faces);
  assert.equal(assembled.stats.faceCount, 2);
  assert.equal(assembled.stats.primitiveCount, 2);
  assert.equal(assembled.meshes.length, 2);
});

test('writeGltf writes baseColorFactor and alphaMode from material resolver', () => {
  const faces = [
    {
      blockState: 'minecraft:stone',
      blockId: 'minecraft:stone',
      color: -1,
      providesSolidFace: true,
      sourceKind: 'aabb',
      facing: 'NORTH',
      faceType: 'axis',
      outside: false,
      vertices: quad(0),
    },
    {
      blockState: 'minecraft:glass',
      blockId: 'minecraft:glass',
      color: -1,
      providesSolidFace: false,
      sourceKind: 'aabb',
      facing: 'SOUTH',
      faceType: 'axis',
      outside: false,
      vertices: quad(1),
    },
  ];

  const assembled = facesToPrimitiveMeshes(faces);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lt-gltf-mat-'));
  try {
    const gltfPath = path.join(tempDir, 'out.gltf');
    const binPath = path.join(tempDir, 'out.bin');
    const written = writeGltf(assembled.meshes, gltfPath, { outBinPath: binPath });
    assert.equal(written.materialCount, 2);

    const gltf = JSON.parse(readFileSync(gltfPath, 'utf8'));
    assert.equal(gltf.materials.length, 2);
    const alphaModes = new Set(gltf.materials.map((m) => m.alphaMode));
    assert.ok(alphaModes.has('OPAQUE'));
    assert.ok(alphaModes.has('BLEND'));

    for (const material of gltf.materials) {
      assert.ok(Array.isArray(material.pbrMetallicRoughness?.baseColorFactor));
      assert.equal(material.pbrMetallicRoughness.baseColorFactor.length, 4);
    }

    const primitive = gltf.meshes[0].primitives[0];
    assert.ok(Number.isInteger(primitive.attributes.TEXCOORD_0));
    const uvAccessor = gltf.accessors[primitive.attributes.TEXCOORD_0];
    assert.equal(uvAccessor.type, 'VEC2');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('writeGltf writes image/texture entries when material has texture URI', () => {
  const faces = [
    {
      blockState: 'minecraft:stone',
      blockId: 'minecraft:stone',
      color: -1,
      providesSolidFace: true,
      sourceKind: 'aabb',
      facing: 'NORTH',
      faceType: 'axis',
      outside: false,
      vertices: quad(0),
    },
  ];

  const assembled = facesToPrimitiveMeshes(faces, {
    resolveMaterial: () => ({
      materialKey: 'stone|textured',
      materialName: 'minecraft:stone',
      baseColorFactor: [1, 1, 1, 1],
      alphaMode: 'OPAQUE',
      alphaCutoff: null,
      doubleSided: false,
      textureKey: 'textures/minecraft/block/stone.png',
      textureUri: 'textures/minecraft/block/stone.png',
    }),
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lt-gltf-tex-'));
  try {
    const gltfPath = path.join(tempDir, 'out.gltf');
    const binPath = path.join(tempDir, 'out.bin');
    writeGltf(assembled.meshes, gltfPath, { outBinPath: binPath });
    const gltf = JSON.parse(readFileSync(gltfPath, 'utf8'));

    assert.equal(gltf.images.length, 1);
    assert.equal(gltf.images[0].uri, 'textures/minecraft/block/stone.png');
    assert.equal(gltf.textures.length, 1);
    assert.equal(gltf.textures[0].source, 0);
    assert.equal(gltf.textures[0].sampler, 0);
    assert.equal(gltf.samplers.length, 1);
    assert.equal(gltf.samplers[0].magFilter, 9728);
    assert.equal(gltf.samplers[0].minFilter, 9728);
    assert.equal(gltf.materials[0].pbrMetallicRoughness.baseColorTexture.index, 0);
    assert.ok(Number.isInteger(gltf.meshes[0].primitives[0].attributes.TEXCOORD_0));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('writeGltf emits KHR_animation_pointer texture animation tracks', () => {
  const faces = [
    {
      blockState: 'example:animated',
      blockId: 'example:animated',
      color: -1,
      providesSolidFace: true,
      sourceKind: 'aabb',
      facing: 'NORTH',
      faceType: 'axis',
      outside: false,
      vertices: quad(0),
    },
  ];

  const assembled = facesToPrimitiveMeshes(faces, {
    resolveMaterial: () => ({
      materialKey: 'animated|textured',
      materialName: 'example:animated',
      baseColorFactor: [1, 1, 1, 1],
      alphaMode: 'OPAQUE',
      alphaCutoff: null,
      doubleSided: false,
      textureKey: 'textures/example/block/animated.png',
      textureUri: 'textures/example/block/animated.png',
      textureAnimation: {
        frameCount: 4,
        frameTime: 2,
        uvTransform: {
          scale: [1, 0.25],
          offset: [0, 0],
        },
      },
    }),
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lt-gltf-anim-'));
  try {
    const gltfPath = path.join(tempDir, 'out.gltf');
    const binPath = path.join(tempDir, 'out.bin');
    writeGltf(assembled.meshes, gltfPath, { outBinPath: binPath });
    const gltf = JSON.parse(readFileSync(gltfPath, 'utf8'));

    assert.ok(Array.isArray(gltf.extensionsUsed));
    assert.ok(gltf.extensionsUsed.includes('KHR_texture_transform'));
    assert.ok(gltf.extensionsUsed.includes('KHR_animation_pointer'));
    assert.equal(gltf.textures[0].extras.minecraftAnimation.frameCount, 4);
    assert.deepEqual(
      gltf.materials[0].pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform.scale,
      [1, 0.25]
    );
    assert.deepEqual(
      gltf.materials[0].pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform.offset,
      [0, 0]
    );
    assert.equal(gltf.animations.length, 1);
    assert.equal(gltf.animations[0].channels.length, 1);
    assert.equal(gltf.animations[0].samplers.length, 1);
    assert.equal(gltf.animations[0].samplers[0].interpolation, 'STEP');
    assert.equal(
      gltf.animations[0].channels[0].target.extensions.KHR_animation_pointer.pointer,
      '/materials/0/pbrMetallicRoughness/baseColorTexture/extensions/KHR_texture_transform/offset'
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('writeGltf keeps STEP interpolation even when texture metadata interpolate=true', () => {
  const faces = [
    {
      blockState: 'example:animated_interpolate',
      blockId: 'example:animated_interpolate',
      color: -1,
      providesSolidFace: true,
      sourceKind: 'aabb',
      facing: 'NORTH',
      faceType: 'axis',
      outside: false,
      vertices: quad(0),
    },
  ];

  const assembled = facesToPrimitiveMeshes(faces, {
    resolveMaterial: () => ({
      materialKey: 'animated-interpolate|textured',
      materialName: 'example:animated_interpolate',
      baseColorFactor: [1, 1, 1, 1],
      alphaMode: 'OPAQUE',
      alphaCutoff: null,
      doubleSided: false,
      textureKey: 'textures/example/block/animated_interpolate.png',
      textureUri: 'textures/example/block/animated_interpolate.png',
      textureAnimation: {
        frameCount: 2,
        frameTime: 20,
        interpolate: true,
        frames: [
          { index: 0, time: 20 },
          { index: 1, time: 20 },
        ],
        uvTransform: {
          scale: [1, 0.5],
          offset: [0, 0],
        },
      },
    }),
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lt-gltf-anim-step-'));
  try {
    const gltfPath = path.join(tempDir, 'out.gltf');
    const binPath = path.join(tempDir, 'out.bin');
    writeGltf(assembled.meshes, gltfPath, { outBinPath: binPath });
    const gltf = JSON.parse(readFileSync(gltfPath, 'utf8'));
    assert.equal(gltf.animations[0].samplers[0].interpolation, 'STEP');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('writeGltf repeats animated texture tracks to shared loop with t=0 keyframes', () => {
  const faces = [
    {
      blockState: 'example:animated_a',
      blockId: 'example:animated_a',
      color: -1,
      providesSolidFace: true,
      sourceKind: 'aabb',
      facing: 'NORTH',
      faceType: 'axis',
      outside: false,
      vertices: quad(0),
    },
    {
      blockState: 'example:animated_b',
      blockId: 'example:animated_b',
      color: -1,
      providesSolidFace: true,
      sourceKind: 'aabb',
      facing: 'SOUTH',
      faceType: 'axis',
      outside: false,
      vertices: quad(1),
    },
  ];

  const assembled = facesToPrimitiveMeshes(faces, {
    resolveMaterial: (face) => {
      if (face.blockState.endsWith('_a')) {
        return {
          materialKey: 'animated-a|textured',
          materialName: 'example:animated_a',
          baseColorFactor: [1, 1, 1, 1],
          alphaMode: 'OPAQUE',
          alphaCutoff: null,
          doubleSided: false,
          textureKey: 'textures/example/block/animated_a.png',
          textureUri: 'textures/example/block/animated_a.png',
          textureAnimation: {
            frameCount: 2,
            frameTime: 1,
            frames: [
              { index: 0, time: 1 },
              { index: 1, time: 2 },
            ],
            uvTransform: {
              scale: [1, 0.5],
              offset: [0, 0],
            },
          },
        };
      }
      return {
        materialKey: 'animated-b|textured',
        materialName: 'example:animated_b',
        baseColorFactor: [1, 1, 1, 1],
        alphaMode: 'OPAQUE',
        alphaCutoff: null,
        doubleSided: false,
        textureKey: 'textures/example/block/animated_b.png',
        textureUri: 'textures/example/block/animated_b.png',
        textureAnimation: {
          frameCount: 2,
          frameTime: 1,
          frames: [
            { index: 0, time: 1 },
            { index: 1, time: 3 },
          ],
          uvTransform: {
            scale: [1, 0.5],
            offset: [0, 0],
          },
        },
      };
    },
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lt-gltf-anim-loop-'));
  try {
    const gltfPath = path.join(tempDir, 'out.gltf');
    const binPath = path.join(tempDir, 'out.bin');
    writeGltf(assembled.meshes, gltfPath, { outBinPath: binPath });
    const gltf = JSON.parse(readFileSync(gltfPath, 'utf8'));

    assert.equal(gltf.animations.length, 1);
    assert.equal(gltf.animations[0].samplers.length, 2);
    for (const sampler of gltf.animations[0].samplers) {
      const timeAccessor = gltf.accessors[sampler.input];
      assert.equal(timeAccessor.min[0], 0);
      assert.equal(timeAccessor.max[0], 0.6);
      assert.equal(sampler.interpolation, 'STEP');
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
