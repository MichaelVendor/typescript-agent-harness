import assert from "node:assert/strict";
import test from "node:test";
import { Runtime } from "@typescript-agent-harness/core";
import { toolsPlugin, TOOLS } from "@typescript-agent-harness/tools";
import { mcpPlugin } from "@typescript-agent-harness/mcp";

test("lazy: setup registers discovery tools only", async () => {
  const backend = {
    async listTools() {
      return [{ name: "z_remote", description: "x", inputSchema: { type: "object", properties: {} } }];
    },
    async callTool() {
      return { content: [{ type: "text", text: "ok" }] };
    },
  };
  const rt = new Runtime();
  rt.use(toolsPlugin());
  rt.use(mcpPlugin({ backend: backend as never, toolExposure: "lazy", name: "mcp_test" }));
  await rt.start();
  const tools = rt.get(TOOLS);
  const names = tools.list().map((t) => t.name);
  assert.ok(names.includes("mcp_test_list_tools"));
  assert.ok(names.includes("mcp_test_enable_tools"));
  assert.ok(!names.includes("z_remote"));
  await rt.stop();
});

test("lazy: enable registers remote tool and call works", async () => {
  const backend = {
    async listTools() {
      return [{ name: "z_remote", description: "x", inputSchema: { type: "object", properties: {} } }];
    },
    async callTool() {
      return { content: [{ type: "text", text: "ok" }] };
    },
  };
  const rt = new Runtime();
  rt.use(toolsPlugin());
  rt.use(mcpPlugin({ backend: backend as never, toolExposure: "lazy", name: "mcp" }));
  await rt.start();
  const tools = rt.get(TOOLS);
  const enable = tools.list().find((t) => t.name === "mcp_enable_tools")!;
  await enable.execute({ names: ["z_remote"] }, {} as never);
  assert.ok(tools.list().some((t) => t.name === "z_remote"));
  const remote = tools.list().find((t) => t.name === "z_remote")!;
  assert.equal(await remote.execute({}, {} as never), "ok");
  await rt.stop();
});

test("eager: setup registers all remote tools", async () => {
  const backend = {
    async listTools() {
      return [{ name: "z_remote", description: "x", inputSchema: { type: "object", properties: {} } }];
    },
    async callTool() {
      return { content: [{ type: "text", text: "ok" }] };
    },
  };
  const rt = new Runtime();
  rt.use(toolsPlugin());
  rt.use(mcpPlugin({ backend: backend as never, toolExposure: "eager" }));
  await rt.start();
  const names = rt.get(TOOLS).list().map((t) => t.name);
  assert.ok(names.includes("z_remote"));
  assert.ok(!names.includes("mcp_list_tools"));
  await rt.stop();
});