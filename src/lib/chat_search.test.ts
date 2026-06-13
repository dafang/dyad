import { describe, expect, it } from "vitest";

import {
  getHideChatMenuSearchValue,
  isChatMenuHiddenSearchValue,
} from "./chat_search";

describe("chat search helpers", () => {
  it("treats only enabled hide-menu values as hidden", () => {
    expect(isChatMenuHiddenSearchValue("1")).toBe(true);
    expect(isChatMenuHiddenSearchValue(1)).toBe(true);
    expect(isChatMenuHiddenSearchValue(true)).toBe(true);
    expect(isChatMenuHiddenSearchValue(false)).toBe(false);
    expect(isChatMenuHiddenSearchValue(undefined)).toBe(false);
  });

  it("serializes hidden chat menu state for router search objects", () => {
    expect(getHideChatMenuSearchValue({ hideMenu: "1" })).toBe(1);
    expect(getHideChatMenuSearchValue({ hideMenu: true })).toBe(1);
    expect(getHideChatMenuSearchValue({ hideMenu: false })).toBeUndefined();
    expect(getHideChatMenuSearchValue({})).toBeUndefined();
  });
});
