# Sandbox Module

The sandbox module provides the foundational execution environment abstraction for BashKit. It defines a unified `Sandbox` interface that all tools depend on, enabling code execution, file I/O, and command running across different environments (local Bun, Vercel Firecracker VMs, E2B cloud sandboxes). This is the CORE abstraction layer that makes BashKit's "Bring Your Own Sandbox" architecture possible.

## Files

| File | Purpose |
|------|---------|
| `interface.ts` | Defines `Sandbox`, `ExecOptions`, `ExecResult` - the contract all implementations must follow |
| `local.ts` | Bun-based local sandbox using native file APIs and process spawning (sync creation) |
| `vercel.ts` | Vercel Firecracker VM sandbox wrapper with lazy initialization (async creation) |
| `e2b.ts` | E2B cloud sandbox wrapper with lazy initialization (async creation) |
| `ensure-tools.ts` | Auto-installs ripgrep for remote sandboxes, verifies bundled binary for local |
| `lazy-singleton.ts` | Generic lazy initialization primitive preventing SDK race conditions |
| `ripgrep.ts` | Utility to locate bundled ripgrep binary from `@vscode/ripgrep` |
| `index.ts` | Barrel export file exposing all sandbox types and factory functions |

## Key Exports

- `Sandbox` -- Core interface with 9 methods: `exec`, `readFile`, `writeFile`, `readDir`, `fileExists`, `isDirectory`, `destroy`, `id?`, `rgPath?`
- `ExecOptions` -- Command execution options: `timeout?`, `cwd?`, `restart?`
- `ExecResult` -- Command result shape: `stdout`, `stderr`, `exitCode`, `durationMs`, `interrupted`
- `createLocalSandbox(config?)` -- Sync factory returning Bun-based sandbox
- `createVercelSandbox(config?)` -- Async factory returning Vercel Firecracker sandbox with auto tool setup
- `createE2BSandbox(config?)` -- Async factory returning E2B cloud sandbox with auto tool setup
- `ensureSandboxTools(sandbox)` -- Async function that installs/verifies ripgrep availability
- `getBundledRgPath()` / `getBundledRgPathSync()` -- Locate ripgrep from optional `@vscode/ripgrep` package

## Architecture

```
                    Sandbox Interface
                          ↑
         ┌────────────────┼────────────────┐
         │                │                │
    LocalSandbox    VercelSandbox     E2BSandbox
         │                │                │
         │                ↓                ↓
         │         LazySingleton    LazySingleton
         │                │                │
         ↓                ↓                ↓
    Bun APIs      @vercel/sandbox   @e2b/code-interpreter
         │
         ↓
  getBundledRgPathSync
         ↓
    @vscode/ripgrep (optional)
```

**Data Flow**:
1. Tool calls `sandbox.exec(command)` or `sandbox.readFile(path)`
2. Sandbox implementation translates to underlying SDK/API
3. Results normalized to `ExecResult` or string
4. Errors propagated as exceptions (sandboxes throw, tools catch)

**Key Abstractions**:
- **Sandbox Interface**: Contract-based design allows swapping implementations
- **Lazy Singleton**: Defers SDK loading and creation until first tool call
- **Path Normalization**: Local sandbox handles relative→absolute path conversion
- **rgPath Property**: Getter/setter pattern allows post-construction tool setup

**Internal Dependencies**:
- `local.ts` → `interface.ts`, `ripgrep.ts`
- `vercel.ts` → `interface.ts`, `lazy-singleton.ts`, `ensure-tools.ts`
- `e2b.ts` → `interface.ts`, `lazy-singleton.ts`, `ensure-tools.ts`
- `ensure-tools.ts` → `interface.ts`, `ripgrep.ts`

## Design Patterns

- **Strategy Pattern** -- Sandbox interface with 3 interchangeable implementations (local/vercel/e2b)
- **Lazy Initialization** -- Remote sandboxes defer SDK import and creation until first method call
- **Singleton with Reset** -- `createLazySingleton` ensures one SDK instance per sandbox, prevents parallel creation race
- **Factory Functions** -- `createLocalSandbox` (sync), `createVercelSandbox`/`createE2BSandbox` (async) hide construction complexity
- **Dynamic Import** -- SDKs loaded only when needed: `await import("@vercel/sandbox")` in factory
- **Getter/Setter for Late Binding** -- `rgPath` property set after construction by `ensureSandboxTools()`
- **Command Execution Abstraction** -- All sandboxes normalize to `ExecResult` shape despite different SDK APIs

## Integration Points

**Depends on**:
- No other BashKit modules (this is the lowest layer)
- Optional peer deps: `@vercel/sandbox`, `@e2b/code-interpreter`, `@vscode/ripgrep`

**Used by**:
- `/src/tools/*.ts` -- All 8 sandbox-dependent tools import `Sandbox` interface
- `/src/tools/index.ts` -- `createAgentTools(sandbox, config)` accepts any Sandbox implementation

**Exported from**:
- `/src/index.ts` -- Exposes `Sandbox`, `ExecOptions`, `ExecResult` types (line 35)
- `/src/index.ts` -- Exposes all factory functions and configs via re-export from `/src/sandbox/index.ts`

