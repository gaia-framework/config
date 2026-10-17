import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';

interface InstallationResult {
  status: number | null;
  signal?: NodeJS.Signals | null;
  error?: Error;
  stdout: string;
  stderr: string;
}

const registry = 'https://registry.npmjs.org';
const attempts = 30;
const retryDelay = 10_000;
const requestTimeout = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function versionAvailable(name: string, version: string): Promise<boolean> {
  try {
    // Yarn 4 requests full metadata with a literal @ and a lowercase encoded slash.
    const response = await fetch(`${registry}/${name.replace('/', '%2f')}`, {
      ...(process.env.NPM_TOKEN
        ? { headers: { authorization: `Bearer ${process.env.NPM_TOKEN}` } }
        : {}),
      signal: AbortSignal.timeout(requestTimeout)
    });

    if (response.status === 404 || response.status === 429 || response.status >= 500) {
      await response.body?.cancel();

      return false;
    }

    assert.ok(response.ok, `Registry availability check failed: HTTP ${response.status}.`);
    const metadata = await response.json();
    assert.ok(isRecord(metadata), 'Registry returned invalid package metadata.');
    assert.equal(metadata.name, name, 'Registry returned an unexpected package.');
    assert.ok(isRecord(metadata.versions), 'Registry returned invalid versions metadata.');
    const release = metadata.versions[version];
    if (release === undefined) {
      return false;
    }

    assert.ok(isRecord(release), 'Registry returned invalid release metadata.');
    assert.equal(release.name, name, 'Registry returned an unexpected release package.');
    assert.equal(release.version, version, 'Registry returned an unexpected release version.');

    return true;
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name))
    ) {
      return false;
    }

    throw error;
  }
}

function installationAvailable(result: InstallationResult, name: string, version: string): boolean {
  if (result.error) {
    throw result.error;
  }

  if (result.status === 0) {
    return true;
  }

  const output = stripVTControlCharacters(`${result.stdout}\n${result.stderr}`);
  const errors: readonly string[] = output.match(/\bYN\d{4}\b/g) ?? [];
  const candidateFailures = output.split('\n').filter((line) => line.includes('YN0082'));
  const pendingVersion = candidateFailures.every((line) =>
    line.includes(`${name}@npm:${version}: No candidates found`)
  );
  if (
    result.status !== null &&
    !result.signal &&
    pendingVersion &&
    errors.includes('YN0082') &&
    errors.every((code) => code === 'YN0000' || code === 'YN0082')
  ) {
    return false;
  }

  assert.fail(`Registry consumer installation failed:\n${output}`);
}

export async function waitForRegistry(
  name: string,
  version: string,
  install?: () => InstallationResult
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (
      (await versionAvailable(name, version)) &&
      (!install || installationAvailable(install(), name, version))
    ) {
      return;
    }

    if (attempt < attempts) {
      console.log(`Waiting for npm availability for ${name}@${version} (${attempt}/${attempts}).`);
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  throw new Error(
    `${name}@${version} is not available from the npm registry after ${attempts} checks. ` +
      'Inspect npm processing or staging status before retrying verification; do not republish.'
  );
}
