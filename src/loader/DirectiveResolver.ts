import fs from 'node:fs';
import path from 'node:path';
import { canonicalPath } from './canonicalPath.js';
import type { EnvironmentSubstitution } from './EnvironmentSubstitution.js';

export type IncludeStack = Map<string, string>;
export type DirectiveKey = '$env' | '$file' | '$include';

interface DirectiveDependencies {
  parseFile(filePath: string): any;
  resolveValue(
    value: any,
    sourceFile: string,
    includeStack: IncludeStack,
    ancestors: Set<object>
  ): any;
}

export function isDirectiveKey(key: string): key is DirectiveKey {
  return key === '$env' || key === '$file' || key === '$include';
}

/** Own include reuse for exactly one loader; callbacks retain its recursive context. */
export class DirectiveResolver {
  private includeCache = new Map<string, any>();

  constructor(
    private readonly environment: EnvironmentSubstitution,
    private readonly dependencies: DirectiveDependencies
  ) {}

  resolve(
    key: DirectiveKey,
    value: any,
    sourceFile: string,
    includeStack: IncludeStack,
    ancestors: Set<object>
  ): any {
    if (typeof value !== 'string') {
      throw new Error(`${key} directive must be a string (in ${sourceFile})`);
    }

    if (key === '$env') {
      return this.resolveEnvironment(value, sourceFile);
    }

    const baseDir = path.dirname(sourceFile);
    if (key === '$file') {
      return this.resolveText(value, sourceFile, baseDir);
    }

    return this.resolveInclude(value, sourceFile, baseDir, includeStack, ancestors);
  }

  private resolveEnvironment(value: string, sourceFile: string): string {
    const envName = this.environment.substitute(value);
    const envVal = this.environment.read(envName);
    if (envVal === undefined || envVal === '') {
      throw new Error(`$env "${envName}" is required but not set (from ${sourceFile})`);
    }

    return envVal;
  }

  private resolveText(value: string, sourceFile: string, baseDir: string): string {
    const rel = this.environment.substitute(value);
    const abs = path.resolve(baseDir, rel);
    if (!fs.existsSync(abs)) {
      throw new Error(`$file not found: ${abs} (from ${sourceFile})`);
    }

    return fs.readFileSync(abs, 'utf8');
  }

  private resolveInclude(
    v: string,
    sourceFile: string,
    baseDir: string,
    includeStack: IncludeStack,
    ancestors: Set<object>
  ): any {
    const spec = this.environment.substitute(v);
    const [filePart, frag = ''] = spec.split('#', 2);

    const abs = path.resolve(baseDir, filePart ?? '');
    const absNorm = path.resolve(abs);

    if (!fs.existsSync(absNorm)) {
      throw new Error(`$include not found: ${absNorm} (from ${sourceFile})`);
    }

    const identity = canonicalPath(absNorm);

    if (includeStack.has(identity)) {
      throw new Error(
        `$include cycle detected: ${[...includeStack.values(), absNorm].join(' -> ')}`
      );
    }

    let included: any;

    if (this.includeCache.has(absNorm)) {
      included = this.includeCache.get(absNorm);
    } else {
      includeStack.set(identity, absNorm);
      try {
        const rawIncluded = this.dependencies.parseFile(absNorm);
        included = this.dependencies.resolveValue(rawIncluded, absNorm, includeStack, ancestors);
        this.includeCache.set(absNorm, included);
      } finally {
        includeStack.delete(identity);
      }
    }

    if (!frag) {
      return included;
    }

    // fragment dot path (supports numeric segments for arrays)
    const parts = frag.split('.').filter(Boolean);
    let cur: any = included;

    const throwFragNotFound = () => {
      throw new Error(`$include fragment not found: ${spec} (from ${sourceFile})`);
    };

    for (const part of parts) {
      if (cur === null || cur === undefined) {
        throwFragNotFound();
      }

      if (Array.isArray(cur)) {
        const idx = Number(part);
        if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
          throw new Error(`$include fragment index not found: ${spec} (from ${sourceFile})`);
        }

        cur = cur[idx];
        continue;
      }

      if (typeof cur === 'object') {
        // ensures the key actually exists (prevents single-segment missing fragments from returning undefined)
        if (!Object.prototype.hasOwnProperty.call(cur, part)) {
          throwFragNotFound();
        }

        cur = (cur as any)[part];
        continue;
      }

      throwFragNotFound();
    }

    // YAML can't represent `undefined`; treat undefined as missing fragment.
    if (cur === undefined) {
      throwFragNotFound();
    }

    return cur;
  }
}
