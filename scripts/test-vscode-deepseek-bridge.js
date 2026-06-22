#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");

const bridge = require("./codex-vscode-deepseek-bridge.js");

function testThreadStartRewrite() {
  const input = {
    id: 1,
    method: "thread/start",
    params: {
      model: "deepseek-v4-pro",
      cwd: "/tmp/project",
      config: {
        features: { apps: true },
      },
    },
  };

  const output = bridge.rewriteClientMessage(JSON.parse(JSON.stringify(input)));
  assert.equal(output.params.model, "deepseek-v4-pro");
  assert.equal(output.params.modelProvider, "moonbridge");
  assert.equal(output.params.config.model_provider, "moonbridge");
  assert.equal(output.params.config.model_reasoning_effort, "xhigh");
  assert.equal(output.params.config.plan_mode_reasoning_effort, "xhigh");
  assert.match(output.params.config.developer_instructions, /DeepSeek Codex agentic operating rules/);
  assert.equal(output.params.config.features.apps, false);
  assert.equal(output.params.config.model_providers.moonbridge.wire_api, "responses");
  assert.equal(output.params.config.plugins["github@openai-curated"].enabled, false);
}

function testThreadStartRewritePreservesDeepSeekFlash() {
  const input = {
    id: 11,
    method: "thread/start",
    params: {
      model: "deepseek-v4-flash",
      cwd: "/tmp/project",
      config: {
        features: { apps: true },
      },
    },
  };

  const output = bridge.rewriteClientMessage(JSON.parse(JSON.stringify(input)));
  assert.equal(output.params.model, "deepseek-v4-flash");
  assert.equal(output.params.modelProvider, "moonbridge");
  assert.equal(output.params.config.model_provider, "moonbridge");
  assert.equal(output.params.config.model_reasoning_effort, "xhigh");
  assert.match(output.params.config.developer_instructions, /DeepSeek Codex agentic operating rules/);
  assert.equal(output.params.config.features.apps, false);
}

function testAgenticInstructionsAppendOnce() {
  const first = bridge.mergeAgenticInstructions("Existing rule.");
  assert.match(first, /Existing rule/);
  assert.match(first, /DeepSeek Codex agentic operating rules/);

  const second = bridge.mergeAgenticInstructions(first);
  assert.equal(second, first);
}

function testGptThreadStartIsUntouched() {
  const input = {
    id: 2,
    method: "thread/start",
    params: {
      model: "gpt-5.5",
      modelProvider: "openai",
      config: { features: { apps: true } },
    },
  };

  const output = bridge.rewriteClientMessage(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(output, input);
}

function testThreadResumeRewrite() {
  const input = {
    id: 3,
    method: "thread/resume",
    params: {
      threadId: "abc",
      model: "deepseek-v4-pro",
    },
  };

  const output = bridge.rewriteClientMessage(JSON.parse(JSON.stringify(input)));
  assert.equal(output.params.model, "deepseek-v4-pro");
  assert.equal(output.params.modelProvider, "moonbridge");
}

function testSettingsRewrite() {
  const input = {
    id: 4,
    method: "thread/settings/update",
    params: {
      threadId: "abc",
      model: "deepseek-v4-pro",
      summary: "auto",
    },
  };

  const output = bridge.rewriteClientMessage(JSON.parse(JSON.stringify(input)));
  assert.equal(output.params.model, "deepseek-v4-pro");
  assert.equal(output.params.summary, "none");
}

function testModelListInjection() {
  const result = {
    data: [
      {
        id: "gpt-5.5",
        model: "gpt-5.5",
        displayName: "GPT-5.5",
        description: "",
        hidden: false,
        isDefault: true,
        defaultReasoningEffort: "xhigh",
        supportedReasoningEfforts: [{ reasoningEffort: "xhigh", description: "Extra high" }],
      },
    ],
  };

  bridge.ensureDeepSeekInModelList(result);
  const deepseek = result.data.find((model) => model.id === "deepseek-v4-pro");
  assert.ok(deepseek);
  assert.equal(deepseek.model, "deepseek-v4-pro");
  assert.equal(deepseek.hidden, false);
  assert.equal(deepseek.defaultReasoningEffort, "xhigh");
  const flash = result.data.find((model) => model.id === "deepseek-v4-flash");
  assert.ok(flash);
  assert.equal(flash.model, "deepseek-v4-flash");
  assert.equal(flash.hidden, false);
  assert.equal(flash.defaultReasoningEffort, "xhigh");
}

function testModelListInjectionWithModelsEnvelope() {
  const result = {
    models: [
      {
        slug: "gpt-5.5",
        display_name: "GPT-5.5",
        visibility: "list",
      },
    ],
  };

  bridge.ensureDeepSeekInModelList(result);
  const deepseek = result.models.find((model) => model.id === "deepseek-v4-pro");
  assert.ok(deepseek);
  assert.equal(deepseek.model, "deepseek-v4-pro");
  assert.equal(deepseek.displayName, "DeepSeek V4 Pro");
  assert.equal(deepseek.visibility, "list");
  assert.equal(deepseek.defaultReasoningEffort, "xhigh");
}

function testModelListNormalizesExistingSlugEntry() {
  const result = {
    items: [
      {
        id: "deepseek-v4-pro",
        slug: "stale-deepseek-alias",
        display_name: "DeepSeek V4 Pro",
        visibility: "hide",
      },
    ],
  };

  bridge.ensureDeepSeekInModelList(result);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].id, "deepseek-v4-pro");
  assert.equal(result.items[0].model, "deepseek-v4-pro");
  assert.equal(result.items[0].slug, "deepseek-v4-pro");
  assert.equal(result.items[0].hidden, false);
  assert.equal(result.items[0].visibility, "list");
  assert.equal(result.items[1].id, "deepseek-v4-flash");
  assert.equal(result.items[1].model, "deepseek-v4-flash");
  assert.equal(result.items[1].hidden, false);
  assert.equal(result.items[1].visibility, "list");
}

