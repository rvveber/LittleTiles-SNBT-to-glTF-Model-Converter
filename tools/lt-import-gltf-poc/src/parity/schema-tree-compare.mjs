export function sanitizeStats(stats) {
  const inStats = stats && typeof stats === 'object' ? stats : {};
  return {
    groups: intOrZero(inStats.groups),
    tiles: intOrZero(inStats.tiles),
    boxes: intOrZero(inStats.boxes),
    transformableBoxes: intOrZero(inStats.transformableBoxes),
  };
}

export function countGroupStats(group) {
  const out = {
    groups: 1,
    tiles: 0,
    boxes: 0,
    transformableBoxes: 0,
  };

  for (const tile of group.tiles ?? []) {
    out.tiles++;
    for (const box of tile.boxes ?? []) {
      out.boxes++;
      if (box.kind === 'transformable')
        out.transformableBoxes++;
    }
  }

  for (const child of group.children ?? []) {
    const nested = countGroupStats(child);
    out.groups += nested.groups;
    out.tiles += nested.tiles;
    out.boxes += nested.boxes;
    out.transformableBoxes += nested.transformableBoxes;
  }

  return out;
}

export function canonicalGroupFromParsed(group) {
  const tiles = (group.tiles ?? []).map((tile) => ({
    blockState: tile.blockState,
    color: tile.color,
    boxes: canonicalizeBoxes((tile.boxes ?? []).map((box) => ({
      kind: box.kind,
      minX: box.minX,
      minY: box.minY,
      minZ: box.minZ,
      maxX: box.maxX,
      maxY: box.maxY,
      maxZ: box.maxZ,
      array: box.kind === 'transformable'
        ? [box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ, ...(box.transformData ?? [])]
        : [box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ],
    }))),
  }));

  const children = (group.children ?? [])
    .map((child) => canonicalGroupFromParsed(child))
    .sort(compareCanonical);

  return sanitizeNullableKeys({
    grid: group.grid,
    structureId: group.structureId ?? null,
    tiles: canonicalizeTiles(tiles),
    children,
  });
}

export function canonicalGroupFromDebug(group) {
  const tiles = (group?.tiles ?? []).map((tile) => ({
    blockState: tile.blockState,
    color: tile.color,
    boxes: canonicalizeBoxes((tile.boxes ?? []).map((box) => ({
      kind: box.kind,
      minX: box.minX,
      minY: box.minY,
      minZ: box.minZ,
      maxX: box.maxX,
      maxY: box.maxY,
      maxZ: box.maxZ,
      array: Array.isArray(box.array) ? box.array.slice() : [],
    }))),
  }));

  const children = (group?.children ?? [])
    .map((child) => canonicalGroupFromDebug(child))
    .sort(compareCanonical);

  return sanitizeNullableKeys({
    grid: group?.grid,
    structureId: group?.structureId ?? null,
    tiles: canonicalizeTiles(tiles),
    children,
  });
}

export function firstDiff(a, b, pathValue = '$') {
  if (Object.is(a, b))
    return null;

  const aIsObj = a !== null && typeof a === 'object';
  const bIsObj = b !== null && typeof b === 'object';
  if (!aIsObj || !bIsObj)
    return { path: pathValue, a, b };

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray)
    return { path: pathValue, a, b };

  if (aIsArray) {
    if (a.length !== b.length)
      return { path: `${pathValue}.length`, a: a.length, b: b.length };
    for (let i = 0; i < a.length; i++) {
      const diff = firstDiff(a[i], b[i], `${pathValue}[${i}]`);
      if (diff)
        return diff;
    }
    return null;
  }

  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length)
    return { path: `${pathValue} keys`, a: aKeys, b: bKeys };
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i])
      return { path: `${pathValue} keys`, a: aKeys, b: bKeys };
  }

  for (const key of aKeys) {
    const diff = firstDiff(a[key], b[key], `${pathValue}.${key}`);
    if (diff)
      return diff;
  }
  return null;
}

function intOrZero(value) {
  return Number.isInteger(value) ? value : 0;
}

function canonicalizeTiles(tiles) {
  return tiles.sort(compareCanonical);
}

function canonicalizeBoxes(boxes) {
  return boxes.sort(compareCanonical);
}

function compareCanonical(a, b) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa < sb)
    return -1;
  if (sa > sb)
    return 1;
  return 0;
}

function sanitizeNullableKeys(value) {
  if (Array.isArray(value))
    return value.map((entry) => sanitizeNullableKeys(entry));

  if (value === null || typeof value !== 'object')
    return value;

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry == null)
      continue;
    out[key] = sanitizeNullableKeys(entry);
  }
  return out;
}
