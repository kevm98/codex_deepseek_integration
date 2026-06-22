#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");

const DEEPSEEK_PICKER_MODEL = "deepseek-v4-pro";
const DEEPSEEK_PICKER_MODELS = new Set([
  "deepseek-v4-pro",
  "deepseek-v4-flash",
]);
const DEEPSEEK_MODEL_DISPLAY_NAMES = {
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "deepseek-v4-flash": "DeepSeek V4 Flash",
};
const MOONBRIDGE_ROUTE_MODEL = "moonbridge";
const MOONBRIDGE_PROVIDER_ID = "moonbridge";
const MOONBRIDGE_BASE_URL = process.env.MOONBRIDGE_CODEX_BASE_URL || "http://127.0.0.1:38440/v1";

const MOONBRIDGE_PROVIDER_TOML =
  `model_providers.${MOONBRIDGE_PROVIDER_ID}={ name = "Moon Bridge", base_url = "${MOONBRIDGE_BASE_URL}", wire_api = "responses" }`;

const DISABLED_CONNECTOR_PLUGINS = [
  "gmail@openai-curated",
  "github@openai-curated",
  "google-drive@openai-curated",
];

const DEEPSEEK_AGENTIC_INSTRUCTIONS = `
DeepSeek Codex agentic operating rules:
- Treat implementation, debugging, review, install, and verification prompts as agent tasks. Gather context, make the needed changes, run the relevant checks, install updated runtime artifacts when the user asks, and stop only when the task is complete or genuinely blocked.
- Keep working across multiple tool calls. If the first command or test fails, inspect the failure, try the next reasonable diagnostic or narrower fix, and continue until you have a verified result.
- For non-trivial tasks, maintain an explicit plan or checklist, update it as work progresses, and use it to avoid stopping after partial progress.
- Prefer concrete repository evidence over guesses. Read the nearby code, docs, generated config, and runtime logs before deciding.
- Preserve normal GPT/OpenAI behavior. Only change DeepSeek/Moon Bridge routing or DeepSeek-specific configuration unless the user explicitly asks for broader changes.
- Before final output, verify the live path that matters: unit tests for wrapper changes, Codex CLI smoke tests for profile changes, and app-server probes for VS Code model-picker behavior.
- If the user asks to keep working until success, do not hand back a proposal when you can safely act. Implement, test, install, and report the exact remaining blocker only if external approval, credentials, or unavailable services prevent completion.
`.trim();

// Thread-listing method names that the app-server might use.
const THREAD_LIST_METHODS = new Set([
  "thread/list",
  "threads/list",
  "thread/search",
  "thread/listAll",
  "threads/search",
]);

const MODEL_LIST_METHODS = new Set([
  "model/list",
  "models/list",
  "model/listAll",
  "models/listAll",
  "model/search",
  "models/search",
]);

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function log(message) {
  process.stderr.write(`[codex-vscode-deepseek-bridge] ${message}\n`);
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findLatestVsCodeCodexBinary() {
  const extensionsDir = path.join(os.homedir(), ".vscode", "extensions");
  let entries = [];
  try {
    entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("openai.chatgpt-"))
    .map((entry) => {
      const dir = path.join(extensionsDir, entry.name);
      return {
        name: entry.name,
        codex: path.join(dir, "bin", "linux-x86_64", "codex"),
      };
    })
    .filter((candidate) => isExecutable(candidate.codex))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return candidates.length > 0 ? candidates[candidates.length - 1].codex : null;
}

function resolveRealCodexBinary() {
  const self = fs.realpathSync(process.argv[1]);
  const candidates = [
    process.env.CODEX_REAL_CLI,
    findLatestVsCodeCodexBinary(),
    path.join(os.homedir(), ".npm-global", "bin", "codex"),
    "codex",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate !== "codex") {
      try {
        if (fs.realpathSync(candidate) === self) {
          continue;
        }
      } catch {
        continue;
      }
      if (isExecutable(candidate)) {
        return candidate;
      }
      continue;
    }
    return candidate;
  }

  throw new Error("could not find a real Codex executable");
}

