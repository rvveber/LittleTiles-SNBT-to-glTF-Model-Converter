import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveMaterial as resolveMaterialDefault } from './material-resolver.mjs';

export function facesToPrimitiveMeshes(faces, options = {}) {
  const resolveMaterial = typeof options.resolveMaterial === 'function'
    ? options.resolveMaterial
    : resolveMaterialDefault;
  const materialOptions = options.materialOptions ?? {};
  const groups = new Map();
  let transformableFaceCount = 0;

  for (const face of faces) {
    if (face.sourceKind === 'transformable')
      transformableFaceCount++;

    const material = resolveMaterial(face, materialOptions);
    if (!material)
      continue;

    const groupKey = material.materialKey;
    let mesh = groups.get(groupKey);
    if (!mesh) {
      mesh = {
        name: material.materialName || face.blockState,
        material,
        positions: [],
        uvs: [],
        indices: [],
      };
      groups.set(groupKey, mesh);
    }

    const base = mesh.positions.length / 3;
    const faceUvs = computeFaceUvs(face);
    for (const v of face.vertices)
      mesh.positions.push(v[0], v[1], v[2]);
    for (const uv of faceUvs)
      mesh.uvs.push(uv[0], uv[1]);

    if (face.vertices.length === 3) {
      mesh.indices.push(base, base + 1, base + 2);
    } else if (face.vertices.length === 4) {
      mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      for (let i = 1; i + 1 < face.vertices.length; i++)
        mesh.indices.push(base, base + i, base + i + 1);
    }
  }

  return {
    meshes: [...groups.values()],
    stats: {
      faceCount: faces.length,
      primitiveCount: groups.size,
      transformableFaceCount,
    },
  };
}

