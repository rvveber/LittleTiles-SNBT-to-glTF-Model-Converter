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

function northFaceQuad() {
  // Match faceVerticesFromPlaneRect({ axis: 'z', sign: -1, ... }).
  return [
    [1, 0, 0],
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ];
}

function southFaceQuad() {
  // Match faceVerticesFromPlaneRect({ axis: 'z', sign: +1, ... }).
  return [
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
}

function westFaceQuad() {
  // Match faceVerticesFromPlaneRect({ axis: 'x', sign: -1, ... }).
  return [
    [0, 0, 1],
    [0, 1, 1],
    [0, 1, 0],
    [0, 0, 0],
  ];
}

function eastFaceQuad() {
  // Match faceVerticesFromPlaneRect({ axis: 'x', sign: +1, ... }).
  return [
    [1, 0, 0],
    [1, 1, 0],
    [1, 1, 1],
    [1, 0, 1],
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
    assert.ok(alphaModes.has('MASK'));
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

test('writeGltf emits KHR_texture_transform from texture animation UV transform', () => {
  const faces = [
    {
      blockState: 'example:non_square',
      blockId: 'example:non_square',
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
      materialKey: 'non-square|textured',
      materialName: 'example:non_square',
      baseColorFactor: [1, 1, 1, 1],
      alphaMode: 'OPAQUE',
      alphaCutoff: null,
      doubleSided: false,
      textureKey: 'textures/example/block/non_square.png',
      textureUri: 'textures/example/block/non_square.png',
      textureAnimation: {
        frameTime: 1,
        frameCount: 4,
        frames: [{ index: 0, time: 1 }],
        uvTransform: {
          scale: [1, 0.25],
          offset: [0, 0],
        },
      },
    }),
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lt-gltf-transform-'));
  try {
    const gltfPath = path.join(tempDir, 'out.gltf');
    const binPath = path.join(tempDir, 'out.bin');
    writeGltf(assembled.meshes, gltfPath, { outBinPath: binPath });
    const gltf = JSON.parse(readFileSync(gltfPath, 'utf8'));

    assert.ok(Array.isArray(gltf.extensionsUsed));
    assert.ok(gltf.extensionsUsed.includes('KHR_texture_transform'));
    assert.ok(gltf.extensionsUsed.includes('KHR_animation_pointer'));
    assert.deepEqual(
      gltf.materials[0].pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform.scale,
      [1, 0.25]
    );
    assert.deepEqual(
      gltf.materials[0].pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform.offset,
      [0, 0]
    );
    assert.ok(Array.isArray(gltf.animations));
    assert.equal(gltf.animations.length, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('writeGltf emits no extensions when texture has no transform', () => {
  const faces = [
    {
      blockState: 'example:static',
      blockId: 'example:static',
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
      materialKey: 'static|textured',
      materialName: 'example:static',
      baseColorFactor: [1, 1, 1, 1],
      alphaMode: 'OPAQUE',
      alphaCutoff: null,
      doubleSided: false,
      textureKey: 'textures/example/block/static.png',
      textureUri: 'textures/example/block/static.png',
      textureAnimation: null,
    }),
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lt-gltf-no-transform-'));
  try {
    const gltfPath = path.join(tempDir, 'out.gltf');
    const binPath = path.join(tempDir, 'out.bin');
    writeGltf(assembled.meshes, gltfPath, { outBinPath: binPath });
    const gltf = JSON.parse(readFileSync(gltfPath, 'utf8'));
    assert.equal(gltf.extensionsUsed, undefined);
    assert.equal(gltf.animations, undefined);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('axis UV orientation matches Minecraft north/south defaults', () => {
  const faces = [
    {
      blockState: 'example:north',
      blockId: 'example:north',
      color: -1,
      providesSolidFace: true,
      sourceKind: 'aabb',
      facing: 'NORTH',
      faceType: 'axis',
      outside: true,
      vertices: northFaceQuad(),
    },
    {
      blockState: 'example:south',
      blockId: 'example:south',
      color: -1,
      providesSolidFace: true,
      sourceKind: 'aabb',
      facing: 'SOUTH',
      faceType: 'axis',
      outside: true,
      vertices: southFaceQuad(),
    },
  ];

  const assembled = facesToPrimitiveMeshes(faces, {
    resolveMaterial: (face) => ({
      materialKey: `${face.blockId}|mat`,
      materialName: face.blockId,
      baseColorFactor: [1, 1, 1, 1],
      alphaMode: 'OPAQUE',
      alphaCutoff: null,
      doubleSided: false,
      textureKey: `textures/${face.blockId}.png`,
      textureUri: `textures/${face.blockId}.png`,
    }),
  });

  assert.equal(assembled.meshes.length, 2);
  const north = assembled.meshes.find((mesh) => mesh.name === 'example:north');
  const south = assembled.meshes.find((mesh) => mesh.name === 'example:south');
  assert.ok(north);
  assert.ok(south);

  const northUvs = [];
  for (let i = 0; i < north.uvs.length; i += 2)
    northUvs.push([north.uvs[i], north.uvs[i + 1]]);

  const southUvs = [];
  for (let i = 0; i < south.uvs.length; i += 2)
    southUvs.push([south.uvs[i], south.uvs[i + 1]]);

  assert.deepEqual(northUvs, [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ]);
  assert.deepEqual(southUvs, [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ]);
});

test('axis UV orientation matches Minecraft east/west defaults', () => {
  const faces = [
    {
      blockState: 'example:west',
      blockId: 'example:west',
      color: -1,
      providesSolidFace: true,
      sourceKind: 'aabb',
      facing: 'WEST',
      faceType: 'axis',
      outside: true,
      vertices: westFaceQuad(),
    },
    {
      blockState: 'example:east',
      blockId: 'example:east',
      color: -1,
      providesSolidFace: true,
      sourceKind: 'aabb',
      facing: 'EAST',
      faceType: 'axis',
      outside: true,
      vertices: eastFaceQuad(),
    },
  ];

  const assembled = facesToPrimitiveMeshes(faces, {
    resolveMaterial: (face) => ({
      materialKey: `${face.blockId}|mat`,
      materialName: face.blockId,
      baseColorFactor: [1, 1, 1, 1],
      alphaMode: 'OPAQUE',
      alphaCutoff: null,
      doubleSided: false,
      textureKey: `textures/${face.blockId}.png`,
      textureUri: `textures/${face.blockId}.png`,
    }),
  });

  assert.equal(assembled.meshes.length, 2);
  const west = assembled.meshes.find((mesh) => mesh.name === 'example:west');
  const east = assembled.meshes.find((mesh) => mesh.name === 'example:east');
  assert.ok(west);
  assert.ok(east);

  const westUvs = [];
  for (let i = 0; i < west.uvs.length; i += 2)
    westUvs.push([west.uvs[i], west.uvs[i + 1]]);

  const eastUvs = [];
  for (let i = 0; i < east.uvs.length; i += 2)
    eastUvs.push([east.uvs[i], east.uvs[i + 1]]);

  assert.deepEqual(westUvs, [
    [1, 1],
    [1, 0],
    [0, 0],
    [0, 1],
  ]);
  assert.deepEqual(eastUvs, [
    [1, 1],
    [1, 0],
    [0, 0],
    [0, 1],
  ]);
});

test('axis=z state rotates UV basis for side faces', () => {
  const faces = [
    {
      blockState: 'minecraft:oak_log[axis=y]',
      blockId: 'minecraft:oak_log',
      color: -1,
      providesSolidFace: true,
      sourceKind: 'aabb',
      facing: 'EAST',
      faceType: 'axis',
      outside: true,
      vertices: eastFaceQuad(),
    },
    {
      blockState: 'minecraft:oak_log[axis=z]',
      blockId: 'minecraft:oak_log',
      color: -1,
      providesSolidFace: true,
      sourceKind: 'aabb',
      facing: 'EAST',
      faceType: 'axis',
      outside: true,
      vertices: eastFaceQuad(),
    },
  ];

  const assembled = facesToPrimitiveMeshes(faces, {
    resolveMaterial: (face) => ({
      materialKey: `${face.blockState}|mat`,
      materialName: face.blockState,
      baseColorFactor: [1, 1, 1, 1],
      alphaMode: 'OPAQUE',
      alphaCutoff: null,
      doubleSided: false,
      textureKey: `textures/${face.blockId}.png`,
      textureUri: `textures/${face.blockId}.png`,
    }),
  });

  assert.equal(assembled.meshes.length, 2);
  const axisY = assembled.meshes.find((mesh) => mesh.name === 'minecraft:oak_log[axis=y]');
  const axisZ = assembled.meshes.find((mesh) => mesh.name === 'minecraft:oak_log[axis=z]');
  assert.ok(axisY);
  assert.ok(axisZ);

  const axisYUvs = [];
  for (let i = 0; i < axisY.uvs.length; i += 2)
    axisYUvs.push([axisY.uvs[i], axisY.uvs[i + 1]]);

  const axisZUvs = [];
  for (let i = 0; i < axisZ.uvs.length; i += 2)
    axisZUvs.push([axisZ.uvs[i], axisZ.uvs[i + 1]]);

  assert.deepEqual(axisYUvs, [
    [1, 1],
    [1, 0],
    [0, 0],
    [0, 1],
  ]);
  assert.deepEqual(axisZUvs, [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ]);
});
