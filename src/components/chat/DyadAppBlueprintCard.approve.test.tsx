import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import type { AppBlueprintData } from "@/ipc/types/app_blueprint";
import { encodeAppBlueprintData } from "@/lib/app_blueprint_data";
import { DyadAppBlueprintCard } from "./DyadAppBlueprintCard";

const {
  applyAppTemplateMock,
  approveMock,
  getAppThemeMock,
  restartAppMock,
  streamMessageMock,
} = vi.hoisted(() => ({
  applyAppTemplateMock: vi.fn(),
  approveMock: vi.fn(),
  getAppThemeMock: vi.fn(),
  restartAppMock: vi.fn(),
  streamMessageMock: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    app: {
      getApp: vi.fn(),
      renameApp: vi.fn(),
      restartApp: restartAppMock,
    },
    appBlueprint: {
      approve: approveMock,
      editField: vi.fn(),
      addVisual: vi.fn(),
      editVisual: vi.fn(),
      removeVisual: vi.fn(),
    },
    template: {
      applyAppTemplate: applyAppTemplateMock,
      getAppTheme: getAppThemeMock,
      setAppTheme: vi.fn(),
    },
  },
}));

vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({
    streamMessage: streamMessageMock,
  }),
}));

vi.mock("./DyadMarkdownParser", () => ({
  VanillaMarkdownParser: ({ content }: { content: string }) => (
    <span>{content}</span>
  ),
}));

vi.mock("jotai/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jotai/utils")>();
  const { atom } = await import("jotai");
  return {
    ...actual,
    atomWithStorage: <T,>(_key: string, initialValue: T) => atom(initialValue),
  };
});

vi.mock("@/hooks/useTemplates", () => ({
  useTemplates: () => ({
    templates: [
      {
        id: "react",
        title: "React.js Template",
        description: "React template",
        imageUrl: "react.png",
        isOfficial: true,
      },
    ],
  }),
}));

vi.mock("@/hooks/useThemes", () => ({
  useThemes: () => ({
    themes: [
      {
        id: "default",
        name: "Default",
        description: "Default theme",
      },
    ],
  }),
}));

vi.mock("@/hooks/useCustomThemes", () => ({
  useCustomThemes: () => ({
    customThemes: [],
  }),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({
    app: {
      id: 7,
      name: "Blueprint Smoke",
      path: "blueprint-smoke",
    },
    refreshApp: vi.fn(),
  }),
}));

vi.mock("@/lib/toast", () => ({
  showError: vi.fn(),
}));

const blueprintData: AppBlueprintData = {
  appName: "Blueprint Smoke",
  userPrompt: "Build a landing page",
  attachments: [],
  templateId: "react",
  themeId: "default",
  designDirection: "Clean and direct",
  primaryColor: "#2563EB",
  visuals: [],
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderCard() {
  const store = createStore();
  store.set(selectedChatIdAtom, 42);
  store.set(selectedAppIdAtom, 7);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
  }

  return render(
    <DyadAppBlueprintCard
      node={{
        properties: {
          data: encodeAppBlueprintData(blueprintData),
          complete: "true",
        },
      }}
    />,
    { wrapper: Wrapper },
  );
}

describe("DyadAppBlueprintCard approval", () => {
  beforeEach(() => {
    applyAppTemplateMock.mockReset();
    approveMock.mockReset();
    getAppThemeMock.mockReset();
    restartAppMock.mockReset();
    streamMessageMock.mockReset();

    applyAppTemplateMock.mockResolvedValue({
      applied: true,
      needsRestart: true,
    });
    approveMock.mockResolvedValue(undefined);
    getAppThemeMock.mockResolvedValue("default");
    streamMessageMock.mockResolvedValue(undefined);
  });

  it("approves from embedded blueprint data without waiting for preview restart", async () => {
    const restart = deferred<void>();
    restartAppMock.mockReturnValue(restart.promise);

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /approve plan/i }));

    await waitFor(() =>
      expect(approveMock).toHaveBeenCalledWith({ chatId: 42 }),
    );
    await waitFor(() => expect(streamMessageMock).toHaveBeenCalledTimes(1));

    expect(restartAppMock).toHaveBeenCalledWith({
      appId: 7,
      removeNodeModules: true,
    });
    expect(approveMock.mock.invocationCallOrder[0]).toBeLessThan(
      restartAppMock.mock.invocationCallOrder[0],
    );

    restart.resolve();
  });
});