export function writeGltf(meshes, outGltfPath, options = {}) {
  const outBinPath = options.outBinPath || replaceExt(outGltfPath, '.bin');
  const binUri = path.basename(outBinPath);
  mkdirSync(path.dirname(outBinPath), { recursive: true });
  mkdirSync(path.dirname(outGltfPath), { recursive: true });

  const chunks = [];
  let totalByteLength = 0;

  const addChunk = (typedArray) => {
    const data = new Uint8Array(
      typedArray.buffer,
      typedArray.byteOffset,
      typedArray.byteLength
    );

    const alignedOffset = align4(totalByteLength);
    if (alignedOffset > totalByteLength) {
      const padding = new Uint8Array(alignedOffset - totalByteLength);
      chunks.push(padding);
      totalByteLength = alignedOffset;
    }

    const byteOffset = totalByteLength;
    chunks.push(data);
    totalByteLength += data.byteLength;

    return {
      byteOffset,
      byteLength: data.byteLength,
    };
  };

  const bufferViews = [];
  const accessors = [];
  const materials = [];
  const materialIndexes = new Map();
  const images = [];
  const textures = [];
  const textureIndexes = new Map();
  const samplers = [];
  const primitives = [];
  const animatedMaterialTargets = [];
  let usesTextureTransform = false;
  const samplerIndex = createSamplerIndex(samplers);

  const resolveTextureIndex = (uri, animation) => {
    const key = String(uri ?? '').trim();
    if (!key)
      return null;

    const existing = textureIndexes.get(key);
    if (existing != null) {
      if (animation && textures[existing]?.extras?.minecraftAnimation == null) {
        textures[existing].extras = {
          ...(textures[existing].extras ?? {}),
          minecraftAnimation: animation,
        };
      }
      return existing;
    }

    const imageIndex = images.length;
    images.push({ uri: key });
    const textureIndex = textures.length;
    const textureOut = { source: imageIndex };
    if (samplerIndex != null)
      textureOut.sampler = samplerIndex;
    if (animation)
      textureOut.extras = { minecraftAnimation: animation };
    textures.push(textureOut);
    textureIndexes.set(key, textureIndex);
    return textureIndex;
  };

  for (const mesh of meshes) {
    if (mesh.positions.length === 0 || mesh.indices.length === 0)
      continue;

    let materialIndex = materialIndexes.get(mesh.material.materialKey);
    if (materialIndex == null) {
      materialIndex = materials.length;
      materialIndexes.set(mesh.material.materialKey, materialIndex);
      const gltfMaterial = toGltfMaterial(mesh, {
        resolveTextureIndex,
      });
      materials.push(gltfMaterial);

      if (isAnimatedMaterialTarget(gltfMaterial, mesh.material?.textureAnimation)) {
        usesTextureTransform = true;
        animatedMaterialTargets.push({
          materialIndex,
          animation: mesh.material.textureAnimation,
        });
      }
    }

    const posArray = new Float32Array(mesh.positions);
    const posView = addChunk(posArray);
    const posBufferViewIndex = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: posView.byteOffset,
      byteLength: posView.byteLength,
      target: 34962,
    });

    const { min, max } = minMax3(mesh.positions);
    const posAccessorIndex = accessors.length;
    accessors.push({
      bufferView: posBufferViewIndex,
      byteOffset: 0,
      componentType: 5126,
      count: mesh.positions.length / 3,
      type: 'VEC3',
      min,
      max,
    });

    let uvAccessorIndex = null;
    if (Array.isArray(mesh.uvs) && mesh.uvs.length === (mesh.positions.length / 3) * 2) {
      const uvArray = new Float32Array(mesh.uvs);
      const uvView = addChunk(uvArray);
      const uvBufferViewIndex = bufferViews.length;
      bufferViews.push({
        buffer: 0,
        byteOffset: uvView.byteOffset,
        byteLength: uvView.byteLength,
        target: 34962,
      });

      const uvMinMax = minMax2(mesh.uvs);
      uvAccessorIndex = accessors.length;
      accessors.push({
        bufferView: uvBufferViewIndex,
        byteOffset: 0,
        componentType: 5126,
        count: mesh.uvs.length / 2,
        type: 'VEC2',
        min: uvMinMax.min,
        max: uvMinMax.max,
      });
    }

    const maxIndex = maxValue(mesh.indices);
    const useU16 = maxIndex <= 65535;
    const idxArray = useU16
      ? Uint16Array.from(mesh.indices)
      : Uint32Array.from(mesh.indices);

    const idxView = addChunk(idxArray);
    const idxBufferViewIndex = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: idxView.byteOffset,
      byteLength: idxView.byteLength,
      target: 34963,
    });

    const idxAccessorIndex = accessors.length;
    accessors.push({
      bufferView: idxBufferViewIndex,
      byteOffset: 0,
      componentType: useU16 ? 5123 : 5125,
      count: mesh.indices.length,
      type: 'SCALAR',
      min: [0],
      max: [maxIndex],
    });

    const attributes = {
      POSITION: posAccessorIndex,
    };
    if (uvAccessorIndex != null)
      attributes.TEXCOORD_0 = uvAccessorIndex;

    primitives.push({
      attributes,
      indices: idxAccessorIndex,
      material: materialIndex,
    });
  }

  if (primitives.length === 0)
    throw new Error('No geometry generated.');

  const gltf = {
    asset: {
      version: '2.0',
      generator: 'lt-import-gltf-poc',
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'LittleTilesRoot' }],
    meshes: [{ name: 'LittleTilesMesh', primitives }],
    materials,
    buffers: [{
      uri: binUri,
      byteLength: totalByteLength,
    }],
    bufferViews,
    accessors,
  };

  if (images.length > 0)
    gltf.images = images;
  if (textures.length > 0)
    gltf.textures = textures;
  if (samplers.length > 0)
    gltf.samplers = samplers;

  const textureAnimations = buildTextureOffsetAnimation({
    animatedMaterialTargets,
    addChunk,
    bufferViews,
    accessors,
  });
  if (textureAnimations)
    gltf.animations = [textureAnimations];

  const extensionsUsed = [];
  if (usesTextureTransform)
    extensionsUsed.push('KHR_texture_transform');
  if (textureAnimations)
    extensionsUsed.push('KHR_animation_pointer');
  if (extensionsUsed.length > 0)
    gltf.extensionsUsed = extensionsUsed;

  const bin = concatChunks(chunks, totalByteLength);
  writeFileSync(outBinPath, bin);
  writeFileSync(outGltfPath, JSON.stringify(gltf, null, 2) + '\n', 'utf8');

  return {
    gltfPath: outGltfPath,
    binPath: outBinPath,
    byteLength: totalByteLength,
    primitiveCount: primitives.length,
    materialCount: materials.length,
  };
}

