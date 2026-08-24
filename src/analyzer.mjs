import { safeMetadataLabel, shortHash } from "./privacy.mjs";

export const BLACKBOX_REPORT_SCHEMA = "eversko.dsh-blackbox.report.v1";

const defaultThresholds = Object.freeze({
  approvalStallMs: 30_000,
  outputChunkWarning: 2_000,
  outputCharWarning: 200_000,
  repetitionMinChars: 2_000,
  repetitionWindowChars: 80,
  repetitionStrideChars: 20,
  repetitionWindowCount: 8,
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeInteger(value) {
  return Number.isSafeInteger(value) ? value : null;
}

function safeString(value) {
  return typeof value === "string" ? value : null;
}

function severityRank(severity) {
  return severity === "critical" ? 2 : severity === "attention" ? 1 : 0;
}

function terminalReason(event) {
  const kind = safeString(event?.data?.reason?.kind);
  if (kind === null) return "unknown";
  return ["completed", "aborted", "blocked", "error", "max-tokens", "interrupted"].includes(kind)
    ? kind
    : `extension-${shortHash(kind)}`;
}

function resultCallId(event) {
  const content = event?.data?.message?.content;
  if (!Array.isArray(content) || !isRecord(content[0])) return null;
  return safeString(content[0].toolCallId);
}

function usageNumber(usage, key) {
  const value = usage?.[key];
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function normalizeThresholds(value) {
  if (value === undefined) return defaultThresholds;
  if (!isRecord(value)) throw new TypeError("thresholds must be an object");
  const thresholds = { ...defaultThresholds };
  for (const [key, threshold] of Object.entries(value)) {
    if (!Object.hasOwn(defaultThresholds, key)) {
      throw new TypeError(`unknown Black Box threshold: ${key}`);
    }
    const minimum = key === "approvalStallMs" ? 0 : 1;
    if (!Number.isSafeInteger(threshold) || threshold < minimum) {
      throw new TypeError(`${key} must be a safe integer greater than or equal to ${minimum}`);
    }
    thresholds[key] = threshold;
  }
  return Object.freeze(thresholds);
}

function addUsage(totals, usage) {
  totals.inputTokens += usageNumber(usage, "inputTokens");
  totals.outputTokens += usageNumber(usage, "outputTokens");
  totals.cacheReadTokens += usageNumber(usage, "cacheReadTokens");
  totals.cacheWriteTokens += usageNumber(usage, "cacheWriteTokens");
  totals.reasoningTokens += usageNumber(usage, "reasoningTokens");
}

function normalizeStreamText(value) {
  return value.toLowerCase().replace(/\s+/gu, " ").trim();
}

function repeatedWindowCount(text, thresholds) {
  const normalized = normalizeStreamText(text);
  if (normalized.length < thresholds.repetitionMinChars) return 0;
  const counts = new Map();
  let maximum = 0;
  for (
    let offset = 0;
    offset + thresholds.repetitionWindowChars <= normalized.length;
    offset += thresholds.repetitionStrideChars
  ) {
    const window = normalized.slice(
      offset,
      offset + thresholds.repetitionWindowChars,
    );
    const count = (counts.get(window) ?? 0) + 1;
    counts.set(window, count);
    maximum = Math.max(maximum, count);
  }
  return maximum;
}

function timelineEntry(event, kind, label, status = "neutral") {
  return Object.freeze({
    seq: event.seq,
    time: event.time,
    kind,
    label,
    status,
  });
}

export function analyzeSession({ header = {}, events }, options = {}) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  const thresholds = normalizeThresholds(options.thresholds);
  if (
    options.captureEndTime !== undefined &&
    (!Number.isSafeInteger(options.captureEndTime) || options.captureEndTime < 0)
  ) {
    throw new TypeError("captureEndTime must be a non-negative safe integer");
  }
  const captureEndTime =
    options.captureEndTime ??
    events.reduce(
      (latest, event) => Math.max(latest, safeInteger(event?.time) ?? 0),
      safeInteger(header.createdAt) ?? 0,
    );

  const anomalies = [];
  const anomalyKeys = new Set();
  const timeline = [];
  const turns = new Set();
  const steps = new Set();
  const calls = new Map();
  const approvals = new Map();
  const usageByStep = new Map();
  const streamText = [];
  let streamTextBytes = 0;
  let outputChunks = 0;
  let outputChars = 0;
  let toolCallCount = 0;
  let approvalCount = 0;
  let openTurn = null;
  let openStep = null;

  function usageState(turn, step) {
    const key = `${turn ?? "?"}:${step ?? "?"}`;
    let state = usageByStep.get(key);
    if (state === undefined) {
      state = { chunks: [], messages: [] };
      usageByStep.set(key, state);
    }
    return state;
  }

  function addAnomaly(code, severity, eventSeq, facts) {
    const key = `${code}:${eventSeq ?? "end"}`;
    if (anomalyKeys.has(key)) return;
    anomalyKeys.add(key);
    anomalies.push(
      Object.freeze({
        code,
        severity,
        eventSeq: eventSeq ?? null,
        facts: Object.freeze({ ...facts }),
      }),
    );
  }

  let expectedSeq = 0;
  for (const event of events) {
    if (!isRecord(event)) {
      addAnomaly("invalid-event-envelope", "critical", expectedSeq, {});
      expectedSeq += 1;
      continue;
    }
    const seq = safeInteger(event.seq);
    const time = safeInteger(event.time);
    const type = safeString(event.type);
    if (seq === null || time === null || type === null || !isRecord(event.data)) {
      addAnomaly("invalid-event-envelope", "critical", seq, {});
      expectedSeq += 1;
      continue;
    }
    if (seq !== expectedSeq) {
      addAnomaly(
        seq < expectedSeq ? "duplicate-sequence" : "sequence-gap",
        "critical",
        seq,
        { expectedSeq, actualSeq: seq },
      );
    }
    if (seq >= expectedSeq) expectedSeq = seq + 1;

    switch (type) {
      case "turn/start": {
        const turn = safeInteger(event.data.turn);
        if (openTurn !== null) {
          addAnomaly("nested-turn", "critical", seq, { openTurn, nextTurn: turn });
        }
        openTurn = turn;
        if (turn !== null) turns.add(turn);
        timeline.push(timelineEntry(event, "turn", `Turn ${turn ?? "?"} started`));
        break;
      }
      case "turn/end": {
        const turn = safeInteger(event.data.turn);
        if (openTurn !== turn) {
          addAnomaly("turn-end-mismatch", "critical", seq, {
            openTurn,
            endedTurn: turn,
          });
        }
        if (openStep !== null) {
          addAnomaly("turn-ended-with-open-step", "critical", seq, {
            openStep,
          });
          openStep = null;
        }
        const reason = terminalReason(event);
        timeline.push(
          timelineEntry(
            event,
            "turn",
            `Turn ${turn ?? "?"} ${reason}`,
            reason === "completed" ? "success" : "attention",
          ),
        );
        openTurn = null;
        break;
      }
      case "step/start": {
        const turn = safeInteger(event.data.turn);
        const step = safeInteger(event.data.step);
        if (openTurn !== turn || openStep !== null) {
          addAnomaly("step-start-mismatch", "critical", seq, {
            openTurn,
            eventTurn: turn,
            openStep,
          });
        }
        openStep = step;
        if (turn !== null && step !== null) steps.add(`${turn}:${step}`);
        break;
      }
      case "step/end": {
        const turn = safeInteger(event.data.turn);
        const step = safeInteger(event.data.step);
        if (openTurn !== turn || openStep !== step) {
          addAnomaly("step-end-mismatch", "critical", seq, {
            openTurn,
            eventTurn: turn,
            openStep,
            endedStep: step,
          });
        }
        openStep = null;
        break;
      }
      case "assistant/chunk": {
        const chunk = event.data.chunk;
        if (!isRecord(chunk)) break;
        if (chunk.type === "usage" && isRecord(chunk.usage)) {
          usageState(
            safeInteger(event.data.turn),
            safeInteger(event.data.step),
          ).chunks.push(chunk.usage);
        }
        if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") {
          const text = safeString(chunk.text);
          if (text === null) break;
          outputChunks += 1;
          outputChars += text.length;
          if (streamTextBytes < 2_000_000) {
            streamText.push(text);
            streamTextBytes += Buffer.byteLength(text);
          }
        }
        break;
      }
      case "assistant/message": {
        if (isRecord(event.data.usage)) {
          usageState(
            safeInteger(event.data.turn),
            safeInteger(event.data.step),
          ).messages.push(event.data.usage);
        }
        timeline.push(
          timelineEntry(
            event,
            "output",
            event.data.interrupted === true ? "Output interrupted" : "Output committed",
            event.data.interrupted === true ? "attention" : "success",
          ),
        );
        break;
      }
      case "tool/call": {
        toolCallCount += 1;
        const callId = safeString(event.data.callId);
        const name = safeMetadataLabel(event.data.name, "private-tool") ?? "unknown-tool";
        if (callId !== null) {
          if (calls.has(callId)) {
            addAnomaly("duplicate-tool-call-id", "critical", seq, {
              callIdHash: shortHash(callId),
            });
          }
          calls.set(callId, { seq, time, name });
        }
        timeline.push(timelineEntry(event, "tool", name));
        break;
      }
      case "tool/result": {
        const callId = resultCallId(event);
        if (callId === null || !calls.has(callId)) {
          addAnomaly("tool-result-without-call", "critical", seq, {
            callIdHash: callId === null ? null : shortHash(callId),
          });
        } else {
          const call = calls.get(callId);
          calls.delete(callId);
          timeline.push(
            timelineEntry(
              event,
              "tool",
              `${call.name} ${event.data.error ? "failed" : "returned"}`,
              event.data.error ? "attention" : "success",
            ),
          );
        }
        break;
      }
      case "approval/asked": {
        approvalCount += 1;
        const id = safeString(event.data.id);
        const toolName = safeMetadataLabel(event.data.toolName, "private-tool") ?? "unknown-tool";
        if (id !== null) approvals.set(id, { seq, time, toolName });
        timeline.push(timelineEntry(event, "approval", `${toolName} asked`, "attention"));
        break;
      }
      case "approval/decided": {
        const id = safeString(event.data.id);
        const rawOutcome = safeString(event.data.outcome);
        const outcome = ["allowed-once", "rejected", "cancelled", "unavailable"].includes(rawOutcome)
          ? rawOutcome
          : "unknown";
        const pending = id === null ? null : approvals.get(id);
        if (pending === null || pending === undefined) {
          addAnomaly("approval-decision-without-ask", "critical", seq, {
            approvalIdHash: id === null ? null : shortHash(id),
          });
        } else {
          approvals.delete(id);
        }
        timeline.push(
          timelineEntry(
            event,
            "approval",
            `Approval ${outcome}`,
            outcome === "allowed-once" ? "success" : "attention",
          ),
        );
        break;
      }
      default:
        break;
    }
  }

  if (openStep !== null) {
    addAnomaly("open-step-at-capture-end", "attention", null, { openStep });
  }
  if (openTurn !== null) {
    addAnomaly("open-turn-at-capture-end", "attention", null, { openTurn });
  }
  for (const [callId, call] of calls) {
    addAnomaly("tool-call-without-result", "attention", call.seq, {
      callIdHash: shortHash(callId),
      toolName: call.name,
      ageMs: Math.max(0, captureEndTime - call.time),
    });
  }
  for (const [id, approval] of approvals) {
    const ageMs = Math.max(0, captureEndTime - approval.time);
    if (ageMs >= thresholds.approvalStallMs) {
      addAnomaly("approval-stalled", "attention", approval.seq, {
        approvalIdHash: shortHash(id),
        toolName: approval.toolName,
        ageMs,
      });
    }
  }
  if (outputChunks >= thresholds.outputChunkWarning || outputChars >= thresholds.outputCharWarning) {
    addAnomaly("output-runaway", "attention", null, {
      outputChunks,
      outputChars,
    });
  }
  const maximumRepeatedWindows = repeatedWindowCount(streamText.join(""), thresholds);
  if (maximumRepeatedWindows >= thresholds.repetitionWindowCount) {
    addAnomaly("output-repetition-loop", "attention", null, {
      repeatedWindowCount: maximumRepeatedWindows,
      windowChars: thresholds.repetitionWindowChars,
      outputChars,
    });
  }

  anomalies.sort(
    (left, right) =>
      severityRank(right.severity) - severityRank(left.severity) ||
      (left.eventSeq ?? Number.MAX_SAFE_INTEGER) -
        (right.eventSeq ?? Number.MAX_SAFE_INTEGER),
  );
  const highestSeverity = anomalies.reduce(
    (highest, anomaly) => Math.max(highest, severityRank(anomaly.severity)),
    0,
  );
  const firstTime = events.length > 0 ? safeInteger(events[0]?.time) : null;
  const lastTime = events.length > 0 ? safeInteger(events.at(-1)?.time) : null;
  const usageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  };
  for (const state of usageByStep.values()) {
    const records = state.chunks.length > 0 ? state.chunks : state.messages;
    for (const usage of records) addUsage(usageTotals, usage);
  }

  return Object.freeze({
    schema: BLACKBOX_REPORT_SCHEMA,
    status: highestSeverity === 2 ? "critical" : highestSeverity === 1 ? "attention" : "healthy",
    summary: Object.freeze({
      eventCount: events.length,
      turnCount: turns.size,
      stepCount: steps.size,
      toolCallCount,
      approvalCount,
      outputChunks,
      outputChars,
      ...usageTotals,
      durationMs:
        firstTime === null || lastTime === null ? 0 : Math.max(0, lastTime - firstTime),
      agentPreset: safeMetadataLabel(header.agentPreset, "private-preset"),
    }),
    anomalies: Object.freeze(anomalies),
    timeline: Object.freeze(timeline),
  });
}
