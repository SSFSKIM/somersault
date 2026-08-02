// Probe 94b — SDK 0.3.220 result-correlation edge cases for Session waiters.
// Output is structural and privacy-safe: no prompts, prose, paths, IDs, session IDs, or credentials.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

type CaseId = "human-compact" | "automatic-normal" | "automatic-compact";
type SubmittedOrigin = "human" | "auto-continuation";
type Association = "first" | "second" | "other" | "missing";
type ApiProvider = "firstParty" | "missing" | "other";
type ObservedResult = {
  index: number;
  validShape: boolean;
  subtype: string;
  origin: SubmittedOrigin | "absent" | "other";
  userMessageAssociation: Association;
  isError: boolean;
  apiErrorStatus?: number;
  unhealthyText: boolean;
  resultKind: string;
  compactLifecycleSeen: boolean;
};
type CaseOutcome = {
  caseId: CaseId;
  apiProvider: ApiProvider;
  secondOrigin: SubmittedOrigin;
  secondMode: "normal" | "compact";
  results: ObservedResult[];
  systemMarkers: string[];
  failures: string[];
};

const PROBE_VERSION = "94b";
const EXPECTED_SDK_VERSION = "0.3.220";
const MODEL_ALIAS = "fable";
const CASE_TIMEOUT_MS = 600_000;
const CASE_IDS: CaseId[] = ["human-compact", "automatic-normal", "automatic-compact"];
const RESULT_ORIGIN_KINDS = new Set([
  "human", "channel", "peer", "task-notification", "coordinator", "observer",
  "auto-continuation", "observer-activity",
]);
// SDKResultMessage = SDKResultSuccess | SDKResultError. The error arm declares `errors` and no `result`.
const RESULT_ERROR_SUBTYPES = new Set([
  "error_during_execution", "error_max_turns", "error_max_budget_usd", "error_max_structured_output_retries",
]);
const ALTERNATE_PROVIDER_ENV_VARS = [
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_VERTEX",
] as const;

function sdkVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../node_modules/@anthropic-ai/claude-agent-sdk/package.json", import.meta.url), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

function resolvedApiProvider(initialization: unknown): ApiProvider {
  const record = initialization !== null && typeof initialization === "object" ? initialization as Record<string, unknown> : undefined;
  const account = record?.account !== null && typeof record?.account === "object" ? record.account as Record<string, unknown> : undefined;
  if (account?.apiProvider === "firstParty") return "firstParty";
  return account?.apiProvider == null ? "missing" : "other";
}

function probeTempParent(): string {
  const parent = process.env.CLAUDE_JOB_DIR ? join(process.env.CLAUDE_JOB_DIR, "tmp") : tmpdir();
  mkdirSync(parent, { recursive: true });
  return parent;
}

function isolatedProbeEnv(env: NodeJS.ProcessEnv, root: string, config: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const name of ["COLORTERM", "COMSPEC", "LANG", "LC_ALL", "LC_CTYPE", "LOGNAME", "PATH", "PATHEXT", "SHELL", "SystemRoot", "TERM", "USER", "WINDIR"]) {
    if (env[name]) result[name] = env[name];
  }
  result.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN;
  result.CLAUDE_CONFIG_DIR = config;
  result.HOME = root;
  result.USERPROFILE = root;
  const privateTmp = join(root, "tmp");
  result.TMPDIR = privateTmp;
  result.TEMP = privateTmp;
  result.TMP = privateTmp;
  return result;
}

function oauthEnvironmentFailure(env: NodeJS.ProcessEnv): string | undefined {
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return "non_oauth_credentials_present";
  if (!env.CLAUDE_CODE_OAUTH_TOKEN) return "oauth_token_missing";
  if (ALTERNATE_PROVIDER_ENV_VARS.some((key) => env[key])) return "alternate_provider_route_present";
  return undefined;
}

function userTurn(uuid: ReturnType<typeof randomUUID>, content: string, origin: SubmittedOrigin): SDKUserMessage {
  return { type: "user", uuid, origin: { kind: origin }, parent_tool_use_id: null, message: { role: "user", content } };
}

function association(value: unknown, firstUuid: string, secondUuid: string): Association {
  if (value === firstUuid) return "first";
  if (value === secondUuid) return "second";
  return typeof value === "string" && value.length > 0 ? "other" : "missing";
}

