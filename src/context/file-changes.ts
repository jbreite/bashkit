import type { Sandbox } from "../sandbox/interface";
import {
  createRuntimeEvent,
  type FileChangeKind,
  type RuntimeEventSink,
} from "../runtime";
import type { ContextLayer } from "./index";
import { getRuntimeToolCallMeta } from "./runtime-events";

export interface FileChangeEventLayerConfig {
  sandbox: Sandbox;
  eventSink: RuntimeEventSink;
  agentId?: string | null;
  threadId?: string | null;
  turnId?: string | null;
  includeTools?: readonly string[];
  maxDiffBytes?: number;
}

interface FileSnapshot {
  exists: boolean;
  content: string | null;
}

const DEFAULT_TOOLS = new Set(["Write", "Edit", "Patch"]);
const DEFAULT_MAX_DIFF_BYTES = 60_000;

function stringFromUnknown(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function pathsFromPatch(patch: string): string[] {
  const paths = new Set<string>();
  for (const line of patch.split("\n")) {
    for (const marker of [
      "*** Add File: ",
      "*** Delete File: ",
      "*** Update File: ",
      "*** Move to: ",
    ]) {
      if (line.startsWith(marker)) {
        const path = line.slice(marker.length).trim();
        if (path) paths.add(path);
      }
    }
  }
  return [...paths];
}

function pathsFromParams(toolName: string, params: Record<string, unknown>) {
  if (toolName === "Write" || toolName === "Edit") {
    const filePath = stringFromUnknown(params.file_path);
    return filePath ? [filePath] : [];
  }

  if (toolName === "Patch") {
    const patch = stringFromUnknown(params.patch);
    return patch ? pathsFromPatch(patch) : [];
  }

  return [];
}

function pathsFromResult(result: Record<string, unknown>): string[] {
  const paths = new Set<string>();
  const filePath = stringFromUnknown(result.file_path);
  if (filePath) paths.add(filePath);

  if (Array.isArray(result.files)) {
    for (const item of result.files) {
      if (!item || typeof item !== "object") continue;
      const path = stringFromUnknown((item as Record<string, unknown>).path);
      if (path) paths.add(path);
    }
  }

  return [...paths];
}

async function snapshotFile(
  sandbox: Sandbox,
  path: string,
): Promise<FileSnapshot> {
  try {
    const exists = await sandbox.fileExists(path);
    if (!exists) return { exists: false, content: null };
    const content = await sandbox.readFile(path);
    return { exists: true, content };
  } catch {
    return { exists: false, content: null };
  }
}

function classifyChange(
  before: FileSnapshot | undefined,
  after: FileSnapshot,
): FileChangeKind | null {
  const beforeExists = before?.exists ?? false;
  if (!beforeExists && after.exists) return "created";
  if (beforeExists && !after.exists) return "deleted";
  if (beforeExists && after.exists && before?.content !== after.content) {
    return "modified";
  }
  return null;
}

function diffLinePrefix(line: string, prefix: string): string {
  return `${prefix}${line}`;
}

function createUnifiedDiff(
  path: string,
  beforeContent: string | null,
  afterContent: string | null,
  maxBytes: number,
): string | null {
  const beforeLines = beforeContent?.split("\n") ?? [];
  const afterLines = afterContent?.split("\n") ?? [];
  const lines = [
    `--- ${path}`,
    `+++ ${path}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => diffLinePrefix(line, "-")),
    ...afterLines.map((line) => diffLinePrefix(line, "+")),
  ];
  const diff = lines.join("\n");

  if (Buffer.byteLength(diff, "utf-8") <= maxBytes) return diff;
  return `${diff.slice(0, maxBytes)}\n... diff truncated ...`;
}

export function createFileChangeEventLayer(
  config: FileChangeEventLayerConfig,
): ContextLayer {
  const trackedTools = new Set(config.includeTools ?? DEFAULT_TOOLS);
  const maxDiffBytes = config.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES;
  const snapshots = new WeakMap<
    Record<string, unknown>,
    Map<string, FileSnapshot>
  >();

  return {
    beforeExecute: async (toolName, params) => {
      if (!trackedTools.has(toolName)) return undefined;

      const before = new Map<string, FileSnapshot>();
      for (const path of pathsFromParams(toolName, params)) {
        before.set(path, await snapshotFile(config.sandbox, path));
      }
      snapshots.set(params, before);

      return undefined;
    },

    afterExecute: async (toolName, params, result) => {
      if (!trackedTools.has(toolName) || typeof result.error === "string") {
        return result;
      }

      const before = snapshots.get(params) ?? new Map<string, FileSnapshot>();
      const paths = new Set([...before.keys(), ...pathsFromResult(result)]);
      const meta = getRuntimeToolCallMeta(params);

      for (const path of paths) {
        const after = await snapshotFile(config.sandbox, path);
        const change = classifyChange(before.get(path), after);
        if (!change) continue;

        await config.eventSink.emit(
          createRuntimeEvent({
            type: "file.changed",
            path,
            change,
            unified_diff: createUnifiedDiff(
              path,
              before.get(path)?.content ?? null,
              after.content,
              maxDiffBytes,
            ),
            tool_call_id: meta?.tool_call_id ?? null,
            tool_name: toolName,
            agent_id: config.agentId ?? null,
            thread_id: config.threadId ?? null,
            turn_id: config.turnId ?? null,
          }),
        );
      }

      snapshots.delete(params);
      return result;
    },
  };
}
