import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export type AppsView = "apps" | "collections";

interface AppsViewTabsProps {
  value: AppsView;
  onChange: (value: AppsView) => void;
}

const TABS = [
  { key: "apps", labelKey: "appsPage.tabs.apps" },
  { key: "collections", labelKey: "appsPage.tabs.collections" },
] as const satisfies ReadonlyArray<{
  key: AppsView;
  labelKey: "appsPage.tabs.apps" | "appsPage.tabs.collections";
}>;

export function AppsViewTabs({ value, onChange }: AppsViewTabsProps) {
  const { t } = useTranslation("home");
  return (
    <div
      role="tablist"
      aria-label={t("appsPage.tabs.ariaLabel")}
      className="flex items-center gap-2"
      data-testid="apps-view-tabs"
    >
      {TABS.map((tab) => {
        const active = value === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`apps-view-tab-${tab.key}`}
            onClick={() => onChange(tab.key)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              "border",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-(--background-lighter) text-foreground border-border hover:border-primary/40",
            )}
          >
            {t(tab.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
