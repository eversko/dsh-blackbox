import assert from "node:assert/strict";
import test from "node:test";
import { constants, zstdCompressSync } from "node:zlib";
import { parseSessionArtifact, scanDshZstdFrames } from "../src/index.mjs";

const headerLine = JSON.stringify({
  type: "session",
  version: 0,
  id: "session-artifact",
  createdAt: 1_000,
  agentPreset: "skocase",
});

const packedLine = JSON.stringify({
  type: "text-chunks",
  seq0: 0,
  time0: 1_010,
  data: {
    turn: 1,
    step: 1,
    index: 0,
    dt: [4, 7],
    texts: ["first", "second", "third"],
  },
});

test("reads raw JSONL and expands DSH packed chunk rows losslessly", () => {
  const parsed = parseSessionArtifact(
    Buffer.from(`${headerLine}\n${packedLine}\n`, "utf8"),
  );
  assert.equal(parsed.artifact.encoding, "jsonl");
  assert.equal(parsed.events.length, 3);
  assert.deepEqual(
    parsed.events.map((event) => [event.seq, event.time, event.data.chunk.text]),
    [
      [0, 1_010, "first"],
      [1, 1_014, "second"],
      [2, 1_021, "third"],
    ],
  );
});

test("reads every complete frame in DSH concatenated Zstandard artifacts", () => {
  const options = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
  const compressed = Buffer.concat([
    zstdCompressSync(`${headerLine}\n`, options),
    zstdCompressSync(`${packedLine}\n`, options),
  ]);
  const scan = scanDshZstdFrames(compressed);
  assert.equal(scan.frames.length, 2);
  const parsed = parseSessionArtifact(compressed);
  assert.equal(parsed.artifact.encoding, "jsonl-zstd");
  assert.equal(parsed.events.length, 3);
  assert.equal(parsed.events[2].data.chunk.text, "third");
});

test("rejects a torn final Zstandard frame and malformed packed records", () => {
  const compressed = zstdCompressSync(`${headerLine}\n${packedLine}\n`);
  assert.throws(
    () => parseSessionArtifact(compressed.subarray(0, compressed.length - 2)),
    /torn Zstandard frame/u,
  );
  const malformed = `${headerLine}\n${JSON.stringify({
    type: "text-chunks",
    seq0: 0,
    time0: 1,
    data: { turn: 1, step: 1, index: 0, dt: [], texts: ["a", "b"] },
  })}\n`;
  assert.throws(() => parseSessionArtifact(Buffer.from(malformed)), /time-gap count/u);
});

test("bounds decompressed artifacts and rejects packed rows outside the official shape", () => {
  const compressed = zstdCompressSync(`${headerLine}\n${" ".repeat(4_096)}\n`);
  assert.throws(
    () => parseSessionArtifact(compressed, { limits: { maxDecodedBytes: 128 } }),
    /Decoded session artifact exceeds the 128-byte limit/u,
  );
  const extraField = `${headerLine}\n${JSON.stringify({
    ...JSON.parse(packedLine),
    unexpected: true,
  })}\n`;
  assert.throws(
    () => parseSessionArtifact(Buffer.from(extraField)),
    /packed chunk row envelope/u,
  );
  assert.throws(
    () => parseSessionArtifact(Buffer.from(`${headerLine}\n`), { limits: { unknown: 1 } }),
    /unknown artifact limit/u,
  );
});
