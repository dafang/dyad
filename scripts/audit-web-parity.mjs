#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const rootDir = process.cwd();
const typesDir = path.join(rootDir, "src/ipc/types");
const preloadChannelsPath = path.join(rootDir, "src/ipc/preload/channels.ts");
const outputPath = path.join(rootDir, ".supergoal/web-parity-inventory.json");

const print = (message = "") => {
  process.stdout.write(`${message}\n`);
};

const printError = (message = "") => {
  process.stderr.write(`${message}\n`);
};

const CLUSTERS = [
  "shell/read",
  "mutations",
  "runtime/preview",
  "chat/agent",
  "integrations",
  "electron-only/system",
  "test-only",
];

const ELECTRON_ONLY_CHANNELS = new Set([
  "window:minimize",
  "window:maximize",
  "window:close",
  "window:focus",
  "select-node-folder",
  "select-app-folder",
  "select-app-location",
  "select-custom-apps-folder",
  "open-external-url",
  "show-item-in-folder",
  "open-file-path",
  "clear-session-data",
  "reset-all",
  "take-screenshot",
  "restart-dyad",
  "force-close-detected",
  "deep-link-received",
  "toast:error",
]);

const READ_CHANNELS = new Set([
  "get-user-settings",
  "get-app",
  "list-apps",
  "check-app-name",
  "search-app",
  "app:get-current-commit-hash",
  "app:list-screenshots",
  "app:list-thumbnails",
  "get-chat",
  "get-chats",
  "get-chat-metadata",
  "search-chats",
  "chat:count-tokens",
  "get-system-platform",
  "get-initial-load-telemetry-context",
  "get-system-debug-info",
  "get-app-version",
  "nodejs-status",
  "get-node-path",
  "get-custom-apps-folder",
  "does-release-note-exist",
  "get-user-budget",
  "list-versions",
  "get-current-branch",
  "get-language-model-providers",
  "get-language-models",
  "get-language-models-by-providers",
  "local-models:list-ollama",
  "local-models:list-lmstudio",
  "get-templates",
  "get-themes",
  "get-app-theme",
  "get-custom-themes",
  "get-theme-generation-model-options",
  "get-env-vars",
  "get-app-env-vars",
  "get-session-debug-bundle",
  "check-problems",
  "get-context-paths",
  "get-app-upgrades",
  "get-latest-security-review",
  "list-all-media",
  "free-agent-quota:get-status",
  "appCollections:list",
  "check-ai-rules",
  "prompts:list",
]);

const MUTATION_PREFIXES = [
  "create-",
  "delete-",
  "copy-",
  "rename-",
  "edit-",
  "set-",
  "unset-",
  "update-",
  "apply-",
  "respond-",
  "import-",
  "add-",
  "remove-",
  "move-",
  "save-",
  "cancel-",
  "approve-",
  "reject-",
  "checkout-",
  "revert-",
  "install-",
  "reload-",
  "upload-",
  "portal:migrate-",
  "change-app-location",
  "renderer:",
  "execute-app-upgrade",
  "clear-logs",
  "add-log",
  "appCollections:create",
  "appCollections:update",
  "appCollections:delete",
  "appCollections:assignApps",
];

const RUNTIME_PREFIXES = [
  "run-app",
  "stop-app",
  "restart-app",
  "read-app-file",
  "search-app-files",
  "select-app-for-preview",
  "respond-to-app-input",
  "app:output",
  "app:output-batch",
  "terminal:",
  "get-cloud-sandbox-status",
  "create-cloud-sandbox-share-link",
  "app:save-screenshot",
];

const CHAT_PREFIXES = [
  "chat:",
  "get-proposal",
  "approve-proposal",
  "reject-proposal",
  "get-chat",
  "get-chats",
  "get-chat-metadata",
  "create-chat",
  "update-chat",
  "delete-chat",
  "delete-messages",
  "search-chats",
  "help:chat:",
  "agent-tool:",
  "plan:",
  "app-blueprint:",
];

