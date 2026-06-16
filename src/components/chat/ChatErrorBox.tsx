import { ipc } from "@/ipc/types";
import { useFreeAgentQuota } from "@/hooks/useFreeAgentQuota";
import { AI_STREAMING_ERROR_MESSAGE_PREFIX } from "@/shared/texts";
import {
  X,
  ExternalLink as ExternalLinkIcon,
  CircleArrowUp,
  MessageSquarePlus,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { shouldHideDyadProUi } from "@/lib/dyad_pro_ui";
import { useTranslation } from "react-i18next";

export function ChatErrorBox({
  onDismiss,
  error,
  isDyadProEnabled,
  onStartNewChat,
}: {
  onDismiss: () => void;
  error: string;
  isDyadProEnabled: boolean;
  onStartNewChat?: () => void;
}) {
  const { t } = useTranslation("chat");
  const { messagesLimit } = useFreeAgentQuota();
  const hideDyadProUi = shouldHideDyadProUi();

  if (error.includes("doesn't have a free quota tier")) {
    return (
      <ChatErrorContainer onDismiss={onDismiss}>
        {error}
        {hideDyadProUi ? (
          <span className="ml-1">{t("errorBox.switchToAnotherModel")}</span>
        ) : (
          <>
            <span className="ml-1">
              <ExternalLink
                href="https://dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=free-quota-error"
                variant="primary"
              >
                {t("errorBox.accessWithDyadPro")}
              </ExternalLink>
            </span>{" "}
            {t("errorBox.orSwitchModel")}
          </>
        )}
      </ChatErrorContainer>
    );
  }

  // Important, this needs to come after the "free quota tier" check
  // because it also includes this URL in the error message
  //
  // Sometimes Bzyai Pro can return rate limit errors and we do not want to
  // show the upgrade to Bzyai Pro link in that case because they are
  // already on the Bzyai Pro plan.
  if (
    !isDyadProEnabled &&
    (error.includes("Resource has been exhausted") ||
      error.includes("https://ai.google.dev/gemini-api/docs/rate-limits") ||
      error.includes("Provider returned error"))
  ) {
    return (
      <ChatErrorContainer onDismiss={onDismiss}>
        {error}
        <div className="mt-2 space-y-2 space-x-2">
          {!hideDyadProUi && (
            <ExternalLink
              href="https://dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=rate-limit-error"
              variant="primary"
            >
              {t("errorBox.upgradeToDyadPro")}
            </ExternalLink>
          )}

          <ExternalLink href="https://dyad.sh/docs/help/ai-rate-limit">
            {t("errorBox.troubleshootingGuide")}
          </ExternalLink>
        </div>
      </ChatErrorContainer>
    );
  }

  if (error.includes("LiteLLM Virtual Key expected")) {
    if (hideDyadProUi) {
      return (
        <ChatInfoContainer onDismiss={onDismiss}>
          {t("errorBox.invalidConfiguredAiKey")}
        </ChatInfoContainer>
      );
    }
    return (
      <ChatInfoContainer onDismiss={onDismiss}>
        <span>
          {t("errorBox.invalidProKey")}{" "}
          <ExternalLink
            href="https://dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=invalid-pro-key-error"
            variant="primary"
          >
            {t("errorBox.upgradeToDyadPro")}
          </ExternalLink>{" "}
          {t("errorBox.today")}
        </span>
      </ChatInfoContainer>
    );
  }
  if (isDyadProEnabled && error.includes("ExceededBudget:")) {
    if (hideDyadProUi) {
      return (
        <ChatInfoContainer onDismiss={onDismiss}>
          {t("errorBox.configuredCreditsUsed")}
        </ChatInfoContainer>
      );
    }
    return (
      <ChatInfoContainer onDismiss={onDismiss}>
        <span>
          {t("errorBox.creditsUsed")}{" "}
          <ExternalLink
            href="https://academy.dyad.sh/subscription?utm_source=dyad-app&utm_medium=app&utm_campaign=exceeded-budget-error"
            variant="primary"
          >
            {t("errorBox.reloadOrUpgrade")}
          </ExternalLink>{" "}
          {t("errorBox.getMoreCredits")}
        </span>
      </ChatInfoContainer>
    );
  }
  // This is a very long list of model fallbacks that clutters the error message.
  //
  // We are matching "Fallbacks=[{" and not just "Fallbacks=" because the fallback
  // model itself can error and we want to include the fallback model error in the error message.
  // Example: https://github.com/dyad-sh/dyad/issues/1849#issuecomment-3590685911
  const fallbackPrefix = "Fallbacks=[{";
  if (error.includes(fallbackPrefix)) {
    error = error.split(fallbackPrefix)[0];
  }
  // Handle FREE_AGENT_QUOTA_EXCEEDED error (Basic Agent mode quota exceeded)
  if (error.includes("FREE_AGENT_QUOTA_EXCEEDED")) {
    return (
      <ChatErrorContainer onDismiss={onDismiss}>
        {t("errorBox.freeAgentQuotaExceeded", { count: messagesLimit })}
        <div className="mt-2 space-y-2 space-x-2">
          {!hideDyadProUi && (
            <ExternalLink
              href="https://dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=free-agent-quota-exceeded"
              variant="primary"
            >
              {t("errorBox.upgradeToDyadPro")}
            </ExternalLink>
          )}
        </div>
      </ChatErrorContainer>
    );
  }

  return (
    <ChatErrorContainer onDismiss={onDismiss}>
      {error}
      <div className="mt-2 space-y-2 space-x-2">
        {!hideDyadProUi &&
          !isDyadProEnabled &&
          error.includes(AI_STREAMING_ERROR_MESSAGE_PREFIX) &&
          !error.includes("TypeError: terminated") && (
            <ExternalLink
              href="https://dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=general-error"
              variant="primary"
            >
              Upgrade to Bzyai Pro
            </ExternalLink>
          )}
        {isDyadProEnabled && onStartNewChat && (
          <Tooltip>
            <TooltipTrigger
              onClick={onStartNewChat}
              className="cursor-pointer inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500"
            >
              <span>{t("errorBox.startNewChat")}</span>
              <MessageSquarePlus size={18} />
            </TooltipTrigger>
            <TooltipContent>{t("errorBox.startNewChatTooltip")}</TooltipContent>
          </Tooltip>
        )}
        <ExternalLink href="https://www.dyad.sh/docs/faq">
          {t("errorBox.readDocs")}
        </ExternalLink>
      </div>
    </ChatErrorContainer>
  );
}

function ExternalLink({
  href,
  children,
  variant = "secondary",
  icon,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  icon?: React.ReactNode;
}) {
  const baseClasses =
    "cursor-pointer inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium shadow-sm focus:outline-none focus:ring-2";
  const primaryClasses =
    "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500";
  const secondaryClasses =
    "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 hover:border-blue-300 focus:ring-blue-200";
  const iconElement =
    icon ??
    (variant === "primary" ? (
      <CircleArrowUp size={18} />
    ) : (
      <ExternalLinkIcon size={14} />
    ));

  return (
    <a
      className={`${baseClasses} ${variant === "primary" ? primaryClasses : secondaryClasses}`}
      onClick={() => ipc.system.openExternalUrl(href)}
    >
      <span>{children}</span>
      {iconElement}
    </a>
  );
}

function ChatErrorContainer({
  onDismiss,
  children,
}: {
  onDismiss: () => void;
  children: React.ReactNode | string;
}) {
  return (
    <div
      data-testid="chat-error-box"
      className="relative mt-2 bg-red-50 border border-red-200 rounded-md shadow-sm p-2 mx-4"
    >
      <button
        onClick={onDismiss}
        className="absolute top-2.5 left-2 p-1 hover:bg-red-100 rounded"
      >
        <X size={14} className="text-red-500" />
      </button>
      <div className="pl-8 py-1 text-sm">
        <div className="text-red-700 text-wrap">
          {typeof children === "string" ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ children: linkChildren, ...props }) => (
                  <a
                    {...props}
                    onClick={(e) => {
                      e.preventDefault();
                      if (props.href) {
                        ipc.system.openExternalUrl(props.href);
                      }
                    }}
                    className="text-blue-500 hover:text-blue-700"
                  >
                    {linkChildren}
                  </a>
                ),
              }}
            >
              {children}
            </ReactMarkdown>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
}

function ChatInfoContainer({
  onDismiss,
  children,
}: {
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative mt-2 bg-sky-50 border border-sky-200 rounded-md shadow-sm p-2 mx-4">
      <button
        onClick={onDismiss}
        className="absolute top-2.5 left-2 p-1 hover:bg-sky-100 rounded"
      >
        <X size={14} className="text-sky-600" />
      </button>
      <div className="pl-8 py-1 text-sm">
        <div className="text-sky-800 text-wrap">{children}</div>
      </div>
    </div>
  );
}
