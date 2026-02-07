# Skills Module

The skills module implements the Agent Skills standard for BashKit, enabling discovery, loading, and activation of modular agent capabilities. It provides both local filesystem discovery (`.skills/` directories) and remote fetching (GitHub repositories), with progressive disclosure that loads only metadata at startup and full instructions on-demand. The module integrates with the Skill tool to expose skills to AI agents via XML system prompts.

## Files

| File | Purpose |
|------|---------|
| `types.ts` | Core type definitions for SkillMetadata and discovery options |
| `loader.ts` | YAML frontmatter parsing and local skill bundle loading |
| `discovery.ts` | Filesystem scanning for skills in project and global directories |
| `fetch.ts` | GitHub API integration for fetching remote skill bundles |
| `xml.ts` | XML generation for system prompt injection |
| `index.ts` | Barrel exports for public API |

## Key Exports

- `discoverSkills(options?)` -- Scans `.skills/` and `~/.bashkit/skills/` for local skills, returns metadata only
- `fetchSkill(ref: string)` -- Fetches complete skill bundle from GitHub (format: `owner/repo/skillName`)
- `fetchSkills(refs: string[])` -- Parallel fetch of multiple GitHub skills
- `loadSkillBundle(skillDir: string)` -- Recursively loads all files from a local skill directory
- `loadSkillBundles(skills: SkillMetadata[])` -- Batch loads discovered skills as bundles
- `parseSkillMetadata(content: string, path: string)` -- Extracts and validates YAML frontmatter from SKILL.md
- `skillsToXml(skills: SkillMetadata[])` -- Generates `<available_skills>` XML for system prompts
- `SkillMetadata` -- Lightweight metadata type (name, description, path, allowedTools, etc.)
- `SkillBundle` -- Complete skill with all files (`{ name, files: Record<string, string> }`)

## Architecture

### Data Flow

1. **Discovery Phase** (startup)
   - `discoverSkills()` → `scanDirectory()` → `parseSkillMetadata()`
   - Result: Array of `SkillMetadata` (no full instructions yet)

2. **System Prompt Generation**
   - `skillsToXml(metadata[])` → XML string injected into system prompt
   - Agent sees skill names, descriptions, and file paths

3. **Activation Phase** (runtime)
   - Agent calls Skill tool → `createSkillTool()` in `tools/skill.ts`
   - Tool uses `sandbox.readFile(metadata.path)` to load full SKILL.md
   - Returns instructions to agent for execution

### Internal Dependencies

```
types.ts (base types)
  ↓
loader.ts (YAML parsing + file loading)
  ↓
discovery.ts (local filesystem scan, uses loader)
  ↓
fetch.ts (GitHub API, produces SkillBundle)
  ↓
xml.ts (system prompt generation)
  ↓
index.ts (barrel exports)
```

### Key Abstractions

**SkillMetadata** - Minimal data structure loaded at startup:
- `name` (matches folder name, validates regex)
- `description` (1-1024 chars, tells agent when to use)
- `path` (absolute path to SKILL.md for Read tool)
- `allowedTools` (optional whitelist for tool restriction)
- `license`, `compatibility`, `metadata` (optional fields)

**SkillBundle** - Complete skill package:
- `name` (skill identifier)
- `files` (Record mapping relative paths to contents)
- Used by `setupAgentEnvironment()` to seed sandbox filesystem

**Progressive Disclosure** - Core design pattern:
- Discovery loads only frontmatter (cheap, fast startup)
- Agent reads full SKILL.md via Read tool when activating (pay-per-use)
- Reduces initial prompt size and API costs

## Design Patterns

- **Progressive Disclosure** -- Metadata parsed at startup, full instructions loaded on-demand via Read tool to minimize prompt size
- **Deduplication** -- Discovery processes paths in order; first occurrence of a skill name wins (project `.skills/` overrides global `~/.bashkit/skills/`)
- **Path Resolution** -- `resolvePath()` expands `~` to home directory and handles absolute/relative paths consistently
- **Validation at Parse Time** -- `parseSkillMetadata()` enforces name format (1-64 chars, lowercase + hyphens, no consecutive hyphens) and required fields
- **Simple YAML Parser** -- Custom parser in `loader.ts` avoids external dependencies, handles frontmatter + nested objects (metadata field)
- **Recursive File Loading** -- `loadSkillBundle()` preserves directory structure when loading local skills
- **Parallel Fetching** -- `fetchSkills()` uses `Promise.all()` for concurrent GitHub API requests
- **Error Tolerance** -- Discovery ignores missing directories and unparseable skills (returns empty array), never throws

## Integration Points

### Depends on
- **Node.js APIs**: `node:fs/promises` (readdir, readFile, stat), `node:path` (join, resolve, basename, dirname), `node:os` (homedir)
- **Sandbox interface**: Used by `tools/skill.ts` to read SKILL.md at activation time