**Critical Contract**: All tools depend ONLY on the `Sandbox` interface, never concrete implementations. Changing the interface breaks ALL tools.

## Common Modifications

### Adding a New Sandbox Implementation

**Files to modify**:
1. Create `/src/sandbox/your-sandbox.ts`
2. Update `/src/sandbox/index.ts` to export new factory

**Steps**:
1. Import `Sandbox`, `ExecOptions`, `ExecResult` from `./interface`
2. Define config interface (e.g., `YourSandboxConfig`)
3. Create factory function (sync or async):
   ```typescript
   export async function createYourSandbox(config?: YourSandboxConfig): Promise<Sandbox>
   ```
4. Implement all 9 interface methods (7 required + `id?` + `rgPath?`)
5. For remote sandboxes: wrap SDK in `createLazySingleton`, call `ensureSandboxTools()`
6. For local sandboxes: use `getBundledRgPathSync()` in constructor
7. Export from `index.ts`: `export { createYourSandbox, type YourSandboxConfig } from "./your-sandbox"`

**Gotchas**:
- `exec()` must return `ExecResult` with all 5 fields (use `performance.now()` for timing)
- Timeout handling varies by SDK: AbortController (Vercel), timeoutMs option (E2B), setTimeout+kill (local)
- `rgPath` uses getter/setter pattern for late binding after `ensureSandboxTools()`
- Dynamic imports prevent bundling optional deps: `await import("your-sdk")`
- Lazy singleton prevents race: wrap SDK creation in `createLazySingleton(async () => ...)`

### Adding a Method to Sandbox Interface

**Files to modify**:
1. `/src/sandbox/interface.ts` -- Add method to `Sandbox` interface
2. `/src/sandbox/local.ts` -- Implement for LocalSandbox
3. `/src/sandbox/vercel.ts` -- Implement for VercelSandbox
4. `/src/sandbox/e2b.ts` -- Implement for E2BSandbox

**Critical**: This is a BREAKING CHANGE requiring a major version bump. All 3 implementations must be updated simultaneously. Consider making methods optional (`methodName?()`) to maintain backward compatibility.

### Adding Auto-Installed Tools

**Files to modify**:
1. `/src/sandbox/ensure-tools.ts` -- Add installation logic

**Steps**:
1. Check if tool exists in sandbox: `await sandbox.exec("which yourtool")`
2. If not found, download and install: `await sandbox.exec("curl ... | tar ...")`
3. Set property on sandbox: `sandbox.yourToolPath = "/tmp/yourtool"`
4. Add architecture detection if needed (see `ARCH_MAP` for ripgrep example)

**Gotchas**:
- Use `/tmp` for remote sandboxes (writable, ephemeral)
- Check bundled version first (like `getBundledRgPath()`) before downloading
- Support both x86_64 and aarch64/arm64 architectures
- Verify executable after install: `test -x /path/to/tool`

### Debugging Sandbox Issues

**Common problems**:
1. **SDK not installed**: Catch import errors in factory, throw helpful message
2. **Race condition on parallel calls**: Wrap SDK creation in `createLazySingleton`
3. **Path issues**: Local sandbox normalizes relative paths, remote sandboxes use absolute
4. **Timeout not working**: Check SDK timeout mechanism (signal vs option vs manual kill)
5. **rgPath undefined**: Ensure `ensureSandboxTools()` called after construction (remote) or `getBundledRgPathSync()` in constructor (local)

**Debug techniques**:
- Log `sandbox.id` to verify same instance across calls
- Check `sandbox.rgPath` after creation
- Test timeout: `await sandbox.exec("sleep 10", { timeout: 100 })`
- Verify working directory: `await sandbox.exec("pwd")`

## Testing

**Test files**:
- `/tests/sandbox/local.test.ts` -- 48 test cases for LocalSandbox (skipped in Node.js, requires Bun)
- `/tests/sandbox/vercel.test.ts` -- Integration tests for VercelSandbox (requires API access)
- `/tests/sandbox/e2b.test.ts` -- Integration tests for E2BSandbox (requires API key)

**Coverage**:
- ✅ All `Sandbox` interface methods tested
- ✅ Timeout handling, error cases, path normalization
- ✅ Configuration options (cwd, timeout, reconnection)
- ⚠️ `ensureSandboxTools` tested indirectly via tool tests
- ⚠️ `lazy-singleton.ts` not directly tested (covered by integration tests)

**How to run**:
```bash
# Local sandbox tests (requires Bun runtime)
bun test tests/sandbox/local.test.ts

# Remote sandbox tests (requires API credentials)
VERCEL_TOKEN=xxx bun test tests/sandbox/vercel.test.ts
E2B_API_KEY=xxx bun test tests/sandbox/e2b.test.ts

# All sandbox tests
bun test tests/sandbox/
```

**Testing new implementations**:
1. Copy `local.test.ts` structure
2. Replace factory function and config
3. Test all 7 required methods + `destroy()`
4. Add SDK-specific tests (reconnection, timeouts, etc.)
5. Test ripgrep setup: verify `sandbox.rgPath` is set
