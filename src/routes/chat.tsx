import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import ChatPage from "../pages/chat";
import { z } from "zod";
import { getHideChatMenuSearchValue } from "@/lib/chat_search";

export const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: ChatPage,
  validateSearch: (search) => {
    const parsed = z
      .object({
        id: z.number().optional(),
        appId: z.number().optional(),
        "hide-menu": z.union([z.literal("1"), z.literal(1)]).optional(),
      })
      .parse(search);

    return {
      ...parsed,
      "hide-menu": getHideChatMenuSearchValue({
        hideMenu: parsed["hide-menu"],
      }),
    };
  },
});
