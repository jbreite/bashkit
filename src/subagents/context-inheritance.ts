import type { ModelMessage } from "ai";
import type { SubagentContextPolicy } from "./types";

export interface BuildSubagentMessagesOptions {
  parentMessages?: ModelMessage[];
  policy: SubagentContextPolicy;
  task: string;
}

function recentTurnStartIndex(
  messages: readonly ModelMessage[],
  turns: number,
): number {
  if (turns <= 0) return messages.length;

  const userIndexes = messages
    .map((message, index) => ({ role: message.role, index }))
    .filter((entry) => entry.role === "user")
    .map((entry) => entry.index);

  if (userIndexes.length <= turns) return 0;
  return userIndexes[userIndexes.length - turns];
}

export function inheritSubagentMessages(
  parentMessages: readonly ModelMessage[] | undefined,
  policy: SubagentContextPolicy,
): ModelMessage[] {
  const messages = parentMessages ?? [];

  if (policy.mode === "none") return [];
  if (policy.mode === "all") return messages.map((message) => ({ ...message }));

  const startIndex = recentTurnStartIndex(messages, policy.turns);
  return messages.slice(startIndex).map((message) => ({ ...message }));
}

export function buildSubagentMessages({
  parentMessages,
  policy,
  task,
}: BuildSubagentMessagesOptions): ModelMessage[] {
  return [
    ...inheritSubagentMessages(parentMessages, policy),
    {
      role: "user",
      content: task,
    },
  ];
}
