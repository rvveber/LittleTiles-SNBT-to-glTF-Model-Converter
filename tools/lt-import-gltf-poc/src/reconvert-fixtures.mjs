#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), '..', '..', '..');
const inputsDir = path.join(repoRoot, 'fixtures', 'inputs');
const outputsDir = path.join(repoRoot, 'fixtures', 'outputs');
const allOutputsDir = path.join(outputsDir, 'all-inputs-gltf');
const cliPath = path.join(repoRoot, 'tools', 'lt-import-gltf-poc', 'src', 'cli.mjs');
const textureBaseUri = normalizeTextureBaseUri(
  process.env.LT_TEXTURE_BASE_URI ?? 'http://127.0.0.1:4173/fixtures/outputs/textures/'
);

const inputFiles = readdirSync(inputsDir)
  .filter((name) => name.endsWith('.txt') || name.endsWith('.struct'))
  .map((name) => path.join(inputsDir, name))
  .filter((filePath) => statSync(filePath).isFile())
  .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

for (const inputPath of inputFiles) {
  const stem = path.basename(inputPath).replace(/\.[^.]+$/, '');
  const outPath = path.join(allOutputsDir, `${stem}.gltf`);
  const args = [cliPath, inputPath, '--out', outPath, '--texture-base-uri', textureBaseUri];

  const run = spawnSync('node', args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (run.status !== 0) {
    process.exit(run.status ?? 1);
  }
}

function normalizeTextureBaseUri(valueRaw) {
  const value = String(valueRaw ?? '').trim();
  if (!value)
    throw new Error('Texture base URI must not be empty');
  return value.endsWith('/') ? value : `${value}/`;
}

const simpleLightInput = path.join(inputsDir, 'simple_light.struct');
const simpleLightOutputs = [
  path.join(outputsDir, 'simple_light.file.gltf'),
  path.join(outputsDir, 'simple_light.stdin.gltf'),
];

{
  const run = spawnSync('node', [
    cliPath,
    simpleLightInput,
    '--out',
    simpleLightOutputs[0],
    '--texture-base-uri',
    textureBaseUri,
  ], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (run.status !== 0) {
    process.exit(run.status ?? 1);
  }
}

{
  const run = spawnSync('node', [
    cliPath,
    '-',
    '--out',
    simpleLightOutputs[1],
    '--texture-base-uri',
    textureBaseUri,
  ], {
    cwd: repoRoot,
    stdio: ['pipe', 'inherit', 'inherit'],
    input: readFileSync(simpleLightInput, 'utf8'),
  });
  if (run.status !== 0) {
    process.exit(run.status ?? 1);
  }
}
