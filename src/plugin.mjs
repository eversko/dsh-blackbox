import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { analyzeSession } from "./analyzer.mjs";
import { createBlackBoxPack } from "./pack.mjs";

export const name = "eversko-dsh-blackbox";
export const inject = ["sessions"];

function sessionSlug(sessionId) {
  return createHash("sha256").update(String(sessionId)).digest("hex").slice(0, 24);
}

function exactOutputRoot(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("eversko-dsh-blackbox requires an explicit outputRoot");
  }
  if (!isAbsolute(value)) {
    throw new Error("eversko-dsh-blackbox outputRoot must be absolute");
  }
  return resolve(value);
}

export async function writeBlackBoxSnapshot(session, config) {
  const outputRoot = exactOutputRoot(config.outputRoot);
  const { filename, pack } = buildBlackBoxSnapshot(session, config);
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  try {
    await writeFile(join(outputRoot, filename), `${JSON.stringify(pack)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return Object.freeze({ filename, pack });
}

function buildBlackBoxSnapshot(session, config) {
  const events = session.events;
  const captureEndTime =
    events.length === 0
      ? session.header.createdAt
      : events.at(-1).time;
  const report = analyzeSession(
    { header: session.header, events },
    { captureEndTime, thresholds: config.thresholds },
  );
  const pack = createBlackBoxPack({
    header: session.header,
    report,
    runtimeVersion: config.runtimeVersion,
    generatedAt: captureEndTime,
    sourceKind: "live-session",
  });
  const lastSeq = events.length === 0 ? "empty" : String(events.at(-1).seq);
  const filename = `${sessionSlug(session.id)}--${lastSeq}.dshpack.json`;
  return Object.freeze({ filename, pack });
}

export function writeBlackBoxSnapshotSync(session, config) {
  const outputRoot = exactOutputRoot(config.outputRoot);
  const { filename, pack } = buildBlackBoxSnapshot(session, config);
  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(join(outputRoot, filename), `${JSON.stringify(pack)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return Object.freeze({ filename, pack });
}

export function apply(ctx, config = {}) {
  exactOutputRoot(config.outputRoot);
  ctx.on("session/flush", async (session) => {
    try {
      await writeBlackBoxSnapshot(session, config);
    } catch (error) {
      if (config.failClosed === true) throw error;
      process.stderr.write(
        `DSH Black Box could not write a metadata snapshot: ${error instanceof Error ? error.message : "unknown error"}\n`,
      );
    }
  });
  ctx.on("session/disposed", (session) => {
    try {
      // DSH disposal observers are synchronous and contained. A synchronous final
      // snapshot makes failed and interrupted turns durable before process exit.
      writeBlackBoxSnapshotSync(session, config);
    } catch (error) {
      if (config.failClosed === true) throw error;
      process.stderr.write(
        `DSH Black Box could not write its final metadata snapshot: ${error instanceof Error ? error.message : "unknown error"}\n`,
      );
    }
  });
}
