import { describe, expect, it } from "vitest";

import { canUsePreviewAdvancedTools } from "./previewFeatureAccess";

describe("canUsePreviewAdvancedTools", () => {
  it("allows local Web builds that hide Dyad Pro UI", () => {
    expect(
      canUsePreviewAdvancedTools({
        hideDyadProUi: true,
        userBudget: null,
      }),
    ).toBe(true);
  });

  it("keeps Electron builds gated by budget access", () => {
    expect(
      canUsePreviewAdvancedTools({
        hideDyadProUi: false,
        userBudget: null,
      }),
    ).toBe(false);
  });
});
