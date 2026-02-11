import { resolveRuntimeFaceBehaviorProfile } from './runtime-face-behavior-profile.mjs';

const SOURCE_BACKED_TRANSLUCENT_PATH_TOKENS = ['air', 'leaves', 'glass', 'pane', 'ice', 'water', 'lava', 'barrier'];
const SOURCE_BACKED_CULL_OVER_EDGE_DISABLED_PATH_TOKENS = ['leaves'];

export function normalizeTilesForRendering(input, behaviorOverrides) {
  const rawTiles = Array.isArray(input?.tiles)
    ? input.tiles
    : Array.isArray(input)
      ? input.map((box) => ({
          blockState: box.blockState ?? 'minecraft:air',
          color: Number.isInteger(box.color) ? box.color : -1,
          structureId: box.structureId ?? null,
          grid: box.grid,
          boxes: [box],
        }))
      : [];

  const tiles = [];
  let tileId = 0;
  let boxId = 0;

  for (const tile of rawTiles) {
    if (!Array.isArray(tile.boxes) || tile.boxes.length === 0)
      continue;

    const blockState = String(tile.blockState ?? 'minecraft:air');
    const color = Number.isInteger(tile.color) ? tile.color : -1;
    const blockId = canonicalBlockId(blockState);
    const structureId = normalizeStructureId(tile.structureId);
    const behavior = inferStandaloneBlockBehavior(blockId, color, behaviorOverrides);

    const normalized = {
      id: tileId++,
      blockState,
      blockId,
      color,
      structureId,
      structureNoCollision: hasNoCollisionStructureAttribute(structureId),
      grid: toGridCount(tile.grid, tile.boxes),
      providesSolidFace: behavior.providesSolidFace,
      cullOverEdge: behavior.cullOverEdge,
      boxes: [],
    };

    for (const box of tile.boxes) {
      const grid = toGridCount(box.grid, [box], normalized.grid);
      const world = boxWorldBounds(box, grid);
      normalized.boxes.push({
        id: boxId++,
        kind: box.kind,
        grid,
        blockState,
        color,
        minX: box.minX,
        minY: box.minY,
        minZ: box.minZ,
        maxX: box.maxX,
        maxY: box.maxY,
        maxZ: box.maxZ,
        minWorldX: world.minX,
        minWorldY: world.minY,
        minWorldZ: world.minZ,
        maxWorldX: world.maxX,
        maxWorldY: world.maxY,
        maxWorldZ: world.maxZ,
        transformData: Array.isArray(box.transformData) ? box.transformData : null,
        transformCache: null,
      });
    }

    if (normalized.boxes.length > 0)
      tiles.push(normalized);
  }

  return tiles;
}

function toGridCount(grid, boxes, fallbackGrid) {
  const value = Number(grid);
  if (Number.isInteger(value) && value > 0)
    return value;

  for (const box of boxes ?? []) {
    const bGrid = Number(box?.grid);
    if (Number.isInteger(bGrid) && bGrid > 0)
      return bGrid;
  }

  const fallback = Number(fallbackGrid);
  if (Number.isInteger(fallback) && fallback > 0)
    return fallback;

  return 16;
}

function boxWorldBounds(box, grid) {
  const inv = 1 / grid;
  return {
    minX: box.minX * inv,
    minY: box.minY * inv,
    minZ: box.minZ * inv,
    maxX: box.maxX * inv,
    maxY: box.maxY * inv,
    maxZ: box.maxZ * inv,
  };
}

export function hasStaticExternalNeighbour(_face, _tile) {
  // Static structure conversion has no world blockstate context, so this branch
  // corresponds to "no blocking vanilla neighbour" in LittleServerFace.checkforNeighbour.
  return false;
}

function blockStateName(state) {
  const index = state.indexOf('[');
  if (index >= 0)
    return state.slice(0, index);
  return state;
}

function canonicalBlockId(state) {
  const id = blockStateName(String(state ?? '')).trim();
  if (/^[^:]+:[^:]+:-?\d+$/.test(id))
    return id.replace(/:-?\d+$/, '');
  return id;
}

function normalizeStructureId(value) {
  if (value == null)
    return null;
  const id = String(value).trim();
  if (id.length === 0)
    return null;
  return id;
}

function inferStandaloneBlockBehavior(blockId, color, behaviorOverrides) {
  // Source-backed baseline:
  // - LittleTile.doesProvideSolidFace delegates to !isTranslucent()
  //   (LittleTile.doesProvideSolidFace + ILittleMCBlock.isTranslucent).
  // - LittleBlocks overrides cullOverEdge() only for leaves blocks.
  let behavior = {
    providesSolidFace: !(inferTranslucent(blockId) || isColorTransparent(color)),
    cullOverEdge: !isLeavesBlockId(blockId),
  };

  const override = resolveBehaviorOverride(blockId, behaviorOverrides);
  if (override)
    behavior = { ...behavior, ...override };
  return behavior;
}

function inferTranslucent(blockId) {
  const tokens = blockIdPathTokens(blockId);
  return SOURCE_BACKED_TRANSLUCENT_PATH_TOKENS.some((token) => tokens.includes(token));
}

function isLeavesBlockId(blockId) {
  const tokens = blockIdPathTokens(blockId);
  return SOURCE_BACKED_CULL_OVER_EDGE_DISABLED_PATH_TOKENS.some((token) => tokens.includes(token));
}

function resolveBehaviorOverride(blockId, behaviorOverrides) {
  if (!behaviorOverrides || typeof behaviorOverrides !== 'object')
    return null;
  const override = behaviorOverrides[blockId];
  if (!override || typeof override !== 'object')
    return null;

  const out = {};
  if (typeof override.providesSolidFace === 'boolean')
    out.providesSolidFace = override.providesSolidFace;
  if (typeof override.cullOverEdge === 'boolean')
    out.cullOverEdge = override.cullOverEdge;
  return Object.keys(out).length > 0 ? out : null;
}

function hasNoCollisionStructureAttribute(structureId) {
  if (structureId == null)
    return false;
  // Source-backed from LittleStructureRegistry registrations.
  return String(structureId) === 'noclip';
}

function blockIdPathTokens(blockId) {
  const path = String(blockId.split(':')[1] ?? blockId);
  return path.split(/[_./-]+/g);
}

function isColorTransparent(color) {
  return ((color >>> 24) & 255) < 255;
}