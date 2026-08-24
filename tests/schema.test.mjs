import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { analyzeSession, createBlackBoxPack } from "../src/index.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the public JSON Schema accepts an emitted pack and rejects privacy drift", async () => {
  const schema = JSON.parse(
    await readFile(resolve(packageRoot, "schemas/dshpack.schema.json"), "utf8"),
  );
  const validate = new Ajv2020({ strict: true, allowUnionTypes: true }).compile(schema);
  const report = analyzeSession({
    header: { id: "schema-session", cwd: "C:/private/schema", createdAt: 1_000 },
    events: [],
  });
  const pack = createBlackBoxPack({
    header: { id: "schema-session", cwd: "C:/private/schema", createdAt: 1_000 },
    report,
    generatedAt: 1_000,
  });
  assert.equal(validate(pack), true, JSON.stringify(validate.errors));

  const privacyDrift = structuredClone(pack);
  privacyDrift.privacy.contentIncluded = true;
  assert.equal(validate(privacyDrift), false);
});