### Used by
- **`src/types.ts`** -- Imports `SkillMetadata` for type definitions
- **`src/tools/skill.ts`** -- Creates Skill tool using metadata, reads full content via sandbox
- **`src/setup/setup-environment.ts`** -- Seeds skills into sandbox filesystem, parses metadata
- **`src/index.ts`** -- Barrel exports all public types and functions

### Exported from
```typescript
// In src/index.ts
export type { SkillMetadata, SkillBundle, DiscoverSkillsOptions } from './skills';
export {
  discoverSkills,
  fetchSkill,
  fetchSkills,
  loadSkillBundle,
  loadSkillBundles,
  parseSkillMetadata,
  skillsToXml,
} from './skills';
```

### External Integration Pattern
```typescript
// Typical usage flow
const metadata = await discoverSkills(); // Filesystem scan
const xml = skillsToXml(metadata);       // System prompt injection
const tools = createAgentTools(sandbox, {
  skills: { skills: Object.fromEntries(metadata.map(s => [s.name, s])) }
});
// Agent sees skills in prompt, calls Skill tool to activate
```

## Common Modifications

### Adding a New Skill Source (e.g., npm packages)
1. Create `src/skills/npm.ts` with `fetchNpmSkill(packageName: string): Promise<SkillBundle>`
2. Follow the `fetch.ts` pattern: return `{ name, files: Record<string, string> }`
3. Export from `src/skills/index.ts`
4. Update `src/setup/setup-environment.ts` to accept npm package references if needed

**Gotchas**:
- SKILL.md must exist in `files` object (validated by consumers)
- Preserve relative paths in `files` keys (used by sandbox seeding)
- Handle fetch errors gracefully (discovery never throws)

### Changing YAML Parser
1. Replace `parseYaml()` in `loader.ts` with library (e.g., `yaml` package)
2. Update dependency in package.json (currently zero-dependency)
3. Ensure frontmatter extraction logic (`extractFrontmatter()`) remains unchanged
4. Validate nested object parsing (metadata field requires `Record<string, string>`)

**Gotchas**:
- Library must handle simple key-value + nested objects (no arrays, complex nesting needed)
- Preserve error messages for missing required fields
- Maintain validation of name format regex

### Adding Skill Metadata Fields
1. Add field to `SkillMetadata` interface in `types.ts`
2. Update `parseSkillMetadata()` in `loader.ts` to extract new field from frontmatter
3. Update `skillsToXml()` in `xml.ts` if field should appear in system prompt
4. Update validation logic if field is required

**Gotchas**:
- Optional fields must use `?:` in TypeScript interface
- Add to XML only if agents need it for activation decisions (keep prompt concise)
- Preserve backward compatibility (old skills without new field should still work)

### Custom Discovery Paths
Modify `DEFAULT_SKILL_PATHS` in `discovery.ts`:
```typescript
const DEFAULT_SKILL_PATHS = [
  '.skills',
  '~/.bashkit/skills',
  '~/.config/bashkit/skills', // Add custom path
];
```

**Gotchas**:
- Earlier paths win during deduplication (order matters)
- All paths support `~` expansion and relative resolution
- Non-existent directories are silently skipped

### GitHub API Rate Limiting
Add token support in `fetch.ts`:
```typescript
const response = await fetch(apiUrl, {
  headers: {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'bashkit',
    Authorization: process.env.GITHUB_TOKEN ? `token ${process.env.GITHUB_TOKEN}` : undefined,
  },
});
```

**Gotchas**:
- Unauthenticated rate limit: 60 requests/hour per IP
- Authenticated: 5000 requests/hour (requires personal access token)
- `fetchSkills()` uses parallel fetching (may hit rate limits quickly)

## Testing

**Test Files**: None (no `tests/skills/` directory exists)

**Coverage Gaps**:
- No unit tests for YAML parser edge cases (multiline values, special chars)
- No tests for GitHub API error handling (404, rate limits, malformed refs)
- No validation tests for skill name format regex
- No tests for deduplication logic in discovery

**How to Test**:
1. Manual testing via examples (create `.skills/test-skill/SKILL.md`)
2. Integration test discovery: `const skills = await discoverSkills({ cwd: '/path/to/test' })`
3. Integration test GitHub fetch: `const bundle = await fetchSkill('anthropics/skills/pdf')`
4. Validate XML output: `const xml = skillsToXml(skills); console.log(xml)`

**Test Recommendations**:
- Add unit tests for `parseYaml()` with various frontmatter formats
- Test `parseSkillMetadata()` validation (missing fields, invalid name format)
- Mock `fetch` to test GitHub error scenarios
- Test deduplication (two skills with same name in different paths)
- Test `loadSkillBundle()` with nested directory structures
