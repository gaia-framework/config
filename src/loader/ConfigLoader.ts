import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';
import { isObject, setOwnProperty } from '../utils.js';
import type { ConfigData } from '../types.js';
import type { ConfigLoaderOptions } from '../options.js';
import { withSafeErrors } from '../errors.js';
import { canonicalPath } from './canonicalPath.js';
import { EnvironmentSubstitution } from './EnvironmentSubstitution.js';
import { DirectiveResolver, isDirectiveKey } from './DirectiveResolver.js';
import type { IncludeStack } from './DirectiveResolver.js';
import { parseTomlFile } from './TomlParser.js';

// Define colliding keys as own data without invoking inherited setters or getters.
const yamlSchema = yaml.JSON_SCHEMA.withTags({
  ...yaml.mapTag,
  addPair: (container, key, value) => {
    if (key === null || typeof key !== 'object') {
      const normalizedKey = String(key);
      if (normalizedKey in container) {
        setOwnProperty(container, normalizedKey, value);

        return '';
      }
    }

    return yaml.mapTag.addPair(container, key, value);
  }
});

export class ConfigLoader {
  private readonly environment: EnvironmentSubstitution;
  private readonly directives: DirectiveResolver;

  constructor(private options?: ConfigLoaderOptions) {
    this.environment = new EnvironmentSubstitution(options);
    this.directives = new DirectiveResolver(this.environment, {
      parseFile: (filePath) => this.parseIncludedFile(filePath),
      resolveValue: (value, sourceFile, includeStack, ancestors) =>
        this.resolveValue(value, sourceFile, includeStack, ancestors)
    });
  }

  public loadYamlConfig(filePath: string): ConfigData {
    return withSafeErrors(this.options?.safeErrors, 'CONFIG_FILE_LOAD_FAILED', () =>
      this.loadFile(filePath, false)
    );
  }

  public loadTomlConfig(filePath: string): ConfigData {
    return withSafeErrors(this.options?.safeErrors, 'CONFIG_FILE_LOAD_FAILED', () =>
      this.loadFile(filePath, true)
    );
  }

  public loadConfigFile(filePath: string): ConfigData {
    return path.extname(filePath).toLowerCase() === '.toml'
      ? this.loadTomlConfig(filePath)
      : this.loadYamlConfig(filePath);
  }

  private loadFile(filePath: string, toml: boolean): ConfigData {
    if (!fs.existsSync(filePath)) {
      return {};
    }

    const abs = path.resolve(filePath);
    const parsed = toml ? parseTomlFile(abs) : this.parseYaml(this.readText(abs));

    if (!toml && (parsed === undefined || parsed === null)) {
      return {};
    }

    if (!isObject(parsed)) {
      throw new Error(`Config root must be an object/mapping: ${abs}`);
    }

    const includeStack: IncludeStack = new Map([[canonicalPath(abs), abs]]);
    const resolved = this.resolveValue(parsed, abs, includeStack);

    if (!isObject(resolved)) {
      throw new Error(`Config root must resolve to an object: ${abs}`);
    }

    return resolved as ConfigData;
  }

  private readText(filePath: string): string {
    return fs.readFileSync(filePath, 'utf8');
  }

  private parseYaml(raw: string): unknown {
    if (raw.trim() === '') {
      return undefined;
    }

    let parsed: unknown;
    try {
      parsed = yaml.load(raw, { schema: yamlSchema });
    } catch (error) {
      // The pinned parser rejects sources containing only comments or end markers.
      if (
        error instanceof yaml.YAMLException &&
        error.reason === 'expected a document, but the input is empty'
      ) {
        return undefined;
      }

      throw error;
    }

    if (parsed === '') {
      const root = yaml.parseEvents(raw, {})[1];
      // An empty document is distinct from a quoted or block-style empty string.
      if (
        root?.type === yaml.EVENT_SCALAR &&
        root.style === yaml.SCALAR_STYLE_PLAIN &&
        root.valueStart === -1 &&
        root.tagStart === -1
      ) {
        return undefined;
      }
    }

    return parsed;
  }

  private parseIncludedFile(filePath: string): any {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.toml') {
      return parseTomlFile(filePath);
    }

    const raw = this.readText(filePath);

    if (ext === '.json') {
      return JSON.parse(raw);
    }

    if (ext === '.yaml' || ext === '.yml') {
      return this.parseYaml(raw);
    }

    throw new Error(`$include only supports .yaml/.yml/.json/.toml, got: ${filePath}`);
  }

  /**
   * Resolve directives and env substitutions recursively.
   * Directive objects must be exactly one key:
   *   { $env: "NAME" }
   *   { $file: "./rel.txt" }
   *   { $include: "./file.yaml#path.to.fragment" }
   */
  private resolveValue(
    value: any,
    sourceFile: string,
    includeStack: IncludeStack,
    ancestors = new Set<object>()
  ): any {
    if (typeof value === 'string') {
      return this.environment.resolveScalar(value);
    }

    if (value === null || typeof value !== 'object') {
      return value;
    }

    if (ancestors.has(value)) {
      throw new Error(`Config value cycle detected: ${sourceFile}`);
    }

    ancestors.add(value);
    try {
      return this.resolveContainer(value, sourceFile, includeStack, ancestors);
    } finally {
      ancestors.delete(value);
    }
  }

  private resolveContainer(
    value: Record<string, any> | any[],
    sourceFile: string,
    includeStack: IncludeStack,
    ancestors: Set<object>
  ): any {
    if (Array.isArray(value)) {
      return value.map((v) => this.resolveValue(v, sourceFile, includeStack, ancestors));
    }

    const keys = Object.keys(value);

    if (keys.length === 1) {
      const key = keys[0]!;
      const argument = value[key];
      if (isDirectiveKey(key)) {
        return this.directives.resolve(key, argument, sourceFile, includeStack, ancestors);
      }
    }

    // Capture sibling values before resolving them, preserving observation order.
    const entries = Object.entries(value);
    for (const entry of entries) {
      entry[1] = this.resolveValue(entry[1], sourceFile, includeStack, ancestors);
    }

    // Create own data properties, including names such as __proto__, in one pass.
    return Object.fromEntries(entries);
  }
}
