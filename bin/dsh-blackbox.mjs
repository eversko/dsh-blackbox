#!/usr/bin/env node

import { lstat, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  analyzeSession,
  createBlackBoxPack,
  readSessionArtifact,
  renderBlackBoxMarkdown,
} from "../src/index.mjs";

function usage() {
  return [
    "Usage: dsh-blackbox <session.jsonl|session.jsonl.zstd> [options]",
    "",
    "Options:",
    "  --runtime <version>   Record the DSH runtime version.",
    "  --json <path>         Write the metadata-only .dshpack JSON.",
    "  --markdown <path>     Write a shareable Markdown report.",
    "  --force               Replace explicitly named output files.",
    "  --version             Show the package version.",
    "  --help                Show this help.",
    "",
    "Exit codes: 0 no critical finding; 1 command/artifact error; 2 critical finding.",
  ].join("\n");
}

function parseArgs(argv) {
  if (argv.includes("--help")) return { help: true };
  if (argv.includes("--version")) {
    if (argv.length !== 1) throw new Error("--version cannot be combined with other arguments");
    return { version: true };
  }
  const result = { input: null, runtimeVersion: null, json: null, markdown: null, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--force") {
      result.force = true;
    } else if (["--runtime", "--json", "--markdown"].includes(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      if (argument === "--runtime") result.runtimeVersion = value;
      if (argument === "--json") result.json = value;
      if (argument === "--markdown") result.markdown = value;
    } else if (argument.startsWith("--")) {
      throw new Error(`unknown option: ${argument}`);
    } else if (result.input === null) {
      result.input = argument;
    } else {
      throw new Error("only one session artifact may be analyzed at a time");
    }
  }
  if (result.input === null) throw new Error("a session artifact is required");
  return result;
}

async function inspectPath(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function preflightOutputs(input, options) {
  const inputPath = resolve(input);
  const outputs = [
    ...(options.json ? [["JSON", resolve(options.json)]] : []),
    ...(options.markdown ? [["Markdown", resolve(options.markdown)]] : []),
  ];
  if (outputs.length === 2 && outputs[0][1] === outputs[1][1]) {
    throw new Error("JSON and Markdown outputs must use different paths");
  }
  for (const [label, outputPath] of outputs) {
    if (outputPath === inputPath) {
      throw new Error(`${label} output must not replace the source artifact`);
    }
    const parent = await inspectPath(dirname(outputPath));
    if (parent === null || !parent.isDirectory()) {
      throw new Error(`${label} output directory does not exist`);
    }
    const target = await inspectPath(outputPath);
    if (target?.isSymbolicLink()) {
      throw new Error(`${label} output must not be a symbolic link`);
    }
    if (target !== null && !target.isFile()) {
      throw new Error(`${label} output must be a regular file`);
    }
    if (target !== null && !options.force) {
      const error = new Error(`${label} output file already exists`);
      error.code = "EEXIST";
      throw error;
    }
  }
  return Object.fromEntries(outputs.map(([label, path]) => [label.toLowerCase(), path]));
}

async function writeExplicit(path, content, force) {
  await writeFile(resolve(path), content, {
    encoding: "utf8",
    flag: force ? "w" : "wx",
    mode: 0o600,
  });
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    process.exitCode = 0;
  } else if (options.version) {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    process.stdout.write(`${manifest.version}\n`);
    process.exitCode = 0;
  } else {
    const inputPath = resolve(options.input);
    const outputPaths = await preflightOutputs(inputPath, options);
    const parsed = await readSessionArtifact(inputPath);
    const report = analyzeSession({ header: parsed.header, events: parsed.events });
    const pack = createBlackBoxPack({
      ...parsed,
      report,
      runtimeVersion: options.runtimeVersion,
      generatedAt: Date.now(),
    });
    const markdown = renderBlackBoxMarkdown(pack);
    if (options.json) {
      await writeExplicit(outputPaths.json, `${JSON.stringify(pack, null, 2)}\n`, options.force);
    }
    if (options.markdown) {
      await writeExplicit(outputPaths.markdown, markdown, options.force);
    }
    if (!options.json && !options.markdown) process.stdout.write(markdown);
    process.exitCode = report.status === "critical" ? 2 : 0;
  }
} catch (error) {
  process.stderr.write(`DSH Black Box: ${error instanceof Error ? error.message : "unknown error"}\n\n${usage()}\n`);
  process.exitCode = 1;
}
