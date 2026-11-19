// Builds the Swift desktop helper. macOS only; elsewhere it does nothing.
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

if (process.platform !== 'darwin') {
  console.log('deskhand is macOS only; skipping.');
  process.exit(0);
}
mkdirSync(resolve('dist/deskhand'), { recursive: true });
const result = spawnSync(
  'swiftc',
  ['-O', resolve('native/deskhand/main.swift'), '-o', resolve('dist/deskhand/deskhand')],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
