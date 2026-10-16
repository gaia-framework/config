import assert from 'node:assert/strict';

const registry = 'https://registry.npmjs.org';
const attempts = 30;
const retryDelay = 10_000;
const requestTimeout = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function versionAvailable(name: string, version: string): Promise<boolean> {
  try {
    const response = await fetch(`${registry}/${encodeURIComponent(name)}`, {
      // Check the same abbreviated metadata that Yarn uses during resolution.
      headers: { accept: 'application/vnd.npm.install-v1+json' },
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

export async function waitForRegistry(name: string, version: string): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (await versionAvailable(name, version)) {
      return;
    }

    if (attempt < attempts) {
      console.log(
        `Waiting for public npm metadata for ${name}@${version} (${attempt}/${attempts}).`
      );
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  throw new Error(
    `${name}@${version} is not available from the public registry after ${attempts} checks. ` +
      'Inspect npm processing or staging status before retrying verification; do not republish.'
  );
}
