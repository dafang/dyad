import React from "react";
import { useSettings } from "@/hooks/useSettings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MAX_CHAT_TURNS_IN_CONTEXT } from "@/constants/settings_constants";
import { useTranslation } from "react-i18next";

const MAX_CHAT_TURNS_LABEL_KEYS = {
  economy: "ai.maxChatTurnsOptions.economy.label",
  default: "ai.maxChatTurnsOptions.default.label",
  plus: "ai.maxChatTurnsOptions.plus.label",
  high: "ai.maxChatTurnsOptions.high.label",
  max: "ai.maxChatTurnsOptions.max.label",
} as const;

const MAX_CHAT_TURNS_DESCRIPTION_KEYS = {
  economy: "ai.maxChatTurnsOptions.economy.description",
  default: "ai.maxChatTurnsOptions.default.description",
  plus: "ai.maxChatTurnsOptions.plus.description",
  high: "ai.maxChatTurnsOptions.high.description",
  max: "ai.maxChatTurnsOptions.max.description",
} as const;

interface OptionInfo {
  value: string;
  labelKey: (typeof MAX_CHAT_TURNS_LABEL_KEYS)[keyof typeof MAX_CHAT_TURNS_LABEL_KEYS];
  descriptionKey: (typeof MAX_CHAT_TURNS_DESCRIPTION_KEYS)[keyof typeof MAX_CHAT_TURNS_DESCRIPTION_KEYS];
}

const defaultValue = "default";

const options: OptionInfo[] = [
  {
    value: "2",
    labelKey: MAX_CHAT_TURNS_LABEL_KEYS.economy,
    descriptionKey: MAX_CHAT_TURNS_DESCRIPTION_KEYS.economy,
  },
  {
    value: defaultValue,
    labelKey: MAX_CHAT_TURNS_LABEL_KEYS.default,
    descriptionKey: MAX_CHAT_TURNS_DESCRIPTION_KEYS.default,
  },
  {
    value: "5",
    labelKey: MAX_CHAT_TURNS_LABEL_KEYS.plus,
    descriptionKey: MAX_CHAT_TURNS_DESCRIPTION_KEYS.plus,
  },
  {
    value: "10",
    labelKey: MAX_CHAT_TURNS_LABEL_KEYS.high,
    descriptionKey: MAX_CHAT_TURNS_DESCRIPTION_KEYS.high,
  },
  {
    value: "100",
    labelKey: MAX_CHAT_TURNS_LABEL_KEYS.max,
    descriptionKey: MAX_CHAT_TURNS_DESCRIPTION_KEYS.max,
  },
];

export const MaxChatTurnsSelector: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");

  const handleValueChange = (value: string) => {
    if (value === "default") {
      updateSettings({ maxChatTurnsInContext: undefined });
    } else {
      const numValue = parseInt(value, 10);
      updateSettings({ maxChatTurnsInContext: numValue });
    }
  };

  // Determine the current value
  const currentValue =
    settings?.maxChatTurnsInContext?.toString() || defaultValue;

  // Find the current option to display its description
  const currentOption =
    options.find((opt) => opt.value === currentValue) || options[1];
  const getOptionLabel = (option: OptionInfo) => {
    if (option.value === defaultValue) {
      return t(option.labelKey, { count: MAX_CHAT_TURNS_IN_CONTEXT });
    }
    return t(option.labelKey);
  };
  const currentLabel = getOptionLabel(currentOption);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-4">
        <label
          htmlFor="max-chat-turns"
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {t("ai.maxChatTurns")}
        </label>
        <Select
          value={currentValue}
          onValueChange={(v) => v && handleValueChange(v)}
        >
          <SelectTrigger className="w-[180px]" id="max-chat-turns">
            <SelectValue>{currentLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {getOptionLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {t(currentOption.descriptionKey)}
      </div>
    </div>
  );
};
