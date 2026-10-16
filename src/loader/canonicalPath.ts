import fs from 'node:fs';

export function canonicalPath(filename: string): string {
  if (typeof fs.realpathSync.native === 'function') {
    try {
      const resolved = fs.realpathSync.native(filename);

      // Both callers supply normalized absolute paths. Windows native resolution
      // expands short names and changes casing; the legacy resolver may preserve
      // those spellings, affecting the point at which a cycle is detected.
      if (process.platform !== 'win32' || resolved === filename) {
        return resolved;
      }
    } catch {
      // Some filesystems cannot use the native implementation. Preserve the
      // existing resolver and its diagnostics in that case.
    }
  }

  return fs.realpathSync(filename);
}
