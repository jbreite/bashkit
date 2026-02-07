# Setup Module

The setup module provides environment initialization for AI agents in sandboxed execution contexts. It creates workspace directory structures and seeds Agent Skills (from the Agent Skills standard) into the sandbox filesystem, returning parsed metadata for prompt injection. This module bridges the gap between fetched skill bundles and runtime agent environments.

## Files

| File | Purpose |
|------|---------|
| `setup-environment.ts` | Core logic for creating directories and seeding skill files into sandbox |
| `types.ts` | Type definitions for environment config and skill content |
| `index.ts` | Barrel exports for public API |

## Key Exports

- `setupAgentEnvironment(sandbox, config)` -- Creates workspace dirs and seeds skills, returns metadata
- `AgentEnvironmentConfig` -- Configuration for workspace directories and skills to seed
- `SetupResult` -- Return type containing parsed skill metadata array
- `SkillContent` -- Union type: `string | SkillBundle` for inline or fetched skills

## Architecture

**Data Flow**:
```
fetchSkill() → SkillBundle
                  ↓
AgentEnvironmentConfig { skills: { name: SkillBundle | string } }
                  ↓
setupAgentEnvironment(sandbox, config)
                  ↓
  1. Create workspace directories (config.workspace)
  2. Create .skills/ directory
  3. For each skill:
     - If SkillBundle: write all files via seedSkillBundle()
     - If string: write just SKILL.md
     - Parse metadata via parseSkillMetadata()
                  ↓
SetupResult { skills: SkillMetadata[] }
                  ↓
skillsToXml(skills) → inject into system prompt
```

**Internal Functions**:
- `isSkillBundle(content)` -- Type guard distinguishing SkillBundle from plain string
- `seedSkillBundle(sandbox, skillDir, bundle)` -- Writes all files from bundle to sandbox
- `createDirectory(sandbox, path)` -- Creates directory with parents via `mkdir -p`

**File Structure Created**:
```
sandbox/
├── .skills/
│   ├── skill-name/
│   │   ├── SKILL.md
│   │   └── [other bundle files]
│   └── another-skill/
│       └── SKILL.md
└── files/  (workspace dirs)
    ├── notes/
    └── outputs/
```

## Design Patterns

- **Factory Pattern** -- `setupAgentEnvironment()` as single initialization function
- **Type Guard** -- `isSkillBundle()` for discriminating union types
- **Progressive File Writing** -- Parent directories created on-demand during file writes
- **Error Recovery** -- Falls back to basic metadata if `parseSkillMetadata()` throws
- **Separation of Concerns** -- Knows about sandbox and skills modules, but not tools or AI SDK

## Integration Points

- **Depends on**:
  - `/src/sandbox/interface.ts` -- Uses `Sandbox` interface methods
  - `/src/skills/types.ts` -- Imports `SkillMetadata` type
  - `/src/skills/fetch.ts` -- Imports `SkillBundle` type
  - `/src/skills/loader.ts` -- Uses `parseSkillMetadata()` function

- **Used by**:
  - `/src/tools/skill.ts` -- Consumes `SkillMetadata` from `SetupResult.skills`
  - External consumers creating agent environments before running AI loops

- **Exported from**:
  - `/src/index.ts` -- Lines 182-187 (types and setupAgentEnvironment function)

## Common Modifications

### Adding Workspace Template Presets
1. Edit `/src/setup/types.ts`
2. Add preset type:
   ```typescript
   export const WORKSPACE_PRESETS = {
     coder: { workspace: { files: 'files/', tests: 'tests/' } },
     researcher: { workspace: { notes: 'notes/', outputs: 'outputs/' } },
   };
   ```
3. Update `AgentEnvironmentConfig` to accept preset names
4. Modify `setupAgentEnvironment()` to expand presets

**Gotcha**: Don't create dirs until preset is expanded

### Adding File Validation
1. Edit `/src/setup/setup-environment.ts`
2. Add validation function before `sandbox.writeFile()`:
   ```typescript
   async function validateFileContent(path: string, content: string): Promise<void> {
     if (path.endsWith('.md') && content.length > 100_000) {
       throw new Error(`Skill file too large: ${path}`);
     }
   }
   ```
3. Call in both `seedSkillBundle()` and main skill loop

**Gotcha**: SkillBundle files already validated by fetchSkill, only validate inline strings

### Supporting Nested Workspace Directories
1. Edit `createDirectory()` in `/src/setup/setup-environment.ts`
2. Already handles nesting via `mkdir -p`
3. To add validation, check path depth before creation:
   ```typescript
   const depth = normalizedPath.split('/').length;
   if (depth > 5) throw new Error('Directory nesting too deep');
   ```

**Gotcha**: `mkdir -p` already handles parents, don't reimplement

### Adding Skill File Templates
1. Edit `/src/setup/types.ts`
2. Add template type:
   ```typescript
   export interface SkillTemplate {
     'SKILL.md': string;
     'README.md'?: string;
   }
   ```
3. Update `AgentEnvironmentConfig.skills` to accept `SkillTemplate`
4. Add type guard and handler in `setupAgentEnvironment()`

**Gotcha**: Must still parse metadata from SKILL.md even for templates

## Testing

**Test Files**: None currently (no `/tests/setup/` directory exists)

**Coverage Gaps**:
- No tests for `setupAgentEnvironment()` end-to-end flow
- No tests for `createDirectory()` edge cases (absolute paths, symlinks, existing files)
- No tests for `seedSkillBundle()` with nested directory structures
- No tests for error recovery when `parseSkillMetadata()` fails
- No tests for both SkillBundle and string skill content paths

**How to Test Manually**:
```typescript
// Create test in tests/setup/setup-environment.test.ts
import { describe, test, expect } from 'bun:test';
import { createLocalSandbox } from '../src/sandbox/local';
import { setupAgentEnvironment } from '../src/setup';

describe('setupAgentEnvironment', () => {
  test('creates workspace directories', async () => {
    const sandbox = createLocalSandbox({ workingDirectory: '/tmp/test' });
    await setupAgentEnvironment(sandbox, {
      workspace: { notes: 'files/notes/', outputs: 'files/outputs/' }
    });

    const exists = await sandbox.isDirectory('files/notes');
    expect(exists).toBe(true);
  });

  test('seeds inline skill content', async () => {
    const sandbox = createLocalSandbox({ workingDirectory: '/tmp/test' });
    const { skills } = await setupAgentEnvironment(sandbox, {
      skills: { 'test-skill': '---\nname: test\ndescription: Test\n---\n# Test' }
    });

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('test');
  });
});
```

**Integration Testing**: Use with `/examples/basic.ts` by adding setup step before agent loop