const INTEGRATION_PREFIXES = [
  "github:",
  "git:",
  "mcp:",
  "vercel:",
  "supabase:",
  "neon:",
  "migration:",
  "integration:",
  "is-capacitor",
  "sync-capacitor",
  "open-ios",
  "open-android",
  "pro:transcribe-audio",
  "generate-image",
  "cancel-image-generation",
  "apply-visual-editing-changes",
  "analyze-component",
  "telemetry:event",
];

const MUTATION_NAMESPACES = ["prompts:"];

const MUTATION_EXACT_CHANNELS = new Set([
  "generate-theme-prompt",
  "generate-theme-from-url",
  "cleanup-theme-images",
]);

function main() {
  const definitions = extractDefinitions();
  const preload = extractPreloadAllowlists(definitions);
  const directElectronUsage = scanDirectRendererElectronUsage();
  const backendElectronImports = scanBackendElectronImports();

  const invokeChannels = preload.invoke.map((channel) =>
    buildChannelEntry(channel, "invoke", definitions),
  );
  const receiveChannels = preload.receive.map((channel) =>
    buildChannelEntry(channel, "receive", definitions),
  );

  const unclassified = [...invokeChannels, ...receiveChannels].filter(
    (entry) => !entry.cluster,
  );
  const missingDefinitions = [
    ...preload.missingInvokeDefinitions,
    ...preload.missingReceiveDefinitions,
  ];

  const inventory = {
    schemaVersion: 1,
    sourceOfTruth: {
      preloadAllowlist: relative(preloadChannelsPath),
      contractGlobs: ["src/ipc/types/*.ts"],
    },
    clusters: CLUSTERS,
    summary: {
      invokeChannels: invokeChannels.length,
      receiveChannels: receiveChannels.length,
      directRendererElectronUsages: directElectronUsage.length,
      backendTopLevelElectronImports: backendElectronImports.length,
      unclassifiedChannels: unclassified.length,
      missingPreloadDefinitions: missingDefinitions.length,
      duplicateChannelDefinitions: definitions.duplicates.length,
    },
    clusterCounts: countClusters([...invokeChannels, ...receiveChannels]),
    invokeChannels,
    receiveChannels,
    directRendererElectronUsage: directElectronUsage,
    backendTopLevelElectronImports: backendElectronImports,
    validation: {
      missingInvokeDefinitions: preload.missingInvokeDefinitions,
      missingReceiveDefinitions: preload.missingReceiveDefinitions,
      unclassifiedChannels: unclassified.map((entry) => ({
        channel: entry.channel,
        direction: entry.direction,
        source: entry.source,
      })),
      duplicateChannelDefinitions: definitions.duplicates,
    },
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, formatInventoryJson(inventory));

  printSummary(inventory);

  if (missingDefinitions.length > 0 || unclassified.length > 0) {
    process.exitCode = 1;
  }
}

function extractDefinitions() {
  const byChannel = new Map();
  const byGroup = new Map();
  const byStreamVar = new Map();
  const duplicates = [];
  const files = fs
    .readdirSync(typesDir)
    .filter((file) => file.endsWith(".ts") && file !== "index.ts")
    .sort();

  for (const file of files) {
    const fullPath = path.join(typesDir, file);
    const sourceFile = parseSourceFile(fullPath);
    visit(sourceFile, (node) => {
      if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
        return;
      }

      const kind = node.expression.text;
      if (
        kind !== "defineContract" &&
        kind !== "defineEvent" &&
        kind !== "defineStream"
      ) {
        return;
      }

      const arg = node.arguments[0];
      if (!arg || !ts.isObjectLiteralExpression(arg)) {
        return;
      }

      const channel = getStringProperty(arg, "channel");
      if (!channel) {
        return;
      }

      const context = getDefinitionContext(node);
      if (kind === "defineStream") {
        const events = extractStreamEvents(arg);
        const streamDef = {
          channel,
          direction: "invoke",
          kind: "stream",
          group: context.group,
          method: context.method,
          file: relative(fullPath),
          line: lineOf(sourceFile, node),
          events,
        };
        addDefinition(byChannel, streamDef, duplicates);
        if (context.group) {
          byStreamVar.set(context.group, streamDef);
        }
        for (const event of events) {
          addDefinition(
            byChannel,
            {
              channel: event.channel,
              direction: "receive",
              kind: "stream-event",
              group: context.group,
              method: event.event,
              file: relative(fullPath),
              line: lineOf(sourceFile, node),
              streamChannel: channel,
            },
            duplicates,
          );
        }
        return;
      }

      const def = {
        channel,
        direction: kind === "defineEvent" ? "receive" : "invoke",
        kind: kind === "defineEvent" ? "event" : "contract",
        group: context.group,
        method: context.method,
        file: relative(fullPath),
        line: lineOf(sourceFile, node),
      };
      addDefinition(byChannel, def, duplicates);

      if (context.group) {
        if (!byGroup.has(context.group)) {
          byGroup.set(context.group, []);
        }
        byGroup.get(context.group).push(def);
      }
    });
  }

  return { byChannel, byGroup, byStreamVar, duplicates };
}