function minMax3(positions) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

function minMax2(values) {
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;

  for (let i = 0; i < values.length; i += 2) {
    const u = values[i];
    const v = values[i + 1];
    if (u < minU) minU = u;
    if (v < minV) minV = v;
    if (u > maxU) maxU = u;
    if (v > maxV) maxV = v;
  }

  return {
    min: [minU, minV],
    max: [maxU, maxV],
  };
}

function maxValue(values) {
  let out = 0;
  for (const value of values) {
    if (value > out)
      out = value;
  }
  return out;
}

function concatChunks(chunks, totalByteLength) {
  const out = new Uint8Array(totalByteLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function align4(value) {
  return (value + 3) & ~3;
}

function replaceExt(filePath, ext) {
  return filePath.replace(/\.[^.]+$/, '') + ext;
}

function toGltfMaterial(mesh, options = {}) {
  const material = mesh.material ?? {};
  const baseColorFactor = Array.isArray(material.baseColorFactor) && material.baseColorFactor.length === 4
    ? material.baseColorFactor
    : [1, 1, 1, 1];
  const alphaMode = material.alphaMode === 'BLEND' || material.alphaMode === 'MASK'
    ? material.alphaMode
    : 'OPAQUE';

  const out = {
    name: mesh.name,
    pbrMetallicRoughness: {
      baseColorFactor,
      metallicFactor: 0,
      roughnessFactor: 1,
    },
    alphaMode,
    doubleSided: material.doubleSided === true,
  };

  if (alphaMode === 'MASK' && Number.isFinite(material.alphaCutoff))
    out.alphaCutoff = material.alphaCutoff;

  if (typeof options.resolveTextureIndex === 'function') {
    const textureIndex = options.resolveTextureIndex(material.textureUri, material.textureAnimation);
    if (textureIndex != null) {
      out.pbrMetallicRoughness.baseColorTexture = {
        index: textureIndex,
      };

      const uvTransform = normalizeTextureTransform(material.textureAnimation);
      if (uvTransform) {
        out.pbrMetallicRoughness.baseColorTexture.extensions = {
          KHR_texture_transform: uvTransform,
        };
      }
    }
  }

  return out;
}

function createSamplerIndex(samplers) {
  if (!Array.isArray(samplers))
    return null;
  const sampler = {
    magFilter: 9728, // NEAREST
    minFilter: 9728, // NEAREST
    wrapS: 10497, // REPEAT
    wrapT: 10497, // REPEAT
  };
  samplers.push(sampler);
  return samplers.length - 1;
}

function normalizeVec2(value) {
  if (!Array.isArray(value) || value.length !== 2)
    return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y))
    return null;
  return [x, y];
}

function normalizeTextureTransform(animation) {
  const uvTransform = animation?.uvTransform;
  const scale = normalizeVec2(uvTransform?.scale);
  const offset = normalizeVec2(uvTransform?.offset);
  if (!scale || !offset)
    return null;
  return {
    scale,
    offset,
  };
}

function isAnimatedMaterialTarget(gltfMaterial, animation) {
  const textureInfo = gltfMaterial?.pbrMetallicRoughness?.baseColorTexture;
  if (!textureInfo || !Number.isInteger(textureInfo.index))
    return false;
  if (normalizeTextureTransform(animation) == null)
    return false;
  return true;
}

