import { defineTool } from "@typescript-agent-harness/cli";
import { findOrder } from "../lib/orders.ts";

// File name query-order.ts → tool name query_order.
export default defineTool({
  description: "Look up an order by its id and return its status.",
  inputSchema: {
    type: "object",
    properties: { orderId: { type: "string", description: "Order id, e.g. A123" } },
    required: ["orderId"],
    additionalProperties: false,
  },
  async execute(input: { orderId: string }) {
    return findOrder(input.orderId) ?? { error: `order ${input.orderId} not found` };
  },
});
