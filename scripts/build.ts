import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
const project = process.argv.includes('--tests') ? 'tsconfig.json' : 'tsconfig.build.json';
const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', project], {
  stdio: 'inherit'
});
process.exit(result.status ?? 1);