function extractPreloadAllowlists(definitions) {
  const sourceFile = parseSourceFile(preloadChannelsPath);
  const consts = new Map();
  visit(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      consts.set(node.name.text, node.initializer);
    }
  });

  const streamChannelConsts = new Map();
  for (const [name, initializer] of consts) {
    if (
      ts.isCallExpression(initializer) &&
      ts.isIdentifier(initializer.expression) &&
      initializer.expression.text === "getStreamChannels"
    ) {
      const arg = initializer.arguments[0];
      if (arg && ts.isIdentifier(arg)) {
        const streamDef = definitions.byStreamVar.get(arg.text);
        if (streamDef) {
          streamChannelConsts.set(name, streamDef);
        }
      }
    }
  }

  const invokeArray = consts.get("VALID_INVOKE_CHANNELS");
  const receiveArray = consts.get("VALID_RECEIVE_CHANNELS");
  if (!invokeArray || !receiveArray) {
    throw new Error(
      "Could not find VALID_INVOKE_CHANNELS/VALID_RECEIVE_CHANNELS",
    );
  }

  const invoke = evaluatePreloadArray(invokeArray, {
    definitions,
    streamChannelConsts,
    mode: "invoke",
  });
  const receive = evaluatePreloadArray(receiveArray, {
    definitions,
    streamChannelConsts,
    mode: "receive",
  });

  return {
    invoke: invoke.channels,
    receive: receive.channels,
    missingInvokeDefinitions: invoke.missingDefinitions,
    missingReceiveDefinitions: receive.missingDefinitions,
  };
}

function evaluatePreloadArray(arrayExpression, context) {
  const expression = unwrapExpression(arrayExpression);
  if (!ts.isArrayLiteralExpression(expression)) {
    throw new Error("Expected preload allowlist to be an array literal");
  }

  const channels = [];
  const missingDefinitions = [];

  for (const element of expression.elements) {
    if (ts.isSpreadElement(element)) {
      const spread = element.expression;
      if (isGetChannelsCall(spread, "getInvokeChannels")) {
        const group = spread.arguments[0];
        if (!group || !ts.isIdentifier(group)) {
          continue;
        }
        const defs = context.definitions.byGroup.get(group.text) ?? [];
        if (defs.length === 0) {
          missingDefinitions.push({
            source: group.text,
            reason: "No definitions found for getInvokeChannels source",
          });
        }
        channels.push(...defs.map((def) => def.channel));
        continue;
      }

      if (isGetChannelsCall(spread, "getReceiveChannels")) {
        const group = spread.arguments[0];
        if (!group || !ts.isIdentifier(group)) {
          continue;
        }
        const defs = context.definitions.byGroup.get(group.text) ?? [];
        if (defs.length === 0) {
          missingDefinitions.push({
            source: group.text,
            reason: "No definitions found for getReceiveChannels source",
          });
        }
        channels.push(...defs.map((def) => def.channel));
        continue;
      }

      if (
        ts.isPropertyAccessExpression(spread) &&
        spread.name.text === "receive" &&
        ts.isIdentifier(spread.expression)
      ) {
        const streamDef = context.streamChannelConsts.get(
          spread.expression.text,
        );
        if (!streamDef) {
          missingDefinitions.push({
            source: spread.expression.text,
            reason: "No stream definition found for receive channels",
          });
          continue;
        }
        channels.push(...streamDef.events.map((event) => event.channel));
        continue;
      }

      if (ts.isIdentifier(spread) && spread.text === "TEST_INVOKE_CHANNELS") {
        channels.push(...extractStringArrayConst("TEST_INVOKE_CHANNELS"));
        continue;
      }

      missingDefinitions.push({
        source: spread.getText(),
        reason: "Unsupported preload spread expression",
      });
      continue;
    }

    if (
      ts.isPropertyAccessExpression(element) &&
      element.name.text === "invoke" &&
      ts.isIdentifier(element.expression)
    ) {
      const streamDef = context.streamChannelConsts.get(
        element.expression.text,
      );
      if (!streamDef) {
        missingDefinitions.push({
          source: element.expression.text,
          reason: "No stream definition found for invoke channel",
        });
        continue;
      }
      channels.push(streamDef.channel);
      continue;
    }

    const literal = getStringLiteralValue(element);
    if (literal) {
      channels.push(literal);
      continue;
    }

    missingDefinitions.push({
      source: element.getText(),
      reason: "Unsupported preload allowlist element",
    });
  }

  return {
    channels: unique(channels),
    missingDefinitions,
  };

  function extractStringArrayConst(name) {
    const constSource = parseSourceFile(preloadChannelsPath);
    let values = [];
    visit(constSource, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name &&
        node.initializer
      ) {
        const initializer = unwrapExpression(node.initializer);
        if (ts.isArrayLiteralExpression(initializer)) {
          values = initializer.elements
            .map((item) => getStringLiteralValue(item))
            .filter(Boolean);
        }
      }
    });
    return values;
  }
}