function parseJsonObject(text, source) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.models)) {
      throw new Error("expected top-level models array");
    }
    return parsed;
  } catch (error) {
    throw new Error(`failed to parse ${source}: ${error.message}`);
  }
}

function loadBundledCatalog(realCodex) {
  const result = spawnSync(realCodex, ["debug", "models", "--bundled"], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "codex debug models failed").trim());
  }

  return parseJsonObject(result.stdout, "bundled Codex model catalog");
}

function loadMoonBridgeCatalog(home = codexHome()) {
  const catalogPath = process.env.CODEX_MOONBRIDGE_MODEL_CATALOG || path.join(home, "models_catalog.json");
  if (!fs.existsSync(catalogPath)) {
    return null;
  }
  return parseJsonObject(fs.readFileSync(catalogPath, "utf8"), catalogPath);
}

// ---------------------------------------------------------------------------
// MoonBridge thread persistence: load threads from the local Codex state DB
// so they survive restarts even when the active provider is "openai".
// ---------------------------------------------------------------------------

let _moonBridgeThreadCache = null;
let _moonBridgeThreadCacheTs = 0;

function loadMoonBridgeThreads(home) {
  const now = Date.now();
  // Refresh cache at most every 30 seconds.
  if (_moonBridgeThreadCache && (now - _moonBridgeThreadCacheTs) < 30000) {
    return _moonBridgeThreadCache;
  }

  const stateDb = path.join(home, "state_5.sqlite");
  if (!fs.existsSync(stateDb)) {
    log(`state DB not found at ${stateDb}, skipping moonbridge thread injection`);
    _moonBridgeThreadCache = [];
    _moonBridgeThreadCacheTs = now;
    return _moonBridgeThreadCache;
  }

  const query = `
SELECT
  id,
  title,
  preview,
  created_at,
  updated_at,
  model,
  model_provider,
  source,
  cwd,
  archived,
  first_user_message,
  reasoning_effort,
  tokens_used
FROM threads
WHERE model_provider = 'moonbridge'
  AND archived = 0
  AND source = 'vscode'
ORDER BY updated_at DESC
LIMIT 200
`.replace(/\n/g, " ").trim();

  try {
    const result = spawnSync("python3", ["-c", `
import sqlite3, json, sys
db = '${stateDb.replace(/'/g, "\\'")}'
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
cur = conn.cursor()
cur.execute("""${query.replace(/"/g, '\\"')}""")
rows = [dict(r) for r in cur.fetchall()]
conn.close()
print(json.dumps(rows))
`], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 5000,
    });

    if (result.status !== 0 || !result.stdout.trim()) {
      log(`python3 query failed: ${result.stderr || result.stdout || 'empty output'}`);
      _moonBridgeThreadCache = [];
      _moonBridgeThreadCacheTs = now;
      return _moonBridgeThreadCache;
    }

    _moonBridgeThreadCache = JSON.parse(result.stdout.trim());
    _moonBridgeThreadCacheTs = now;
    log(`loaded ${_moonBridgeThreadCache.length} moonbridge threads from state DB`);
    return _moonBridgeThreadCache;
  } catch (err) {
    log(`failed to load moonbridge threads: ${err.message}`);
    _moonBridgeThreadCache = [];
    _moonBridgeThreadCacheTs = now;
    return _moonBridgeThreadCache;
  }
}

/**
 * Convert a DB thread row into a thread-list entry matching the
 * format the Codex UI expects. We use a minimal shape so the UI
 * can render thread cards and the bridge can rewrite on resume.
 */
function dbThreadToThreadEntry(t) {
  return {
    id: t.id,
    title: t.title || "",
    preview: t.preview || t.first_user_message || "",
    created_at: t.created_at,
    updated_at: t.updated_at,
    model: t.model || DEEPSEEK_PICKER_MODEL,
    model_provider: t.model_provider || MOONBRIDGE_PROVIDER_ID,
    source: t.source || "vscode",
    cwd: t.cwd || "",
    archived: !!t.archived,
    reasoning_effort: t.reasoning_effort || "high",
    tokens_used: t.tokens_used || 0,
  };
}

