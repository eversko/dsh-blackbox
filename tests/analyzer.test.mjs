import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeSession,
  createBlackBoxPack,
  renderBlackBoxMarkdown,
} from "../src/index.mjs";

const header = Object.freeze({
  version: 0,
  id: "session-secret-identifier",
  cwd: "C:/private/customer/project",
  createdAt: 1_000,
  agentPreset: "skocase",
});

function event(type, seq, time, data) {
  return Object.freeze({ type, seq, time, data: Object.freeze(data) });
}

test("produces a healthy metadata-only report without leaking recorded content", () => {
  const events = [
    event("turn/start", 0, 1_000, { turn: 1 }),
    event("user/message", 1, 1_010, {
      role: "user",
      content: [{ type: "text", text: "PRIVATE PROMPT 8492" }],
    }),
    event("step/start", 2, 1_020, { turn: 1, step: 1 }),
    event("tool/call", 3, 1_030, {
      turn: 1,
      step: 1,
      callId: "private-call-id",
      name: "bash",
      arguments: '{"command":"PRIVATE ARGUMENT 8492"}',
    }),
    event("tool/result", 4, 1_040, {
      turn: 1,
      step: 1,
      message: {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "private-call-id",
            content: [{ type: "text", text: "PRIVATE RESULT 8492" }],
          },
        ],
      },
    }),
    event("assistant/chunk", 5, 1_050, {
      turn: 1,
      step: 1,
      chunk: { type: "text-delta", index: 0, text: "PRIVATE OUTPUT 8492" },
    }),
    event("assistant/message", 6, 1_060, {
      turn: 1,
      step: 1,
      message: { role: "assistant", content: [] },
      usage: {
        inputTokens: 120,
        outputTokens: 40,
        cacheReadTokens: 30,
        reasoningTokens: 12,
      },
    }),
    event("step/end", 7, 1_070, { turn: 1, step: 1 }),
    event("turn/end", 8, 1_080, { turn: 1, reason: { kind: "completed" } }),
  ];

  const report = analyzeSession({ header, events });
  assert.equal(report.status, "healthy");
  assert.equal(report.summary.toolCallCount, 1);
  assert.equal(report.summary.inputTokens, 120);
  assert.equal(report.summary.outputTokens, 40);
  assert.equal(report.summary.agentPreset, "skocase");
  assert.deepEqual(report.anomalies, []);

  const pack = createBlackBoxPack({
    header,
    report,
    runtimeVersion: "0.1.1-rc.2",
    generatedAt: 1_080,
  });
  const serialized = JSON.stringify(pack);
  for (const secret of [
    "PRIVATE PROMPT 8492",
    "PRIVATE ARGUMENT 8492",
    "PRIVATE RESULT 8492",
    "PRIVATE OUTPUT 8492",
    "session-secret-identifier",
    "C:/private/customer/project",
    "private-call-id",
  ]) {
    assert.equal(serialized.includes(secret), false, `pack leaked ${secret}`);
  }
  assert.equal(pack.privacy.contentIncluded, false);
  assert.equal(pack.source.sessionIdHash.length, 64);
  assert.match(renderBlackBoxMarkdown(pack), /No Black Box anomaly was detected/u);
});

test("detects sequence damage, unfinished approvals, and lifecycle mismatches", () => {
  const events = [
    event("turn/start", 0, 1_000, { turn: 1 }),
    event("step/start", 2, 1_010, { turn: 1, step: 1 }),
    event("approval/asked", 3, 1_020, {
      id: "approval-private-id",
      toolName: "bash",
      reason: "PRIVATE APPROVAL REASON",
    }),
  ];
  const report = analyzeSession(
    { header, events },
    { captureEndTime: 61_020 },
  );
  assert.equal(report.status, "critical");
  assert.deepEqual(
    new Set(report.anomalies.map((finding) => finding.code)),
    new Set([
      "sequence-gap",
      "open-step-at-capture-end",
      "open-turn-at-capture-end",
      "approval-stalled",
    ]),
  );
  assert.equal(JSON.stringify(report).includes("PRIVATE APPROVAL REASON"), false);
  assert.equal(JSON.stringify(report).includes("approval-private-id"), false);
});

