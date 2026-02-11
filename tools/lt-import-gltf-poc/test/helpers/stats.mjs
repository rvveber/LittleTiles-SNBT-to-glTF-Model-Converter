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
