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
