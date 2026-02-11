#!/usr/bin/env node
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 4173;
const DEFAULT_HOST = '127.0.0.1';

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
    });
  });

  // Serve all fixture files so existing glTF relative texture URIs resolve unchanged.
  app.use('/fixtures', express.static(fixturesRoot));

  app.get('/', (_req, res) => {
    res.type('text/plain').send(
      [
        'LittleTiles texture server is running.',
        '',
        `glTF root: http://${args.host}:${args.port}/fixtures/outputs/all-inputs-gltf/fixtures/inputs/`,
        `textures root: http://${args.host}:${args.port}/fixtures/inputs/textures/`,
        '',
        'Use /_status for runtime paths.',
      ].join('\n')
    );
  });

  app.listen(args.port, args.host, () => {
    console.log(`Texture server listening on http://${args.host}:${args.port}`);
    console.log(`Serving fixtures from: ${fixturesRoot}`);
  });
}

function parseArgs(argv) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const out = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    repoRoot: path.resolve(__dirname, '../../..'),
    corsOrigin: '*',
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
