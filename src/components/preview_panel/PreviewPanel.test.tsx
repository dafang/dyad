import { render, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { PreviewPanel } from "./PreviewPanel";

const { loadAppState, runAppMock, selectAppForPreviewMock, useSupabaseMock } =
  vi.hoisted(() => ({
    loadAppState: {
      current: {
        app: null as {
          id: number;
          name: string;
          path: string;
          needsAppBlueprint: boolean;
        } | null,
        loading: false,
      },
    },
    runAppMock: vi.fn(),
    selectAppForPreviewMock: vi.fn(),
    useSupabaseMock: vi.fn(),
  }));

vi.mock("@/hooks/useRunApp", () => ({
  useRunApp: () => ({
    runApp: runAppMock,
    loading: false,
  }),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({
    ...loadAppState.current,
    refreshApp: vi.fn(),
  }),
}));

vi.mock("@/hooks/useSupabase", () => ({
  useSupabase: useSupabaseMock,
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    app: {
      selectAppForPreview: selectAppForPreviewMock,
    },
  },
}));

vi.mock("react-resizable-panels", () => ({
  PanelGroup: ({ children }: PropsWithChildren) => (
    <div data-testid="panel-group">{children}</div>
  ),
  Panel: ({ children }: PropsWithChildren) => (
    <div data-testid="panel">{children}</div>
  ),
  PanelResizeHandle: () => <div data-testid="resize-handle" />,
}));

vi.mock("./PreviewIframe", () => ({
  PreviewIframe: () => <div data-testid="preview-iframe" />,
}));

vi.mock("./PreviewToolbar", () => ({
  PreviewToolbar: () => <div data-testid="preview-toolbar" />,
}));

vi.mock("./CodeView", () => ({
  CodeView: () => <div data-testid="code-view" />,
}));

vi.mock("./Problems", () => ({
  Problems: () => <div data-testid="problems" />,
}));

vi.mock("./ConfigurePanel", () => ({
  ConfigurePanel: () => <div data-testid="configure-panel" />,
}));

vi.mock("./PublishPanel", () => ({
  PublishPanel: () => <div data-testid="publish-panel" />,
}));

vi.mock("./SecurityPanel", () => ({
  SecurityPanel: () => <div data-testid="security-panel" />,
}));

vi.mock("./PlanPanel", () => ({
  PlanPanel: () => <div data-testid="plan-panel" />,
}));

vi.mock("./Console", () => ({
  Console: () => <div data-testid="console" />,
}));

function renderPreviewPanel(appId = 7) {
  const store = createStore();
  store.set(selectedAppIdAtom, appId);

  function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  }

  return render(<PreviewPanel />, { wrapper: Wrapper });
}

describe("PreviewPanel app startup", () => {
  beforeEach(() => {
    runAppMock.mockReset();
    selectAppForPreviewMock.mockReset();
    selectAppForPreviewMock.mockResolvedValue(undefined);
    useSupabaseMock.mockReset();
    loadAppState.current = {
      app: {
        id: 7,
        name: "Blueprint App",
        path: "blueprint-app",
        needsAppBlueprint: true,
      },
      loading: false,
    };
  });

  it("does not auto-start preview while the selected app still needs blueprint approval", async () => {
    renderPreviewPanel();

    await waitFor(() => {
      expect(selectAppForPreviewMock).toHaveBeenCalledWith({ appId: 7 });
    });
    expect(runAppMock).not.toHaveBeenCalled();
  });

  it("auto-starts preview after the app no longer needs blueprint approval", async () => {
    const { rerender } = renderPreviewPanel();

    await waitFor(() => {
      expect(selectAppForPreviewMock).toHaveBeenCalledWith({ appId: 7 });
    });
    expect(runAppMock).not.toHaveBeenCalled();

    loadAppState.current = {
      app: {
        id: 7,
        name: "Blueprint App",
        path: "blueprint-app",
        needsAppBlueprint: false,
      },
      loading: false,
    };

    rerender(<PreviewPanel />);

    await waitFor(() => {
      expect(runAppMock).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          suppressCancelledError: true,
        }),
      );
    });
  });
});
