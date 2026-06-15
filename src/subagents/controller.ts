import { checkSubagentCostPolicy } from "./cost-control";
import { clampSubagentWaitTimeout } from "./execution-limits";
import { subagentEventToRuntimeEvent } from "./events";
import { createMailboxMessage } from "./mailbox";
import { createSubagentProfileRegistry } from "./profiles";
import { createSubagentRegistry } from "./registry";
import { isActiveSubagentStatus, isTerminalSubagentStatus } from "./status";
import { createInMemorySubagentStore } from "./store";
import { filterSubagentTools } from "./tool-filter";
import type {
  ResolvedSubagentProfile,
  SubagentController,
  SubagentControllerConfig,
  SubagentError,
  SubagentEvent,
  SubagentFollowupRequest,
  SubagentHandle,
  SubagentInterruptRequest,
  SubagentInterruptResult,
  SubagentListFilter,
  SubagentMailboxMessage,
  SubagentMessageRequest,
  SubagentMessageResult,
  SubagentMetadata,
  SubagentRunResult,
  SubagentSpawnRequest,
  SubagentSpawnResult,
  SubagentStatus,
  SubagentUsage,
  SubagentWaitRequest,
  SubagentWaitResult,
} from "./types";

function hasError<T>(value: T | SubagentError): value is SubagentError {
  return typeof value === "object" && value !== null && "error" in value;
}

function eventFromMetadata(
  metadata: SubagentMetadata,
  type: SubagentEvent["type"],
  payload?: SubagentEvent["payload"],
): SubagentEvent {
  return {
    type,
    agent_id: metadata.agent_id,
    task_name: metadata.task_name,
    parent_id: metadata.parent_id,
    profile: metadata.profile,
    status: metadata.status,
    timestamp: new Date().toISOString(),
    payload,
  };
}

function usagePayload(usage: SubagentUsage): SubagentEvent["payload"] {
  return {
    totalCostUsd: usage.totalCostUsd ?? null,
    stepsCompleted: usage.stepsCompleted ?? null,
    unpricedSteps: usage.unpricedSteps ?? null,
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
  };
}

