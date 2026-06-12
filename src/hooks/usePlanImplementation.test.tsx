import { renderHook, act } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatErrorByIdAtom,
  chatMessagesByIdAtom,
  chatStreamCountByIdAtom,
  isStreamingByIdAtom,
} from "@/atoms/chatAtoms";
import { pendingPlanImplementationAtom } from "@/atoms/planAtoms";
import { usePlanImplementation } from "@/hooks/usePlanImplementation";
import type { ChatResponseChunk, ChatResponseEnd } from "@/ipc/types";

vi.mock("jotai/utils", async () => {
  const { atom } = await vi.importActual<typeof import("jotai")>("jotai");
  return {
    atomWithStorage: <T,>(_key: string, initialValue: T) => atom(initialValue),
  };
});

type StreamCallbacks = {
  onChunk: (payload: ChatResponseChunk) => void;
  onEnd: (payload: ChatResponseEnd) => void;
  onError: (payload: { error: string }) => void;
};

const {
  chatStreamStartMock,
  handleEffectiveChatModeChunkMock,
  syncChatFromDbMock,
} = vi.hoisted(() => ({
  chatStreamStartMock: vi.fn(),
  handleEffectiveChatModeChunkMock: vi.fn(() => false),
  syncChatFromDbMock: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    chatStream: {
      start: chatStreamStartMock,
    },
  },
}));

vi.mock("./useSettings", () => ({
  useSettings: () => ({
    settings: {
      selectedChatMode: "local-agent",
    },
  }),
}));

vi.mock("@/lib/chatModeStream", () => ({
  handleEffectiveChatModeChunk: handleEffectiveChatModeChunkMock,
}));

vi.mock("@/lib/resyncChat", () => ({
  syncChatFromDb: syncChatFromDbMock,
  triggerResync: vi.fn(),
}));

vi.mock("@/lib/streamingPreviewSync", () => ({
  applyPreviewChunk: vi.fn(),
  clearPreviewForChat: vi.fn(),
}));

function makeWrapper() {
  const store = createStore();
  return {
    store,
    Wrapper({ children }: PropsWithChildren) {
      return <Provider store={store}>{children}</Provider>;
    },
  };
}

describe("usePlanImplementation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chatStreamStartMock.mockReset();
    handleEffectiveChatModeChunkMock.mockClear();
    syncChatFromDbMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts an implementation stream for the pending plan and applies chunks", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(pendingPlanImplementationAtom, {
      chatId: 42,
      title: "Checkout flow",
      planSlug: "checkout-flow",
    });

    renderHook(() => usePlanImplementation(), { wrapper: Wrapper });

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(chatStreamStartMock).toHaveBeenCalledWith(
      {
        chatId: 42,
        prompt: "/implement-plan=checkout-flow",
        selectedComponents: [],
      },
      expect.objectContaining({
        onChunk: expect.any(Function),
        onEnd: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    expect(store.get(pendingPlanImplementationAtom)).toBeNull();
    expect(store.get(isStreamingByIdAtom).get(42)).toBe(true);
    expect(store.get(chatErrorByIdAtom).get(42)).toBeNull();

    const callbacks = chatStreamStartMock.mock.calls[0][1] as StreamCallbacks;

    act(() => {
      callbacks.onChunk({
        chatId: 42,
        messages: [
          {
            id: 1,
            role: "assistant",
            content: "Implementing the plan",
          },
        ],
      });
    });

    expect(store.get(chatMessagesByIdAtom).get(42)).toEqual([
      {
        id: 1,
        role: "assistant",
        content: "Implementing the plan",
      },
    ]);
    expect(store.get(chatStreamCountByIdAtom).get(42)).toBe(1);

    act(() => {
      callbacks.onEnd({
        chatId: 42,
        updatedFiles: true,
      });
    });

    expect(store.get(isStreamingByIdAtom).get(42)).toBe(false);
    expect(syncChatFromDbMock).toHaveBeenCalledWith(
      42,
      expect.any(Function),
      "[CHAT] Plan onEnd",
      expect.anything(),
    );
  });

  it("clears global streaming state when the stream ends after unmount", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(pendingPlanImplementationAtom, {
      chatId: 99,
      title: "Dashboard",
      planSlug: "dashboard",
    });

    const { unmount } = renderHook(() => usePlanImplementation(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    const callbacks = chatStreamStartMock.mock.calls[0][1] as StreamCallbacks;
    unmount();

    act(() => {
      callbacks.onEnd({
        chatId: 99,
        updatedFiles: false,
      });
    });

    expect(store.get(isStreamingByIdAtom).get(99)).toBe(false);
    expect(syncChatFromDbMock).toHaveBeenCalledWith(
      99,
      expect.any(Function),
      "[CHAT] Plan onEnd",
      expect.anything(),
    );
  });
});
