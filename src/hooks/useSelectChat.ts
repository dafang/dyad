import { useSetAtom } from "jotai";
import {
  selectedChatIdAtom,
  pushRecentViewedChatIdAtom,
  addSessionOpenedChatIdAtom,
  chatInputValueAtom,
} from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  getHideChatMenuSearchValue,
  isChatMenuHiddenSearchValue,
  type ChatHideMenuSearchValue,
} from "@/lib/chat_search";

export function useSelectChat() {
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const pushRecentViewedChatId = useSetAtom(pushRecentViewedChatIdAtom);
  const addSessionOpenedChatId = useSetAtom(addSessionOpenedChatIdAtom);
  const setChatInputValue = useSetAtom(chatInputValueAtom);
  const navigate = useNavigate();
  const currentHideMenu = useRouterState({
    select: (state) =>
      state.location.pathname === "/chat"
        ? isChatMenuHiddenSearchValue(
            state.location.search["hide-menu"] as ChatHideMenuSearchValue,
          )
        : false,
  });

  return {
    selectChat: ({
      chatId,
      appId,
      preserveTabOrder = false,
      prefillInput,
      hideMenu,
    }: {
      chatId: number;
      appId: number;
      preserveTabOrder?: boolean;
      prefillInput?: string;
      hideMenu?: ChatHideMenuSearchValue;
    }) => {
      setSelectedChatId(chatId);
      setSelectedAppId(appId);
      // Track this chat as opened in the current session
      addSessionOpenedChatId(chatId);
      if (!preserveTabOrder) {
        pushRecentViewedChatId(chatId);
      }
      const navigationResult = navigate({
        to: "/chat",
        search: {
          id: chatId,
          appId,
          "hide-menu": getHideChatMenuSearchValue({
            hideMenu: hideMenu ?? currentHideMenu,
          }),
        },
      });

      if (prefillInput !== undefined) {
        Promise.resolve(navigationResult)
          .then(() => {
            setChatInputValue(prefillInput);
          })
          .catch(() => {
            // Ignore navigation errors here; navigation handling is centralized.
          });
      }
    },
  };
}
