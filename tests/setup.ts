/**
 * Global test setup for Vitest
 *
 * This file runs before all tests and configures:
 * - Global test utilities
 * - Mock defaults
 * - Environment setup
 */

import { beforeEach, vi } from "vitest";

// Reset all mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

// Silence console.log in tests unless DEBUG is set
if (!process.env.DEBUG) {
  vi.spyOn(console, "log").mockImplementation(() => {});
}

// Set test environment variables
process.env.NODE_ENV = "test";
