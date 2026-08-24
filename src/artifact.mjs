import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { constants, zstdDecompressSync } from "node:zlib";

const ZSTD_MAGIC = 0xfd2fb528;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const MAX_DECODED_BYTES = 512 * 1024 * 1024;
const MAX_JSONL_LINE_BYTES = 24 * 1024 * 1024;
const MAX_ZSTD_WINDOW_LOG = 27;

export const DEFAULT_ARTIFACT_LIMITS = Object.freeze({
  maxArtifactBytes: MAX_ARTIFACT_BYTES,
  maxDecodedBytes: MAX_DECODED_BYTES,
  maxJsonlLineBytes: MAX_JSONL_LINE_BYTES,
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireSafeInteger(value, label) {
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid packed row ${label}.`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string") throw new Error(`Invalid packed row ${label}.`);
  return value;
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function normalizeLimits(value) {
  if (value === undefined) return DEFAULT_ARTIFACT_LIMITS;
  if (!isRecord(value)) throw new TypeError("artifact limits must be an object");
  const limits = { ...DEFAULT_ARTIFACT_LIMITS };
  for (const [key, limit] of Object.entries(value)) {
    if (!Object.hasOwn(DEFAULT_ARTIFACT_LIMITS, key)) {
      throw new TypeError(`unknown artifact limit: ${key}`);
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new TypeError(`${key} must be a positive safe integer`);
    }
    limits[key] = limit;
  }
  return Object.freeze(limits);
}

// DSH session logs append complete standard Zstandard frames. This scanner is
// intentionally limited to that documented container and rejects every
// reserved shape instead of guessing around damaged bytes.
export function scanDshZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`Invalid Zstandard frame magic at byte ${offset}.`);
    }
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset++);
    if ((descriptor & 0x18) !== 0) {
      throw new Error(`Reserved Zstandard frame-header bit at byte ${offset - 1}.`);
    }
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes =
      contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes =
      (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) {
      return { frames, tornStart: start };
    }
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) {
        throw new Error(`Reserved Zstandard block type at byte ${offset - 3}.`);
      }
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push(Object.freeze({ start, end: offset }));
  }
  return { frames };
}

function decodeArtifactBytes(buffer, limits) {
  if (buffer.length > limits.maxArtifactBytes) {
    throw new Error(`Session artifact exceeds the ${limits.maxArtifactBytes}-byte input limit.`);
  }
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== ZSTD_MAGIC) return buffer;
  const { frames, tornStart } = scanDshZstdFrames(buffer);
  if (tornStart !== undefined) {
    throw new Error(`Session artifact ends with a torn Zstandard frame at byte ${tornStart}.`);
  }
  const decoded = [];
  let decodedBytes = 0;
  for (const { start, end } of frames) {
    const remaining = limits.maxDecodedBytes - decodedBytes;
    if (remaining < 1) {
      throw new Error(`Decoded session artifact exceeds the ${limits.maxDecodedBytes}-byte limit.`);
    }
    let frame;
    try {
      frame = zstdDecompressSync(buffer.subarray(start, end), {
        maxOutputLength: remaining,
        params: { [constants.ZSTD_d_windowLogMax]: MAX_ZSTD_WINDOW_LOG },
      });
    } catch (error) {
      if (error?.code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|too large/iu.test(error?.message ?? "")) {
        throw new Error(`Decoded session artifact exceeds the ${limits.maxDecodedBytes}-byte limit.`);
      }
      throw error;
    }
    decoded.push(frame);
    decodedBytes += frame.length;
  }
  return Buffer.concat(decoded, decodedBytes);
}

function expandPackedRow(row) {
  if (!["text-chunks", "reasoning-chunks", "tool-call-chunks"].includes(row?.type)) {
    return [row];
  }
  if (!hasExactKeys(row, ["type", "seq0", "time0", "data"])) {
    throw new Error("Invalid packed chunk row envelope.");
  }
  if (!isRecord(row.data)) throw new Error("Invalid packed chunk row data.");
  const seq0 = requireSafeInteger(row.seq0, "seq0");
  if (seq0 < 0) throw new Error("Invalid packed row seq0.");
  const time0 = requireSafeInteger(row.time0, "time0");
  const turn = requireSafeInteger(row.data.turn, "turn");
  const step = requireSafeInteger(row.data.step, "step");
  const index = requireSafeInteger(row.data.index, "index");
  if (!Array.isArray(row.data.dt) || !row.data.dt.every(Number.isSafeInteger)) {
    throw new Error("Invalid packed row time gaps.");
  }
  const values =
    row.type === "tool-call-chunks" ? row.data.args : row.data.texts;
  const expectedDataKeys =
    row.type === "tool-call-chunks"
      ? row.data.name === undefined
        ? ["turn", "step", "index", "id", "dt", "args"]
        : ["turn", "step", "index", "id", "name", "dt", "args"]
      : ["turn", "step", "index", "dt", "texts"];
  if (!hasExactKeys(row.data, expectedDataKeys)) {
    throw new Error("Invalid packed chunk row fields.");
  }
  if (!Array.isArray(values) || values.length === 0 || !values.every((value) => typeof value === "string")) {
    throw new Error("Invalid packed row values.");
  }
  if (row.data.dt.length !== values.length - 1) {
    throw new Error("Invalid packed row time-gap count.");
  }
  if (!Number.isSafeInteger(seq0 + values.length - 1)) {
    throw new Error("Invalid packed row sequence range.");
  }
  let finalTime = time0;
  for (const gap of row.data.dt) {
    finalTime += gap;
    if (!Number.isSafeInteger(finalTime)) {
      throw new Error("Invalid packed row timestamp range.");
    }
  }
  let time = time0;
  return values.map((value, memberIndex) => {
    if (memberIndex > 0) time += row.data.dt[memberIndex - 1];
    let chunk;
    if (row.type === "text-chunks") {
      chunk = { type: "text-delta", index, text: value };
    } else if (row.type === "reasoning-chunks") {
      chunk = { type: "reasoning-delta", index, text: value };
    } else {
      chunk = {
        type: "tool-call-delta",
        index,
        id: requireString(row.data.id, "tool call id"),
        ...(row.data.name === undefined
          ? {}
          : { name: requireString(row.data.name, "tool name") }),
        argumentsDelta: value,
      };
    }
    return Object.freeze({
      type: "assistant/chunk",
      seq: seq0 + memberIndex,
      time,
      data: Object.freeze({ turn, step, chunk: Object.freeze(chunk) }),
    });
  });
}

export function parseSessionArtifact(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError("artifact must be a Buffer");
  const limits = normalizeLimits(options.limits);
  const rawSha256 = createHash("sha256").update(buffer).digest("hex");
  const decoded = decodeArtifactBytes(buffer, limits);
  if (decoded.length > limits.maxDecodedBytes) {
    throw new Error(`Decoded session artifact exceeds the ${limits.maxDecodedBytes}-byte limit.`);
  }
  const lines = decoded.toString("utf8").replace(/^\uFEFF/u, "").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) throw new Error("Session artifact is empty.");
  const records = lines.map((line, lineIndex) => {
    if (Buffer.byteLength(line) > limits.maxJsonlLineBytes) {
      throw new Error(`Session artifact line ${lineIndex + 1} exceeds the safety limit.`);
    }
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Session artifact line ${lineIndex + 1} is not valid JSON.`);
    }
  });
  const headerRecord = records.shift();
  if (!isRecord(headerRecord) || headerRecord.type !== "session") {
    throw new Error("Session artifact is missing its immutable session header.");
  }
  const { type: _type, ...header } = headerRecord;
  const events = records.flatMap(expandPackedRow);
  return Object.freeze({
    header: Object.freeze(header),
    events: Object.freeze(events),
    artifact: Object.freeze({
      encoding:
        buffer.length >= 4 && buffer.readUInt32LE(0) === ZSTD_MAGIC
          ? "jsonl-zstd"
          : "jsonl",
      sha256: rawSha256,
      bytes: buffer.length,
    }),
  });
}

export async function readSessionArtifact(path, options = {}) {
  return parseSessionArtifact(await readFile(path), options);
}
