import assert from "node:assert/strict";
import { test } from "node:test";
import { answerOf, answersOf, emptyDrafts, pick, typeOther } from "../src/question-view.ts";

const single = { question: "Which?", options: ["a", "b", "c"] };
const multiple = { question: "Also?", options: ["x", "y", "z"], multiple: true };

test("single choice: a pick replaces the typed answer and typing replaces the pick", () => {
  let d = emptyDrafts([single])[0]!;
  d = typeOther(single, d, "mine");
  d = pick(single, d, 1);
  assert.deepEqual(answerOf(single, d), ["b"]);
  d = typeOther(single, d, "mine");
  assert.deepEqual(answerOf(single, d), ["mine"]);
});

test("multiple choice: picks toggle, keep option order, and the typed answer is added", () => {
  let d = emptyDrafts([multiple])[0]!;
  d = pick(multiple, d, 2);
  d = pick(multiple, d, 0);
  d = pick(multiple, d, 1);
  d = pick(multiple, d, 1);
  d = typeOther(multiple, d, "  w  ");
  assert.deepEqual(answerOf(multiple, d), ["x", "z", "w"]);
});

test("answers are ready only when every question has one", () => {
  const questions = [single, multiple];
  const drafts = emptyDrafts(questions);
  assert.equal(answersOf(questions, drafts), undefined);
  drafts[0] = pick(single, drafts[0]!, 0);
  assert.equal(answersOf(questions, drafts), undefined);
  drafts[1] = typeOther(multiple, drafts[1]!, "w");
  assert.deepEqual(answersOf(questions, drafts), [["a"], ["w"]]);
});