function resultKind(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function unhealthyResultText(value: unknown): boolean {
  return typeof value === "string" && /^\s*API Error:/i.test(value);
}

function safeResultSubtype(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_:-]{1,80}$/.test(value) ? value : "unknown";
}

function finiteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function plainRecord(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Validate the whole declared union, not a lowest common denominator: a sparse frame carrying only
// subtype/is_error/result is not a terminal result, and an error frame legitimately has no `result`.
function validResultFrameShape(frame: Record<string, any>): boolean {
  if (typeof frame.subtype !== "string" || typeof frame.is_error !== "boolean") return false;
  if (!finiteNumber(frame.duration_ms) || !finiteNumber(frame.duration_api_ms)) return false;
  if (!finiteNumber(frame.num_turns) || !finiteNumber(frame.total_cost_usd)) return false;
  if (frame.stop_reason !== null && typeof frame.stop_reason !== "string") return false;
  if (!plainRecord(frame.usage) || !plainRecord(frame.modelUsage) || !Array.isArray(frame.permission_denials)) return false;
  if (typeof frame.uuid !== "string" || frame.uuid.length === 0) return false;
  if (typeof frame.session_id !== "string" || frame.session_id.length === 0) return false;
  if (Object.hasOwn(frame, "origin")) {
    if (!plainRecord(frame.origin) || typeof frame.origin.kind !== "string" || !RESULT_ORIGIN_KINDS.has(frame.origin.kind)) return false;
  }
  if (frame.subtype === "success") {
    if (typeof frame.result !== "string") return false;
    if (Object.hasOwn(frame, "api_error_status") && frame.api_error_status !== null && !finiteNumber(frame.api_error_status)) return false;
    return !Object.hasOwn(frame, "user_message_uuid") || (typeof frame.user_message_uuid === "string" && frame.user_message_uuid.length > 0);
  }
  if (!RESULT_ERROR_SUBTYPES.has(frame.subtype)) return false;
  if (!Array.isArray(frame.errors) || frame.errors.some((value: unknown) => typeof value !== "string")) return false;
  return !Object.hasOwn(frame, "result") || typeof frame.result === "string";
}

function compactLifecycleMarker(frame: Record<string, any>, secondSubmitted: boolean): "status:compacting" | "compact_boundary" | undefined {
  if (!secondSubmitted || frame.type !== "system") return undefined;
  if (frame.subtype === "status" && frame.status === "compacting") return "status:compacting";
  if (frame.subtype === "compact_boundary") return "compact_boundary";
  return undefined;
}

function expectedFailures(outcome: Omit<CaseOutcome, "failures">): string[] {
  const failures: string[] = [];
  if (outcome.apiProvider !== "firstParty") failures.push("unexpected_api_provider");
  if (outcome.results.length !== 2) failures.push("expected_exactly_two_results");
  const first = outcome.results[0];
  const second = outcome.results[1];
  if (!first || !first.validShape || first.subtype !== "success" || first.isError || (first.apiErrorStatus ?? 0) >= 400 || first.unhealthyText || first.origin !== "human" || first.userMessageAssociation !== "first") failures.push("invalid_first_result");
  if (!second || !second.validShape || second.subtype !== "success" || second.isError || (second.apiErrorStatus ?? 0) >= 400 || second.unhealthyText) failures.push("invalid_second_result");
  if (outcome.caseId === "human-compact") {
    if (!second || second.origin !== "human" || second.userMessageAssociation !== "missing") failures.push("invalid_human_compact_correlation");
    if (!second?.compactLifecycleSeen) failures.push("missing_human_compact_lifecycle");
  } else if (outcome.caseId === "automatic-normal") {
    if (!second || second.origin !== "absent" || second.userMessageAssociation !== "second") failures.push("invalid_automatic_normal_correlation");
    if (second?.compactLifecycleSeen) failures.push("unexpected_automatic_normal_compact_lifecycle");
  } else {
    if (!second || second.origin !== "absent" || second.userMessageAssociation !== "missing") failures.push("invalid_automatic_compact_correlation");
    if (!second?.compactLifecycleSeen) failures.push("missing_automatic_compact_lifecycle");
  }
  return failures;
}

async function runCase(caseId: CaseId): Promise<CaseOutcome> {
  const root = mkdtempSync(join(probeTempParent(), "p94b-result-correlation-"));
  const cwd = join(root, "repo"), config = join(root, "config");
  mkdirSync(cwd); mkdirSync(config); mkdirSync(join(root, "tmp"));
  const probeEnv = isolatedProbeEnv(process.env, root, config);
  const firstUuid = randomUUID(), secondUuid = randomUUID();
  const secondOrigin: SubmittedOrigin = caseId === "human-compact" ? "human" : "auto-continuation";
  const secondMode: "normal" | "compact" = caseId === "automatic-normal" ? "normal" : "compact";
  let releaseSecond!: () => void;
  let secondSubmitted = false;
  const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
  async function* prompts(): AsyncIterable<SDKUserMessage> {
    yield userTurn(firstUuid, "Reply with exactly OK and nothing else.", "human");
    await secondGate;
    secondSubmitted = true;
    yield userTurn(secondUuid, secondMode === "compact" ? "/compact" : "Reply with exactly OK and nothing else.", secondOrigin);
  }

  const results: ObservedResult[] = [], systemMarkers: string[] = [];
  let compactLifecycleSeen = false;
  let apiProvider: ApiProvider = "missing";
  let stream: ReturnType<typeof query> | undefined;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), CASE_TIMEOUT_MS);
  try {
    stream = query({ prompt: prompts(), options: {
      model: MODEL_ALIAS,
      effort: "low",
      cwd,
      permissionMode: "bypassPermissions",
      settingSources: [],
      tools: [],
      skills: [],
      persistSession: false,
      maxTurns: 4,
      abortController,
      env: probeEnv,
    } });
    apiProvider = resolvedApiProvider(await stream.initializationResult());
    for await (const message of stream) {
      const frame = message as Record<string, any>;
      const compactMarker = compactLifecycleMarker(frame, secondSubmitted);
      if (compactMarker) {
        compactLifecycleSeen = true;
        systemMarkers.push(compactMarker);
      } else if (frame.type === "system" && typeof frame.subtype === "string" && !systemMarkers.includes(frame.subtype)) {
        systemMarkers.push(frame.subtype);
      }
      if (frame.type !== "result") continue;
      const ownedBy = association(frame.user_message_uuid, firstUuid, secondUuid);
      const validShape = validResultFrameShape(frame);
      const texts = [frame.result, ...(Array.isArray(frame.errors) ? frame.errors : [])];
      results.push({
        index: results.length + 1,
        validShape,
        subtype: safeResultSubtype(frame.subtype),
        origin: frame.origin?.kind === "human" || frame.origin?.kind === "auto-continuation" ? frame.origin.kind : frame.origin?.kind == null ? "absent" : "other",
        userMessageAssociation: ownedBy,
        isError: frame.is_error === true,
        ...(finiteNumber(frame.api_error_status) ? { apiErrorStatus: frame.api_error_status as number } : {}),
        unhealthyText: texts.some(unhealthyResultText),
        resultKind: resultKind(frame.result),
        compactLifecycleSeen,
      });
      if (ownedBy === "first") releaseSecond();
    }
    const partial = { caseId, apiProvider, secondOrigin, secondMode, results, systemMarkers };
    return { ...partial, failures: expectedFailures(partial) };
  } catch (error) {
    const kind = error instanceof Error && error.name === "AbortError" ? "timeout" : "query_failure";
    return { caseId, apiProvider, secondOrigin, secondMode, results, systemMarkers, failures: [kind] };
  } finally {
    clearTimeout(timeout);
    stream?.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function selfTest(): void {
  const baseFirst: ObservedResult = { index: 1, validShape: true, subtype: "success", origin: "human", userMessageAssociation: "first", isError: false, unhealthyText: false, resultKind: "string", compactLifecycleSeen: false };
  const outcome = (caseId: CaseId, second: ObservedResult): Omit<CaseOutcome, "failures"> => ({
    caseId,
    apiProvider: "firstParty",
    secondOrigin: caseId === "human-compact" ? "human" : "auto-continuation",
    secondMode: caseId === "automatic-normal" ? "normal" : "compact",
    results: [baseFirst, second],
    systemMarkers: second.compactLifecycleSeen ? ["status:compacting"] : ["init"],
  });
  assert.deepEqual(expectedFailures(outcome("human-compact", { ...baseFirst, index: 2, userMessageAssociation: "missing", compactLifecycleSeen: true })), []);
  assert.deepEqual(expectedFailures(outcome("automatic-normal", { ...baseFirst, index: 2, origin: "absent", userMessageAssociation: "second" })), []);
  assert.deepEqual(expectedFailures(outcome("automatic-compact", { ...baseFirst, index: 2, origin: "absent", userMessageAssociation: "missing", compactLifecycleSeen: true })), []);
  assert.equal(expectedFailures(outcome("automatic-normal", { ...baseFirst, index: 2, origin: "absent", userMessageAssociation: "missing" })).includes("invalid_automatic_normal_correlation"), true);
  assert.equal(expectedFailures(outcome("automatic-normal", { ...baseFirst, index: 2, origin: "absent", userMessageAssociation: "second", apiErrorStatus: 401 })).includes("invalid_second_result"), true);
  assert.equal(expectedFailures(outcome("automatic-normal", { ...baseFirst, index: 2, origin: "absent", userMessageAssociation: "second", unhealthyText: true })).includes("invalid_second_result"), true);
  assert.equal(unhealthyResultText("API Error: 401"), true);
  assert.equal(unhealthyResultText("completed normally"), false);
  // Terminal frames carry every field SDKResultSuccess/SDKResultError declare; `omit` drops a key
  // outright, which is distinct from setting it to undefined.
  const resultFrame = (extra: Record<string, any> = {}, omit: string[] = []): Record<string, any> => {
    const frame: Record<string, any> = {
      type: "result", subtype: "success", is_error: false, duration_ms: 12, duration_api_ms: 8, num_turns: 1,
      stop_reason: null, total_cost_usd: 0.01, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: {},
      permission_denials: [], uuid: "result-uuid", session_id: "session-id", result: "done", ...extra,
    };
    for (const key of omit) delete frame[key];
    return frame;
  };
  assert.equal(validResultFrameShape(resultFrame({ api_error_status: null, origin: { kind: "human" }, user_message_uuid: "turn" })), true);
  // A UUID-less compact success is the shape the compact route actually returns.
  assert.equal(validResultFrameShape(resultFrame()), true);
  assert.equal(validResultFrameShape(resultFrame({ subtype: "error_max_turns", is_error: true, errors: ["hit the cap"] }, ["result"])), true);
  assert.equal(validResultFrameShape(resultFrame({ subtype: "error_max_turns", is_error: true }, ["result"])), false);
  assert.equal(validResultFrameShape(resultFrame({ subtype: "surprise", errors: ["x"] }, ["result"])), false);
  assert.equal(validResultFrameShape({ subtype: "success", is_error: false, result: "done" }), false);
  for (const missing of ["duration_ms", "duration_api_ms", "num_turns", "total_cost_usd", "usage", "modelUsage", "permission_denials", "uuid", "session_id", "result"]) {
    assert.equal(validResultFrameShape(resultFrame({}, [missing])), false);
  }
  for (const status of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "401"]) {
    assert.equal(validResultFrameShape(resultFrame({ api_error_status: status })), false);
  }
  assert.equal(validResultFrameShape(resultFrame({ origin: "human" })), false);
  assert.equal(validResultFrameShape(resultFrame({ origin: { kind: "invented" } })), false);
  assert.equal(validResultFrameShape(resultFrame({ user_message_uuid: "" })), false);
  assert.equal(validResultFrameShape(resultFrame({ result: {} })), false);
  assert.equal(expectedFailures(outcome("automatic-normal", { ...baseFirst, index: 2, validShape: false, origin: "absent", userMessageAssociation: "second" })).includes("invalid_second_result"), true);
  assert.equal(compactLifecycleMarker({ type: "system", subtype: "status", status: "compacting" }, false), undefined);
  assert.equal(compactLifecycleMarker({ type: "system", subtype: "status", status: "compacting" }, true), "status:compacting");
  assert.equal(compactLifecycleMarker({ type: "system", subtype: "compact_boundary" }, true), "compact_boundary");
  assert.equal(oauthEnvironmentFailure({ CLAUDE_CODE_OAUTH_TOKEN: "oauth" }), undefined);
  assert.equal(oauthEnvironmentFailure({}), "oauth_token_missing");
  assert.equal(oauthEnvironmentFailure({ CLAUDE_CODE_OAUTH_TOKEN: "oauth", ANTHROPIC_API_KEY: "api" }), "non_oauth_credentials_present");
  assert.equal(oauthEnvironmentFailure({ CLAUDE_CODE_OAUTH_TOKEN: "oauth", ANTHROPIC_AUTH_TOKEN: "auth" }), "non_oauth_credentials_present");
  for (const key of ALTERNATE_PROVIDER_ENV_VARS) {
    assert.equal(oauthEnvironmentFailure({ CLAUDE_CODE_OAUTH_TOKEN: "oauth", [key]: "enabled" }), "alternate_provider_route_present");
  }
  const isolatedRoot = join(probeTempParent(), "p94b-policy-root");
  const isolated = isolatedProbeEnv({ PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "oauth", GH_TOKEN: "github", ANTHROPIC_BASE_URL: "https://gateway.invalid" }, isolatedRoot, join(isolatedRoot, "config"));
  assert.equal(isolated.CLAUDE_CODE_OAUTH_TOKEN, "oauth");
  assert.equal(isolated.GH_TOKEN, undefined);
  assert.equal(isolated.ANTHROPIC_BASE_URL, undefined);
  assert.equal(isolated.HOME, isolatedRoot);
  assert.equal(sdkVersion(), EXPECTED_SDK_VERSION);
  assert.equal(resolvedApiProvider({ account: { apiProvider: "firstParty" } }), "firstParty");
  assert.equal(resolvedApiProvider({ account: { apiProvider: "vertex" } }), "other");
  assert.equal(resolvedApiProvider({}), "missing");
  assert.equal(expectedFailures({ ...outcome("automatic-normal", { ...baseFirst, index: 2, origin: "absent", userMessageAssociation: "second" }), apiProvider: "other" }).includes("unexpected_api_provider"), true);
  process.stdout.write("P94B SELF-TEST PASS\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--self-test") return selfTest();
  const caseArg = args.find((arg) => arg.startsWith("--case="));
  if (args.length > (caseArg ? 1 : 0) || args.some((arg) => !arg.startsWith("--case="))) {
    process.stdout.write(`${JSON.stringify({ probeVersion: PROBE_VERSION, status: "failed", error: "invalid_arguments" })}\n`);
    process.exitCode = 1;
    return;
  }
  const selected = caseArg?.slice("--case=".length) as CaseId | undefined;
  if (selected !== undefined && !CASE_IDS.includes(selected)) {
    process.stdout.write(`${JSON.stringify({ probeVersion: PROBE_VERSION, status: "failed", error: "invalid_case" })}\n`);
    process.exitCode = 1;
    return;
  }
  const actualSdkVersion = sdkVersion();
  if (actualSdkVersion !== EXPECTED_SDK_VERSION) {
    process.stdout.write(`${JSON.stringify({ probeVersion: PROBE_VERSION, status: "failed", error: "sdk_version_mismatch", expectedSdkVersion: EXPECTED_SDK_VERSION, actualSdkVersion })}\n`);
    process.exitCode = 1;
    return;
  }
  const environmentFailure = oauthEnvironmentFailure(process.env);
  if (environmentFailure) {
    process.stdout.write(`${JSON.stringify({ probeVersion: PROBE_VERSION, status: "failed", error: environmentFailure })}\n`);
    process.exitCode = 1;
    return;
  }
  const outcomes: CaseOutcome[] = [];
  for (const caseId of selected !== undefined ? [selected] : CASE_IDS) outcomes.push(await runCase(caseId));
  const failures = outcomes.flatMap((outcome) => outcome.failures.map((kind) => ({ caseId: outcome.caseId, kind })));
  process.stdout.write(`${JSON.stringify({
    probeVersion: PROBE_VERSION,
    sdk: actualSdkVersion,
    modelAlias: MODEL_ALIAS,
    authentication: "claude-code-oauth",
    configuration: { tools: [], skills: [], settingSources: [], subprocessEnvironment: "minimal-oauth-only" },
    status: failures.length ? "failed" : "completed",
    outcomes,
    failures,
  })}\n`);
  if (failures.length) process.exitCode = 1;
}

try {
  await main();
} catch {
  process.stdout.write(`${JSON.stringify({ probeVersion: PROBE_VERSION, status: "failed", error: "unexpected_failure" })}\n`);
  process.exitCode = 1;
}
