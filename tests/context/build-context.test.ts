import { describe, it, expect } from "vitest";
import { discoverInstructions } from "@/context/instructions";
import { collectEnvironment, formatEnvironment } from "@/context/environment";
import { buildToolGuidance } from "@/context/tool-guidance";
import { buildSystemContext } from "@/context/build-context";
import { createMockSandbox } from "../helpers";

// ---------------------------------------------------------------------------
// discoverInstructions
// ---------------------------------------------------------------------------

describe("discoverInstructions", () => {
  it("finds AGENTS.md walking from CWD to project root", async () => {
    const sandbox = createMockSandbox({
      files: {
        "/project/.git": ["HEAD"],
        "/project/AGENTS.md": "Project instructions",
        "/project/src": ["index.ts"],
      },
    });
    Object.defineProperty(sandbox, "workingDirectory", {
      value: "/project/src",
    });

    const result = await discoverInstructions(sandbox);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Project instructions");
    expect(result!.sources.length).toBeGreaterThan(0);
  });

  it("finds CLAUDE.md when AGENTS.md not present", async () => {
    const sandbox = createMockSandbox({
      files: {
        "/project/.git": ["HEAD"],
        "/project/CLAUDE.md": "Claude instructions",
      },
    });
    Object.defineProperty(sandbox, "workingDirectory", {
      value: "/project",
    });

    const result = await discoverInstructions(sandbox);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Claude instructions");
  });

  it("merges multiple instruction files (root → CWD, most specific last)", async () => {
    const sandbox = createMockSandbox({
      files: {
        "/project/.git": ["HEAD"],
        "/project/AGENTS.md": "Root instructions",
        "/project/src/AGENTS.md": "Src instructions",
      },
    });
    Object.defineProperty(sandbox, "workingDirectory", {
      value: "/project/src",
    });

    const result = await discoverInstructions(sandbox);
    expect(result).not.toBeNull();
    // Root first, then src
    const rootIdx = result!.text.indexOf("Root instructions");
    const srcIdx = result!.text.indexOf("Src instructions");
    expect(rootIdx).toBeLessThan(srcIdx);
    expect(result!.sources).toHaveLength(2);
  });

  it("prepends global instructions when globalPath configured", async () => {
    const sandbox = createMockSandbox({
      files: {
        "/home/.bashkit/AGENTS.md": "Global instructions",
        "/project/.git": ["HEAD"],
        "/project/AGENTS.md": "Project instructions",
      },
    });
    Object.defineProperty(sandbox, "workingDirectory", {
      value: "/project",
    });

    const result = await discoverInstructions(sandbox, {
      globalPath: "/home/.bashkit/AGENTS.md",
    });
    expect(result).not.toBeNull();
    // Global first
    const globalIdx = result!.text.indexOf("Global instructions");
    const projectIdx = result!.text.indexOf("Project instructions");
    expect(globalIdx).toBeLessThan(projectIdx);
    expect(result!.sources[0].scope).toBe("global");
  });

  it("truncates at maxBytes", async () => {
    const sandbox = createMockSandbox({
      files: {
        "/project/.git": ["HEAD"],
        "/project/AGENTS.md": "x".repeat(1000),
      },
    });
    Object.defineProperty(sandbox, "workingDirectory", {
      value: "/project",
    });

    const result = await discoverInstructions(sandbox, { maxBytes: 100 });
    expect(result).not.toBeNull();
    expect(result!.text.length).toBeLessThanOrEqual(100);
    expect(result!.sources.some((s) => s.truncated)).toBe(true);
  });

  it("returns null when no instruction files found", async () => {
    const sandbox = createMockSandbox({
      files: {
        "/project/.git": ["HEAD"],
        "/project/src": ["index.ts"],
      },
    });
    Object.defineProperty(sandbox, "workingDirectory", {
      value: "/project/src",
    });

    const result = await discoverInstructions(sandbox);
    expect(result).toBeNull();
  });

  it("stops walking at .git root marker", async () => {
    const sandbox = createMockSandbox({
      files: {
        "/project/.git": ["HEAD"],
        "/above/AGENTS.md": "Should not find this",
      },
    });
    Object.defineProperty(sandbox, "workingDirectory", {
      value: "/project",
    });

    const result = await discoverInstructions(sandbox);
    expect(result).toBeNull(); // No files found at or below .git root
  });

  it("first matching filename wins per directory", async () => {
    const sandbox = createMockSandbox({
      files: {
        "/project/.git": ["HEAD"],
        "/project/AGENTS.md": "AGENTS content",
        "/project/CLAUDE.md": "CLAUDE content",
      },
    });
    Object.defineProperty(sandbox, "workingDirectory", {
      value: "/project",
    });

    const result = await discoverInstructions(sandbox);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("AGENTS content");
    expect(result!.text).not.toContain("CLAUDE content");
    expect(result!.sources).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// collectEnvironment
// ---------------------------------------------------------------------------

describe("collectEnvironment", () => {
  it("returns CWD, shell, platform, date", async () => {
    const sandbox = createMockSandbox({
      execHandler: (cmd) => ({
        stdout: cmd.includes("SHELL") ? "/bin/zsh\n" : "",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
        interrupted: false,
      }),
    });
    Object.defineProperty(sandbox, "workingDirectory", {
      value: "/my/project",
    });

    const env = await collectEnvironment(sandbox);
    expect(env.cwd).toBe("/my/project");
    expect(env.shell).toBe("/bin/zsh");
    expect(env.platform).toBeDefined();
    expect(env.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("includes git branch when in a repo", async () => {
    const sandbox = createMockSandbox({
      execHandler: (cmd) => ({
        stdout: cmd.includes("branch") ? "main\n" : "",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
        interrupted: false,
      }),
    });

    const env = await collectEnvironment(sandbox);
    expect(env.gitBranch).toBe("main");
  });

  it("includes git changed file count", async () => {
    const sandbox = createMockSandbox({
      execHandler: (cmd) => ({
        stdout: cmd.includes("status") ? "3\n" : "",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
        interrupted: false,
      }),
    });

    const env = await collectEnvironment(sandbox);
    expect(env.gitStatus).toBe("3");
  });

  it("gracefully handles sandbox.exec failures", async () => {
    const sandbox = createMockSandbox({
      execHandler: () => {
        throw new Error("exec failed");
      },
    });

    const env = await collectEnvironment(sandbox);
    expect(env.shell).toBe("unknown");
    expect(env.gitBranch).toBeUndefined();
    expect(env.gitStatus).toBeUndefined();
    expect(env.timezone).toBeUndefined();
  });

  it("omits git info when git config disabled", async () => {
    const execSpy: string[] = [];
    const sandbox = createMockSandbox({
      execHandler: (cmd) => {
        execSpy.push(cmd);
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          durationMs: 1,
          interrupted: false,
        };
      },
    });

    await collectEnvironment(sandbox, { git: false });
    expect(execSpy.some((c) => c.includes("git"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatEnvironment
// ---------------------------------------------------------------------------

describe("formatEnvironment", () => {
  it("formats as XML with required fields", () => {
    const xml = formatEnvironment({
      cwd: "/project",
      shell: "/bin/zsh",
      platform: "darwin",
      date: "2026-03-29",
    });
    expect(xml).toContain("<environment_context>");
    expect(xml).toContain("<cwd>/project</cwd>");
    expect(xml).toContain("<shell>/bin/zsh</shell>");
    expect(xml).toContain("<platform>darwin</platform>");
    expect(xml).toContain("<date>2026-03-29</date>");
    expect(xml).toContain("</environment_context>");
  });

  it("includes optional fields when present", () => {
    const xml = formatEnvironment({
      cwd: "/project",
      shell: "/bin/zsh",
      platform: "darwin",
      date: "2026-03-29",
      timezone: "PST",
      gitBranch: "feature/ctx",
      gitStatus: "5",
    });
    expect(xml).toContain("<timezone>PST</timezone>");
    expect(xml).toContain("<git_branch>feature/ctx</git_branch>");
    expect(xml).toContain("<git_changed_files>5</git_changed_files>");
  });

  it("includes custom fields", () => {
    const xml = formatEnvironment(
      {
        cwd: "/project",
        shell: "/bin/zsh",
        platform: "darwin",
        date: "2026-03-29",
      },
      { app_version: "1.2.3", user: "josh" },
    );
    expect(xml).toContain("<app_version>1.2.3</app_version>");
    expect(xml).toContain("<user>josh</user>");
  });

  it("omits optional fields when undefined", () => {
    const xml = formatEnvironment({
      cwd: "/project",
      shell: "/bin/zsh",
      platform: "darwin",
      date: "2026-03-29",
    });
    expect(xml).not.toContain("timezone");
    expect(xml).not.toContain("git_branch");
    expect(xml).not.toContain("git_changed_files");
  });
});

// ---------------------------------------------------------------------------
// buildToolGuidance
// ---------------------------------------------------------------------------

describe("buildToolGuidance", () => {
  it("only includes hints for registered tool names", () => {
    const text = buildToolGuidance({ tools: ["Bash", "Read"] });
    expect(text).toContain("**Bash**");
    expect(text).toContain("**Read**");
    expect(text).not.toContain("**Write**");
    expect(text).not.toContain("**Grep**");
  });

  it("merges custom hints with defaults", () => {
    const text = buildToolGuidance({
      tools: ["Bash", "Research"],
      hints: { Research: "Query study data across the org." },
    });
    expect(text).toContain("**Bash**"); // default hint
    expect(text).toContain("**Research**: Query study data across the org.");
  });

  it("custom hints override defaults", () => {
    const text = buildToolGuidance({
      tools: ["Bash"],
      hints: { Bash: "Custom bash hint" },
    });
    expect(text).toContain("Custom bash hint");
    expect(text).not.toContain("Prefer Read/Grep/Glob");
  });

  it("includes custom guidelines", () => {
    const text = buildToolGuidance({
      tools: ["Bash"],
      guidelines: [
        "Prefer Grep over Bash for file search",
        "Always use timeout",
      ],
    });
    expect(text).toContain("## Guidelines");
    expect(text).toContain("Prefer Grep over Bash");
    expect(text).toContain("Always use timeout");
  });

  it("skips tools with no hint", () => {
    const text = buildToolGuidance({
      tools: ["Bash", "UnknownTool"],
    });
    expect(text).toContain("**Bash**");
    expect(text).not.toContain("UnknownTool");
  });
});

// ---------------------------------------------------------------------------
// buildSystemContext
// ---------------------------------------------------------------------------

describe("buildSystemContext", () => {
  it("returns individual sections and combined string", async () => {
    const sandbox = createMockSandbox({
      files: {
        "/project/.git": ["HEAD"],
        "/project/AGENTS.md": "Instructions here",
      },
    });
    Object.defineProperty(sandbox, "workingDirectory", {
      value: "/project",
    });

    const ctx = await buildSystemContext(sandbox, {
      instructions: true,
      environment: true,
      toolGuidance: { tools: ["Bash", "Read"] },
    });

    expect(ctx.instructions).toContain("Instructions here");
    expect(ctx.environment).toContain("<environment_context>");
    expect(ctx.toolGuidance).toContain("**Bash**");
    expect(ctx.combined).toContain("Instructions here");
    expect(ctx.combined).toContain("<environment_context>");
    expect(ctx.combined).toContain("**Bash**");
  });

  it("omits null sections from combined string", async () => {
    const sandbox = createMockSandbox();

    const ctx = await buildSystemContext(sandbox, {
      // No instructions, no environment, only tool guidance
      toolGuidance: { tools: ["Bash"] },
    });

    expect(ctx.instructions).toBeNull();
    expect(ctx.environment).toBeNull();
    expect(ctx.toolGuidance).toContain("**Bash**");
    expect(ctx.combined).toBe(ctx.toolGuidance);
  });

  it("includes metadata about sources", async () => {
    const sandbox = createMockSandbox({
      files: {
        "/project/.git": ["HEAD"],
        "/project/AGENTS.md": "test",
      },
    });
    Object.defineProperty(sandbox, "workingDirectory", {
      value: "/project",
    });

    const ctx = await buildSystemContext(sandbox, {
      instructions: true,
      environment: true,
    });

    expect(ctx.meta.instructionSources).toBeDefined();
    expect(ctx.meta.instructionSources!.length).toBeGreaterThan(0);
    expect(ctx.meta.environmentContext).toBeDefined();
    expect(ctx.meta.environmentContext!.cwd).toBe("/project");
  });

  it("returns empty combined when no sections configured", async () => {
    const sandbox = createMockSandbox();
    const ctx = await buildSystemContext(sandbox);
    expect(ctx.combined).toBe("");
  });
});
