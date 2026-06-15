import React, { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Wrench } from "lucide-react";
import { useMcp } from "@/hooks/useMcp";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";

export function McpToolsPicker() {
  const { t } = useTranslation(["settings", "common"]);
  const [isOpen, setIsOpen] = useState(false);
  const { servers, toolsByServer, consentsMap, setToolConsent } = useMcp();
  const getConsentLabel = (consent: string) => {
    if (consent === "always") {
      return t("settings:agentPermissions.alwaysAllow");
    }
    if (consent === "denied") {
      return t("settings:toolsMcp.deny");
    }
    return t("settings:agentPermissions.ask");
  };

  // Removed activation toggling – consent governs execution time behavior

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        className="inline-flex items-center justify-center whitespace-nowrap rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border-none bg-transparent shadow-none text-muted-foreground hover:text-foreground hover:bg-muted/60 h-7 px-1.5 cursor-pointer"
        data-testid="mcp-tools-button"
        title={t("settings:toolsMcp.title")}
      >
        <Wrench className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        className="w-120 max-h-[80vh] overflow-y-auto"
        align="start"
      >
        <div className="space-y-4">
          <div>
            <h3 className="font-medium">{t("settings:toolsMcp.title")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("settings:toolsMcp.pickerDescription")}
            </p>
          </div>
          {servers.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              {t("settings:toolsMcp.noServersConfiguredPicker")}
            </div>
          ) : (
            <div className="space-y-3">
              {servers.map((s) => (
                <div key={s.id} className="border rounded-md p-2">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm truncate">{s.name}</div>
                    {s.enabled ? (
                      <Badge variant="secondary">{t("common:enabled")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("common:disabled")}</Badge>
                    )}
                  </div>
                  <div className="mt-2 space-y-1">
                    {(toolsByServer[s.id] || []).map((tool) => (
                      <div
                        key={tool.name}
                        className="flex items-center justify-between gap-2 rounded border p-2"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-sm truncate">
                            {tool.name}
                          </div>
                          {tool.description && (
                            <div className="text-xs text-muted-foreground truncate">
                              {tool.description}
                            </div>
                          )}
                        </div>
                        {(() => {
                          const consent =
                            consentsMap[`${s.id}:${tool.name}`] ||
                            tool.consent ||
                            "ask";
                          return (
                            <Select
                              value={consent}
                              onValueChange={(v) =>
                                setToolConsent(s.id, tool.name, v as any)
                              }
                            >
                              <SelectTrigger className="w-[140px] h-8">
                                <SelectValue>
                                  {getConsentLabel(consent)}
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
                          );
                        })()}
                      </div>
                    ))}
                    {(toolsByServer[s.id] || []).length === 0 && (
                      <div className="text-xs text-muted-foreground">
                        {t("settings:toolsMcp.noToolsDiscovered")}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
