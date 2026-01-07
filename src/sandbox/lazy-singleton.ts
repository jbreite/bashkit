/**
 * Creates a lazy singleton that initializes on first access.
 * Safe for concurrent calls - all callers await the same promise.
 *
 * @example
 * ```typescript
 * const sandbox = createLazySingleton(async () => {
 *   const sdk = await import("@vercel/sandbox");
 *   return sdk.Sandbox.create({ ... });
 * });
 *
 * // Safe for parallel calls:
 * const [a, b] = await Promise.all([sandbox.get(), sandbox.get()]);
 * // a === b (same instance)
 *
 * // Reset for cleanup:
 * sandbox.reset();
 * ```
 */
export function createLazySingleton<T>(factory: () => Promise<T>): {
  /** Get the singleton instance, creating it if needed */
  get: () => Promise<T>;
  /** Reset the singleton, allowing a new instance to be created */
  reset: () => void;
} {
  let promise: Promise<T> | null = null;

  return {
    get: () => {
      if (!promise) {
        promise = factory();
      }
      return promise;
    },
    reset: () => {
      promise = null;
    },
  };
}
