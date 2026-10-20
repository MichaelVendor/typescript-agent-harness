import assert from "node:assert/strict";
import { test } from "node:test";
import { contextToolsFromMcp, type McpBackend } from "@typescript-agent-harness/mcp";

function fake(partial: Partial<McpBackend>): McpBackend {
  return {
    async listTools() { return []; },
    async callTool() { return ""; },
    async listResources() { return []; },
    async readResource() { throw new Error("missing"); },
    async listPrompts() { return []; },
    async getPrompt() { throw new Error("missing"); },
    ...partial,
  };
}

test("no resources and no prompts register nothing", async () => {
  assert.deepEqual(await contextToolsFromMcp([{ label: "a", backend: fake({}) }]), []);
});

test("resources register list and read; blobs are omitted", async () => {
  const backend = fake({
    async listResources() {
      return [{ uri: "doc://a", name: "A", mimeType: "text/plain" }];
    },
    async readResource() {
      return [
        { mimeType: "text/plain", text: "hello" },
        { blob: "aaaa" },
      ];
    },
  });
  const tools = await contextToolsFromMcp([{ label: "npx pkg", backend }]);
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["list_resources", "read_resource"]);
  const list = tools.find((t) => t.name === "list_resources")!;
  assert.deepEqual(await list.execute({}, {} as never), [
    { server: "npx pkg", uri: "doc://a", name: "A", mimeType: "text/plain" },
  ]);
  const read = tools.find((t) => t.name === "read_resource")!;
  assert.equal(
    await read.execute({ uri: "doc://a" }, {} as never),
    "hello\n已省略（application/octet-stream）",
  );
  await assert.rejects(read.execute({ uri: "doc://nope" }, {} as never), /unknown resource/);
});

test("get_prompt lists names and requires server when ambiguous", async () => {
  const one = fake({
    async listPrompts() {
      return [{ name: "review-code", arguments: [{ name: "code", required: true }] }];
    },
    async getPrompt() {
      return [{ text: "be brief" }];
    },
  });
  const tools = await contextToolsFromMcp([
    { label: "alpha", backend: one },
    { label: "beta", backend: one },
  ]);
  const get = tools.find((t) => t.name === "get_prompt")!;
  assert.match(get.description, /review-code/);
  assert.match(get.description, /alpha/);
  await assert.rejects(get.execute({ name: "review-code" }, {} as never), /requires server/);
  assert.equal(await get.execute({ name: "review-code", server: "alpha" }, {} as never), "be brief");
  await assert.rejects(get.execute({ name: "missing" }, {} as never), /unknown prompt/);
});
