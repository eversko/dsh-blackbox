import {
  analyzeSession,
  createBlackBoxPack,
  DEFAULT_ARTIFACT_LIMITS,
  type BlackBoxPack,
  type BlackBoxReport,
} from "@eversko/dsh-blackbox";
import {
  apply,
  type BlackBoxPluginConfig,
  type BlackBoxPluginContext,
} from "@eversko/dsh-blackbox/plugin";

const report: BlackBoxReport = analyzeSession({ header: {}, events: [] });
const pack: BlackBoxPack = createBlackBoxPack({ report });
const config: BlackBoxPluginConfig = { outputRoot: "/private/blackbox" };
declare const context: BlackBoxPluginContext;

apply(context, config);
void pack.schema;
void DEFAULT_ARTIFACT_LIMITS.maxDecodedBytes;