function buildChannelEntry(channel, direction, definitions) {
  const def = definitions.byChannel.get(channel);
  const cluster = classifyChannel(channel);
  return {
    channel,
    direction,
    cluster,
    kind: def?.kind ?? (channel.startsWith("test:") ? "test-only" : "unknown"),
    source: def ? `${def.file}:${def.line}` : "src/ipc/preload/channels.ts",
    group: def?.group,
    method: def?.method,
    webReplacement: webReplacementFor(channel, cluster),
  };
}

function classifyChannel(channel) {
  if (channel.startsWith("test:")) {
    return "test-only";
  }
  if (ELECTRON_ONLY_CHANNELS.has(channel)) {
    return "electron-only/system";
  }
  if (RUNTIME_PREFIXES.some((prefix) => channel.startsWith(prefix))) {
    return "runtime/preview";
  }
  if (CHAT_PREFIXES.some((prefix) => channel.startsWith(prefix))) {
    return "chat/agent";
  }
  if (INTEGRATION_PREFIXES.some((prefix) => channel.startsWith(prefix))) {
    return "integrations";
  }
  if (READ_CHANNELS.has(channel)) {
    return "shell/read";
  }
  if (MUTATION_EXACT_CHANNELS.has(channel)) {
    return "mutations";
  }
  if (MUTATION_NAMESPACES.some((prefix) => channel.startsWith(prefix))) {
    return "mutations";
  }
  if (MUTATION_PREFIXES.some((prefix) => channel.startsWith(prefix))) {
    return "mutations";
  }
  return null;
}

function webReplacementFor(channel, cluster) {
  if (cluster !== "electron-only/system") {
    return "HTTP/API or browser event bridge equivalent";
  }
  if (channel.startsWith("window:") || channel === "force-close-detected") {
    return "No-op or browser navigation state; browser chrome owns window controls";
  }
  if (channel.startsWith("select-")) {
    return "Browser-safe picker flow backed by local server path capability";
  }
  if (
    channel === "open-external-url" ||
    channel === "show-item-in-folder" ||
    channel === "open-file-path"
  ) {
    return "Server-mediated local OS action with explicit user intent";
  }
  if (channel === "take-screenshot") {
    return "Browser screenshot/canvas capture where available; otherwise server-side preview capture";
  }
  if (channel === "restart-dyad" || channel === "reset-all") {
    return "Local server lifecycle/reset endpoint plus browser reload";
  }
  if (channel === "clear-session-data") {
    return "Browser storage clear plus server session cleanup";
  }
  if (channel === "deep-link-received") {
    return "Loopback callback route/event bridge";
  }
  return "Explicit Web replacement required";
}

