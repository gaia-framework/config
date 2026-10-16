export function isObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Store special names such as __proto__ as data, without invoking inherited setters. */
export function setOwnProperty(target: Record<string, any>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true
  });
}

/** Node's process.env own-property lookup retains the host's environment casing rules. */
export function readEnvironmentValue(
  env: NodeJS.ProcessEnv | undefined,
  name: string
): string | undefined {
  return env && Object.hasOwn(env, name) ? env[name] : undefined;
}