function buildTextureOffsetAnimation(options) {
  const targets = Array.isArray(options?.animatedMaterialTargets)
    ? options.animatedMaterialTargets
    : [];
  if (targets.length === 0)
    return null;

  const addChunk = options.addChunk;
  const bufferViews = options.bufferViews;
  const accessors = options.accessors;
  if (typeof addChunk !== 'function' || !Array.isArray(bufferViews) || !Array.isArray(accessors))
    return null;

  const samplers = [];
  const channels = [];
  const tracks = [];

  for (const target of targets) {
    const track = buildOffsetTrack(target.animation);
    if (!track)
      continue;
    tracks.push({
      materialIndex: target.materialIndex,
      track,
    });
  }

  if (tracks.length === 0)
    return null;

  const sharedLoopTicks = resolveSharedLoopTicks(tracks.map((entry) => entry.track.periodTicks));

  for (const entry of tracks) {
    const repeated = repeatTrackToLoop(entry.track, sharedLoopTicks);
    if (!repeated)
      continue;

    const timeArray = Float32Array.from(repeated.timesSeconds);
    const timeView = addChunk(timeArray);
    const timeBufferViewIndex = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: timeView.byteOffset,
      byteLength: timeView.byteLength,
    });
    const timeAccessorIndex = accessors.length;
    accessors.push({
      bufferView: timeBufferViewIndex,
      byteOffset: 0,
      componentType: 5126,
      count: timeArray.length,
      type: 'SCALAR',
      min: [repeated.timesSeconds[0]],
      max: [repeated.timesSeconds[repeated.timesSeconds.length - 1]],
    });

    const valueArray = Float32Array.from(repeated.valuesFlat);
    const valueView = addChunk(valueArray);
    const valueBufferViewIndex = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: valueView.byteOffset,
      byteLength: valueView.byteLength,
    });
    const valueAccessorIndex = accessors.length;
    const valueMinMax = minMax2(repeated.valuesFlat);
    accessors.push({
      bufferView: valueBufferViewIndex,
      byteOffset: 0,
      componentType: 5126,
      count: repeated.valuesFlat.length / 2,
      type: 'VEC2',
      min: valueMinMax.min,
      max: valueMinMax.max,
    });

    const samplerIndex = samplers.length;
    samplers.push({
      input: timeAccessorIndex,
      output: valueAccessorIndex,
      interpolation: repeated.interpolation,
    });

    channels.push({
      sampler: samplerIndex,
      target: {
        path: 'pointer',
        extensions: {
          KHR_animation_pointer: {
            pointer: `/materials/${entry.materialIndex}/pbrMetallicRoughness/baseColorTexture/extensions/KHR_texture_transform/offset`,
          },
        },
      },
    });
  }

  if (channels.length === 0)
    return null;

  return {
    name: 'texture_animation',
    samplers,
    channels,
  };
}

function buildOffsetTrack(animation) {
  const frameCount = Number(animation?.frameCount ?? 0);
  if (!Number.isInteger(frameCount) || frameCount <= 1)
    return null;

  const frames = normalizeTrackFrames(animation, frameCount);
  if (frames.length === 0)
    return null;

  const periodTicks = frames.reduce((sum, frame) => sum + normalizePositiveInt(frame.time, 1), 0);
  if (!Number.isInteger(periodTicks) || periodTicks <= 0)
    return null;

  return {
    frames,
    frameCount,
    periodTicks,
    // UV-offset animation can represent frame selection, but not Minecraft's
    // interpolate=true crossfade semantics. Keep STEP to avoid texture scrolling.
    interpolation: 'STEP',
  };
}

function normalizeTrackFrames(animation, frameCount) {
  const fallbackFrameTime = normalizePositiveInt(animation?.frameTime, 1);
  const rawFrames = Array.isArray(animation?.frames) ? animation.frames : [];
  const out = [];

  for (const frame of rawFrames) {
    const index = Number(frame?.index);
    if (!Number.isInteger(index))
      continue;
    out.push({
      index: clampFrameIndex(index, frameCount),
      time: normalizePositiveInt(frame?.time, fallbackFrameTime),
    });
  }

  if (out.length > 0)
    return out;

  for (let index = 0; index < frameCount; index++) {
    out.push({
      index,
      time: fallbackFrameTime,
    });
  }
  return out;
}

function offsetForFrame(index, frameCount) {
  return clamp01(index / frameCount);
}

function ticksToSeconds(ticks) {
  const value = Number(ticks);
  if (!Number.isFinite(value) || value < 0)
    return 0;
  return value / 20;
}