function scanDirectRendererElectronUsage() {
  const rendererRoots = ["src/app", "src/components", "src/hooks", "src/lib"];
  const patterns = [/window\.electron/g, /\bwebFrame\b/g];
  const results = [];

  for (const root of rendererRoots) {
    const absoluteRoot = path.join(rootDir, root);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }
    for (const file of listFiles(absoluteRoot, [".ts", ".tsx"])) {
      const text = fs.readFileSync(file, "utf8");
      const lines = text.split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const pattern of patterns) {
          if (pattern.test(line)) {
            results.push({
              file: relative(file),
              line: index + 1,
              match: pattern.source.replaceAll("\\", ""),
              text: line.trim(),
            });
            pattern.lastIndex = 0;
          }
        }
      });
    }
  }

  return results.sort(compareFileLine);
}

function scanBackendElectronImports() {
  const backendRoots = [
    "src/main",
    "src/ipc",
    "src/runtime",
    "src/server",
    "src",
  ];
  const files = new Set();
  for (const root of backendRoots) {
    const absoluteRoot = path.join(rootDir, root);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }
    for (const file of listFiles(absoluteRoot, [".ts"])) {
      if (file.endsWith(".test.ts") || file.endsWith(".spec.ts")) {
        continue;
      }
      files.add(file);
    }
  }

  const imports = [];
  for (const file of [...files].sort()) {
    const sourceFile = parseSourceFile(file);
    const firstStatements = sourceFile.statements.filter(
      (statement) =>
        ts.isImportDeclaration(statement) ||
        ts.isImportEqualsDeclaration(statement) ||
        ts.isVariableStatement(statement),
    );

    for (const statement of firstStatements) {
      if (
        ts.isImportDeclaration(statement) &&
        getModuleSpecifier(statement) === "electron" &&
        !isTypeOnlyImportDeclaration(statement)
      ) {
        imports.push({
          file: relative(file),
          line: lineOf(sourceFile, statement),
          import: statement.getText(sourceFile).replace(/\s+/g, " "),
          startupCandidate: isWebServerStartupCandidate(file),
        });
      }

      if (ts.isVariableStatement(statement)) {
        const text = statement.getText(sourceFile);
        if (/require\(["']electron["']\)/.test(text)) {
          imports.push({
            file: relative(file),
            line: lineOf(sourceFile, statement),
            import: text.replace(/\s+/g, " "),
            startupCandidate: isWebServerStartupCandidate(file),
          });
        }
      }
    }
  }

  return imports.sort(compareFileLine);
}

function isWebServerStartupCandidate(file) {
  const rel = relative(file);
  return (
    rel === "src/main.ts" ||
    rel.startsWith("src/main/") ||
    rel.startsWith("src/ipc/handlers/") ||
    rel.startsWith("src/ipc/services/") ||
    rel.startsWith("src/ipc/utils/") ||
    rel.startsWith("src/runtime/") ||
    rel.startsWith("src/server/")
  );
}

function countClusters(entries) {
  const counts = Object.fromEntries(CLUSTERS.map((cluster) => [cluster, 0]));
  for (const entry of entries) {
    if (entry.cluster) {
      counts[entry.cluster] += 1;
    }
  }
  return counts;
}

function printSummary(inventory) {
  print("Web parity audit complete");
  print(`Inventory: ${relative(outputPath)}`);
  print(`Invoke channels: ${inventory.summary.invokeChannels}`);
  print(`Receive channels: ${inventory.summary.receiveChannels}`);
  print(
    `Direct renderer Electron usages: ${inventory.summary.directRendererElectronUsages}`,
  );
  print(
    `Backend top-level Electron imports: ${inventory.summary.backendTopLevelElectronImports}`,
  );
  print(`Unclassified channels: ${inventory.summary.unclassifiedChannels}`);
  print(
    `Missing preload definitions: ${inventory.summary.missingPreloadDefinitions}`,
  );
  print(
    `Duplicate channel definitions: ${inventory.summary.duplicateChannelDefinitions}`,
  );
  print(`Cluster counts: ${JSON.stringify(inventory.clusterCounts)}`);

  if (inventory.validation.unclassifiedChannels.length > 0) {
    printError("Unclassified channels:");
    for (const item of inventory.validation.unclassifiedChannels) {
      printError(`- ${item.direction} ${item.channel} (${item.source})`);
    }
  }

  const missing = [
    ...inventory.validation.missingInvokeDefinitions,
    ...inventory.validation.missingReceiveDefinitions,
  ];
  if (missing.length > 0) {
    printError("Missing preload definitions:");
    for (const item of missing) {
      printError(`- ${item.source}: ${item.reason}`);
    }
  }
}

function formatInventoryJson(inventory) {
  return `${JSON.stringify(inventory, null, 2).replace(
    /"contractGlobs": \[\n\s+"src\/ipc\/types\/\*\.ts"\n\s+\]/,
    '"contractGlobs": ["src/ipc/types/*.ts"]',
  )}\n`;
}

function extractStreamEvents(streamObject) {
  const eventsProperty = getObjectProperty(streamObject, "events");
  if (!eventsProperty || !ts.isObjectLiteralExpression(eventsProperty)) {
    return [];
  }

  return eventsProperty.properties
    .filter(ts.isPropertyAssignment)
    .map((property) => {
      const eventObject = unwrapExpression(property.initializer);
      if (!ts.isObjectLiteralExpression(eventObject)) {
        return null;
      }
      const channel = getStringProperty(eventObject, "channel");
      if (!channel) {
        return null;
      }
      return {
        event: getPropertyNameText(property.name),
        channel,
      };
    })
    .filter(Boolean);
}

function getDefinitionContext(node) {
  let current = node.parent;
  let method;
  let group;
  while (current) {
    if (ts.isPropertyAssignment(current) && !method) {
      method = getPropertyNameText(current.name);
    }
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      group = current.name.text;
      break;
    }
    current = current.parent;
  }
  return { group, method };
}