/**
 * Returns true when `obj` looks like an array of thread-like objects.
 */
function looksLikeThreadList(obj) {
  if (!Array.isArray(obj) || obj.length === 0) return false;
  const first = obj[0];
  return first && typeof first === "object" && first !== null &&
    (typeof first.id === "string" || typeof first.thread_id === "string");
}

/**
 * Extract the thread array from a result object, handling common shapes:
 *   result                     (flat array)
 *   result.data                (envelope)
 *   result.threads
 *   result.items
 *   { threadList: [...] }
 * Returns null if no thread array found.
 */
function extractThreadArray(result) {
  if (!result || typeof result !== "object") return null;
  if (Array.isArray(result) && looksLikeThreadList(result)) return result;
  for (const key of ["data", "threads", "items", "threadList", "thread_list"]) {
    if (Array.isArray(result[key]) && looksLikeThreadList(result[key])) {
      return result[key];
    }
  }
  return null;
}

/**
 * Merge moonbridge threads into a thread-list response, deduplicating by id.
 */
function mergeMoonBridgeThreads(result, moonBridgeThreads) {
  if (!result || typeof result !== "object") return result;

  const threadArray = extractThreadArray(result);
  if (!threadArray) return result; // not a thread list

  const existing = new Set();
  for (const t of threadArray) {
    const tid = t.id || t.thread_id;
    if (tid) existing.add(tid);
  }

  let added = 0;
  for (const t of moonBridgeThreads) {
    if (existing.has(t.id)) continue;
    threadArray.push(dbThreadToThreadEntry(t));
    existing.add(t.id);
    added++;
  }

  if (added > 0) {
    log(`merged ${added} moonbridge threads into thread list (total now ${threadArray.length})`);
  }

  return result;
}

function deepSeekDisplayName(model) {
  return DEEPSEEK_MODEL_DISPLAY_NAMES[model] || model;
}

function cloneForPickerModel(source, model = DEEPSEEK_PICKER_MODEL) {
  const cloned = JSON.parse(JSON.stringify(source));
  cloned.slug = model;
  cloned.display_name = deepSeekDisplayName(model);
  cloned.description = `${deepSeekDisplayName(model)} via Moon Bridge`;
  cloned.visibility = "list";
  cloned.priority = Math.max(Number(source.priority || 0), 0);
  return cloned;
}

function fallbackMoonBridgeEntry(bundledCatalog) {
  const template =
    bundledCatalog.models.find((model) => model.slug === "gpt-5.5") ||
    bundledCatalog.models.find((model) => model.visibility === "list") ||
    bundledCatalog.models[0];

  if (!template) {
    throw new Error("bundled Codex model catalog is empty");
  }

  const entry = JSON.parse(JSON.stringify(template));
  entry.slug = MOONBRIDGE_ROUTE_MODEL;
  entry.display_name = "Moon Bridge";
  entry.description = "DeepSeek V4 Pro route through Moon Bridge";
  entry.visibility = "hide";
  entry.supported_in_api = true;
  entry.context_window = Math.max(Number(entry.context_window || 0), 1000000);
  entry.max_context_window = Math.max(Number(entry.max_context_window || 0), 1000000);
  entry.effective_context_window_percent = entry.effective_context_window_percent || 95;
  entry.default_reasoning_level = "xhigh";
  entry.supported_reasoning_levels = [
    { effort: "high", description: "High reasoning effort" },
    { effort: "xhigh", description: "Extra high reasoning effort" },
  ];
  entry.supports_reasoning_summaries = false;
  entry.default_reasoning_summary = null;
  return entry;
}

