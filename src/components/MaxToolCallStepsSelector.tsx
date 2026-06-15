import React from "react";
import { useSettings } from "@/hooks/useSettings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_MAX_TOOL_CALL_STEPS } from "@/constants/settings_constants";
import { useTranslation } from "react-i18next";

const MAX_TOOL_CALL_STEPS_LABEL_KEYS = {
  low: "ai.maxToolCallStepsOptions.low.label",
  medium: "ai.maxToolCallStepsOptions.medium.label",
  default: "ai.maxToolCallStepsOptions.default.label",
  high: "ai.maxToolCallStepsOptions.high.label",
} as const;

const MAX_TOOL_CALL_STEPS_DESCRIPTION_KEYS = {
  low: "ai.maxToolCallStepsOptions.low.description",
  medium: "ai.maxToolCallStepsOptions.medium.description",
  default: "ai.maxToolCallStepsOptions.default.description",
  high: "ai.maxToolCallStepsOptions.high.description",
} as const;

interface OptionInfo {
  value: string;
  labelKey: (typeof MAX_TOOL_CALL_STEPS_LABEL_KEYS)[keyof typeof MAX_TOOL_CALL_STEPS_LABEL_KEYS];
  descriptionKey: (typeof MAX_TOOL_CALL_STEPS_DESCRIPTION_KEYS)[keyof typeof MAX_TOOL_CALL_STEPS_DESCRIPTION_KEYS];
}

const defaultValue = "default";

const options: OptionInfo[] = [
  {
    value: "25",
    labelKey: MAX_TOOL_CALL_STEPS_LABEL_KEYS.low,
    descriptionKey: MAX_TOOL_CALL_STEPS_DESCRIPTION_KEYS.low,
  },
  {
    value: "50",
    labelKey: MAX_TOOL_CALL_STEPS_LABEL_KEYS.medium,
    descriptionKey: MAX_TOOL_CALL_STEPS_DESCRIPTION_KEYS.medium,
  },
  {
    value: defaultValue,
    labelKey: MAX_TOOL_CALL_STEPS_LABEL_KEYS.default,
    descriptionKey: MAX_TOOL_CALL_STEPS_DESCRIPTION_KEYS.default,
  },
  {
    value: "200",
    labelKey: MAX_TOOL_CALL_STEPS_LABEL_KEYS.high,
    descriptionKey: MAX_TOOL_CALL_STEPS_DESCRIPTION_KEYS.high,
  },
];

export const MaxToolCallStepsSelector: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");

  const handleValueChange = (value: string) => {
    if (value === "default") {
      updateSettings({ maxToolCallSteps: undefined });
    } else {
      const numValue = parseInt(value, 10);
      updateSettings({ maxToolCallSteps: numValue });
    }
  };

  // Determine the current value
  const rawValue = settings?.maxToolCallSteps;
  const currentValue =
    rawValue == null || rawValue === DEFAULT_MAX_TOOL_CALL_STEPS
      ? defaultValue
      : rawValue.toString();

  // Find the current option to display its description
  const currentOption =
    options.find((opt) => opt.value === currentValue) ||
    options.find((opt) => opt.value === defaultValue) ||
    options[0];
  const getOptionLabel = (option: OptionInfo) => {
    if (option.value === defaultValue) {
      return t(option.labelKey, { count: DEFAULT_MAX_TOOL_CALL_STEPS });
    }
    return t(option.labelKey);
  };
  const currentLabel = getOptionLabel(currentOption);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-4">
        <label
          htmlFor="max-tool-call-steps"
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {t("ai.maxToolCallSteps")}
        </label>
        <Select
          value={currentValue}
          onValueChange={(v) => v && handleValueChange(v)}
        >
          <SelectTrigger className="w-[180px]" id="max-tool-call-steps">
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
