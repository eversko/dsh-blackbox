import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(packageRoot, "bin/dsh-blackbox.mjs");

test("the CLI emits a shareable report and never replaces evidence implicitly", async () => {
  const root = await mkdtemp(join(tmpdir(), "eversko-dsh-blackbox-cli-"));
  try {
    const artifact = join(root, "session.jsonl");
    const jsonOutput = join(root, "incident.dshpack.json");
    const markdownOutput = join(root, "incident.md");
    const secret = "CLI PRIVATE CONTENT 5582";
    await writeFile(
      artifact,
      [
        JSON.stringify({
          type: "session",
          version: 0,
          id: "cli-private-id",
          cwd: "C:/cli/private",
          createdAt: 1_000,
          agentPreset: "skocase",
        }),
        JSON.stringify({ type: "turn/start", seq: 0, time: 1_000, data: { turn: 1 } }),
        JSON.stringify({
          type: "user/message",
          seq: 1,
          time: 1_010,
          data: { role: "user", content: [{ type: "text", text: secret }] },
        }),
        JSON.stringify({
          type: "turn/end",
          seq: 2,
          time: 1_020,
          data: { turn: 1, reason: { kind: "completed" } },
        }),
        "",
      ].join("\n"),
    );
    const result = spawnSync(
      process.execPath,
      [cli, artifact, "--runtime", "0.1.1-rc.2", "--json", jsonOutput, "--markdown", markdownOutput],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const json = await readFile(jsonOutput, "utf8");
    const markdown = await readFile(markdownOutput, "utf8");
    assert.equal(json.includes(secret), false);
    assert.equal(markdown.includes(secret), false);
    assert.match(markdown, /Status:\*\* HEALTHY/u);

    const repeat = spawnSync(
      process.execPath,
      [cli, artifact, "--json", jsonOutput],
      { encoding: "utf8" },
    );
    assert.equal(repeat.status, 1);
    assert.match(repeat.stderr, /EEXIST|file already exists/u);

    const version = spawnSync(process.execPath, [cli, "--version"], { encoding: "utf8" });
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), "0.1.1");

    const secondJson = join(root, "second.dshpack.json");
    const occupiedMarkdown = join(root, "occupied.md");
    await writeFile(occupiedMarkdown, "existing evidence", "utf8");
    const preflight = spawnSync(
      process.execPath,
      [cli, artifact, "--json", secondJson, "--markdown", occupiedMarkdown],
      { encoding: "utf8" },
    );
    assert.equal(preflight.status, 1);
    await assert.rejects(() => readFile(secondJson), { code: "ENOENT" });
    assert.equal(await readFile(occupiedMarkdown, "utf8"), "existing evidence");

    const sameOutput = spawnSync(
      process.execPath,
      [cli, artifact, "--json", secondJson, "--markdown", secondJson],
      { encoding: "utf8" },
    );
    assert.equal(sameOutput.status, 1);
    assert.match(sameOutput.stderr, /different paths/u);

    const originalArtifact = await readFile(artifact, "utf8");
    const sourceReplacement = spawnSync(
      process.execPath,
      [cli, artifact, "--json", artifact, "--force"],
      { encoding: "utf8" },
    );
    assert.equal(sourceReplacement.status, 1);
    assert.match(sourceReplacement.stderr, /must not replace the source artifact/u);
    assert.equal(await readFile(artifact, "utf8"), originalArtifact);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
