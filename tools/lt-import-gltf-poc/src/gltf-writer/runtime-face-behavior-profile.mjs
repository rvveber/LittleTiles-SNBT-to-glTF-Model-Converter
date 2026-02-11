const CURRENT_RUNTIME_FACE_BEHAVIOR_PROFILE = {
  profileId: 'mc1.21.1-lt1.6.x',
  runtimeMatchers: {
    minecraftVersionPrefix: '1.21.',
    littleTilesVersionPrefix: '1.6.',
  },
  faceStates: {
    evaluationMode: 'little_server_face',
    supportsCutting: false,
    outsideNeighborPolicy: 'air',
    occludeOutsideFacesWithTiles: false,
  },
};

const DEFAULT_RUNTIME_FACE_BEHAVIOR_PROFILE = {
  profileId: 'default',
  runtimeMatchers: {
    minecraftVersionPrefix: null,
    littleTilesVersionPrefix: null,
  },
  faceStates: {
    evaluationMode: 'little_server_face',
    supportsCutting: false,
    outsideNeighborPolicy: 'air',
    occludeOutsideFacesWithTiles: false,
  },
};

const RUNTIME_FACE_BEHAVIOR_PROFILE_MAP = {
  default: DEFAULT_RUNTIME_FACE_BEHAVIOR_PROFILE,
  [CURRENT_RUNTIME_FACE_BEHAVIOR_PROFILE.profileId]: CURRENT_RUNTIME_FACE_BEHAVIOR_PROFILE,
};

export const LT_RUNTIME_FACE_BEHAVIOR_PROFILE_IDS = Object.freeze(
  Object.keys(RUNTIME_FACE_BEHAVIOR_PROFILE_MAP)
);

export function resolveRuntimeFaceBehaviorProfile(options = {}) {
  const profileId = resolveRuntimeProfileId(options);
  const base = RUNTIME_FACE_BEHAVIOR_PROFILE_MAP[profileId] ?? DEFAULT_RUNTIME_FACE_BEHAVIOR_PROFILE;

  const merged = deepMerge(
    DEFAULT_RUNTIME_FACE_BEHAVIOR_PROFILE,
    base,
    options.runtimeBehaviorOverrides,
    options.runtimeFaceBehaviorProfile
  );

  merged.profileId = profileId;
  return merged;
}

function resolveRuntimeProfileId(options) {
  if (typeof options.runtimeProfile === 'string' && options.runtimeProfile.trim().length > 0)
    return options.runtimeProfile.trim();

  const runtime = options.runtime;
  if (!runtime || typeof runtime !== 'object')
    return 'default';

  for (const [id, profile] of Object.entries(RUNTIME_FACE_BEHAVIOR_PROFILE_MAP)) {
    if (id === 'default')
      continue;
    if (runtimeMatchesProfile(runtime, profile.runtimeMatchers))
      return id;
  }
  return 'default';
}

function runtimeMatchesProfile(runtime, matchers) {
  if (!matchers || typeof matchers !== 'object')
    return false;

  if (
    typeof matchers.minecraftVersionPrefix === 'string' &&
    matchers.minecraftVersionPrefix.length > 0
  ) {
    const value = String(runtime.minecraftVersion ?? '');
    if (!value.startsWith(matchers.minecraftVersionPrefix))
      return false;
  }

  if (
    typeof matchers.littleTilesVersionPrefix === 'string' &&
    matchers.littleTilesVersionPrefix.length > 0
  ) {
    const value = String(runtime.littleTilesVersion ?? '');
    if (!value.startsWith(matchers.littleTilesVersionPrefix))
      return false;
  }

  return true;
}

function deepMerge(...sources) {
  let out = {};
  for (const source of sources)
    out = mergeInto(out, source);
  return out;
}

function mergeInto(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source))
    return target;

  const out = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      out[key] = value.slice();
      continue;
    }

    if (value && typeof value === 'object') {
      const previous = out[key];
      const nestedBase = previous && typeof previous === 'object' && !Array.isArray(previous)
        ? previous
        : {};
      out[key] = mergeInto(nestedBase, value);
      continue;
    }

    out[key] = value;
  }
  return out;
}
