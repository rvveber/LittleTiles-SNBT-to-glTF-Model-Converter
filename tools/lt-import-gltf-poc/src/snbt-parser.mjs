import mojangson from 'mojangson';

/**
 * Parse SNBT text into plain JavaScript values.
 *
 * Contract:
 * - Input: raw SNBT text
 * - Output: plain JS object/array/primitive
 * - Errors: throws parse error (caller may provide a custom error factory)
 *
 * @param {string} rawText
 * @param {{createParseError?: (message: string) => Error}} [options]
 * @returns {unknown}
 */
export function parseSnbtToObject(rawText, options = {}) {
  const createParseError = typeof options.createParseError === 'function'
    ? options.createParseError
    : (message) => new Error(message);

  const primary = sanitizeSnbt(String(rawText ?? ''));
  let tag;

  try {
    tag = mojangson.parse(primary);
  } catch (primaryError) {
    const fallback = sanitizeSnbtForMojangsonArrayPairBug(primary);
    if (fallback !== primary) {
      try {
        tag = mojangson.parse(fallback);
      } catch (fallbackError) {
        throw createParseError(
          `SNBT parse failed after mojangson fallback: ${shortParseErrorMessage(fallbackError)}`
        );
      }
    } else {
      throw createParseError(`SNBT parse failed: ${shortParseErrorMessage(primaryError)}`);
    }
  }

  return unwrapTag(tag);
}

export function sanitizeSnbt(raw) {
  // `mojangson` fails on empty typed arrays like [I;], so normalize those.
  return String(raw).replace(/\[(?:\s*[BILbil]\s*;\s*)\]/g, '[]');
}

export function sanitizeSnbtForMojangsonArrayPairBug(raw) {
  // `mojangson` v2 can throw in extractArrayPair for list compounds that contain
  // untyped integer/empty lists (e.g. tickets:[] in signal payloads).
  return String(raw).replace(/\btickets\s*:\s*\[([^\]]*)\]/g, (match, inner) => {
    const trimmed = String(inner ?? '').trim();
    if (trimmed.length === 0)
      return 'tickets:[I;0]';
    if (!/^[-+]?\d+(?:\s*,\s*[-+]?\d+)*$/.test(trimmed))
      return match;
    return `tickets:[I;${trimmed}]`;
  });
}

function shortParseErrorMessage(error) {
  const raw = String(error?.message ?? error ?? 'unknown parse error');
  if (raw.includes("Cannot read properties of undefined (reading 'type')")) {
    return 'mojangson array/list parser bug (likely untyped numeric list in list-compound payload)';
  }
  if (raw.startsWith('Error parsing text'))
    return 'invalid SNBT text';
  return raw;
}

function unwrapTag(tag) {
  if (Array.isArray(tag))
    return tag.map(unwrapTag);

  if (!isObject(tag))
    return tag;

  if (typeof tag.type === 'string') {
    const type = tag.type;
    const value = tag.value;

    if (type === 'compound' && isObject(value))
      return unwrapTag(value);

    if (type === 'list') {
      const values = Array.isArray(value?.value) ? value.value : [];
      return values.map(unwrapTag);
    }

    return unwrapTag(value);
  }

  const out = {};
  for (const [k, v] of Object.entries(tag))
    out[k] = unwrapTag(v);
  return out;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
