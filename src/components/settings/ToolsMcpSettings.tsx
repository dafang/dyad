import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMcp, type Transport } from "@/hooks/useMcp";
import { ipc } from "@/ipc/types";
import { DEFAULT_OAUTH_CALLBACK_PORT } from "@/ipc/types/mcp";
import { showError, showInfo, showSuccess } from "@/lib/toast";
import { Edit2, Plus, Save, Trash2, X } from "lucide-react";
import { useDeepLink } from "@/contexts/DeepLinkContext";
import { AddMcpServerDeepLinkData } from "@/ipc/deep_link_data";
import { useTranslation } from "react-i18next";

type ConnectFeedback = {
  serverId: number;
  kind: "discovery_failed" | "unauthorized" | "other";
  message: string;
};

type KeyValue = { key: string; value: string };

function parseJsonToArray(
  json?: Record<string, string> | string | null,
): KeyValue[] {
  if (!json) return [];
  try {
    const obj =
      typeof json === "string"
        ? (JSON.parse(json) as unknown as Record<string, string>)
        : (json as Record<string, string>);
    return Object.entries(obj).map(([key, value]) => ({
      key,
      value: String(value ?? ""),
    }));
  } catch {
    return [];
  }
}

function arrayToJsonObject(envVars: KeyValue[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const { key, value } of envVars) {
    if (key.trim().length === 0) continue;
    env[key.trim()] = value;
  }
  return env;
}

