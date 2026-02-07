# CLI Module

The CLI module provides an interactive setup wizard for bashkit that guides users through dependency installation and configuration file generation. It detects the user's environment (package manager, existing dependencies) and creates a ready-to-use `bashkit.config.ts` file with appropriate sandbox and tool selections.

## Files

| File | Purpose |
|------|---------|
| `init.ts` | Interactive setup wizard with dependency checking, installation, and config generation |

## Key Exports

- **Executable**: `init()` - Main async function that runs the setup wizard
- **Helper Functions**:
  - `checkInstalled(pkg: string): boolean` - Checks if a package exists in current project
  - `detectPackageManager(): "bun" | "npm" | "yarn" | "pnpm"` - Detects package manager from environment
  - `getInstallCommand(pm: string): string` - Returns install command for detected package manager
  - `createConfigFile(sandbox: string, webTools: boolean): void` - Generates bashkit.config.ts file

## Architecture

Single-file CLI application structured as:

1. **Environment Detection** - Checks installed dependencies and package manager
2. **User Interaction** - Uses @clack/prompts for interactive selection (sandbox type, web tools)
3. **Dependency Installation** - Installs missing peer dependencies via execSync
4. **Config Generation** - Writes bashkit.config.ts with chosen sandbox and tools

**Entry Point**: Registered as `bashkit` bin command in package.json line 15.

**Build Process**: Separate build step (`build:cli`) bundles to `dist/cli/init.js` with shebang preserved and executable permissions set.

## Design Patterns

- **Environment Introspection** - Uses `process.env.npm_config_user_agent` and `require.resolve()` to detect existing setup
- **Interactive CLI** - @clack/prompts for consistent UX (intro, select, confirm, spinner, outro)
- **Graceful Degradation** - Shows status of all dependencies (required vs optional) before prompting
- **Template Generation** - String interpolation creates config file with conditional web tools setup

## Integration Points

- **Depends on**:
  - `@clack/prompts` - User interaction primitives
  - `child_process.execSync` - Dependency installation
  - `fs`, `path` - File system operations
  - No bashkit internal modules (CLI is isolated)

- **Used by**: End users via `npx bashkit` or `bun x bashkit` command

- **Exported from**: package.json `bin` field (line 15), not from src/index.ts

**Build Isolation**: CLI has separate build command (`build:cli`) and external dependency (@clack/prompts). The main bashkit bundle does NOT include CLI code.

## Common Modifications

### Adding a New Sandbox Type

**Files to modify**:
1. `/src/cli/init.ts` - Lines 99-122 (sandbox selection prompt)

**Steps**:
1. Add new option to `select()` options array:
```typescript
{
  value: "NewSandbox",
  label: "NewSandbox",
  hint: hasNewSandbox ? "Already installed ✓" : "Description, requires @new/sandbox"
}
```

2. Add dependency check at line 87:
```typescript
const hasNewSandbox = checkInstalled("@new/sandbox");
```

3. Add to status display (line 94):
```typescript
console.log(`  ${hasNewSandbox ? "✅" : "⚪"} @new/sandbox (optional)`);
```

4. Add to installation logic (line 144):
```typescript
if (sandboxChoice === "NewSandbox" && !hasNewSandbox)
  toInstall.push("@new/sandbox");
```

5. Update `createConfigFile()` template (line 51) if needed for different constructor signature

**Gotcha**: Factory function name must match pattern `create${sandbox}Sandbox` (e.g., "Local" → "createLocalSandbox")

### Modifying Config File Template

**Files to modify**:
1. `/src/cli/init.ts` - Lines 50-78 (`createConfigFile()`)

**Steps**:
1. Modify string template starting at line 51
2. Use conditional interpolation for optional features:
```typescript
sandbox === "Local" ? "{\n  workingDirectory: process.cwd()\n}" : ""
```

**Gotcha**: Template string escaping - ensure quotes and newlines are properly escaped. Test generated file compiles with `tsc`.

### Adding New Optional Dependencies

**Files to modify**:
1. `/src/cli/init.ts` - Lines 84-96 (dependency checks), 141-148 (installation logic)

**Steps**:
1. Add check: `const hasNewPkg = checkInstalled("new-package");`
2. Add status display: `console.log(\`  ${hasNewPkg ? "✅" : "⚪"} new-package (optional)\`);`
3. Add installation condition based on user selections
4. Update config template if package requires configuration

### Changing Package Manager Detection

**Files to modify**:
1. `/src/cli/init.ts` - Lines 22-45 (package manager detection and commands)

**Steps**:
1. Add new package manager to `detectPackageManager()` return type
2. Add detection logic using `process.env.npm_config_user_agent`
3. Add install command to `getInstallCommand()` switch statement

**Gotcha**: Order matters in detection - check specific managers before falling back to npm

## Testing

**Test Files**: None - no tests/cli directory exists

**Manual Testing**:
```bash
# Test full flow
bun run build:cli
node dist/cli/init.js

# Test in fresh directory
mkdir /tmp/test-bashkit && cd /tmp/test-bashkit
npm init -y
npx bashkit
```

**Coverage Gaps**:
- No unit tests for helper functions (checkInstalled, detectPackageManager, getInstallCommand)
- No integration tests for dependency installation
- No validation of generated config file syntax
- Error handling paths untested (installation failures, file write errors)

**Testing Strategy**: CLI is tested manually during release process. Consider adding:
- Unit tests for pure functions (package manager detection, install command generation)
- Integration tests with mocked execSync for installation flow
- Snapshot tests for generated config file templates