function repeatTrackToLoop(track, sharedLoopTicks) {
  const periodTicks = track.periodTicks;
  if (!Number.isInteger(periodTicks) || periodTicks <= 0)
    return null;
  if (!Number.isInteger(sharedLoopTicks) || sharedLoopTicks <= 0)
    return null;

  const timesTicks = [];
  const valuesFlat = [];
  let cursor = 0;

  while (cursor < sharedLoopTicks) {
    for (const frame of track.frames) {
      if (cursor >= sharedLoopTicks)
        break;
      timesTicks.push(cursor);
      valuesFlat.push(0, offsetForFrame(frame.index, track.frameCount));
      cursor += normalizePositiveInt(frame.time, 1);
    }
  }

  // Ensure the clip closes cleanly at the shared loop boundary.
  timesTicks.push(sharedLoopTicks);
  valuesFlat.push(valuesFlat[0], valuesFlat[1]);

  return {
    timesSeconds: timesTicks.map(ticksToSeconds),
    valuesFlat,
    interpolation: track.interpolation,
  };
}

function resolveSharedLoopTicks(periodTicksList) {
  const periods = periodTicksList
    .map((value) => normalizePositiveInt(value, 0))
    .filter((value) => value > 0);
  if (periods.length === 0)
    return 0;

  let lcmValue = periods[0];
  for (let i = 1; i < periods.length; i++) {
    lcmValue = lcm(lcmValue, periods[i]);
    if (lcmValue > MAX_SHARED_LOOP_TICKS)
      return Math.max(...periods);
  }
  return lcmValue;
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const temp = x % y;
    x = y;
    y = temp;
  }
  return x || 1;
}

function lcm(a, b) {
  return Math.abs(a * b) / gcd(a, b);
}

const MAX_SHARED_LOOP_TICKS = 4800;

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0)
    return fallback;
  return parsed;
}

function clampFrameIndex(index, frameCount) {
  if (!Number.isInteger(index))
    return 0;
  if (index < 0)
    return 0;
  if (index >= frameCount)
    return frameCount - 1;
  return index;
}

function clamp01(value) {
  if (!Number.isFinite(value))
    return 0;
  if (value <= 0)
    return 0;
  if (value >= 1)
    return 1;
  return value;
}

function computeFaceUvs(face) {
  if (!Array.isArray(face?.vertices) || face.vertices.length === 0)
    return [];

  if (face.faceType === 'axis')
    return computeAxisFaceUvs(face);

  return computePlanarFaceUvs(face.vertices);
}

function computeAxisFaceUvs(face) {
  const facing = String(face?.facing ?? '');
  const uvBasis = resolveAxisUvBasis(face, facing);
  const raw = [];

  for (const vertex of face.vertices) {
    const x = Number(vertex?.[0] ?? 0);
    const y = Number(vertex?.[1] ?? 0);
    const z = Number(vertex?.[2] ?? 0);
    const u = x * uvBasis.u[0] + y * uvBasis.u[1] + z * uvBasis.u[2];
    const v = x * uvBasis.v[0] + y * uvBasis.v[1] + z * uvBasis.v[2];

    raw.push([u, v]);
  }

  return normalizeUvOrigin(raw);
}

function resolveAxisUvBasis(face, worldFacing) {
  const defaultBasis = DEFAULT_AXIS_FACE_UV_BASIS[worldFacing];
  if (!defaultBasis)
    return FALLBACK_UV_BASIS;

  const rotation = resolveStateRotation(face?.blockState);
  if (!rotation)
    return defaultBasis;

  const worldNormal = FACING_NORMAL[worldFacing];
  if (!worldNormal)
    return defaultBasis;

  const localNormal = rotateVectorInverse(worldNormal, rotation);
  const localFacing = nearestFacingFromNormal(localNormal);
  const localBasis = DEFAULT_AXIS_FACE_UV_BASIS[localFacing] ?? defaultBasis;

  return {
    u: rotateVector(localBasis.u, rotation),
    v: rotateVector(localBasis.v, rotation),
  };
}

