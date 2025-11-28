import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { ToolConfig } from "../types";

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

export interface TodoWriteOutput {
  message: string;
  stats: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
  };
}

export interface TodoWriteError {
  error: string;
}

const todoWriteInputSchema = z.object({
  todos: z
    .array(
      z.object({
        content: z.string().describe("The task description"),
        status: z
          .enum(["pending", "in_progress", "completed"])
          .describe("The task status"),
        activeForm: z.string().describe("Active form of the task description"),
      })
    )
    .describe("The updated todo list"),
});

type TodoWriteInput = z.infer<typeof todoWriteInputSchema>;

export interface TodoState {
  todos: TodoItem[];
}

export function createTodoWriteTool(
  state: TodoState,
  config?: ToolConfig,
  onUpdate?: (todos: TodoItem[]) => void
) {
  return tool({
    description:
      "Creates and manages a structured task list for tracking progress. Use this to plan complex tasks and track completion.",
    inputSchema: zodSchema(todoWriteInputSchema),
    execute: async ({
      todos,
    }: TodoWriteInput): Promise<TodoWriteOutput | TodoWriteError> => {
      try {
        // Update the state
        state.todos = todos;

        // Call the update callback if provided
        if (onUpdate) {
          onUpdate(todos);
        }

        // Calculate stats
        const stats = {
          total: todos.length,
          pending: todos.filter((t) => t.status === "pending").length,
          in_progress: todos.filter((t) => t.status === "in_progress").length,
          completed: todos.filter((t) => t.status === "completed").length,
        };

        return {
          message: "Todo list updated successfully",
          stats,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  });
}
