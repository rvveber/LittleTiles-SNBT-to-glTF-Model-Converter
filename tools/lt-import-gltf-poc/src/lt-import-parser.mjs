import { parseSnbtToObject as parseDefaultSnbtToObject, sanitizeSnbt } from './snbt-parser.mjs';

const DEFAULT_GRID = 16;

export class ParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ParseError';
  }
}

export { sanitizeSnbt };

export function parseLtImportSnbt(rawText, options = {}) {
  const defaultGrid = toPositiveInt(options.defaultGrid, DEFAULT_GRID);
  const parseSnbtToObject = typeof options.parseSnbtToObject === 'function'
    ? options.parseSnbtToObject
    : parseDefaultSnbtToObject;
  let data;
  try {
    data = parseSnbtToObject(rawText, {
      createParseError: (message) => new ParseError(message),
    });
  } catch (error) {
    if (error instanceof ParseError)
      throw error;
    throw new ParseError(`SNBT parse failed: ${error?.message ?? error}`);
  }

  if (!isObject(data))
    throw new ParseError('Top-level SNBT must be a compound/object.');

  const isLegacy = Array.isArray(data.tiles) && !isObject(data.t);
  const root = isLegacy
    ? parseLegacyGroup(data, {
        inheritedGrid: resolveGrid(data.grid, defaultGrid),
        path: 'root',
      })
    : parseCurrentGroup(data, {
        defaultGrid,
        path: 'root',
      });

  return {
    schema: isLegacy ? 'legacy' : 'current',
    root,
    tiles: flattenTiles(root),
    boxes: flattenBoxes(root),
  };
}

function parseCurrentGroup(group, ctx) {
  const grid = resolveGrid(group.grid, ctx.defaultGrid);
  const path = ctx.path;
  const structureId = parseStructureId(group.s);

  const tilesOut = [];
  const tiles = isObject(group.t) ? group.t : {};
  for (const [blockState, entries] of Object.entries(tiles)) {
    if (!Array.isArray(entries))
      throw new ParseError(`${path}.t[${blockState}] must be a list.`);

    let color = -1;
    let currentTile = null;
    for (let i = 0; i < entries.length; i++) {
      const array = asIntArray(entries[i], `${path}.t[${blockState}][${i}]`);
      if (array.length === 1) {
        color = array[0];
        currentTile = {
          blockState,
          color,
          grid,
          structureId,
          boxes: [],
        };
        tilesOut.push(currentTile);
        continue;
      }

      const box = parseBoxArray(array, `${path}.t[${blockState}][${i}]`);
      if (!currentTile) {
        currentTile = {
          blockState,
          color,
          grid,
          structureId,
          boxes: [],
        };
        tilesOut.push(currentTile);
      }
      currentTile.boxes.push(box);
    }
  }

  const children = [];
  if (Array.isArray(group.c)) {
    for (let i = 0; i < group.c.length; i++) {
      children.push(
        parseCurrentGroup(group.c[i], {
          defaultGrid: grid,
          path: `${path}.c[${i}]`,
        })
      );
    }
  }

  if (isObject(group.e)) {
    for (const [extKey, extGroup] of Object.entries(group.e)) {
      children.push(
        parseCurrentGroup(extGroup, {
          defaultGrid: grid,
          path: `${path}.e[${extKey}]`,
        })
      );
    }
  }

  return { grid, structureId, tiles: tilesOut, children };
}

