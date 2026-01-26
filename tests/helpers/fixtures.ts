/**
 * Common test fixtures and data generators
 *
 * Provides reusable test data for tool testing.
 */

import type { MockFileSystem } from "./mock-sandbox";

/**
 * Sample TypeScript project file structure
 */
export const sampleProjectFiles: MockFileSystem = {
  "/workspace": ["src", "tests", "package.json", "tsconfig.json", "README.md"],
  "/workspace/src": ["index.ts", "utils.ts", "types.ts"],
  "/workspace/src/index.ts": `import { greet } from './utils';
import type { User } from './types';

export function main(user: User): string {
  return greet(user.name);
}

export { greet } from './utils';
export type { User } from './types';
`,
  "/workspace/src/utils.ts": `export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
`,
  "/workspace/src/types.ts": `export interface User {
  id: number;
  name: string;
  email: string;
}

export interface Config {
  apiUrl: string;
  timeout: number;
}
`,
  "/workspace/tests": ["index.test.ts", "utils.test.ts"],
  "/workspace/tests/index.test.ts": `import { describe, it, expect } from 'vitest';
import { main } from '../src/index';

describe('main', () => {
  it('should greet user', () => {
    expect(main({ id: 1, name: 'Test', email: 'test@test.com' })).toBe('Hello, Test!');
  });
});
`,
  "/workspace/tests/utils.test.ts": `import { describe, it, expect } from 'vitest';
import { greet, capitalize } from '../src/utils';

describe('greet', () => {
  it('should return greeting', () => {
    expect(greet('World')).toBe('Hello, World!');
  });
});

describe('capitalize', () => {
  it('should capitalize first letter', () => {
    expect(capitalize('hello')).toBe('Hello');
  });
});
`,
  "/workspace/package.json": `{
  "name": "sample-project",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest",
    "build": "tsc"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
`,
  "/workspace/tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
`,
  "/workspace/README.md": `# Sample Project

A sample TypeScript project for testing.

## Usage

\`\`\`bash
npm install
npm test
\`\`\`
`,
};

/**
 * Create a large file with numbered lines for pagination tests
 *
 * @param lines - Number of lines to generate
 * @returns String content with numbered lines
 *
 * @example
 * ```typescript
 * const content = createLargeFile(1000);
 * // Returns: "Line 1\nLine 2\n...Line 1000\n"
 * ```
 */
export function createLargeFile(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `Line ${i + 1}`).join("\n");
}

/**
 * Ripgrep JSON match format
 */
export interface RipgrepMatch {
  path: string;
  lineNumber: number;
  lineContent: string;
  matchStart?: number;
  matchEnd?: number;
}

/**
 * Create ripgrep JSON output for grep tests
 *
 * Generates the JSON format that ripgrep produces with --json flag.
 *
 * @param matches - Array of match objects
 * @returns Ripgrep JSON output string (newline-delimited JSON)
 *
 * @example
 * ```typescript
 * const output = createRipgrepOutput([
 *   { path: '/file.ts', lineNumber: 10, lineContent: 'function test()' },
 * ]);
 * ```
 */
export function createRipgrepOutput(matches: RipgrepMatch[]): string {
  const lines: string[] = [];

  // Begin message
  lines.push(
    JSON.stringify({
      type: "begin",
      data: { path: { text: matches[0]?.path || "" } },
    }),
  );

  // Match messages
  for (const match of matches) {
    lines.push(
      JSON.stringify({
        type: "match",
        data: {
          path: { text: match.path },
          lines: { text: match.lineContent },
          line_number: match.lineNumber,
          absolute_offset: 0,
          submatches: [
            {
              match: { text: match.lineContent.trim() },
              start: match.matchStart ?? 0,
              end: match.matchEnd ?? match.lineContent.length,
            },
          ],
        },
      }),
    );
  }

  // End message
  lines.push(
    JSON.stringify({
      type: "end",
      data: {
        path: { text: matches[0]?.path || "" },
        binary_offset: null,
        stats: {
          elapsed: { secs: 0, nanos: 1000000 },
          searches: 1,
          searches_with_match: matches.length > 0 ? 1 : 0,
          bytes_searched: 1000,
          bytes_printed: 100,
          matched_lines: matches.length,
          matches: matches.length,
        },
      },
    }),
  );

  // Summary message
  lines.push(
    JSON.stringify({
      type: "summary",
      data: {
        elapsed_total: { secs: 0, nanos: 2000000 },
        stats: {
          elapsed: { secs: 0, nanos: 1000000 },
          searches: 1,
          searches_with_match: matches.length > 0 ? 1 : 0,
          bytes_searched: 1000,
          bytes_printed: 100,
          matched_lines: matches.length,
          matches: matches.length,
        },
      },
    }),
  );

  return lines.join("\n");
}

/**
 * Create a binary file content (contains null bytes)
 *
 * @param size - Size in bytes
 * @returns String with binary content
 */
export function createBinaryContent(size: number): string {
  const bytes = new Uint8Array(size);
  // Add some null bytes to mark as binary
  bytes[0] = 0x89;
  bytes[1] = 0x50;
  bytes[2] = 0x4e;
  bytes[3] = 0x47;
  bytes[4] = 0x00; // Null byte
  return String.fromCharCode(...bytes);
}

/**
 * Sample glob patterns for testing
 */
export const sampleGlobPatterns = {
  allTypeScript: "**/*.ts",
  allTests: "**/*.test.ts",
  srcOnly: "src/**/*.ts",
  specificFile: "src/index.ts",
  multipleExtensions: "**/*.{ts,tsx,js,jsx}",
  withExclusion: "**/*.ts",
};

/**
 * Sample grep patterns for testing
 */
export const sampleGrepPatterns = {
  functionDef: "function\\s+\\w+",
  importStatement: "^import\\s+",
  exportStatement: "^export\\s+",
  interfaceDef: "interface\\s+\\w+",
  constDeclaration: "const\\s+\\w+\\s*=",
  stringLiteral: "'[^']*'",
};
