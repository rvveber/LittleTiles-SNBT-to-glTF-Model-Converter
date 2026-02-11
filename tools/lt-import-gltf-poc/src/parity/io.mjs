import path from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { ParseError } from '../lt-import-parser.mjs';

export function parsePositiveIntArg(raw, flagName) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    throw new ParseError(`${flagName} expects a positive integer value.`);
  return value;
}

export function expandJsonInputs(inputs) {
  const out = [];
  for (const input of inputs) {
    const resolved = path.resolve(input);
    const st = statSync(resolved);
    if (st.isDirectory()) {
      const entries = readdirSync(resolved)
        .filter((name) => name.toLowerCase().endsWith('.json'))
        .sort();
      for (const name of entries)
        out.push(path.join(resolved, name));
      continue;
    }
    out.push(resolved);
  }
  return out;
}

export function sanitizeRuntimeMetadata(debug) {
  const runtimeRaw = debug?.runtime && typeof debug.runtime === 'object'
    ? debug.runtime
    : null;

  const minecraftVersion = stringOrNull(runtimeRaw?.minecraftVersion ?? debug?.minecraftVersion);
  const littleTilesVersion = stringOrNull(runtimeRaw?.littleTilesVersion ?? debug?.littleTilesVersion);
  const creativeCoreVersion = stringOrNull(runtimeRaw?.creativeCoreVersion ?? debug?.creativeCoreVersion);
  const parityExporterVersion = stringOrNull(runtimeRaw?.parityExporterVersion ?? debug?.parityExporterVersion);

  if (!minecraftVersion && !littleTilesVersion && !creativeCoreVersion && !parityExporterVersion)
    return null;

  return {
    minecraftVersion,
    littleTilesVersion,
    creativeCoreVersion,
    parityExporterVersion,
  };
}

function stringOrNull(value) {
  if (typeof value !== 'string')
    return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