export function createSubagentController(
  config: SubagentControllerConfig,
): SubagentController {
  const registry = createSubagentRegistry();
  const profiles = createSubagentProfileRegistry({
    profiles: config.profiles,
    defaults: config.profileDefaults,
    defaultProfile: config.defaultProfile,
  });
  const store = config.store ?? createInMemorySubagentStore();
  const runner = config.runner;
  const tools = config.tools ?? {};
  const eventSink = config.eventSink;
  const runtimeEventSink = config.runtimeEventSink;
  const lifecycle = config.lifecycle;
  const budget = config.budget;

  async function emit(event: SubagentEvent): Promise<void> {
    await store.appendEvent(event);
    await eventSink?.emit(event);
    const runtimeEvent = subagentEventToRuntimeEvent(event);
    if (runtimeEvent) await runtimeEventSink?.emit(runtimeEvent);
  }

  async function setStatus(
    handle: SubagentHandle,
    status: SubagentStatus,
    payload?: SubagentEvent["payload"],
  ): Promise<void> {
    const metadata = registry.updateStatus(handle, status);
    if (hasError(metadata)) return;
    await store.update(handle, { status });
    await emit(eventFromMetadata(metadata, "subagent.status_changed", payload));
  }

  async function complete(
    handle: SubagentHandle,
    result: SubagentRunResult,
  ): Promise<void> {
    registry.release(handle);
    const metadata = await store.complete(handle, result);
    if (hasError(metadata)) return;

    if (result.status === "completed") {
      await lifecycle?.onComplete?.(result);
      await emit(eventFromMetadata(metadata, "subagent.completed"));
    } else if (result.status === "failed") {
      await lifecycle?.onFail?.(result);
      await emit(
        eventFromMetadata(metadata, "subagent.failed", {
          error: result.error ?? null,
        }),
      );
    } else {
      await emit(eventFromMetadata(metadata, "subagent.interrupted"));
    }
    await lifecycle?.onStop?.(result);
  }

  function resolveHandle(agentRef: string): SubagentHandle | SubagentError {
    const metadata = registry.get(agentRef);
    if (!metadata) return { error: `Unknown subagent: ${agentRef}` };
    return {
      agent_id: metadata.agent_id,
      task_name: metadata.task_name,
    };
  }

  async function runSubagent(
    handle: SubagentHandle,
    request: SubagentSpawnRequest,
    profile: ResolvedSubagentProfile,
    depth: number,
  ): Promise<void> {
    await setStatus(handle, "running");
    const childTools = filterSubagentTools(tools, {
      allowedTools: profile.allowedTools,
      deniedTools: profile.deniedTools,
    });

    try {
      const result = await runner.run({
        handle,
        task: request.task,
        profile,
        parent_id: request.parent_id ?? null,
        depth,
        tools: childTools,
        messages: request.messages,
        metadata: request.metadata,
        callbacks: {
          onStatus: async (status) => {
            await setStatus(handle, status);
          },
          onEvent: async (event) => {
            await emit({ ...event, timestamp: new Date().toISOString() });
          },
          onUsage: async (usage) => {
            await store.update(handle, { usage });
            const metadata = registry.get(handle);
            if (metadata) {
              await emit(
                eventFromMetadata(
                  metadata,
                  "subagent.usage",
                  usagePayload(usage),
                ),
              );
            }
          },
        },
      });
      await complete(handle, result);
    } catch (error) {
      await complete(handle, {
        agent_id: handle.agent_id,
        task_name: handle.task_name,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function enqueueMessage(
    agentRef: string,
    message: string,
    kind: SubagentMailboxMessage["kind"],
    triggerTurn: boolean,
    metadata: SubagentMailboxMessage["metadata"],
  ): Promise<SubagentMessageResult | SubagentError> {
    if (!message.trim()) return { error: "Subagent message cannot be empty" };
    const handle = resolveHandle(agentRef);
    if (hasError(handle)) return handle;
    const record = await store.get(handle);
    if (!record) return { error: `Unknown subagent: ${agentRef}` };
    const profile = profiles.resolve(record.metadata.profile);
    if (hasError(profile)) return profile;

    const policyError = checkSubagentCostPolicy(profile.cost, {
      activeAgents: registry
        .list()
        .filter((agent) => isActiveSubagentStatus(agent.status)).length,
      totalAgents: registry.list().length,
      depth: record.metadata.depth,
      mailboxMessages: record.mailbox.length,
      budgetStatus: budget?.getStatus(),
    });
    if (policyError) return policyError;

    const mailboxMessage = createMailboxMessage({
      agentId: handle.agent_id,
      message,
      kind,
      triggerTurn,
      metadata,
    });
    await store.appendMessage(mailboxMessage);
    await store.update(handle, { last_task_message: message });
    await lifecycle?.onMessage?.(mailboxMessage);
    await emit(
      eventFromMetadata(record.metadata, "subagent.message_queued", {
        message_id: mailboxMessage.id,
        kind,
        message,
      }),
    );
    return {
      queued: true,
      agent_id: handle.agent_id,
      message_id: mailboxMessage.id,
      triggered_turn: triggerTurn && runner.capabilities.followup,
    };
  }

  return {
    async spawn(
      request: SubagentSpawnRequest,
    ): Promise<SubagentSpawnResult | SubagentError> {
      if (!request.task.trim())
        return { error: "Subagent task cannot be empty" };

      const beforeSpawn = await lifecycle?.onBeforeSpawn?.(request);
      if (beforeSpawn && "error" in beforeSpawn) return beforeSpawn;

      const profile = profiles.resolve(request.profile, {
        allowedTools: request.tools ?? undefined,
        context: request.context,
      });
      if (hasError(profile)) return profile;

      const parent = request.parent_id ? registry.get(request.parent_id) : null;
      const depth = parent ? parent.depth + 1 : 0;
      const activeAgents = registry
        .list()
        .filter((agent) => isActiveSubagentStatus(agent.status)).length;
      const policyError = checkSubagentCostPolicy(profile.cost, {
        activeAgents,
        totalAgents: registry.list().length,
        depth,
        mailboxMessages: 0,
        budgetStatus: budget?.getStatus(),
      });
      if (policyError) return policyError;

      const metadata = registry.reserve({
        taskName: request.task_name,
        profile: profile.name,
        nickname: profile.nickname,
        parentId: request.parent_id ?? null,
        depth,
        lastTaskMessage: request.task,
      });
      if (hasError(metadata)) return metadata;

      const handle: SubagentHandle = {
        agent_id: metadata.agent_id,
        task_name: metadata.task_name,
      };

      await store.create(metadata);
      await emit(eventFromMetadata(metadata, "subagent.created"));
      await lifecycle?.onStart?.(metadata);

      void runSubagent(handle, request, profile, depth);

      return {
        ...handle,
        status: metadata.status,
        profile: metadata.profile,
        nickname: metadata.nickname,
      };
    },

    async list(filter?: SubagentListFilter): Promise<SubagentMetadata[]> {
      const records = await store.list(filter);
      return records.map((record) => record.metadata);
    },

    async wait(
      request: SubagentWaitRequest,
    ): Promise<SubagentWaitResult | SubagentError> {
      const handle = resolveHandle(request.agent);
      if (hasError(handle)) return handle;
      const record = await store.get(handle);
      if (!record) return { error: `Unknown subagent: ${request.agent}` };

      const profile = profiles.resolve(record.metadata.profile);
      if (hasError(profile)) return profile;
      const timeoutMs = clampSubagentWaitTimeout(
        request.timeoutMs,
        profile.cost,
      );
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        const latest = await store.get(handle);
        if (!latest) return { error: `Unknown subagent: ${request.agent}` };
        if (
          isTerminalSubagentStatus(latest.metadata.status) ||
          (request.untilStatus &&
            latest.metadata.status === request.untilStatus)
        ) {
          return {
            status: "ready",
            agent: latest.metadata,
            result: latest.result,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const latest = await store.get(handle);
      if (!latest) return { error: `Unknown subagent: ${request.agent}` };
      return { status: "timeout", agent: latest.metadata };
    },

    async sendMessage(
      request: SubagentMessageRequest,
    ): Promise<SubagentMessageResult | SubagentError> {
      return enqueueMessage(
        request.agent,
        request.message,
        "message",
        false,
        request.metadata,
      );
    },

    async followupTask(
      request: SubagentFollowupRequest,
    ): Promise<SubagentMessageResult | SubagentError> {
      const result = await enqueueMessage(
        request.agent,
        request.task,
        "followup",
        true,
        request.metadata,
      );
      if (hasError(result)) return result;
      if (!runner.capabilities.followup || !runner.requestTurn) return result;

      const handle = resolveHandle(request.agent);
      if (hasError(handle)) return handle;
      const turnResult = await runner.requestTurn(handle);
      if (hasError(turnResult)) return turnResult;
      return { ...result, triggered_turn: turnResult.triggered_turn };
    },

    async interrupt(
      request: SubagentInterruptRequest,
    ): Promise<SubagentInterruptResult | SubagentError> {
      const handle = resolveHandle(request.agent);
      if (hasError(handle)) return handle;
      const record = await store.get(handle);
      if (!record) return { error: `Unknown subagent: ${request.agent}` };
      const previous = record.metadata.status;

      if (!runner.capabilities.interrupt || !runner.interrupt) {
        return { error: "Subagent runner does not support interrupt" };
      }

      const runnerResult = await runner.interrupt(handle);
      if (hasError(runnerResult)) return runnerResult;
      await setStatus(handle, "interrupted", {
        reason: request.reason ?? null,
      });
      const result = {
        agent_id: handle.agent_id,
        previous_status: previous,
        status: "interrupted" as const,
      };
      await lifecycle?.onInterrupt?.(result);
      return result;
    },
  };
}
