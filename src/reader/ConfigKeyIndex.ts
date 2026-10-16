export class ConfigKeyIndex {
  private readonly names: string[] = [];
  private labels: string[] = [];
  private parents: number[] = [];
  private paths: string[][] | undefined;

  constructor(root: Record<string, any>) {
    const stack = [{ value: root, prefix: '', parent: -1, keys: Object.keys(root), index: 0 }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const key = frame.keys[frame.index++];

      if (key === undefined) {
        stack.pop();
        continue;
      }

      const value = frame.value[key];
      const full = frame.prefix ? `${frame.prefix}.${key}` : key;
      const index = this.names.length;
      this.names.push(full);
      this.labels.push(key);
      this.parents.push(frame.parent);

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        stack.push({
          value,
          prefix: full,
          parent: index,
          keys: Object.keys(value),
          index: 0
        });
      }
    }
  }

  keys(): string[] {
    return [...this.names];
  }

  keyPaths(): string[][] {
    if (!this.paths) {
      this.paths = this.materializePaths();
      this.labels = [];
      this.parents = [];
    }

    return this.paths.map((segments) => [...segments]);
  }

  private materializePaths(): string[][] {
    const paths: string[][] = [];

    for (let index = 0; index < this.labels.length; index++) {
      const parent = this.parents[index]!;
      const prefix = parent === -1 ? [] : paths[parent]!;
      paths.push([...prefix, this.labels[index]!]);
    }

    return paths;
  }
}
