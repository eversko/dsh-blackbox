import {
  analyzeSession,
  createBlackBoxPack,
  renderBlackBoxMarkdown,
} from "../src/index.mjs";

const repeated = "The register API matches. Let me inspect the host service again. ".repeat(80);
const header = {
  version: 0,
  id: "public-demo-session",
  createdAt: 1_000,
  agentPreset: "skocase",
};
const events = [
  { type: "turn/start", seq: 0, time: 1_000, data: { turn: 1 } },
  { type: "step/start", seq: 1, time: 1_010, data: { turn: 1, step: 1 } },
  {
    type: "assistant/chunk",
    seq: 2,
    time: 1_020,
    data: {
      turn: 1,
      step: 1,
      chunk: { type: "text-delta", index: 0, text: repeated },
    },
  },
  {
    type: "assistant/message",
    seq: 3,
    time: 1_030,
    data: { turn: 1, step: 1, message: { role: "assistant", content: [] } },
  },
  { type: "step/end", seq: 4, time: 1_040, data: { turn: 1, step: 1 } },
  {
    type: "turn/end",
    seq: 5,
    time: 1_050,
    data: { turn: 1, reason: { kind: "completed" } },
  },
];
const report = analyzeSession({ header, events });
const pack = createBlackBoxPack({
  header,
  report,
  runtimeVersion: "0.1.1-rc.2",
  generatedAt: 1_050,
});
process.stdout.write(renderBlackBoxMarkdown(pack));
