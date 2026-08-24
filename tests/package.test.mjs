import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runNode(args, cwd) {
  return spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
}

function runNpm(args, cwd) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath is required for the packed-install test");
  return runNode([npmCli, ...args], cwd);
}

test("the published tarball installs, exports, resolves types/schema, and runs its CLI", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "eversko-dsh-blackbox-package-test-"));
  const consumer = join(root, "consumer");
  try {
    const packed = runNpm(
      ["pack", "--json", "--ignore-scripts", "--pack-destination", root],
      packageRoot,
    );
    assert.equal(packed.status, 0, packed.stderr);
    const packJson = JSON.parse(packed.stdout);
    const packResult = Array.isArray(packJson) ? packJson[0] : packJson["@eversko/dsh-blackbox"];
    assert.ok(packResult, "npm pack --json did not return package metadata");
    const included = new Set(packResult.files.map((file) => file.path));
    for (const required of [
      "bin/dsh-blackbox.mjs",
      "schemas/dshpack.schema.json",
      "src/index.d.mts",
      "src/index.mjs",
      "SECURITY.md",
      "THIRD_PARTY_NOTICES.md",
    ]) {
      assert.equal(included.has(required), true, `${required} is missing from the tarball`);
    }
    assert.equal([...included].some((path) => path.startsWith("tests/")), false);

    await writeFile(
      join(root, "consumer-package.json"),
      `${JSON.stringify({ name: "blackbox-install-probe", private: true, type: "module" })}\n`,
      "utf8",
    );
    const makeConsumer = runNode(
      [
        "-e",
        "const fs=require('node:fs'); fs.mkdirSync(process.argv[1]); fs.copyFileSync(process.argv[2], process.argv[1] + '/package.json')",
        consumer,
        join(root, "consumer-package.json"),
      ],
      root,
    );
    assert.equal(makeConsumer.status, 0, makeConsumer.stderr);

    const tarball = join(root, packResult.filename);
    const installed = runNpm(
      ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"],
      consumer,
    );
    assert.equal(installed.status, 0, installed.stderr);

    const imported = runNode(
      [
        "--input-type=module",
        "-e",
        [
          "import { BLACKBOX_PACK_SCHEMA } from '@eversko/dsh-blackbox';",
          "import { name } from '@eversko/dsh-blackbox/plugin';",
          "import { createRequire } from 'node:module';",
          "const require = createRequire(import.meta.url);",
          "if (BLACKBOX_PACK_SCHEMA !== 'eversko.dsh-blackbox.pack.v1') process.exit(2);",
          "if (name !== 'eversko-dsh-blackbox') process.exit(3);",
          "process.stdout.write(require.resolve('@eversko/dsh-blackbox/schema'));",
        ].join(""),
      ],
      consumer,
    );
    assert.equal(imported.status, 0, imported.stderr);
    assert.match(imported.stdout, /dshpack\.schema\.json$/u);

    const installedRoot = join(consumer, "node_modules", "@eversko", "dsh-blackbox");
    await access(join(installedRoot, "src", "index.d.mts"));
    const version = runNode([join(installedRoot, "bin", "dsh-blackbox.mjs"), "--version"], consumer);
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), "0.1.2");
    const npmExecVersion = runNpm(["exec", "--", "dsh-blackbox", "--version"], consumer);
    assert.equal(npmExecVersion.status, 0, npmExecVersion.stderr);
    assert.equal(npmExecVersion.stdout.trim(), "0.1.2");
    const installedManifest = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
    assert.equal(installedManifest.publishConfig.provenance, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
