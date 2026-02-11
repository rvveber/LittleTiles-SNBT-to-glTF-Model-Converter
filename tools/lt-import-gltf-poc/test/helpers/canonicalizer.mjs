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
