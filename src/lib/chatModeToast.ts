import { toast } from "sonner";
import type { ChatMode } from "./schemas";
import type { ChatModeFallbackReason } from "./chatMode";
import { isLocalWebRuntime } from "./runtime_client";
import i18n from "@/i18n";

export function getChatModeDisplayName(mode: ChatMode, isPro: boolean): string {
  switch (mode) {
    case "build":
      return i18n.t("chat:chatMode.build");
    case "ask":
      return i18n.t("chat:chatMode.ask");
    case "local-agent":
      return isPro || isLocalWebRuntime()
        ? i18n.t("chat:chatMode.agent")
        : i18n.t("chat:chatMode.basicAgent");
    case "plan":
      return i18n.t("chat:chatMode.plan");
  }
}

export function getChatModeFallbackToastId({
  chatId,
  reason,
  effectiveMode,
}: {
  chatId?: number;
  reason: ChatModeFallbackReason;
  effectiveMode: ChatMode;
}) {
  return chatId
    ? `chat-mode-fallback:${chatId}:${reason}:${effectiveMode}`
    : `chat-mode-fallback:${reason}:${effectiveMode}`;
}

export function showChatModeFallbackToast({
  effectiveMode,
  isPro,
  toastId,
}: {
  effectiveMode: ChatMode;
  isPro: boolean;
  toastId?: string;
}) {
  const modeName = getChatModeDisplayName(effectiveMode, isPro);
  const message = i18n.t("chat:chatMode.fallbackQuotaExhausted", {
    mode: modeName,
  });

  toast.warning(message, {
    id: toastId,
    duration: 8000,
    action: {
      label: i18n.t("chat:chatMode.switchMode"),
      onClick: () => {
        const trigger = document.querySelector<HTMLElement>(
          '[data-testid="chat-mode-selector"]',
        );
        if (trigger) {
          trigger.focus();
          trigger.click();
          return;
        }

        if (toastId) {
          toast.dismiss(toastId);
        }
        toast.info(i18n.t("chat:chatMode.openChatToSwitch"), {
          duration: 5000,
        });
      },
    },
  });
}