function mergeModelCatalogs(bundledCatalog, moonBridgeCatalog) {
  const bySlug = new Map();
  for (const model of bundledCatalog.models || []) {
    bySlug.set(model.slug, model);
  }

  const moonBridgeModels = moonBridgeCatalog?.models || [];
  for (const model of moonBridgeModels) {
    bySlug.set(model.slug, model);
  }

  let routeModel = bySlug.get(MOONBRIDGE_ROUTE_MODEL);
  if (!routeModel) {
    routeModel = fallbackMoonBridgeEntry(bundledCatalog);
    bySlug.set(routeModel.slug, routeModel);
  }
  routeModel.display_name = routeModel.display_name || "Moon Bridge";
  routeModel.description = routeModel.description || "DeepSeek V4 Pro route through Moon Bridge";
  routeModel.visibility = "hide";

  for (const model of DEEPSEEK_PICKER_MODELS) {
    if (!bySlug.has(model)) {
      bySlug.set(model, cloneForPickerModel(routeModel, model));
    } else {
      const pickerModel = bySlug.get(model);
      pickerModel.display_name = pickerModel.display_name || deepSeekDisplayName(model);
      pickerModel.description = pickerModel.description || `${deepSeekDisplayName(model)} via Moon Bridge`;
      pickerModel.visibility = "list";
    }
  }

  return {
    ...bundledCatalog,
    models: Array.from(bySlug.values()),
  };
}

function writeMergedCatalog(realCodex) {
  const bundledCatalog = loadBundledCatalog(realCodex);
  const moonBridgeCatalog = loadMoonBridgeCatalog();
  const mergedCatalog = mergeModelCatalogs(bundledCatalog, moonBridgeCatalog);
  const catalogPath = path.join(os.tmpdir(), `codex-vscode-deepseek-models-${process.getuid?.() || "user"}.json`);
  const tmpPath = `${catalogPath}.${process.pid}.tmp`;

  fs.writeFileSync(tmpPath, `${JSON.stringify(mergedCatalog)}\n`, { mode: 0o600 });
  fs.renameSync(tmpPath, catalogPath);
  return catalogPath;
}

function deepSeekModelListEntry(model = DEEPSEEK_PICKER_MODEL) {
  const displayName = deepSeekDisplayName(model);
  return {
    id: model,
    model,
    slug: model,
    displayName,
    display_name: displayName,
    description: `${displayName} via Moon Bridge`,
    hidden: false,
    visibility: "list",
    isDefault: false,
    defaultReasoningEffort: "xhigh",
    default_reasoning_level: "xhigh",
    supportedReasoningEfforts: [
      { reasoningEffort: "high", description: "High reasoning effort" },
      { reasoningEffort: "xhigh", description: "Extra high reasoning effort" },
    ],
    supported_reasoning_levels: [
      { effort: "high", description: "High reasoning effort" },
      { effort: "xhigh", description: "Extra high reasoning effort" },
    ],
    inputModalities: ["text"],
    additionalSpeedTiers: [],
    serviceTiers: [],
    supportsPersonality: false,
    upgrade: null,
  };
}

function normalizeDeepSeekModelListEntry(entry, model = DEEPSEEK_PICKER_MODEL) {
  const displayName = deepSeekDisplayName(model);
  entry.id = model;
  entry.model = model;
  entry.slug = model;
  entry.displayName = entry.displayName || entry.display_name || displayName;
  entry.display_name = entry.display_name || entry.displayName;
  entry.description = entry.description || `${displayName} via Moon Bridge`;
  entry.hidden = false;
  entry.isDefault = false;
  entry.visibility = "list";
  entry.defaultReasoningEffort = "xhigh";
  entry.default_reasoning_level = "xhigh";
  entry.supportedReasoningEfforts =
    entry.supportedReasoningEfforts?.length
      ? entry.supportedReasoningEfforts
      : deepSeekModelListEntry(model).supportedReasoningEfforts;
  entry.supported_reasoning_levels =
    entry.supported_reasoning_levels?.length
      ? entry.supported_reasoning_levels
      : [
          { effort: "high", description: "High reasoning effort" },
          { effort: "xhigh", description: "Extra high reasoning effort" },
        ];
  entry.inputModalities = entry.inputModalities?.length ? entry.inputModalities : ["text"];
  entry.additionalSpeedTiers = entry.additionalSpeedTiers || [];
  entry.serviceTiers = entry.serviceTiers || [];
  entry.supportsPersonality = entry.supportsPersonality || false;
  if (!Object.prototype.hasOwnProperty.call(entry, "upgrade")) {
    entry.upgrade = null;
  }
  return entry;
}

