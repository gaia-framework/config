import assert from 'node:assert/strict';
import { isUtf8 } from 'node:buffer';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function checkDocumentation(root: string) {
  let checked = 0;

  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (
        [
          'node_modules',
          'dist',
          'coverage',
          'artifacts',
          '.evidence',
          '.git',
          '.yarn',
          'journal',
          'JOURNAL.md'
        ].includes(entry.name)
      ) {
        continue;
      }

      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(filename);
      } else if (entry.name.endsWith('.md')) {
        const content = readFileSync(filename);

        assert.ok(isUtf8(content), `Invalid Markdown UTF-8: ${filename}`);

        const text = content.toString('utf8');

        assert.ok(text.startsWith('# '), `Missing Markdown title: ${filename}`);
        for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
          const target = match[1]!.split('#')[0];
          if (!target || /^[a-z]+:/i.test(target)) {
            continue;
          }

          assert.ok(
            existsSync(path.resolve(path.dirname(filename), target)),
            `Broken link in ${filename}: ${target}`
          );
        }

        checked++;
      }
    }
  }

  walk(root);
  for (const example of JSON.parse(readFileSync(path.join(root, 'examples/cases.json'), 'utf8'))) {
    const readme = path.join(root, 'examples', example.directory, 'README.md');
    assert.ok(existsSync(readme), `Example README missing: ${example.directory}`);
    assert.ok(
      readFileSync(readme, 'utf8').includes(JSON.stringify(example.expected)),
      `Expected result missing: ${example.directory}`
    );
  }

  return checked;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = checkDocumentation(fileURLToPath(new URL('../../', import.meta.url)));
  console.log(`${count} Markdown documents and all example instructions checked.`);
}