test("detects a chunk-boundary-independent output repetition loop", () => {
  const repeated = "The register API matches. Let me inspect the host service again. ".repeat(80);
  const events = [
    event("turn/start", 0, 1_000, { turn: 1 }),
    event("step/start", 1, 1_010, { turn: 1, step: 1 }),
    event("assistant/chunk", 2, 1_020, {
      turn: 1,
      step: 1,
      chunk: { type: "text-delta", index: 0, text: repeated.slice(0, 1_137) },
    }),
    event("assistant/chunk", 3, 1_030, {
      turn: 1,
      step: 1,
      chunk: { type: "text-delta", index: 0, text: repeated.slice(1_137) },
    }),
    event("assistant/message", 4, 1_040, {
      turn: 1,
      step: 1,
      message: { role: "assistant", content: [] },
    }),
    event("step/end", 5, 1_050, { turn: 1, step: 1 }),
    event("turn/end", 6, 1_060, { turn: 1, reason: { kind: "completed" } }),
  ];
  const report = analyzeSession({ header, events });
  assert.equal(report.status, "attention");
  assert.ok(
    report.anomalies.some((finding) => finding.code === "output-repetition-loop"),
  );
  assert.equal(JSON.stringify(report).includes("register API"), false);
});

test("does not cascade one duplicate sequence into false later findings", () => {
  const events = [
    event("turn/start", 0, 1_000, { turn: 1 }),
    event("user/message", 0, 1_001, { role: "user", content: [] }),
    event("turn/end", 1, 1_010, { turn: 1, reason: { kind: "completed" } }),
  ];
  const report = analyzeSession({ header, events });
  assert.deepEqual(
    report.anomalies.map((finding) => [finding.code, finding.eventSeq]),
    [["duplicate-sequence", 0]],
  );
});

test("uses stream usage for a step and message usage only as its fallback", () => {
  const events = [
    event("assistant/chunk", 0, 1_000, {
      turn: 1,
      step: 1,
      chunk: {
        type: "usage",
        usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 5 },
      },
    }),
    event("assistant/message", 1, 1_010, {
      turn: 1,
      step: 1,
      message: { role: "assistant", content: [] },
      usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 5 },
    }),
    event("assistant/message", 2, 1_020, {
      turn: 1,
      step: 2,
      message: { role: "assistant", content: [] },
      usage: { inputTokens: 40, outputTokens: 8, cacheReadTokens: 30 },
    }),
  ];
  const report = analyzeSession({ header, events });
  assert.equal(report.summary.inputTokens, 140);
  assert.equal(report.summary.outputTokens, 28);
  assert.equal(report.summary.reasoningTokens, 5);
  assert.equal(report.summary.cacheReadTokens, 30);
});

test("rejects thresholds that could hang or silently weaken analysis", () => {
  assert.throws(
    () => analyzeSession({ header, events: [] }, { thresholds: { repetitionStrideChars: 0 } }),
    /repetitionStrideChars/u,
  );
  assert.throws(
    () => analyzeSession({ header, events: [] }, { thresholds: { unexpected: 1 } }),
    /unknown Black Box threshold/u,
  );
});

test("hashes unsafe metadata labels instead of copying them into a shareable pack", () => {
  const privatePreset = "PRIVATE PRESET LABEL 7788";
  const privateTool = "PRIVATE TOOL LABEL 7788";
  const privateRuntime = "PRIVATE RUNTIME LABEL 7788";
  const report = analyzeSession({
    header: { ...header, agentPreset: privatePreset },
    events: [
      event("tool/call", 0, 1_000, {
        turn: 1,
        step: 1,
        callId: "metadata-call",
        name: privateTool,
        arguments: "{}",
      }),
    ],
  });
  const pack = createBlackBoxPack({
    header: { ...header, agentPreset: privatePreset },
    report,
    runtimeVersion: privateRuntime,
    generatedAt: 1_000,
  });
  const serialized = JSON.stringify(pack);
  for (const secret of [privatePreset, privateTool, privateRuntime]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.match(pack.source.agentPreset, /^private-preset-[a-f0-9]{16}$/u);
  assert.match(pack.source.runtimeVersion, /^private-runtime-[a-f0-9]{16}$/u);
  assert.match(report.timeline[0].label, /^private-tool-[a-f0-9]{16}$/u);
});
