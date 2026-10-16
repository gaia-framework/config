import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

export function checkExamples(directory: string, nodeArgs: string[] = []) {
  const cases = JSON.parse(readFileSync(path.join(directory, 'cases.json'), 'utf8')) as Array<{
    directory: string;
    args: string[];
    expected: unknown;
  }>;
  for (const item of cases) {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (/^(CONFIG|PIPELINE_CONFIG|SERVICE_CONFIG|EXAMPLE_)/.test(key)) {
        delete env[key];
      }
    }

    const result = spawnSync(process.execPath, [...nodeArgs, 'index.ts', ...item.args], {
      cwd: path.join(directory, item.directory),
      env,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, `${item.directory}: ${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout), item.expected, item.directory);
  }

  return cases.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = checkExamples(fileURLToPath(new URL('../../examples', import.meta.url)));
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/examples.json', JSON.stringify({ passed: count }, null, 2));
  console.log(`${count} documented example scenarios passed.`);
}
