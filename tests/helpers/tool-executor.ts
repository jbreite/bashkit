/**
 * Tool execution helpers for testing
 *
 * Provides utilities to execute AI SDK tools in tests
 * with minimal boilerplate.
 */

import type { Tool } from "ai";

/**
 * Default options for tool execution in tests
 */
const DEFAULT_EXEC_OPTIONS = {
  toolCallId: "test-call-id",
  messages: [],
};

/**
 * Execute a tool with test defaults
 *
 * Returns `unknown` which gets narrowed by assertSuccess/assertError.
 * This is type-safe because assertions verify the shape at runtime.
 *
 * @param tool - The AI SDK tool to execute
 * @param input - Tool input parameters
 * @param options - Optional execution options (toolCallId, messages)
 * @returns Tool execution result (use assertSuccess/assertError to narrow)
 *
 * @example
 * ```typescript
 * const result = await executeTool(bashTool, {
 *   command: 'echo "hello"',
 *   description: 'Test echo',
 * });
 * assertSuccess(result);
 * expect(result.stdout).toContain('hello');
 * ```
 */
export async function executeTool<T extends Tool>(
  tool: T,
  input: Record<string, unknown>,
  options?: Partial<typeof DEFAULT_EXEC_OPTIONS>,
): Promise<unknown> {
  if (!tool.execute) {
    throw new Error("Tool has no execute function");
  }

  const execOptions = { ...DEFAULT_EXEC_OPTIONS, ...options };
  const result = await tool.execute(input, execOptions);

  // If result is an AsyncIterable, consume the first value
  // This handles streaming tools in tests
  if (result && typeof result === "object" && Symbol.asyncIterator in result) {
    const iterator = (result as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    const first = await iterator.next();
    return first.value;
  }

  return result;
}

/**
 * Base error result type
 */
interface ErrorResult {
  error: string;
  [key: string]: unknown;
}

/**
 * Type guard for error results
 *
 * Checks if a tool result has an 'error' property,
 * indicating a failed operation.
 *
 * @example
 * ```typescript
 * const result = await executeTool(readTool, { file_path: '/missing' });
 * if (isErrorResult(result)) {
 *   console.log(result.error);
 * }
 * ```
 */
export function isErrorResult(result: unknown): result is ErrorResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    typeof (result as Record<string, unknown>).error === "string"
  );
}

/**
 * Assert that a result is successful (no error property) and narrow to expected type
 *
 * @throws Error if result has an error property
 *
 * @example
 * ```typescript
 * const result = await executeTool(readTool, { file_path: '/file.ts' });
 * assertSuccess<ReadTextOutput>(result);
 * expect(result.content).toBeDefined();
 * ```
 */
export function assertSuccess<T extends object>(
  result: unknown,
): asserts result is T {
  if (isErrorResult(result)) {
    throw new Error(`Expected success but got error: ${result.error}`);
  }
  if (typeof result !== "object" || result === null) {
    throw new Error(`Expected object result but got: ${typeof result}`);
  }
}

/**
 * Assert that a result is an error
 *
 * @throws Error if result doesn't have an error property
 *
 * @example
 * ```typescript
 * const result = await executeTool(readTool, { file_path: '/missing' });
 * assertError(result);
 * expect(result.error).toContain('not found');
 * ```
 */
export function assertError(result: unknown): asserts result is ErrorResult {
  if (!isErrorResult(result)) {
    throw new Error(
      `Expected error but got success: ${JSON.stringify(result)}`,
    );
  }
}
