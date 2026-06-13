export type ChatHideMenuSearchValue = "1" | 1 | boolean | undefined;

export const HIDE_CHAT_MENU_SEARCH_PARAM = "hide-menu";

export function isChatMenuHiddenSearchValue(
  value: ChatHideMenuSearchValue,
): boolean {
  return value === "1" || value === 1 || value === true;
}

export function getHideChatMenuSearchValue({
  hideMenu,
}: {
  hideMenu?: ChatHideMenuSearchValue;
}): "1" | undefined {
  return isChatMenuHiddenSearchValue(hideMenu) ? "1" : undefined;
}