function addDefinition(map, definition, duplicates) {
  if (map.has(definition.channel)) {
    const existing = map.get(definition.channel);
    duplicates.push({
      channel: definition.channel,
      first: {
        kind: existing.kind,
        source: `${existing.file}:${existing.line}`,
      },
      duplicate: {
        kind: definition.kind,
        source: `${definition.file}:${definition.line}`,
      },
    });
    return;
  }
  map.set(definition.channel, definition);
}

function isGetChannelsCall(node, functionName) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === functionName
  );
}

function getStringProperty(object, propertyName) {
  const property = getObjectProperty(object, propertyName);
  return property ? getStringLiteralValue(property) : undefined;
}

function getObjectProperty(object, propertyName) {
  for (const property of object.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      getPropertyNameText(property.name) === propertyName
    ) {
      return unwrapExpression(property.initializer);
    }
  }
  return undefined;
}

function getStringLiteralValue(node) {
  const value = unwrapExpression(node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return value.text;
  }
  return undefined;
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function getPropertyNameText(name) {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return name.getText();
}

function getModuleSpecifier(statement) {
  const specifier = statement.moduleSpecifier;
  if (specifier && ts.isStringLiteral(specifier)) {
    return specifier.text;
  }
  return undefined;
}

function isTypeOnlyImportDeclaration(statement) {
  if (statement.importClause?.isTypeOnly) {
    return true;
  }
  const namedBindings = statement.importClause?.namedBindings;
  return (
    !!namedBindings &&
    ts.isNamedImports(namedBindings) &&
    namedBindings.elements.length > 0 &&
    namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

function parseSourceFile(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function lineOf(sourceFile, node) {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function listFiles(dir, extensions) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === "out"
      ) {
        continue;
      }
      files.push(...listFiles(fullPath, extensions));
    } else if (extensions.includes(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function unique(values) {
  return [...new Set(values)];
}

function compareFileLine(left, right) {
  return left.file.localeCompare(right.file) || left.line - right.line;
}

function relative(file) {
  return path.relative(rootDir, file).replaceAll(path.sep, "/");
}

main();
