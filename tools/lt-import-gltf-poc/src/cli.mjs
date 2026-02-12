#!/usr/bin/env node
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { parseLtImportSnbt, ParseError } from './lt-import-parser.mjs';
import { boxesToPrimitiveMeshes, writeGltf } from './gltf-writer.mjs';
import { GEOMETRY_MODES } from './gltf-writer/postprocess-faces.mjs';

function main(argv) {
  const args = parseArgs(argv);
  if (!args.input && !process.stdin.isTTY)
    args.input = '-';

  if (args.help || !args.input) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const readsStdin = args.input === '-';
  const inputPath = readsStdin ? '<stdin>' : path.resolve(args.input);
  if (readsStdin && !args.output)
    throw new ParseError('`--out <output.gltf>` is required when reading input from stdin.');
  const outputPath = path.resolve(
    args.output || defaultOutputPath(path.resolve(args.input))
  );
  const outBinPath = path.resolve(
    args.bin || defaultBinPath(outputPath)
  );

  const raw = readsStdin
    ? readFileSync(0, 'utf8')
    : readFileSync(inputPath, 'utf8');
  const parsed = parseLtImportSnbt(raw, {
    defaultGrid: args.defaultGrid,
  });
  
  const meshes = boxesToPrimitiveMeshes(parsed, {
    evaluateInternalOcclusion: !args.noCull,
    geometryMode: args.geometryMode,
    optimize: args.optimize,
    materialOptions: {
      textureUriPrefix: args.textureBaseUri,
    },
  });

  const written = writeGltf(meshes.meshes, outputPath, {
    outBinPath,
  });

  const out = [
    `Input: ${inputPath}`,
    `Schema: ${parsed.schema}`,
    `Boxes: ${meshes.stats.boxCount}`,
    `Faces: ${meshes.stats.faceCount}`,
    `Geometry: ${meshes.stats.geometry.mode} optimize=${meshes.stats.geometry.optimize} (removed ${meshes.stats.geometry.removedFaceCount})`,
    `Primitives: ${written.primitiveCount}`,
    `glTF: ${written.gltfPath}`,
    `BIN: ${written.binPath}`,
  ];

  console.log(out.join('\n'));
}

function parseArgs(argv) {
  const out = {
    help: false,
    noCull: false,
    defaultGrid: 16,
    input: null,
    output: null,
    bin: null,
    textureBaseUri: '',
    geometryMode: 'client',
    optimize: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      out.help = true;
      continue;
    }

    if (arg === '--no-cull') {
      out.noCull = true;
      continue;
    }

    if (arg === '--default-grid') {
      out.defaultGrid = parseInt(argv[++i] ?? '', 10);
      continue;
    }

    if (arg === '-o' || arg === '--out') {
      out.output = argv[++i] ?? null;
      continue;
    }

    if (arg === '--bin') {
      out.bin = argv[++i] ?? null;
      continue;
    }

    if (arg === '--texture-base-uri') {
      out.textureBaseUri = argv[++i] ?? '';
      continue;
    }

    if (arg === '--texture-uri-prefix') {
      out.textureBaseUri = argv[++i] ?? '';
      continue;
    }

    if (arg === '--geometry-mode') {
      out.geometryMode = normalizeGeometryMode(argv[++i]);
      continue;
    }

    if (arg === '--optimize') {
      out.optimize = true;
      continue;
    }

    if (!out.input) {
      out.input = arg;
      continue;
    }

    if (!out.output) {
      out.output = arg;
      continue;
    }

    throw new ParseError(`Unexpected argument: ${arg}`);
  }

  return out;
}

function defaultOutputPath(inputPath) {
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}.gltf`);
}

function defaultBinPath(gltfPath) {
  const parsed = path.parse(gltfPath);
  return path.join(parsed.dir, `${parsed.name}.bin`);
}

function printHelp() {
  console.log(`LittleTiles /lt-import -> glTF POC\n
Usage:
  lt-import-to-gltf <input.snbt|.txt|.struct> [output.gltf]
  lt-import-to-gltf - --out <output.gltf> [--bin <output.bin>] < input.struct
  lt-import-to-gltf <input> --out <output.gltf> [--bin <output.bin>]

Options:
  --no-cull            Disable internal face culling (including partial-overlap culling).
  --default-grid <n>   Fallback grid when SNBT omits \"grid\" (default: 16).
  --texture-base-uri   Optional URI prefix prepended to derived texture URIs.
  --texture-uri-prefix Alias of --texture-base-uri.
                       If omitted, no prefix is added.
  --geometry-mode <id> Geometry output mode: ${GEOMETRY_MODES.join(', ')} (default: client).
  --optimize           Apply post-process optimization passes (client mode only).
  -h, --help           Show this help.
`);
}

function normalizeGeometryMode(raw) {
  const mode = String(raw ?? '').trim().toLowerCase();
  if (GEOMETRY_MODES.includes(mode))
    return mode;
  throw new ParseError(`Invalid --geometry-mode value: ${raw}. Expected one of: ${GEOMETRY_MODES.join(', ')}`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const isKnown = error instanceof ParseError;
  console.error(`Error: ${error.message}`);
  if (!isKnown && error?.stack)
    console.error(error.stack);
  process.exit(1);
}
