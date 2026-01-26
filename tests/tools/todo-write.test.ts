import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createTodoWriteTool,
  type TodoState,
  type TodoItem,
  type TodoWriteOutput,
} from "@/tools/todo-write";
import { executeTool, assertSuccess } from "@test/helpers";

describe("TodoWrite Tool", () => {
  let state: TodoState;

  beforeEach(() => {
    state = { todos: [] };
  });

  describe("basic todo management", () => {
    it("should create a new todo list", async () => {
      const tool = createTodoWriteTool(state);
      const result = await executeTool(tool, {
        todos: [
          {
            content: "Task 1",
            status: "pending",
            activeForm: "Starting task 1",
          },
          {
            content: "Task 2",
            status: "pending",
            activeForm: "Starting task 2",
          },
        ],
      });

      assertSuccess<TodoWriteOutput>(result);
      expect(result.message).toContain("updated successfully");
      expect(result.stats.total).toBe(2);
      expect(result.stats.pending).toBe(2);
      expect(result.stats.in_progress).toBe(0);
      expect(result.stats.completed).toBe(0);
    });

    it("should update state with new todos", async () => {
      const tool = createTodoWriteTool(state);
      await executeTool(tool, {
        todos: [
          {
            content: "My task",
            status: "in_progress",
            activeForm: "Working on task",
          },
        ],
      });

      expect(state.todos).toHaveLength(1);
      expect(state.todos[0].content).toBe("My task");
      expect(state.todos[0].status).toBe("in_progress");
    });

    it("should replace all todos on update", async () => {
      state.todos = [
        { content: "Old task", status: "pending", activeForm: "Old" },
      ];

      const tool = createTodoWriteTool(state);
      await executeTool(tool, {
        todos: [{ content: "New task", status: "pending", activeForm: "New" }],
      });

      expect(state.todos).toHaveLength(1);
      expect(state.todos[0].content).toBe("New task");
    });

    it("should handle empty todo list", async () => {
      const tool = createTodoWriteTool(state);
      const result = await executeTool(tool, {
        todos: [],
      });

      assertSuccess<TodoWriteOutput>(result);
      expect(result.stats.total).toBe(0);
      expect(state.todos).toHaveLength(0);
    });
  });

  describe("status tracking", () => {
    it("should track pending tasks", async () => {
      const tool = createTodoWriteTool(state);
      const result = await executeTool(tool, {
        todos: [
          { content: "Task 1", status: "pending", activeForm: "Task 1" },
          { content: "Task 2", status: "pending", activeForm: "Task 2" },
          { content: "Task 3", status: "in_progress", activeForm: "Task 3" },
        ],
      });

      assertSuccess<TodoWriteOutput>(result);
      expect(result.stats.pending).toBe(2);
    });

    it("should track in_progress tasks", async () => {
      const tool = createTodoWriteTool(state);
      const result = await executeTool(tool, {
        todos: [
          { content: "Task 1", status: "in_progress", activeForm: "Task 1" },
          { content: "Task 2", status: "pending", activeForm: "Task 2" },
        ],
      });

      assertSuccess<TodoWriteOutput>(result);
      expect(result.stats.in_progress).toBe(1);
    });

    it("should track completed tasks", async () => {
      const tool = createTodoWriteTool(state);
      const result = await executeTool(tool, {
        todos: [
          { content: "Task 1", status: "completed", activeForm: "Task 1" },
          { content: "Task 2", status: "completed", activeForm: "Task 2" },
          { content: "Task 3", status: "pending", activeForm: "Task 3" },
        ],
      });

      assertSuccess<TodoWriteOutput>(result);
      expect(result.stats.completed).toBe(2);
    });

    it("should track mixed statuses", async () => {
      const tool = createTodoWriteTool(state);
      const result = await executeTool(tool, {
        todos: [
          { content: "Task 1", status: "pending", activeForm: "Task 1" },
          { content: "Task 2", status: "in_progress", activeForm: "Task 2" },
          { content: "Task 3", status: "completed", activeForm: "Task 3" },
          { content: "Task 4", status: "completed", activeForm: "Task 4" },
        ],
      });

      assertSuccess<TodoWriteOutput>(result);
      expect(result.stats.total).toBe(4);
      expect(result.stats.pending).toBe(1);
      expect(result.stats.in_progress).toBe(1);
      expect(result.stats.completed).toBe(2);
    });
  });

  describe("onUpdate callback", () => {
    it("should call onUpdate with new todos", async () => {
      const onUpdate = vi.fn();
      const tool = createTodoWriteTool(state, onUpdate);

      const todos: TodoItem[] = [
        { content: "Task 1", status: "pending", activeForm: "Task 1" },
      ];

      await executeTool(tool, { todos });

      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenCalledWith(todos);
    });

    it("should call onUpdate on every update", async () => {
      const onUpdate = vi.fn();
      const tool = createTodoWriteTool(state, onUpdate);

      await executeTool(tool, {
        todos: [{ content: "Task 1", status: "pending", activeForm: "Task 1" }],
      });
      await executeTool(tool, {
        todos: [
          { content: "Task 1", status: "in_progress", activeForm: "Task 1" },
        ],
      });

      expect(onUpdate).toHaveBeenCalledTimes(2);
    });

    it("should work without onUpdate callback", async () => {
      const tool = createTodoWriteTool(state);

      const result = await executeTool(tool, {
        todos: [{ content: "Task 1", status: "pending", activeForm: "Task 1" }],
      });

      assertSuccess<TodoWriteOutput>(result);
    });
  });

  describe("state persistence", () => {
    it("should persist state across multiple calls", async () => {
      const tool = createTodoWriteTool(state);

      // First call
      await executeTool(tool, {
        todos: [
          { content: "Task 1", status: "pending", activeForm: "Task 1" },
          { content: "Task 2", status: "pending", activeForm: "Task 2" },
        ],
      });

      expect(state.todos).toHaveLength(2);

      // Second call - update status
      await executeTool(tool, {
        todos: [
          { content: "Task 1", status: "completed", activeForm: "Task 1" },
          { content: "Task 2", status: "in_progress", activeForm: "Task 2" },
        ],
      });

      expect(state.todos).toHaveLength(2);
      expect(state.todos[0].status).toBe("completed");
      expect(state.todos[1].status).toBe("in_progress");
    });

    it("should allow adding new todos", async () => {
      const tool = createTodoWriteTool(state);

      await executeTool(tool, {
        todos: [{ content: "Task 1", status: "pending", activeForm: "Task 1" }],
      });

      // Add another task
      await executeTool(tool, {
        todos: [
          { content: "Task 1", status: "pending", activeForm: "Task 1" },
          { content: "Task 2", status: "pending", activeForm: "Task 2" },
        ],
      });

      expect(state.todos).toHaveLength(2);
    });

    it("should allow removing todos", async () => {
      const tool = createTodoWriteTool(state);

      await executeTool(tool, {
        todos: [
          { content: "Task 1", status: "completed", activeForm: "Task 1" },
          { content: "Task 2", status: "pending", activeForm: "Task 2" },
        ],
      });

      // Remove completed task
      await executeTool(tool, {
        todos: [{ content: "Task 2", status: "pending", activeForm: "Task 2" }],
      });

      expect(state.todos).toHaveLength(1);
      expect(state.todos[0].content).toBe("Task 2");
    });
  });

  describe("todo item structure", () => {
    it("should preserve content field", async () => {
      const tool = createTodoWriteTool(state);
      await executeTool(tool, {
        todos: [
          {
            content: "Implement feature X",
            status: "pending",
            activeForm: "Implementing feature X",
          },
        ],
      });

      expect(state.todos[0].content).toBe("Implement feature X");
    });

    it("should preserve activeForm field", async () => {
      const tool = createTodoWriteTool(state);
      await executeTool(tool, {
        todos: [
          {
            content: "Run tests",
            status: "in_progress",
            activeForm: "Running tests",
          },
        ],
      });

      expect(state.todos[0].activeForm).toBe("Running tests");
    });

    it("should preserve status field", async () => {
      const tool = createTodoWriteTool(state);
      await executeTool(tool, {
        todos: [
          {
            content: "Task",
            status: "completed",
            activeForm: "Completing task",
          },
        ],
      });

      expect(state.todos[0].status).toBe("completed");
    });
  });
});
