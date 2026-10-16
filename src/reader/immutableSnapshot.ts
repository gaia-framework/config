type DataContainer = Record<PropertyKey, unknown> | unknown[];

function emptyContainer(value: object): DataContainer {
  const prototype = Object.getPrototypeOf(value);

  if (Array.isArray(value) && prototype === Array.prototype) {
    return new Array(value.length);
  }

  if (!Array.isArray(value) && (prototype === Object.prototype || prototype === null)) {
    return Object.create(prototype) as Record<PropertyKey, unknown>;
  }

  throw new Error('Immutable configuration supports only plain objects and arrays.');
}

/** Copy data descriptors, retaining shared references without recursive traversal. */
export function createImmutableSnapshot(value: Record<string, any>): Record<string, any> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Config root must be an object/mapping.');
  }

  const copies = new WeakMap<object, DataContainer>();
  const pending: Array<{ source: object; target: DataContainer }> = [];

  function copy(item: unknown): unknown {
    if (item === null || ['undefined', 'string', 'number', 'boolean'].includes(typeof item)) {
      return item;
    }

    if (typeof item !== 'object') {
      throw new Error('Immutable configuration contains an unsupported value type.');
    }

    const existing = copies.get(item);

    if (existing) {
      return existing;
    }

    const target = emptyContainer(item);
    copies.set(item, target);
    pending.push({ source: item, target });

    return target;
  }

  const snapshot = copy(value) as Record<string, any>;

  while (pending.length > 0) {
    const { source, target } = pending.pop()!;

    for (const key of Reflect.ownKeys(source)) {
      if (Array.isArray(source) && key === 'length') {
        continue;
      }

      const descriptor = Object.getOwnPropertyDescriptor(source, key)!;

      if (!Object.hasOwn(descriptor, 'value')) {
        throw new Error('Immutable configuration does not support accessor properties.');
      }

      Object.defineProperty(target, key, {
        value: copy(descriptor.value),
        enumerable: descriptor.enumerable ?? false,
        configurable: true,
        writable: true
      });
    }

    Object.freeze(target);
  }

  return snapshot;
}
