import { tool, zodSchema } from "ai";
import { z } from "zod";

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
      }),
    )
    .describe("The updated todo list"),
});

type TodoWriteInput = z.infer<typeof todoWriteInputSchema>;

export interface TodoState {
  todos: TodoItem[];
}

const TODO_WRITE_DESCRIPTION = `Use this tool to create and manage a structured task list for tracking progress. This helps organize complex tasks and gives the user visibility into your work.

**When to use this tool proactively:**
1. Complex multi-step tasks - When a task requires 3 or more distinct steps
2. Non-trivial tasks - Tasks requiring careful planning or multiple operations
3. User explicitly requests a todo list
4. User provides multiple tasks - Numbered lists or comma-separated items
5. After receiving new instructions - Immediately capture requirements as todos
6. When starting work - Mark task as in_progress BEFORE beginning
7. After completing - Mark as completed and add any follow-up tasks discovered

**When NOT to use:**
1. Single, straightforward tasks
2. Trivial tasks with no organizational benefit
3. Tasks completable in less than 3 trivial steps
4. Purely conversational or informational requests

**Task states:**
- pending: Not yet started
- in_progress: Currently working on (limit to ONE at a time)
- completed: Finished successfully

**Task format (both required):**
- content: Imperative form ("Run tests", "Analyze data")
- activeForm: Present continuous form ("Running tests", "Analyzing data")

**Task management rules:**
- Update status in real-time as you work
- Mark complete IMMEDIATELY after finishing (don't batch)
- Keep exactly ONE task in_progress at any time
- ONLY mark completed when FULLY accomplished
- If blocked/errors, keep in_progress and create new task for the blocker`;

export function createTodoWriteTool(
  state: TodoState,
  onUpdate?: (todos: TodoItem[]) => void,
) {
  return tool({
    description: TODO_WRITE_DESCRIPTION,
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
