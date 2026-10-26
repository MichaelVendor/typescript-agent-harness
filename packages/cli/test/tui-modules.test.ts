import assert from "node:assert/strict";
import { test } from "node:test";
import { defineTuiModule, panelSend } from "../src/tui/modules.ts";

test("defineTuiModule returns the same object", () => {
  const Component = () => null;
  const mod = defineTuiModule({ slot: "above-input", Component });
  assert.equal(mod.slot, "above-input");
  assert.equal(mod.Component, Component);
});

test("panelSend calls through only while focused", async () => {
  const sent: string[] = [];
  const send = panelSend("cost", false, async (text) => {
    sent.push(text);
  });
  await assert.rejects(send("hi"), /tui: cost is not focused/);
  assert.deepEqual(sent, []);
  const open = panelSend("cost", true, async (text) => {
    sent.push(text);
  });
  await open("hi");
  assert.deepEqual(sent, ["hi"]);
});
