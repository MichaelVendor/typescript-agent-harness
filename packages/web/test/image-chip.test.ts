import assert from "node:assert/strict";
import { test } from "node:test";
import { imageChip, imageIndex, insertImageChip, removeImageChip } from "../src/image-chip.ts";

test("imageChip formats Claude-style tags", () => {
  assert.equal(imageChip(1), "[Image #1]");
  assert.equal(imageChip(12), "[Image #12]");
});

test("imageIndex is 1-based among images only", () => {
  const drafts = [
    { id: "a", kind: "file" },
    { id: "b", kind: "image" },
    { id: "c", kind: "image" },
  ];
  assert.equal(imageIndex(drafts, "b"), 1);
  assert.equal(imageIndex(drafts, "c"), 2);
  assert.equal(imageIndex(drafts, "a"), undefined);
});

test("insertImageChip pads and places the caret after the chip", () => {
  assert.deepEqual(insertImageChip("fix ", 4, 1), { text: "fix [Image #1]", caret: 14 });
  assert.deepEqual(insertImageChip("look", 4, 2), { text: "look [Image #2]", caret: 15 });
  assert.deepEqual(insertImageChip("", 0, 1), { text: "[Image #1]", caret: 10 });
});

test("removeImageChip drops the tag and renumbers higher ones", () => {
  assert.equal(removeImageChip("see [Image #1] and [Image #2]", 1), "see and [Image #1]");
  assert.equal(removeImageChip("[Image #1] [Image #2] [Image #3]", 2), "[Image #1] [Image #2]");
});