function extractModelArray(result) {
  if (Array.isArray(result)) {
    return result;
  }
  if (!result || typeof result !== "object") {
    return null;
  }
  for (const key of ["data", "models", "items"]) {
    if (Array.isArray(result[key])) {
      return result[key];
    }
  }
  return null;
}

function ensureDeepSeekInModelList(result) {
  const modelArray = extractModelArray(result);
  if (!modelArray) {
    return result;
  }

  for (const model of DEEPSEEK_PICKER_MODELS) {
    const existing = modelArray.find((entry) =>
      entry.id === model ||
      entry.model === model ||
      entry.slug === model
    );
    if (existing) {
      normalizeDeepSeekModelListEntry(existing, model);
      continue;
    }

    modelArray.push(normalizeDeepSeekModelListEntry(deepSeekModelListEntry(model), model));
  }

  return result;
}

function isDeepSeekSelection(model) {
  return DEEPSEEK_PICKER_MODELS.has(model) || model === MOONBRIDGE_ROUTE_MODEL;
}

function routeDeepSeekModel(model) {
  return DEEPSEEK_PICKER_MODELS.has(model) ? model : MOONBRIDGE_ROUTE_MODEL;
}

function mergeAgenticInstructions(existing) {
  if (!existing) {
    return DEEPSEEK_AGENTIC_INSTRUCTIONS;
  }
  if (existing.includes("DeepSeek Codex agentic operating rules:")) {
    return existing;
  }
  return `${existing.trim()}\n\n${DEEPSEEK_AGENTIC_INSTRUCTIONS}`;
}

function mergeDeepSeekThreadConfig(config) {
  const next = { ...(config || {}) };
  next.model_provider = MOONBRIDGE_PROVIDER_ID;
  next.model_reasoning_effort = "xhigh";
  next.plan_mode_reasoning_effort = "xhigh";
  next.model_reasoning_summary = "none";
  next.model_supports_reasoning_summaries = false;
  next.developer_instructions = mergeAgenticInstructions(next.developer_instructions);
  next.model_providers = {
    ...(next.model_providers || {}),
    [MOONBRIDGE_PROVIDER_ID]: {
      name: "Moon Bridge",
      base_url: MOONBRIDGE_BASE_URL,
      wire_api: "responses",
      ...((next.model_providers || {})[MOONBRIDGE_PROVIDER_ID] || {}),
    },
  };
  next.features = {
    ...(next.features || {}),
    apps: false,
  };
  next.plugins = {
    ...(next.plugins || {}),
  };
  for (const plugin of DISABLED_CONNECTOR_PLUGINS) {
    next.plugins[plugin] = {
      ...(next.plugins[plugin] || {}),
      enabled: false,
    };
  }
  return next;
}

function rewriteDeepSeekStartParams(params) {
  if (!params || (!isDeepSeekSelection(params.model) && params.modelProvider !== MOONBRIDGE_PROVIDER_ID)) {
    return params;
  }

  params.model = routeDeepSeekModel(params.model);
  params.modelProvider = MOONBRIDGE_PROVIDER_ID;
  params.config = mergeDeepSeekThreadConfig(params.config);
  return params;
}

function rewriteDeepSeekSettingsParams(params) {
  if (!params || !isDeepSeekSelection(params.model)) {
    return params;
  }

  params.model = routeDeepSeekModel(params.model);
  if (Object.prototype.hasOwnProperty.call(params, "summary")) {
    params.summary = "none";
  }
  return params;
}

function rewriteClientMessage(message) {
  if (!message || !message.method || !message.params) {
    return message;
  }

  if (message.method === "thread/start" || message.method === "thread/resume") {
    message.params = rewriteDeepSeekStartParams(message.params);
    return message;
  }

  if (message.method === "thread/settings/update" || message.method === "turn/start") {
    message.params = rewriteDeepSeekSettingsParams(message.params);
    return message;
  }

  return message;
}