function computePlanarFaceUvs(vertices) {
  if (!Array.isArray(vertices) || vertices.length === 0)
    return [];
  if (vertices.length < 3)
    return vertices.map(() => [0, 0]);

  const origin = vertices[0];
  const p1 = vertices[1];
  const p2 = vertices[2];
  const edge1 = sub3(p1, origin);
  const edge2 = sub3(p2, origin);
  let normal = normalize3(cross3(edge1, edge2));

  if (!isFiniteVec3(normal))
    normal = [0, 1, 0];

  const ref = Math.abs(normal[1]) < 0.999 ? [0, 1, 0] : [1, 0, 0];
  let tangent = normalize3(cross3(ref, normal));
  if (!isFiniteVec3(tangent))
    tangent = [1, 0, 0];
  let bitangent = normalize3(cross3(normal, tangent));
  if (!isFiniteVec3(bitangent))
    bitangent = [0, 0, 1];

  const raw = vertices.map((point) => {
    const delta = sub3(point, origin);
    return [dot3(delta, tangent), dot3(delta, bitangent)];
  });
  return normalizeUvOrigin(raw);
}

function normalizeUvOrigin(uvs) {
  if (!Array.isArray(uvs) || uvs.length === 0)
    return [];

  let minU = Infinity;
  let minV = Infinity;
  for (const uv of uvs) {
    const u = Number(uv?.[0] ?? 0);
    const v = Number(uv?.[1] ?? 0);
    if (u < minU) minU = u;
    if (v < minV) minV = v;
  }

  return uvs.map((uv) => [
    Number(uv?.[0] ?? 0) - minU,
    Number(uv?.[1] ?? 0) - minV,
  ]);
}

function sub3(a, b) {
  return [
    Number(a?.[0] ?? 0) - Number(b?.[0] ?? 0),
    Number(a?.[1] ?? 0) - Number(b?.[1] ?? 0),
    Number(a?.[2] ?? 0) - Number(b?.[2] ?? 0),
  ];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize3(v) {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(length) || length === 0)
    return [NaN, NaN, NaN];
  return [v[0] / length, v[1] / length, v[2] / length];
}

function isFiniteVec3(v) {
  return (
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    Number.isFinite(v[2])
  );
}

const FALLBACK_UV_BASIS = Object.freeze({
  u: [1, 0, 0],
  v: [0, 1, 0],
});

// Matches Minecraft's default block-model UV basis for unrotated elements.
const DEFAULT_AXIS_FACE_UV_BASIS = Object.freeze({
  DOWN: Object.freeze({ u: [0, 0, 1], v: [-1, 0, 0] }),
  UP: Object.freeze({ u: [0, 0, 1], v: [-1, 0, 0] }),
  NORTH: Object.freeze({ u: [-1, 0, 0], v: [0, -1, 0] }),
  SOUTH: Object.freeze({ u: [1, 0, 0], v: [0, -1, 0] }),
  WEST: Object.freeze({ u: [0, 0, 1], v: [0, -1, 0] }),
  EAST: Object.freeze({ u: [0, 0, -1], v: [0, -1, 0] }),
});

const FACING_NORMAL = Object.freeze({
  DOWN: Object.freeze([0, -1, 0]),
  UP: Object.freeze([0, 1, 0]),
  NORTH: Object.freeze([0, 0, -1]),
  SOUTH: Object.freeze([0, 0, 1]),
  WEST: Object.freeze([-1, 0, 0]),
  EAST: Object.freeze([1, 0, 0]),
});

const BLOCK_STATE_PROPERTY_CACHE = new Map();

