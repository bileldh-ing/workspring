import fs from "node:fs/promises";
import path from "node:path";
import type { StorageAdapter } from "./index";

/** Dev/test storage on local disk, outside the public/ folder. Keys are server-generated UUID paths only. */
export function createLocalStorage(root: string): StorageAdapter {
  const base = path.resolve(root);
  const resolve = (key: string) => {
    if (!/^[a-z0-9/_-]+$/i.test(key)) throw new Error("Invalid storage key");
    const p = path.resolve(base, key);
    if (!p.startsWith(base + path.sep)) throw new Error("Invalid storage key");
    return p;
  };
  return {
    id: "local",
    async put(key, bytes) {
      const p = resolve(key);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, bytes, { mode: 0o600 });
    },
    async get(key) {
      try {
        return new Uint8Array(await fs.readFile(resolve(key)));
      } catch {
        return null;
      }
    },
    async delete(key) {
      await fs.rm(resolve(key), { force: true });
    },
  };
}
