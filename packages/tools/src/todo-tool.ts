import type { Tool } from "./types.js";

export type TodoStatus = "pending" | "in_progress" | "completed";
export type Todo = { content: string; status: TodoStatus };

const STATUSES: TodoStatus[] = ["pending", "in_progress", "completed"];
const MAX_TODOS = 50;
const MAX_CONTENT = 300;

export function todoWriteTool(): Tool<{ todos: Todo[] }, { todos: Todo[] }> {
  return {
    name: "todo_write",
    description:
      "Replace the task list shown to the user. Use it for work with 3 or more steps: send the whole list every time, keep one item in_progress while working on it, and mark items completed as soon as they are done. Skip it for simple questions.",
    inputSchema: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "The full task list, in order",
          items: {
            type: "object",
            properties: {
              content: { type: "string", description: "What to do, one short line" },
              status: { type: "string", enum: STATUSES },
            },
            required: ["content", "status"],
            additionalProperties: false,
          },
        },
      },
      required: ["todos"],
      additionalProperties: false,
    },
    async execute(input) {
      if (!Array.isArray(input.todos)) throw new Error("todos must be an array");
      if (input.todos.length > MAX_TODOS) throw new Error(`at most ${MAX_TODOS} todos`);
      const todos = input.todos.map((t, i) => {
        const content = typeof t?.content === "string" ? t.content.trim() : "";
        if (!content || content.length > MAX_CONTENT) {
          throw new Error(`todos[${i}].content must be 1–${MAX_CONTENT} characters`);
        }
        if (!STATUSES.includes(t.status)) throw new Error(`todos[${i}].status must be one of ${STATUSES.join(", ")}`);
        return { content, status: t.status };
      });
      return { todos };
    },
  };
}