function testBareModelListInjection() {
  const result = [
    {
      id: "gpt-5.5",
      model: "gpt-5.5",
      displayName: "GPT-5.5",
    },
  ];

  bridge.ensureDeepSeekInModelList(result);
  const deepseek = result.find((model) => model.id === "deepseek-v4-pro");
  assert.ok(deepseek);
  assert.equal(deepseek.model, "deepseek-v4-pro");
}

function testCatalogMerge() {
  const bundled = {
    models: [
      {
        slug: "gpt-5.5",
        display_name: "GPT-5.5",
        visibility: "list",
        priority: 100,
        base_instructions: "base",
      },
    ],
  };
  const moonBridge = {
    models: [
      {
        slug: "moonbridge",
        display_name: "Moon Bridge",
        visibility: "hidden",
        priority: 0,
        base_instructions: "deepseek",
      },
    ],
  };

  const merged = bridge.mergeModelCatalogs(bundled, moonBridge);
  assert.ok(merged.models.find((model) => model.slug === "gpt-5.5"));
  const route = merged.models.find((model) => model.slug === "moonbridge");
  assert.ok(route);
  assert.equal(route.visibility, "hide");
  const picker = merged.models.find((model) => model.slug === "deepseek-v4-pro");
  assert.ok(picker);
  assert.equal(picker.display_name, "DeepSeek V4 Pro");
  assert.equal(picker.visibility, "list");
  const flash = merged.models.find((model) => model.slug === "deepseek-v4-flash");
  assert.ok(flash);
  assert.equal(flash.display_name, "DeepSeek V4 Flash");
  assert.equal(flash.visibility, "list");
}

function testAppServerArgs() {
  const args = bridge.buildAppServerArgs(["app-server", "--analytics-default-enabled"], "/tmp/models.json");
  assert.deepEqual(args, [
    "app-server",
    "-c",
    'model_catalog_json="/tmp/models.json"',
    "-c",
    'model_providers.moonbridge={ name = "Moon Bridge", base_url = "http://127.0.0.1:38440/v1", wire_api = "responses" }',
    "-c",
    'model="gpt-5.5"',
    "-c",
    'model_provider="openai"',
    "--analytics-default-enabled",
  ]);
}

testThreadStartRewrite();
testThreadStartRewritePreservesDeepSeekFlash();
testAgenticInstructionsAppendOnce();
testGptThreadStartIsUntouched();
testThreadResumeRewrite();
testSettingsRewrite();
testModelListInjection();
testModelListInjectionWithModelsEnvelope();
testModelListNormalizesExistingSlugEntry();
testBareModelListInjection();
testCatalogMerge();
testAppServerArgs();

console.log("vscode DeepSeek bridge tests passed");
