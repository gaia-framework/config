import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));

function checkDirectory(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      checkDirectory(filename);
    } else {
      const relative = path.relative(root, filename).replaceAll('\\', '/');
      assert.ok(filename.endsWith('.ts'), `Test source must be TypeScript: ${relative}`);
    }
  }
}

checkDirectory(path.join(root, 'test'));

function checkSourceExtensions(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      checkSourceExtensions(filename);
    } else {
      assert.ok(
        !/\.(?:mjs|mts|js|cjs|cts)$/.test(entry.name),
        `Maintained source must use .ts: ${path.relative(root, filename)}`
      );
    }
  }
}

checkSourceExtensions(path.join(root, 'examples'));
checkSourceExtensions(path.join(root, 'scripts'));
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile()) {
    assert.ok(
      !/\.(?:mjs|mts|js|cjs|cts)$/.test(entry.name),
      `Root configuration source must use .ts: ${entry.name}`
    );
  }
}

for (const entry of readdirSync(path.join(root, 'docs'))) {
  assert.ok(
    !/^(performance-|refactor-|review-)|source-manifest|dependency-baseline/.test(entry),
    `Generated reports and test metadata do not belong in docs: ${entry}`
  );
}

const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
assert.ok(
  !tracked.some((name) => name === 'JOURNAL.md' || name.startsWith('journal/')),
  'Agent journals must remain local and ignored.'
);
assert.ok(
  !tracked.some((name) => name.startsWith('test/reference/')),
  'Tests must use standalone synthetic fixtures, not archived application sources.'
);
console.log('TypeScript source layout and public repository boundaries checked.');
