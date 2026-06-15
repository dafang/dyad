import { useMemo } from "react";
import { useSettings } from "@/hooks/useSettings";
import { ZoomLevel, ZoomLevelSchema, DEFAULT_ZOOM_LEVEL } from "@/lib/schemas";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";

const ZOOM_LEVEL_LABELS: Record<ZoomLevel, string> = {
  "90": "90%",
  "100": "100%",
  "110": "110%",
  "125": "125%",
  "150": "150%",
};

const ZOOM_LEVEL_DESCRIPTION_KEYS = {
  "90": "general.zoomDescription90",
  "100": "general.zoomDescription100",
  "110": "general.zoomDescription110",
  "125": "general.zoomDescription125",
  "150": "general.zoomDescription150",
} as const satisfies Record<ZoomLevel, string>;

export function ZoomSelector() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  const currentZoomLevel: ZoomLevel = useMemo(() => {
    const value = settings?.zoomLevel ?? DEFAULT_ZOOM_LEVEL;
    return ZoomLevelSchema.safeParse(value).success
      ? (value as ZoomLevel)
      : DEFAULT_ZOOM_LEVEL;
  }, [settings?.zoomLevel]);

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="zoom-level">{t("general.zoom")}</Label>
        <p className="text-sm text-muted-foreground">
          {t("general.zoomDescription")}
        </p>
      </div>
      <Select
        value={currentZoomLevel}
        onValueChange={(value) =>
          updateSettings({ zoomLevel: value as ZoomLevel })
        }
      >
        <SelectTrigger id="zoom-level" className="w-[220px]">
          <SelectValue placeholder={t("general.selectZoom")} />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(ZOOM_LEVEL_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              <div className="flex flex-col text-left">
                <span>{label}</span>
                <span className="text-xs text-muted-foreground">
                  {t(ZOOM_LEVEL_DESCRIPTION_KEYS[value as ZoomLevel])}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
