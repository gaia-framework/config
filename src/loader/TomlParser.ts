import fs from 'node:fs';
import { TextDecoder } from 'node:util';
import { parse, TomlDate } from 'smol-toml';

const maximumDepth = 100;

/** Normalize TOML-only values before entering the shared configuration pipeline. */
function normalizeValue(value: unknown, depth: number): unknown {
  if (value instanceof TomlDate) {
    throw new Error(
      'Native TOML date/time values are not supported. Quote dates and times as strings.'
    );
  }

  if (typeof value === 'bigint') {
    throw new Error(
      'TOML integer exceeds the JavaScript safe integer range. Quote it as a string.'
    );
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (depth > maximumDepth) {
    throw new Error(`TOML configuration exceeds the maximum object-path depth of ${maximumDepth}.`);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item, depth + 1));
  }

  const entries = Object.entries(value);
  if (entries.length === 1 && entries[0]![0] === '$null') {
    if (entries[0]![1] !== true) {
      throw new Error('The TOML $null directive must be exactly { "$null" = true }.');
    }

    return null;
  }

  for (const entry of entries) {
    entry[1] = normalizeValue(entry[1], depth + 1);
  }

  return Object.fromEntries(entries);
}

export function parseTomlFile(filePath: string): unknown {
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(filePath));
  const parsed = parse(raw, {
    integersAsBigInt: 'asNeeded',
    useLegacyDate: true,
    unsafeKeyBehaviour: 'keep',
    maxDepth: maximumDepth
  });

  return normalizeValue(parsed, 0);
}
