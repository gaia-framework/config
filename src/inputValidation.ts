import { isObject } from './utils.js';

interface Frame {
  value: object;
  keys: PropertyKey[];
  index: number;
}

/** Validate object graphs iteratively so deep inputs cannot overflow this guard. */
export function assertConfigObject(
  value: unknown,
  rejectAccessors = false
): asserts value is Record<string, any> {
  if (!isObject(value)) {
    throw new Error('Config root must be an object/mapping.');
  }

  assertAcyclicConfig(value, rejectAccessors);
}

export function assertAcyclicConfig(value: unknown, rejectAccessors = false): void {
  if (value === null || typeof value !== 'object') {
    return;
  }

  const ancestors = new Set<object>([value]);
  const completed = new Set<object>();
  const keysOf = (item: object): PropertyKey[] =>
    rejectAccessors ? Reflect.ownKeys(item) : Object.getOwnPropertyNames(item);
  const stack: Frame[] = [{ value, keys: keysOf(value), index: 0 }];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const key = frame.keys[frame.index++];

    if (key === undefined) {
      ancestors.delete(frame.value);
      completed.add(frame.value);
      stack.pop();
      continue;
    }

    const descriptor = rejectAccessors
      ? Object.getOwnPropertyDescriptor(frame.value, key)
      : undefined;

    if (descriptor && !Object.hasOwn(descriptor, 'value')) {
      throw new Error('Immutable configuration does not support accessor properties.');
    }

    const child: unknown = descriptor
      ? descriptor.value
      : (frame.value as Record<PropertyKey, unknown>)[key];

    if (child === null || typeof child !== 'object') {
      continue;
    }

    if (ancestors.has(child)) {
      throw new Error('Config value cycle detected in in-memory configuration.');
    }

    if (!completed.has(child)) {
      ancestors.add(child);
      stack.push({ value: child, keys: keysOf(child), index: 0 });
    }
  }
}
