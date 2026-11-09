import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { checkExamples } from '../examples/run.js';
import { checkDocumentation } from '../support/check-docs.js';
import { waitForRegistry } from './wait-for-registry.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fromRegistry = process.argv.includes('--registry');
const sourceManifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const require = createRequire(import.meta.url);
const yarn = path.join(root, '.yarn/releases/yarn-4.12.0.cjs');
assert.ok(existsSync(yarn), 'The repository includes its pinned Yarn runtime.');

function run(args: string[], cwd = root, env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);

  return result.stdout;
}

function compileFixtures(directory: string, sources: string[]): void {
  run(
    [
      require.resolve('typescript/bin/tsc'),
      '--strict',
      '--noUncheckedIndexedAccess',
      '--exactOptionalPropertyTypes',
      '--typeRoots',
      path.join(directory, 'node_modules/@types'),
      '--types',
      'node',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2023',
      '--outDir',
      'compiled',
      ...sources
    ],
    directory
  );
}

function packLibrary(tarball: string) {
  const nodeDirectory = path.dirname(process.execPath);
  const npmCli = [
    path.join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js')
  ].find((filename) => existsSync(filename));
  assert.ok(npmCli, 'Node 24 must include npm for archive manifest verification.');
  const probe = path.join(root, 'dist/test/package-exclusion-probe.test.js');
  const licenseProbe = path.join(root, 'dist/test/LICENSE');
  const markdownProbes = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'SECURITY.md'].map(
    (name) => path.join(root, 'dist/test', name)
  );
  mkdirSync(path.dirname(probe), { recursive: true });
  writeFileSync(probe, 'throw new Error("Compiled tests must not ship");\n');
  writeFileSync(licenseProbe, 'Nested development licenses must not ship.\n');
  for (const filename of markdownProbes) {
    writeFileSync(filename, 'Nested development documentation must not ship.\n');
  }

  try {
    run([yarn, 'pack', '--out', tarball]);
    const [manifest] = JSON.parse(
      run([npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'])
    ) as Array<{ files: Array<{ path: string }> }>;
    assert.ok(manifest);
    const npmFiles = manifest.files.map((file) => file.path).sort();
    // npm already supplies tar for its own packing pipeline; no application dependency is used.
    const tar = createRequire(npmCli)('tar');
    const archivedFiles: string[] = [];
    tar.t({
      file: tarball,
      sync: true,
      onentry(entry: { type: string; path: string }) {
        assert.equal(entry.type, 'File');
        assert.ok(entry.path.startsWith('package/'));
        const filename = entry.path.slice('package/'.length);
        assert.ok(!filename.split('/').some((part) => part === 'node_modules' || part === '..'));
        archivedFiles.push(filename);
      }
    });
    for (const filename of [licenseProbe, ...markdownProbes]) {
      const relative = path.relative(root, filename).replaceAll('\\', '/');
      assert.ok(!archivedFiles.includes(relative), `Nested tooling must not ship: ${relative}`);
    }

    assert.deepEqual(
      archivedFiles.sort(),
      npmFiles,
      'Inspect the actual Yarn archive before installing.'
    );

    return npmFiles;
  } finally {
    rmSync(probe, { force: true });
    rmSync(licenseProbe, { force: true });
    for (const filename of markdownProbes) {
      rmSync(filename, { force: true });
    }
  }
}

run(['scripts/build.ts']);
mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const tarball = path.join(root, `artifacts/gaia-framework-config-${sourceManifest.version}.tgz`);
const npmFiles = packLibrary(tarball);
const directory = mkdtempSync(path.join(tmpdir(), 'config-packed-consumer-'));
try {
  writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({
      name: 'config-test-consumer',
      private: true,
      type: 'module',
      packageManager: 'yarn@4.12.0',
      dependencies: {
        '@gaia-framework/config': fromRegistry
          ? `npm:${sourceManifest.version}`
          : `file:${tarball.replaceAll('\\', '/')}`
      }
    })
  );
  writeFileSync(path.join(directory, 'yarn.lock'), '');
  writeFileSync(
    path.join(directory, '.yarnrc.config-consumer.yml'),
    'nodeLinker: node-modules\nnpmRegistryServer: "https://registry.npmjs.org"\n'
  );
  const installEnv: NodeJS.ProcessEnv = {
    ...process.env,
    YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
    YARN_RC_FILENAME: '.yarnrc.config-consumer.yml',
    ...(fromRegistry ? { YARN_GLOBAL_FOLDER: path.join(directory, '.yarn-global') } : {})
  };

  for (const key of Object.keys(installEnv)) {
    if (/^(npm_token|node_auth_token|yarn_npm_(auth_token|auth_ident|always_auth))$/i.test(key)) {
      delete installEnv[key];
    }
  }

  if (fromRegistry) {
    await waitForRegistry(sourceManifest.name, sourceManifest.version, () =>
      spawnSync(process.execPath, [yarn, 'install'], {
        cwd: directory,
        env: installEnv,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024
      })
    );
  } else {
    run([yarn, 'install'], directory, installEnv);
  }

  const installed = path.join(directory, 'node_modules', '@gaia-framework', 'config');
  assert.equal(existsSync(path.join(directory, 'node_modules/config')), false);
  for (const name of [
    'test',
    'scripts',
    '.evidence',
    '.env',
    'coverage',
    'artifacts',
    'dist/test',
    '.github',
    '.yarn',
    'journal',
    'AGENTS.md',
    'JOURNAL.md',
    'yarn.lock'
  ]) {
    assert.equal(existsSync(path.join(installed, name)), false, name);
  }

  for (const name of [
    'src/index.ts',
    'dist/src/index.js',
    'dist/src/index.d.ts',
    'docs/api.md',
    'CONTRIBUTING.md',
    'LICENSE'
  ]) {
    assert.ok(existsSync(path.join(installed, name)), name);
  }

  const documents = checkDocumentation(installed);
  const manifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'));
  assert.notEqual(manifest.private, true);

  // Published archives retain their original access setting after npm visibility changes.
  // Anonymous registry installation, rather than that historical setting, proves public access.
  if (!fromRegistry) {
    assert.equal(manifest.publishConfig.access, 'public');
  }

  assert.equal(manifest.publishConfig.registry, 'https://registry.npmjs.org');
  assert.equal(manifest.name, '@gaia-framework/config');
  assert.equal(manifest.repository.url, 'https://github.com/gaia-framework/config.git');
  assert.equal(manifest.license, 'MIT');
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of ['zod', 'inversify', 'reflect-metadata']) {
      assert.equal(manifest[section]?.[name], undefined, `${name} must not be a ${section} entry.`);
    }
  }

  assert.equal(manifest.devDependencies.zod, sourceManifest.devDependencies.zod);
  assert.equal(
    readFileSync(path.join(installed, 'SECURITY.md'), 'utf8'),
    readFileSync(path.join(root, 'SECURITY.md'), 'utf8')
  );
  const license = readFileSync(path.join(installed, 'LICENSE'), 'utf8');
  assert.equal(license, readFileSync(path.join(root, 'LICENSE'), 'utf8'));
  assert.match(license, /^MIT License\r?\n/);
  assert.ok(license.includes('Copyright (c) 2026 gaia-framework'));
  const files: string[] = [];

  function walk(current: string) {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      // Installation can create nested runtime dependencies when consumer versions differ.
      // They are not archive contents; those are inspected directly before installation above.
      if (full === path.join(installed, 'node_modules')) {
        continue;
      }

      if (item.isDirectory()) {
        walk(full);
      } else {
        files.push(path.relative(installed, full).replaceAll('\\', '/'));
      }
    }
  }

  walk(installed);
  assert.deepEqual([...files].sort(), npmFiles, 'npm and Yarn must include the same files.');
  assert.deepEqual(
    files.filter((name) => path.posix.basename(name) === 'LICENSE'),
    ['LICENSE']
  );
  assert.ok(!files.some((name) => /\.test\.|reference\/|source-before|\.py$/.test(name)));
  assert.ok(
    !files.some((name) =>
      /(?:^|\/)(?:performance-|refactor-|review-)|source-manifest|dependency-baseline/.test(name)
    )
  );
  const cleanEnv = { ...installEnv };
  delete cleanEnv.NODE_OPTIONS;
  delete cleanEnv.NODE_PATH;

  const developmentArgs = [
    '--import',
    pathToFileURL(require.resolve('tsx')).href,
    '--conditions=development'
  ];

  const runtimeChecks = [
    'substitution',
    'toml',
    'schema-versions',
    'smoke',
    'isolation',
    'hardening',
    'escaping',
    'own-environment',
    'sweep',
    'options',
    'snapshots'
  ];
  writeFileSync(path.join(directory, 'config.yaml'), 'value: file\n');

  const fixtureDirectory = path.join(root, 'test/package/fixtures');
  const withoutDi = 'without-di.ts';
  for (const name of ['inversify', '@inversifyjs', 'reflect-metadata']) {
    assert.equal(existsSync(path.join(directory, 'node_modules', name)), false);
    assert.equal(existsSync(path.join(installed, 'node_modules', name)), false);
  }

  cpSync(path.join(fixtureDirectory, withoutDi), path.join(directory, withoutDi));
  compileFixtures(directory, [withoutDi]);
  run(['compiled/without-di.js'], directory, cleanEnv);
  run([...developmentArgs, 'compiled/without-di.js'], directory, cleanEnv);

  // Consumers own their container version; the core package supplies no DI runtime.
  const diFixture = 'di-versions.ts';
  cpSync(path.join(fixtureDirectory, diFixture), path.join(directory, diFixture));
  const containerVersions = ['6.2.2', '7.10.4', '8.2.3'];
  for (const version of containerVersions) {
    run([yarn, 'add', '--exact', `inversify@${version}`, 'reflect-metadata@0.2.2'], directory, {
      ...cleanEnv,
      YARN_ENABLE_IMMUTABLE_INSTALLS: 'false'
    });
    compileFixtures(directory, [diFixture]);
    run(['compiled/di-versions.js'], directory, cleanEnv);
    run([...developmentArgs, 'compiled/di-versions.js'], directory, cleanEnv);
  }

  const withoutZod = 'without-zod.ts';

  // Prove ordinary imports, declarations, schemas and DI work before adding Zod.
  cpSync(path.join(fixtureDirectory, withoutZod), path.join(directory, withoutZod));
  compileFixtures(directory, [withoutZod]);
  run(['compiled/without-zod.js'], directory, cleanEnv);
  run([...developmentArgs, 'compiled/without-zod.js'], directory, cleanEnv);

  // Applications that use Zod declare their own version, independently of our dev tools.
  run([yarn, 'add', '--exact', 'zod@4.6.6'], directory, {
    ...cleanEnv,
    YARN_ENABLE_IMMUTABLE_INSTALLS: 'false'
  });

  const fixtureSources = readdirSync(fixtureDirectory).filter((name) => name.endsWith('.ts'));
  for (const filename of fixtureSources) {
    cpSync(path.join(fixtureDirectory, filename), path.join(directory, filename));
  }

  // Type-check every fixture against the installed declarations, then execute plain JS.
  compileFixtures(directory, fixtureSources);

  for (const name of runtimeChecks) {
    run([`compiled/${name}.js`], directory, cleanEnv);
  }

  // Copy examples to the consumer so module resolution cannot fall back to the source checkout.
  cpSync(path.join(installed, 'examples'), path.join(directory, 'examples'), { recursive: true });
  run(['compiled/applications.js', path.join(directory, 'examples')], directory, cleanEnv);
  const exampleSources: string[] = [];

  function collectExampleSources(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) {
        collectExampleSources(filename);
      } else if (entry.name.endsWith('.ts')) {
        exampleSources.push(filename);
      }
    }
  }

  collectExampleSources(path.join(directory, 'examples'));
  run(
    [
      require.resolve('typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--noUncheckedIndexedAccess',
      '--exactOptionalPropertyTypes',
      '--allowImportingTsExtensions',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2023',
      ...exampleSources
    ],
    directory
  );
  const examples = checkExamples(path.join(directory, 'examples'));
  for (const name of [
    'substitution',
    'toml',
    'smoke',
    'escaping',
    'own-environment',
    'sweep',
    'options',
    'snapshots',
    'schema-versions'
  ]) {
    run([...developmentArgs, `compiled/${name}.js`], directory, cleanEnv);
  }

  run(
    [...developmentArgs, 'compiled/applications.js', path.join(directory, 'examples')],
    directory,
    cleanEnv
  );

  writeFileSync(
    path.join(
      root,
      fromRegistry ? 'artifacts/registry-validation.json' : 'artifacts/package-validation.json'
    ),
    JSON.stringify(
      {
        passed: true,
        source: fromRegistry ? 'public npm registry' : 'local Yarn archive',
        version: manifest.version,
        npmManifestMatchesYarn: true,
        compiledTestProbeExcluded: true,
        zodFreeConsumerPassed: true,
        diFreeConsumerPassed: true,
        consumerOwnedInversifyVersions: containerVersions,
        consumerOwnedZodVersion: '4.6.6',
        packageName: manifest.name,
        license: manifest.license,
        examples,
        documents,
        files,
        consumer: 'disposable directory outside checkout; removed after verification',
        runtime: process.version
      },
      null,
      2
    )
  );
  console.log(
    `${fromRegistry ? 'Registry' : 'Packed'} consumer passed: ${files.length} files, types, runtime, development condition, DI and ${examples} example scenarios.`
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