function KeyValueEditor({
  id,
  json,
  disabled,
  onSave,
  isSaving,
  itemLabel = "Environment Variable",
}: {
  id: number;
  json?: Record<string, string> | null;
  disabled?: boolean;
  onSave: (envVars: KeyValue[]) => Promise<void>;
  isSaving: boolean;
  itemLabel?: string;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const initial = useMemo(() => parseJsonToArray(json), [json]);
  const [envVars, setEnvVars] = useState<KeyValue[]>(initial);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingKeyValue, setEditingKeyValue] = useState("");
  const [editingValue, setEditingValue] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [isAddingNew, setIsAddingNew] = useState(false);
  const itemTranslation =
    itemLabel === "Header"
      ? t("settings:toolsMcp.header")
      : t("settings:toolsMcp.environmentVariable");

  React.useEffect(() => {
    setEnvVars(initial);
  }, [id, initial]);

  const saveAll = async (next: KeyValue[]) => {
    await onSave(next);
    setEnvVars(next);
  };

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim()) {
      showError(t("settings:toolsMcp.keyValueRequired"));
      return;
    }
    if (envVars.some((e) => e.key === newKey.trim())) {
      showError(t("settings:toolsMcp.duplicateKey"));
      return;
    }
    const next = [...envVars, { key: newKey.trim(), value: newValue.trim() }];
    await saveAll(next);
    setNewKey("");
    setNewValue("");
    setIsAddingNew(false);
    showSuccess(t("settings:toolsMcp.itemsSaved", { item: itemTranslation }));
  };

  const handleEdit = (kv: KeyValue) => {
    setEditingKey(kv.key);
    setEditingKeyValue(kv.key);
    setEditingValue(kv.value);
  };

  const handleSaveEdit = async () => {
    if (!editingKey) return;
    if (!editingKeyValue.trim() || !editingValue.trim()) {
      showError(t("settings:toolsMcp.keyValueRequired"));
      return;
    }
    if (
      envVars.some(
        (e) => e.key === editingKeyValue.trim() && e.key !== editingKey,
      )
    ) {
      showError(t("settings:toolsMcp.duplicateKey"));
      return;
    }
    const next = envVars.map((e) =>
      e.key === editingKey
        ? { key: editingKeyValue.trim(), value: editingValue.trim() }
        : e,
    );
    await saveAll(next);
    setEditingKey(null);
    setEditingKeyValue("");
    setEditingValue("");
    showSuccess(t("settings:toolsMcp.itemsSaved", { item: itemTranslation }));
  };

  const handleCancelEdit = () => {
    setEditingKey(null);
    setEditingKeyValue("");
    setEditingValue("");
  };

  const handleDelete = async (key: string) => {
    const next = envVars.filter((e) => e.key !== key);
    await saveAll(next);
    showSuccess(t("settings:toolsMcp.itemsSaved", { item: itemTranslation }));
  };

  return (
    <div className="mt-3 space-y-3">
      {isAddingNew ? (
        <div className="space-y-3 p-3 border rounded-md bg-muted/50">
          <div className="space-y-2">
            <Label htmlFor={`env-new-key-${id}`}>
              {t("settings:toolsMcp.key")}
            </Label>
            <Input
              id={`env-new-key-${id}`}
              placeholder={
                itemLabel === "Header"
                  ? t("settings:toolsMcp.key")
                  : t("settings:toolsMcp.keyPlaceholder")
              }
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              autoFocus
              disabled={disabled || isSaving}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`env-new-value-${id}`}>
              {t("settings:toolsMcp.value")}
            </Label>
            <Input
              id={`env-new-value-${id}`}
              placeholder={
                itemLabel === "Header"
                  ? t("settings:toolsMcp.value")
                  : t("settings:toolsMcp.valuePlaceholder")
              }
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              disabled={disabled || isSaving}
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleAdd}
              size="sm"
              disabled={disabled || isSaving}
            >
              <Save size={14} />
              {isSaving ? t("common:saving") : t("common:save")}
            </Button>
            <Button
              onClick={() => {
                setIsAddingNew(false);
                setNewKey("");
                setNewValue("");
              }}
              variant="outline"
              size="sm"
            >
              <X size={14} />
              {t("common:cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => setIsAddingNew(true)}
          variant="outline"
          className="w-full"
          disabled={disabled}
        >
          <Plus size={14} />
          {t("settings:toolsMcp.addEnvVar")}
        </Button>
      )}

      <div className="space-y-2">
        {envVars.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {itemLabel === "Header"
              ? t("settings:toolsMcp.noHeadersConfigured")
              : t("settings:toolsMcp.noEnvVars")}
          </p>
        ) : (
          envVars.map((kv) => (
            <div
              key={kv.key}
              className="flex items-center space-x-2 p-2 border rounded-md"
            >
              {editingKey === kv.key ? (
                <>
                  <div className="flex-1 space-y-2">
                    <Input
                      value={editingKeyValue}
                      onChange={(e) => setEditingKeyValue(e.target.value)}
                      placeholder={t("settings:toolsMcp.key")}
                      className="h-8"
                      disabled={disabled || isSaving}
                    />
                    <Input
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      placeholder={t("settings:toolsMcp.value")}
                      className="h-8"
                      disabled={disabled || isSaving}
                    />
                  </div>
                  <div className="flex gap-1">
                    <Button
                      onClick={handleSaveEdit}
                      size="sm"
                      variant="outline"
                      disabled={disabled || isSaving}
                    >
                      <Save size={14} />
                    </Button>
                    <Button
                      onClick={handleCancelEdit}
                      size="sm"
                      variant="outline"
                    >
                      <X size={14} />
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{kv.key}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {kv.value}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      onClick={() => handleEdit(kv)}
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      disabled={disabled}
                    >
                      <Edit2 size={14} />
                    </Button>
                    <Button
                      onClick={() => handleDelete(kv.key)}
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      disabled={disabled || isSaving}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function ToolsMcpSettings() {
  const {
    servers,
    toolsByServer,
    statusByServer,
    consentsMap,
    createServer,
    toggleEnabled: toggleServerEnabled,
    deleteServer,
    setToolConsent: updateToolConsent,
    updateServer,
    isUpdatingServer,
    startOAuth,
    disconnectOAuth,
    isStartingOAuth,
    isDisconnectingOAuth,
  } = useMcp();
  const { t } = useTranslation(["settings", "common"]);
  const [consents, setConsents] = useState<Record<string, any>>({});
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<Transport>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState<string>("");
  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [oauthEnabled, setOauthEnabled] = useState(true);
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthScope, setOauthScope] = useState("");
  const [connectingServerId, setConnectingServerId] = useState<number | null>(
    null,
  );
  const [disconnectingServerId, setDisconnectingServerId] = useState<
    number | null
  >(null);
  const [connectFeedback, setConnectFeedback] =
    useState<ConnectFeedback | null>(null);

  // Falls back to the default port on probe failure so the UI
  // doesn't show "…" forever; the OAuth flow uses the same default.
  // The port stays stable while the form is open so the redirect-URI
  // hint matches the value saved on submit -- the user may register it
  // at their provider mid-form. A taken port surfaces on bind instead.
  const callbackPortQuery = useQuery({
    queryKey: ["mcp", "callbackPort"],
    queryFn: () =>
      ipc.mcp
        .probeCallbackPort()
        .then((r) => r.port)
        .catch(() => DEFAULT_OAUTH_CALLBACK_PORT),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const callbackPort = callbackPortQuery.data ?? null;

  // Assume encrypted on probe failure — a false-positive banner is
  // worse than going silent on a transient IPC hiccup.
  const oauthStorageEncryptedQuery = useQuery({
    queryKey: ["mcp", "isOauthStorageEncrypted"],
    queryFn: () =>
      ipc.mcp
        .isOauthStorageEncrypted()
        .then((r) => r.available)
        .catch(() => true),
    staleTime: 5 * 60 * 1000,
  });
  const oauthStorageEncrypted = oauthStorageEncryptedQuery.data ?? null;
  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
  useEffect(() => {
    const handleDeepLink = async () => {
      if (lastDeepLink?.type === "add-mcp-server") {
        const deepLink = lastDeepLink as AddMcpServerDeepLinkData;
        const payload = deepLink.payload;
        showInfo(
          t("settings:toolsMcp.prefilledServer", { name: payload.name }),
        );
        setName(payload.name);
        setTransport(payload.config.type);
        if (payload.config.type === "stdio") {
          const [command, ...args] = payload.config.command.split(" ");
          setCommand(command);
          setArgs(args.join(" "));
        } else {
          setUrl(payload.config.url);
        }
        clearLastDeepLink();
      }
    };
    handleDeepLink();
  }, [lastDeepLink?.timestamp]);

  React.useEffect(() => {
    setConsents(consentsMap);
  }, [consentsMap]);

  const [isAdding, setIsAdding] = useState(false);

  const onCreate = async () => {
    if (isAdding) return;
    setIsAdding(true);
    try {
      await runOnCreate();
    } finally {
      setIsAdding(false);
    }
  };

  const runOnCreate = async () => {
    if (transport === "http") {
      const trimmedUrl = url.trim();
      if (!trimmedUrl) {
        showError(t("settings:toolsMcp.urlRequired"));
        return;
      }
      try {
        const parsed = new URL(trimmedUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          showError(t("settings:toolsMcp.urlProtocolRequired"));
          return;
        }
      } catch {
        showError(t("settings:toolsMcp.invalidUrl", { url: trimmedUrl }));
        return;
      }
    }
    const parsedArgs = (() => {
      const trimmed = args.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith("[")) {
        try {
          const arr = JSON.parse(trimmed);
          return Array.isArray(arr) && arr.every((x) => typeof x === "string")
            ? (arr as string[])
            : null;
        } catch {
          // fall through
        }
      }
      return trimmed.split(" ").filter(Boolean);
    })();
    const wantsOAuth = oauthEnabled && transport === "http";
    const created = await createServer({
      name,
      transport,
      command: command || null,
      args: parsedArgs,
      url: url || null,
      enabled,
      oauthEnabled: wantsOAuth,
      // Skip OAuth fields if the user turned the toggle off — no
      // stray client secret in the DB (especially not as plaintext).
      oauthClientId: wantsOAuth ? oauthClientId.trim() || null : null,
      oauthClientSecret: wantsOAuth ? oauthClientSecret.trim() || null : null,
      oauthScope: wantsOAuth ? oauthScope.trim() || null : null,
      oauthCallbackPort:
        wantsOAuth && typeof callbackPort === "number" ? callbackPort : null,
    });
    setName("");
    setCommand("");
    setArgs("");
    setUrl("");
    setEnabled(true);
    setOauthEnabled(true);
    setOauthClientId("");
    setOauthClientSecret("");
    setOauthScope("");
    setConnectFeedback(null);

    if (transport === "http" && created) {
      if (wantsOAuth) {
        // Bridge the gap until the new row arrives in `serversQuery`
        // and shows its own "Connecting…" state.
        showInfo(
          t("settings:toolsMcp.connectingOAuthFor", { name: created.name }),
        );
        await runAutoConnect(created.id, {
          showToast: true,
          callbackPort:
            typeof callbackPort === "number" ? callbackPort : undefined,
        });
      } else {
        await runProbe(created.id, { showToast: true });
      }
    }
  };

  const runAutoConnect = async (
    serverId: number,
    opts?: { showToast?: boolean; callbackPort?: number },
  ) => {
    // Clear any prior feedback so a stale "discovery_failed" alert
    // can't sit next to a fresh error toast on the retry path.
    setConnectFeedback(null);
    setConnectingServerId(serverId);
    try {
      // No port means the flow uses the server's saved port, which
      // matches its registered redirect URI. Callers pass the probed
      // port only for rows with none saved yet.
      const result = await startOAuth({
        serverId,
        callbackPort: opts?.callbackPort,
      });
      if (result.success) {
        setConnectFeedback(null);
        showSuccess(t("settings:toolsMcp.oauthConnectionSuccessful"));
        return;
      }
      const message = result.error ?? t("settings:toolsMcp.oauthFlowFailed");
      if (result.errorKind === "discovery_failed") {
        setConnectFeedback({
          serverId,
          kind: "discovery_failed",
          message,
        });
        // Toast only on the initial post-registration attempt so the
        // failure is visible even when the new row is scrolled out of
        // view. Manual retries show the inline panel in place.
        if (opts?.showToast) {
          showError(t("settings:toolsMcp.oauthUnsupportedToast"));
        }
      } else {
        showError(message);
      }
    } finally {
      setConnectingServerId(null);
    }
  };

  const runProbe = async (serverId: number, opts?: { showToast?: boolean }) => {
    try {
      const result = await ipc.mcp.probeConnection(serverId);
      if (result.status === "unauthorized") {
        setConnectFeedback({
          serverId,
          kind: "unauthorized",
          message: t("settings:toolsMcp.serverRequiresAuthenticationMessage"),
        });
        if (opts?.showToast) {
          showError(t("settings:toolsMcp.serverRequiresAuthenticationToast"));
        }
      } else {
        setConnectFeedback(null);
      }
    } catch {
      // Best-effort probe; swallow on failure.
    }
  };

  const onConnect = async (serverId: number) => {
    await runAutoConnect(serverId);
  };

  const onEnableOAuthAndRetry = async (serverId: number) => {
    await updateServer({ id: serverId, oauthEnabled: true });
    setConnectFeedback(null);
    // Just enabled, so no saved port yet -- use the probed one.
    await runAutoConnect(serverId, {
      callbackPort: typeof callbackPort === "number" ? callbackPort : undefined,
    });
  };

  const onDisableOAuthAndRetry = async (serverId: number) => {
    await updateServer({ id: serverId, oauthEnabled: false });
    setConnectFeedback(null);
    await runProbe(serverId);
  };

  const onDisconnect = async (serverId: number) => {
    setDisconnectingServerId(serverId);
    try {
      await disconnectOAuth(serverId);
      showSuccess(t("settings:toolsMcp.oauthDisconnected"));
    } catch (err) {
      showError(
        err instanceof Error
          ? err.message
          : t("settings:toolsMcp.oauthDisconnectFailed"),
      );
    } finally {
      setDisconnectingServerId(null);
    }
  };

  const onSetToolConsent = async (
    serverId: number,
    toolName: string,
    consent: "ask" | "always" | "denied",
  ) => {
    await updateToolConsent(serverId, toolName, consent);
    setConsents((prev) => ({ ...prev, [`${serverId}:${toolName}`]: consent }));
  };
  const getToolConsentLabel = (consent: string) => {
    if (consent === "always") {
      return t("settings:agentPermissions.alwaysAllow");
    }
    if (consent === "denied") {
      return t("settings:toolsMcp.deny");
    }
    return t("settings:agentPermissions.ask");
  };

  const hasOauthServer = useMemo(
    () => (servers || []).some((s) => s.transport === "http" && s.oauthEnabled),
    [servers],
  );
  // Surface the no-keyring warning as soon as the user is about to
  // commit an OAuth secret (form has HTTP + OAuth toggle on), not
  // only after a server already exists.
  const willPersistOauthSecret =
    transport === "http" && oauthEnabled && oauthClientSecret.trim().length > 0;
  const showPlaintextBanner =
    oauthStorageEncrypted === false &&
    (hasOauthServer || willPersistOauthSecret);

  return (
    <div className="space-y-6">
      {showPlaintextBanner && (
        <Alert variant="destructive">
          <AlertTitle>{t("settings:toolsMcp.plaintextTitle")}</AlertTitle>
          <AlertDescription>
            {t("settings:toolsMcp.plaintextDescriptionBefore")}
            <code className="mx-1">libsecret</code>/<code>gnome-keyring</code>
            {t("settings:toolsMcp.plaintextDescriptionAfter")}
          </AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("settings:toolsMcp.name")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("settings:toolsMcp.namePlaceholder")}
            />
          </div>
          <div>
            <Label htmlFor="mcp-transport-select">
              {t("settings:toolsMcp.transport")}
            </Label>
            <select
              id="mcp-transport-select"
              data-testid="mcp-transport-select"
              value={transport}
              onChange={(e) => setTransport(e.target.value as Transport)}
              className="w-full h-9 rounded-md border bg-transparent px-3 text-sm"
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </select>
          </div>
          {transport === "stdio" && (
            <>
              <div>
                <Label>{t("settings:toolsMcp.command")}</Label>
                <Input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder={t("settings:toolsMcp.commandPlaceholder")}
                />
              </div>
              <div>
                <Label>{t("settings:toolsMcp.args")}</Label>
                <Input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder={t("settings:toolsMcp.argsPlaceholder")}
                />
              </div>
            </>
          )}
          {transport === "http" && (
            <>
              <div className="col-span-2">
                <Label>{t("settings:toolsMcp.url")}</Label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t("settings:toolsMcp.urlPlaceholder")}
                />
              </div>
              <div className="col-span-2">
                <div className="flex items-center gap-2">
                  <Switch
                    aria-label={t("settings:toolsMcp.useOAuth")}
                    checked={oauthEnabled}
                    onCheckedChange={setOauthEnabled}
                  />
                  <Label>{t("settings:toolsMcp.useOAuth")}</Label>
                </div>
                <div className="ml-10 mt-1 text-xs text-muted-foreground">
                  {t("settings:toolsMcp.oauthRequiredForRemote")}
                </div>
              </div>
              {oauthEnabled && (
                <div className="col-span-2">
                  <Accordion>
                    <AccordionItem value="advanced">
                      <AccordionTrigger className="py-2 text-sm">
                        {t("settings:toolsMcp.advancedOAuthOptions")}
                      </AccordionTrigger>
                      <AccordionContent className="space-y-3">
                        <div>
                          <Label>
                            {t("settings:toolsMcp.oauthClientId")}
                            <span className="ml-1 text-xs text-muted-foreground">
                              {t("settings:toolsMcp.oauthClientIdHelp")}
                            </span>
                          </Label>
                          <Input
                            value={oauthClientId}
                            onChange={(e) => setOauthClientId(e.target.value)}
                            placeholder={t(
                              "settings:toolsMcp.oauthClientIdPlaceholder",
                            )}
                          />
                        </div>
                        <div>
                          <Label>
                            {t("settings:toolsMcp.oauthClientSecret")}
                            <span className="ml-1 text-xs text-muted-foreground">
                              {t("settings:toolsMcp.oauthClientSecretHelp")}
                            </span>
                          </Label>
                          <Input
                            type="password"
                            value={oauthClientSecret}
                            onChange={(e) =>
                              setOauthClientSecret(e.target.value)
                            }
                            placeholder={t(
                              "settings:toolsMcp.oauthClientSecretPlaceholder",
                            )}
                          />
                        </div>
                        <div>
                          <Label>
                            {t("settings:toolsMcp.oauthScope")}
                            <span className="ml-1 text-xs text-muted-foreground">
                              {t("settings:toolsMcp.oauthScopeHelp")}
                            </span>
                          </Label>
                          <Input
                            value={oauthScope}
                            onChange={(e) => setOauthScope(e.target.value)}
                            placeholder=""
                          />
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t("settings:toolsMcp.redirectUriBefore")}{" "}
                          <code>
                            http://localhost:
                            {callbackPort ?? "…"}
                            /callback
                          </code>{" "}
                          {t("settings:toolsMcp.redirectUriAfter")}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              )}
            </>
          )}
          <div className="flex items-center gap-2">
            <Switch
              aria-label={t("common:enabled")}
              checked={enabled}
              onCheckedChange={setEnabled}
            />
            <Label>{t("common:enabled")}</Label>
          </div>
        </div>
        <div>
          <Button onClick={onCreate} disabled={!name.trim() || isAdding}>
            {isAdding
              ? t("settings:toolsMcp.addingServer")
              : t("settings:toolsMcp.addServer")}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {servers.map((s) => {
          // An OAuth-off server that returns 401 needs auth; surface
          // that from the live probe status so the alert stays put.
          const rowFeedback: ConnectFeedback | null =
            connectFeedback && connectFeedback.serverId === s.id
              ? connectFeedback
              : !s.oauthEnabled && statusByServer[s.id] === "unauthorized"
                ? {
                    serverId: s.id,
                    kind: "unauthorized",
                    message: t(
                      "settings:toolsMcp.serverRequiresAuthenticationMessage",
                    ),
                  }
                : null;
          return (
            <div key={s.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {s.name}
                    {s.oauthEnabled && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          s.oauthConnected
                            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100"
                        }`}
                      >
                        {t("settings:toolsMcp.oauthStatus", {
                          status: s.oauthConnected
                            ? t("settings:toolsMcp.connected")
                            : t("settings:toolsMcp.notConnected"),
                        })}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.transport}
                    {s.url ? ` · ${s.url}` : ""}
                    {s.command ? ` · ${s.command}` : ""}
                    {Array.isArray(s.args) && s.args.length
                      ? ` · ${s.args.join(" ")}`
                      : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {s.oauthEnabled && !s.oauthConnected && (
                    <Button
                      variant="default"
                      onClick={() => onConnect(s.id)}
                      disabled={isStartingOAuth && connectingServerId === s.id}
                    >
                      {isStartingOAuth && connectingServerId === s.id
                        ? t("settings:toolsMcp.connecting")
                        : t("settings:toolsMcp.connect")}
                    </Button>
                  )}
                  {s.oauthEnabled && s.oauthConnected && (
                    <Button
                      variant="outline"
                      onClick={() => onDisconnect(s.id)}
                      disabled={
                        isDisconnectingOAuth && disconnectingServerId === s.id
                      }
                    >
                      {isDisconnectingOAuth && disconnectingServerId === s.id
                        ? t("settings:toolsMcp.disconnecting")
                        : t("settings:toolsMcp.disconnect")}
                    </Button>
                  )}
                  <Switch
                    aria-label={t("settings:toolsMcp.toggleServer", {
                      name: s.name,
                    })}
                    checked={!!s.enabled}
                    onCheckedChange={() =>
                      toggleServerEnabled(s.id, !!s.enabled)
                    }
                  />
                  <Button variant="outline" onClick={() => deleteServer(s.id)}>
                    {t("common:delete")}
                  </Button>
                </div>
              </div>
              {s.transport === "stdio" && (
                <div className="mt-3">
                  <div className="text-sm font-medium mb-2">
                    {t("settings:toolsMcp.environmentVariables")}
                  </div>
                  <KeyValueEditor
                    id={s.id}
                    json={s.envJson}
                    disabled={!s.enabled}
                    isSaving={!!isUpdatingServer}
                    onSave={async (pairs) => {
                      await updateServer({
                        id: s.id,
                        envJson: arrayToJsonObject(pairs),
                      });
                    }}
                  />
                </div>
              )}
              {rowFeedback && (
                <div className="mt-3">
                  <Alert variant="destructive">
                    <AlertTitle>
                      {rowFeedback.kind === "unauthorized"
                        ? t("settings:toolsMcp.serverRequiresAuthentication")
                        : rowFeedback.kind === "discovery_failed"
                          ? t("settings:toolsMcp.serverDoesNotSupportOAuth")
                          : t("settings:toolsMcp.connectionFailed")}
                    </AlertTitle>
                    <AlertDescription className="gap-2">
                      <span>{rowFeedback.message}</span>
                      {rowFeedback.kind === "unauthorized" && (
                        <Button
                          size="sm"
                          onClick={() => onEnableOAuthAndRetry(s.id)}
                          disabled={isUpdatingServer || isStartingOAuth}
                        >
                          {t("settings:toolsMcp.enableOAuthAndRetry")}
                        </Button>
                      )}
                      {rowFeedback.kind === "discovery_failed" && (
                        <Button
                          size="sm"
                          onClick={() => onDisableOAuthAndRetry(s.id)}
                          disabled={isUpdatingServer}
                        >
                          {t("settings:toolsMcp.disableOAuthAndRetry")}
                        </Button>
                      )}
                    </AlertDescription>
                  </Alert>
                </div>
              )}
              {s.transport === "http" && (
                <div className="mt-3">
                  <div className="text-sm font-medium mb-2">
                    {t("settings:toolsMcp.headers")}
                  </div>
                  <KeyValueEditor
                    id={s.id}
                    json={s.headersJson}
                    disabled={!s.enabled}
                    isSaving={!!isUpdatingServer}
                    itemLabel="Header"
                    onSave={async (pairs) => {
                      await updateServer({
                        id: s.id,
                        headersJson: arrayToJsonObject(pairs),
                      });
                    }}
                  />
                </div>
              )}
              <div className="mt-3 space-y-2">
                {(toolsByServer[s.id] || []).map((tool) => {
                  const consent = consents[`${s.id}:${tool.name}`] || "ask";
                  return (
                    <div key={tool.name} className="border rounded p-2">
                      <div className="flex items-center gap-4">
                        <div className="font-mono text-sm truncate">
                          {tool.name}
                        </div>
                        <div className="flex items-center gap-2">
                          <Select
                            value={consent}
                            onValueChange={(v) =>
                              onSetToolConsent(s.id, tool.name, v as any)
                            }
                          >
                            <SelectTrigger className="w-[140px] h-8">
                              <SelectValue>
                                {getToolConsentLabel(consent)}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ask">
                                {t("settings:agentPermissions.ask")}
                              </SelectItem>
                              <SelectItem value="always">
                                {t("settings:agentPermissions.alwaysAllow")}
                              </SelectItem>
                              <SelectItem value="denied">
                                {t("settings:toolsMcp.deny")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {tool.description && (
                        <div className="mt-1 text-xs max-w-[500px] text-muted-foreground truncate">
                          {tool.description}
                        </div>
                      )}
                    </div>
                  );
                })}
                {(toolsByServer[s.id] || []).length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    {t("settings:toolsMcp.noToolsDiscovered")}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {servers.length === 0 && (
          <div className="text-sm text-muted-foreground">
            {t("settings:toolsMcp.noServersConfigured")}
          </div>
        )}
      </div>
    </div>
  );
}
