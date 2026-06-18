#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");

const DEEPSEEK_PICKER_MODEL = "deepseek-v4-pro";
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

function cloneForPickerModel(source) {
  const cloned = JSON.parse(JSON.stringify(source));
  cloned.slug = DEEPSEEK_PICKER_MODEL;
  cloned.display_name = "DeepSeek V4 Pro";
  cloned.description = "DeepSeek V4 Pro via Moon Bridge";
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
  entry.default_reasoning_level = "high";
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

  if (!bySlug.has(DEEPSEEK_PICKER_MODEL)) {
    bySlug.set(DEEPSEEK_PICKER_MODEL, cloneForPickerModel(routeModel));
  } else {
    const pickerModel = bySlug.get(DEEPSEEK_PICKER_MODEL);
    pickerModel.display_name = pickerModel.display_name || "DeepSeek V4 Pro";
    pickerModel.visibility = "list";
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

function deepSeekModelListEntry() {
  return {
    id: DEEPSEEK_PICKER_MODEL,
    model: DEEPSEEK_PICKER_MODEL,
    displayName: "DeepSeek V4 Pro",
    description: "DeepSeek V4 Pro via Moon Bridge",
    hidden: false,
    isDefault: false,
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: [
      { reasoningEffort: "high", description: "High reasoning effort" },
      { reasoningEffort: "xhigh", description: "Extra high reasoning effort" },
    ],
    inputModalities: ["text"],
    additionalSpeedTiers: [],
    serviceTiers: [],
    supportsPersonality: false,
    upgrade: null,
  };
}

function ensureDeepSeekInModelList(result) {
  if (!result || !Array.isArray(result.data)) {
    return result;
  }

  const existing = result.data.find((model) => model.id === DEEPSEEK_PICKER_MODEL || model.model === DEEPSEEK_PICKER_MODEL);
  if (existing) {
    existing.id = DEEPSEEK_PICKER_MODEL;
    existing.model = DEEPSEEK_PICKER_MODEL;
    existing.displayName = existing.displayName || "DeepSeek V4 Pro";
    existing.description = existing.description || "DeepSeek V4 Pro via Moon Bridge";
    existing.hidden = false;
    existing.isDefault = false;
    existing.defaultReasoningEffort = existing.defaultReasoningEffort || "high";
    existing.supportedReasoningEfforts =
      existing.supportedReasoningEfforts?.length ? existing.supportedReasoningEfforts : deepSeekModelListEntry().supportedReasoningEfforts;
    existing.inputModalities = existing.inputModalities?.length ? existing.inputModalities : ["text"];
    return result;
  }

  result.data.push(deepSeekModelListEntry());
  return result;
}

function isDeepSeekSelection(model) {
  return model === DEEPSEEK_PICKER_MODEL || model === MOONBRIDGE_ROUTE_MODEL;
}

function mergeDeepSeekThreadConfig(config) {
  const next = { ...(config || {}) };
  next.model_provider = MOONBRIDGE_PROVIDER_ID;
  next.model_reasoning_summary = "none";
  next.model_supports_reasoning_summaries = false;
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

  params.model = MOONBRIDGE_ROUTE_MODEL;
  params.modelProvider = MOONBRIDGE_PROVIDER_ID;
  params.config = mergeDeepSeekThreadConfig(params.config);
  return params;
}

function rewriteDeepSeekSettingsParams(params) {
  if (!params || !isDeepSeekSelection(params.model)) {
    return params;
  }

  params.model = MOONBRIDGE_ROUTE_MODEL;
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
      if (pendingMethods.get(key) === "model/list" && message.result) {
        message.result = ensureDeepSeekInModelList(message.result);
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
  MOONBRIDGE_PROVIDER_ID,
  MOONBRIDGE_ROUTE_MODEL,
  buildAppServerArgs,
  cloneForPickerModel,
  deepSeekModelListEntry,
  ensureDeepSeekInModelList,
  isDeepSeekSelection,
  mergeDeepSeekThreadConfig,
  mergeModelCatalogs,
  rewriteClientMessage,
  rewriteDeepSeekSettingsParams,
  rewriteDeepSeekStartParams,
};