function buildAppServerArgs(originalArgs, catalogPath) {
  const appServerIndex = originalArgs.indexOf("app-server");
  if (appServerIndex === -1) {
    return originalArgs;
  }

  return [
    ...originalArgs.slice(0, appServerIndex + 1),
    "-c",
    `model_catalog_json="${catalogPath}"`,
    "-c",
    MOONBRIDGE_PROVIDER_TOML,
    // Force the default model to GPT-5.5 so thread listing uses the
    // OpenAI provider (which has GPT threads). Moonbridge threads are
    // injected on the response side below.
    "-c",
    'model="gpt-5.5"',
    "-c",
    'model_provider="openai"',
    ...originalArgs.slice(appServerIndex + 1),
  ];
}

function shouldProxyAppServer(args) {
  return args[0] === "app-server";
}

function pipeJsonLines(input, output, transformLine) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) {
      output.write(`${line}\n`);
      return;
    }

    let nextLine = line;
    try {
      const parsed = JSON.parse(line);
      const transformed = transformLine(parsed);
      nextLine = JSON.stringify(transformed);
    } catch {
      nextLine = line;
    }
    output.write(`${nextLine}\n`);
  });
}

function runProxy(realCodex, args) {
  const catalogPath = writeMergedCatalog(realCodex);
  const childArgs = buildAppServerArgs(args, catalogPath);
  const pendingMethods = new Map();
  const home = codexHome();

  log(`starting ${realCodex} ${childArgs.join(" ")}`);
  const child = spawn(realCodex, childArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  pipeJsonLines(process.stdin, child.stdin, (message) => {
    if (message && Object.prototype.hasOwnProperty.call(message, "id") && message.method) {
      pendingMethods.set(String(message.id), message.method);
    }
    return rewriteClientMessage(message);
  });

  pipeJsonLines(child.stdout, process.stdout, (message) => {
    if (message && Object.prototype.hasOwnProperty.call(message, "id")) {
      const key = String(message.id);
      const method = pendingMethods.get(key);

      // Inject DeepSeek into the model list.
      if (method && MODEL_LIST_METHODS.has(method) && message.result) {
        message.result = ensureDeepSeekInModelList(message.result);
      }

      // Merge moonbridge threads into any thread-listing response.
      if (message.result) {
        const isThreadListMethod = method && THREAD_LIST_METHODS.has(method);
        const hasThreadArray = extractThreadArray(message.result) !== null;

        if (isThreadListMethod || hasThreadArray) {
          const moonBridgeThreads = loadMoonBridgeThreads(home);
          if (moonBridgeThreads.length > 0) {
            message.result = mergeMoonBridgeThreads(message.result, moonBridgeThreads);
          }
        }
      }

      pendingMethods.delete(key);
    }
    return message;
  });

  child.stderr.pipe(process.stderr);

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }
}

function main() {
  const args = process.argv.slice(2);
  const realCodex = resolveRealCodexBinary();

  if (!shouldProxyAppServer(args)) {
    const child = spawn(realCodex, args, { stdio: "inherit", env: process.env });
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 1);
    });
    return;
  }

  runProxy(realCodex, args);
}

if (require.main === module) {
  main();
}

module.exports = {
  DEEPSEEK_PICKER_MODEL,
  DEEPSEEK_PICKER_MODELS,
  MOONBRIDGE_PROVIDER_ID,
  MOONBRIDGE_ROUTE_MODEL,
  buildAppServerArgs,
  cloneForPickerModel,
  deepSeekModelListEntry,
  deepSeekDisplayName,
  ensureDeepSeekInModelList,
  extractModelArray,
  isDeepSeekSelection,
  mergeAgenticInstructions,
  mergeDeepSeekThreadConfig,
  mergeModelCatalogs,
  routeDeepSeekModel,
  rewriteClientMessage,
  rewriteDeepSeekSettingsParams,
  rewriteDeepSeekStartParams,
};
