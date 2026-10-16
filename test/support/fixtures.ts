import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resetConfigServiceCacheForTests } from '../../src/index.js';

export function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'config-library-'));

  return {
    directory,
    write(name: string, content: string) {
      const filename = path.join(directory, name);
      mkdirSync(path.dirname(filename), { recursive: true });
      writeFileSync(filename, content);

      return filename;
    },
    dispose() {
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

export function isolatedEnvironment() {
  let previous: NodeJS.ProcessEnv;
  beforeEach(() => {
    previous = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (/^(CONFIG|PIPELINE_CONFIG|SERVICE_CONFIG)/.test(key)) {
        delete process.env[key];
      }
    }

    process.env.NODE_ENV = 'test';
    resetConfigServiceCacheForTests();
  });
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }

    Object.assign(process.env, previous);
  });
}
