import "@testing-library/jest-dom/vitest";

/**
 * A working `localStorage` for renderer unit tests.
 *
 * Two things in this environment make the stock one unusable:
 *
 *  - Node 26 ships its own experimental `localStorage` global that throws "not
 *    available" unless the process was started with --localstorage-file, and
 *    jsdom's `window.localStorage` is a different object in another realm.
 *  - Renderer code makes a working storage by patching `Storage.prototype.setItem`
 *    (Cloud settings sync mirrors every write that way). That only works when the
 *    instance a test uses inherits its methods from `Storage.prototype`.
 *
 * So one shared store is installed behind both names, and `Storage.prototype`
 * itself is given the backing operations. The instance the tests use simply
 * inherits from it, exactly like a browser's.
 */
const data = new Map<string, string>();

const operations = {
  get length(): number {
    return data.size;
  },
  clear(): void {
    data.clear();
  },
  getItem(key: string): string | null {
    const value = data.get(String(key));
    return value === undefined ? null : value;
  },
  key(index: number): string | null {
    return Array.from(data.keys())[index] ?? null;
  },
  removeItem(key: string): void {
    data.delete(String(key));
  },
  setItem(key: string, value: string): void {
    data.set(String(key), String(value));
  },
};

function installPrototype(prototype: object | undefined): void {
  if (!prototype) return;
  for (const name of Object.keys(operations) as Array<
    keyof typeof operations
  >) {
    const descriptor =
      name === "length"
        ? { get: () => operations.length, configurable: true }
        : { value: operations[name], configurable: true, writable: true };
    try {
      Object.defineProperty(prototype, name, descriptor);
    } catch {
      /* a frozen prototype keeps whatever it had */
    }
  }
}

// jsdom exposes a Storage class; put the operations on its prototype before the
// instance is created so the instance has nothing of its own.
installPrototype(
  typeof Storage === "undefined" ? undefined : Storage.prototype,
);
if (typeof window !== "undefined" && window.Storage)
  installPrototype(window.Storage.prototype);

const sharedStorage = Object.create(
  typeof Storage === "undefined" ? Object.prototype : Storage.prototype,
) as Storage;

function defineStorage(target: object | undefined): void {
  if (!target) return;
  try {
    Object.defineProperty(target, "localStorage", {
      value: sharedStorage,
      configurable: true,
      writable: true,
    });
  } catch {
    /* a frozen global keeps whatever it already had */
  }
}

defineStorage(globalThis);
if (typeof window !== "undefined") defineStorage(window);