function parseLegacyGroup(group, ctx) {
  const grid = resolveGrid(group.grid, ctx.inheritedGrid);
  const path = ctx.path;
  const structureId = parseStructureId(group.structure);

  if (!Array.isArray(group.tiles))
    throw new ParseError(`${path}.tiles must be a list in legacy format.`);

  const tiles = [];
  for (let i = 0; i < group.tiles.length; i++) {
    const tileEntry = group.tiles[i];
    const tileObj = isObject(tileEntry.tile) ? tileEntry.tile : tileEntry;

    const blockState = oldTileName(tileObj, `${path}.tiles[${i}]`);
    const color = Number.isInteger(tileObj.color) ? tileObj.color : -1;

    const arrays = [];
    if (Array.isArray(tileEntry.boxes)) {
      for (const b of tileEntry.boxes)
        arrays.push(asIntArray(b, `${path}.tiles[${i}].boxes[]`));
    } else if (tileEntry.bBox != null) {
      arrays.push(asIntArray(tileEntry.bBox, `${path}.tiles[${i}].bBox`));
    } else if (tileEntry.box != null) {
      arrays.push(asIntArray(tileEntry.box, `${path}.tiles[${i}].box`));
    }

    const tile = {
      blockState,
      color,
      grid,
      structureId,
      boxes: [],
    };
    tiles.push(tile);

    for (let j = 0; j < arrays.length; j++) {
      const box = parseBoxArray(arrays[j], `${path}.tiles[${i}].box[${j}]`);
      tile.boxes.push(box);
    }
  }

  const children = [];
  if (Array.isArray(group.children)) {
    for (let i = 0; i < group.children.length; i++) {
      children.push(
        parseLegacyGroup(group.children[i], {
          inheritedGrid: grid,
          path: `${path}.children[${i}]`,
        })
      );
    }
  }

  return { grid, structureId, tiles, children };
}

function parseStructureId(structure) {
  if (!isObject(structure))
    return null;

  if (structure.id == null)
    return null;

  const id = String(structure.id).trim();
  if (id.length === 0)
    return null;
  return id;
}

function oldTileName(tileObj, path) {
  if (!isObject(tileObj) || typeof tileObj.block !== 'string')
    throw new ParseError(`${path}.tile.block is required in legacy format.`);

  if (Number.isInteger(tileObj.meta) && tileObj.meta !== 0)
    return `${tileObj.block}:${tileObj.meta}`;

  return tileObj.block;
}

function parseBoxArray(array, path) {
  if (array.length < 6)
    throw new ParseError(`${path}: invalid box array length ${array.length}.`);

  if (array.length === 6)
    return toAabb(array, path);

  const identifier = array[6];
  if (identifier < 0) {
    return toTransformable(array, path);
  }

  // Matches LittleBox.create(): old slices fallback.
  if (array.length === 7 || array.length === 11)
    return toAabb(array, path);

  throw new ParseError(`${path}: unsupported box encoding length ${array.length}.`);
}

function toAabb(array, path) {
  const [minX, minY, minZ, maxX, maxY, maxZ] = array;
  if (!(minX < maxX && minY < maxY && minZ < maxZ)) {
    throw new ParseError(
      `${path}: invalid box bounds [${minX},${minY},${minZ}] -> [${maxX},${maxY},${maxZ}].`
    );
  }

  return {
    kind: 'aabb',
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
  };
}

function toTransformable(array, path) {
  const [minX, minY, minZ, maxX, maxY, maxZ] = array;
  if (!(minX < maxX && minY < maxY && minZ < maxZ)) {
    throw new ParseError(
      `${path}: invalid transformable bounds [${minX},${minY},${minZ}] -> [${maxX},${maxY},${maxZ}].`
    );
  }

  return {
    kind: 'transformable',
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    // Equivalent to LittleTransformableBox.data (array slice from index 6).
    transformData: array.slice(6),
  };
}

export function flattenBoxes(group, out = []) {
  for (const tile of group.tiles) {
    for (const box of tile.boxes)
      out.push({
        ...box,
        blockState: tile.blockState,
        color: tile.color,
        grid: tile.grid,
        structureId: tile.structureId ?? null,
      });
  }
  for (const child of group.children)
    flattenBoxes(child, out);
  return out;
}

export function flattenTiles(group, out = []) {
  for (const tile of group.tiles)
    if (tile.boxes.length > 0)
      out.push(tile);
  for (const child of group.children)
    flattenTiles(child, out);
  return out;
}

function resolveGrid(value, fallback) {
  const grid = Number(value);
  if (Number.isInteger(grid) && grid > 0)
    return grid;
  return fallback;
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (Number.isInteger(n) && n > 0)
    return n;
  return fallback;
}

function asIntArray(value, path) {
  if (!Array.isArray(value))
    throw new ParseError(`${path} must be an int array.`);

  const out = new Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const n = Number(value[i]);
    if (!Number.isFinite(n) || !Number.isInteger(n))
      throw new ParseError(`${path}[${i}] must be an integer.`);
    out[i] = n;
  }
  return out;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
