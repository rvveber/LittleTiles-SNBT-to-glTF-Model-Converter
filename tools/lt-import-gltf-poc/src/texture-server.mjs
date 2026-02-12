#!/usr/bin/env node
import express from 'express';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 4173;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_MISSING_TEXTURE_PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP4z8AAAAMBAQAY2N4AAAAASUVORK5CYII=',
  'base64'
);

main(process.argv.slice(2));

function main(argv) {
  const args = parseArgs(argv);
  const app = express();
  const fixturesRoot = path.join(args.repoRoot, 'fixtures');
  const texturesRoot = path.join(fixturesRoot, 'inputs', 'textures');
  const outputsRoot = path.join(fixturesRoot, 'outputs');

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', args.corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin,Range,Accept,Content-Type,Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/_status', (_req, res) => {
    res.json({
      ok: true,
      repoRoot: args.repoRoot,
      fixturesRoot,
      texturesRoot,
      outputsRoot,
      missingTextureFallback: args.enableMissingTextureFallback,
      missingTexturePath: args.missingTexturePath,
    });
  });

  // Serve all fixture files so existing glTF relative texture URIs resolve unchanged.
  app.use('/fixtures', express.static(fixturesRoot));

  // If the texture does not exist under the served outputs root, return a fallback PNG.
  app.use('/fixtures/outputs/textures/textures', (req, res, next) => {
    if (!args.enableMissingTextureFallback)
      return next();
    if (!(req.method === 'GET' || req.method === 'HEAD'))
      return next();
    if (!isPngPath(req.path))
      return next();

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-LT-Fallback-Texture', '1');
    res.type('image/png');
    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }
    res.status(200).send(args.missingTextureBuffer);
  });

  app.get('/', (_req, res) => {
    res.type('text/plain').send(
      [
        'LittleTiles texture server is running.',
        '',
        `glTF root: http://${args.host}:${args.port}/fixtures/outputs/all-inputs-gltf/fixtures/inputs/`,
        `textures root: http://${args.host}:${args.port}/fixtures/inputs/textures/`,
        `missing texture fallback: ${args.enableMissingTextureFallback ? 'enabled' : 'disabled'}`,
        '',
        'Use /_status for runtime paths.',
      ].join('\n')
    );
  });

  app.listen(args.port, args.host, () => {
    console.log(`Texture server listening on http://${args.host}:${args.port}`);
    console.log(`Serving fixtures from: ${fixturesRoot}`);
    if (args.enableMissingTextureFallback) {
      const source = args.missingTexturePath ?? 'built-in pixel';
      console.log(`Missing texture fallback enabled (${source})`);
    } else {
      console.log('Missing texture fallback disabled');
    }
  });
}

function parseArgs(argv) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const out = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    repoRoot: path.resolve(__dirname, '../../..'),
    corsOrigin: '*',
    enableMissingTextureFallback: true,
    missingTexturePath: null,
    missingTextureBuffer: DEFAULT_MISSING_TEXTURE_PNG_BUFFER,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--host') {
      out.host = String(argv[++i] ?? '').trim() || DEFAULT_HOST;
      continue;
    }
    if (arg === '--port') {
      out.port = parsePort(argv[++i]);
      continue;
    }
    if (arg === '--repo-root') {
      out.repoRoot = path.resolve(String(argv[++i] ?? '').trim());
      continue;
    }
    if (arg === '--cors-origin') {
      out.corsOrigin = String(argv[++i] ?? '').trim() || '*';
      continue;
    }
    if (arg === '--no-missing-texture-fallback') {
      out.enableMissingTextureFallback = false;
      out.missingTexturePath = null;
      out.missingTextureBuffer = null;
      continue;
    }
    if (arg === '--missing-texture') {
      const value = String(argv[++i] ?? '').trim();
      if (!value)
        throw new Error('Missing value for --missing-texture');
      const resolved = path.resolve(value);
      out.missingTexturePath = resolved;
      out.missingTextureBuffer = readFileSync(resolved);
      out.enableMissingTextureFallback = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return out;
}

function parsePort(raw) {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(value) || value <= 0 || value > 65535)
    throw new Error(`Invalid --port value: ${raw}`);
  return value;
}

function isPngPath(value) {
  return /\.png$/i.test(String(value ?? '').trim());
}
