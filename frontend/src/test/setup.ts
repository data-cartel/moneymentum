import "@testing-library/jest-dom"

const createMemoryStorage = (): Storage => {
  const storedEntries = new Map<string, string>()

  return {
    get length() {
      return storedEntries.size
    },
    clear: () => {
      storedEntries.clear()
    },
    getItem: storageKey => storedEntries.get(storageKey) ?? null,
    key: storageIndex => Array.from(storedEntries.keys())[storageIndex] ?? null,
    removeItem: storageKey => {
      storedEntries.delete(storageKey)
    },
    setItem: (storageKey, storedValue) => {
      storedEntries.set(storageKey, storedValue)
    },
  }
}

const hasCompleteLocalStorage = (candidate: unknown): candidate is Storage =>
  typeof candidate === "object" &&
  candidate !== null &&
  typeof (candidate as Storage).clear === "function" &&
  typeof (candidate as Storage).getItem === "function" &&
  typeof (candidate as Storage).key === "function" &&
  typeof (candidate as Storage).removeItem === "function" &&
  typeof (candidate as Storage).setItem === "function"

if (!hasCompleteLocalStorage(globalThis.localStorage)) {
  const memoryStorage = createMemoryStorage()

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: memoryStorage,
    writable: true,
  })
}