function resolveStateRotation(blockStateRaw) {
  const props = parseBlockStateProperties(blockStateRaw);
  if (!props)
    return null;

  const axis = String(props.axis ?? '').trim().toLowerCase();
  if (axis === 'z')
    return { x: 90, y: 0, z: 0 };
  if (axis === 'x')
    return { x: 90, y: 90, z: 0 };
  if (axis === 'y')
    return { x: 0, y: 0, z: 0 };

  const facing = String(props.facing ?? props.horizontal_facing ?? '').trim().toLowerCase();
  if (facing === 'north')
    return { x: 0, y: 0, z: 0 };
  if (facing === 'south')
    return { x: 0, y: 180, z: 0 };
  if (facing === 'west')
    return { x: 0, y: 270, z: 0 };
  if (facing === 'east')
    return { x: 0, y: 90, z: 0 };
  if (facing === 'up')
    return { x: 270, y: 0, z: 0 };
  if (facing === 'down')
    return { x: 90, y: 0, z: 0 };

  const rotationRaw = props.rotation;
  const rotation = Number.parseInt(String(rotationRaw ?? ''), 10);
  if (Number.isInteger(rotation))
    return { x: 0, y: rotation * 22.5, z: 0 };

  return null;
}

function parseBlockStateProperties(blockStateRaw) {
  const key = String(blockStateRaw ?? '');
  if (BLOCK_STATE_PROPERTY_CACHE.has(key))
    return BLOCK_STATE_PROPERTY_CACHE.get(key);

  const start = key.indexOf('[');
  const end = key.lastIndexOf(']');
  if (start < 0 || end <= start) {
    BLOCK_STATE_PROPERTY_CACHE.set(key, null);
    return null;
  }

  const inside = key.slice(start + 1, end).trim();
  if (!inside) {
    BLOCK_STATE_PROPERTY_CACHE.set(key, null);
    return null;
  }

  const props = {};
  const entries = inside.split(',');
  for (const entry of entries) {
    const [k, v] = entry.split('=');
    const propKey = String(k ?? '').trim();
    if (!propKey)
      continue;
    props[propKey] = String(v ?? '').trim();
  }

  const resolved = Object.keys(props).length > 0 ? props : null;
  BLOCK_STATE_PROPERTY_CACHE.set(key, resolved);
  return resolved;
}

function rotateVector(vector, rotation) {
  let out = [
    Number(vector?.[0] ?? 0),
    Number(vector?.[1] ?? 0),
    Number(vector?.[2] ?? 0),
  ];

  out = rotateVectorX(out, rotation?.x ?? 0);
  out = rotateVectorY(out, rotation?.y ?? 0);
  out = rotateVectorZ(out, rotation?.z ?? 0);
  return sanitizeVector(out);
}

function rotateVectorInverse(vector, rotation) {
  let out = [
    Number(vector?.[0] ?? 0),
    Number(vector?.[1] ?? 0),
    Number(vector?.[2] ?? 0),
  ];

  out = rotateVectorZ(out, -(rotation?.z ?? 0));
  out = rotateVectorY(out, -(rotation?.y ?? 0));
  out = rotateVectorX(out, -(rotation?.x ?? 0));
  return sanitizeVector(out);
}

function rotateVectorX(v, degrees) {
  const rad = toRadians(degrees);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    v[0],
    v[1] * c - v[2] * s,
    v[1] * s + v[2] * c,
  ];
}

function rotateVectorY(v, degrees) {
  const rad = toRadians(degrees);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    v[0] * c + v[2] * s,
    v[1],
    -v[0] * s + v[2] * c,
  ];
}

function rotateVectorZ(v, degrees) {
  const rad = toRadians(degrees);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    v[0] * c - v[1] * s,
    v[0] * s + v[1] * c,
    v[2],
  ];
}

function toRadians(degrees) {
  const value = Number(degrees);
  if (!Number.isFinite(value))
    return 0;
  return value * (Math.PI / 180);
}

function sanitizeVector(vector) {
  return vector.map((component) => sanitizeComponent(component));
}

function sanitizeComponent(value) {
  if (!Number.isFinite(value))
    return 0;
  if (Math.abs(value) < 1e-12)
    return 0;
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 1e-12)
    return rounded;
  return value;
}

function nearestFacingFromNormal(normal) {
  let bestFacing = 'UP';
  let bestDot = -Infinity;
  for (const [facing, axisNormal] of Object.entries(FACING_NORMAL)) {
    const dot =
      normal[0] * axisNormal[0] +
      normal[1] * axisNormal[1] +
      normal[2] * axisNormal[2];
    if (dot > bestDot) {
      bestDot = dot;
      bestFacing = facing;
    }
  }
  return bestFacing;
}
