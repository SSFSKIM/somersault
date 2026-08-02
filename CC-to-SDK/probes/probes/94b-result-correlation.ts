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
  if (!first || first.subtype !== "success" || first.isError || (first.apiErrorStatus ?? 0) >= 400 || first.unhealthyText || first.origin !== "human" || first.userMessageAssociation !== "first") failures.push("invalid_first_result");
  if (!second || second.subtype !== "success" || second.isError || (second.apiErrorStatus ?? 0) >= 400 || second.unhealthyText) failures.push("invalid_second_result");
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
  mkdirSync(cwd); mkdirSync(config);
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
      persistSession: false,
      maxTurns: 4,
      abortController,
      env: { ...process.env, CLAUDE_CONFIG_DIR: config },
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
      const texts = [frame.result, ...(Array.isArray(frame.errors) ? frame.errors : [])];
      results.push({
        index: results.length + 1,
        subtype: typeof frame.subtype === "string" ? frame.subtype : "missing",
        origin: frame.origin?.kind === "human" || frame.origin?.kind === "auto-continuation" ? frame.origin.kind : frame.origin?.kind == null ? "absent" : "other",
        userMessageAssociation: ownedBy,
        isError: frame.is_error === true,
        ...(typeof frame.api_error_status === "number" ? { apiErrorStatus: frame.api_error_status } : {}),
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
  const baseFirst: ObservedResult = { index: 1, subtype: "success", origin: "human", userMessageAssociation: "first", isError: false, unhealthyText: false, resultKind: "string", compactLifecycleSeen: false };
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
