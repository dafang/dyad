import type { UserBudgetInfo } from "@/ipc/types";

export function canUsePreviewAdvancedTools({
  hideDyadProUi,
  userBudget,
}: {
  hideDyadProUi: boolean;
  userBudget: UserBudgetInfo | null | undefined;
}): boolean {
  return hideDyadProUi || Boolean(userBudget);
}
