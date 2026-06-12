import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTerminalSession } from "./useTerminalSession";

const {
  closeMock,
  killMock,
  openMock,
  resizeMock,
  serializeMock,
  terminalListeners,
  writeMock,
} = vi.hoisted(() => ({
  closeMock: vi.fn(),
  killMock: vi.fn(),
  openMock: vi.fn(),
  resizeMock: vi.fn(),
  serializeMock: vi.fn(),
  terminalListeners: new Map<string, Set<(payload: unknown) => void>>(),
  writeMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/toast", () => ({
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    terminal: {
      open: openMock,
      close: closeMock,
      kill: killMock,
      write: writeMock,
      resize: resizeMock,
      serialize: serializeMock,
    },
    events: {
      on: (channel: string, listener: (payload: unknown) => void) => {
        const listeners = terminalListeners.get(channel) ?? new Set();
        listeners.add(listener);
        terminalListeners.set(channel, listeners);
        return () => listeners.delete(listener);
      },
    },
  },
}));

describe("useTerminalSession", () => {
  beforeEach(() => {
    terminalListeners.clear();
    openMock.mockReset();
    closeMock.mockReset();
    killMock.mockReset();
    writeMock.mockReset();
    resizeMock.mockReset();
    serializeMock.mockReset();
    openMock.mockResolvedValue({
      sessionId: "term-1",
      shell: "/bin/zsh",
      cwd: "/apps/test-app",
      appName: "Test App",
      scrollback: "",
      created: true,
    });
    closeMock.mockResolvedValue({ ok: true });
    killMock.mockResolvedValue({ ok: true });
    writeMock.mockResolvedValue({ ok: true });
    resizeMock.mockResolvedValue({ ok: true });
    serializeMock.mockResolvedValue({
      scrollback: "ready\n",
      scrollbackEndOffset: 6,
    });
  });

  it("subscribes through the runtime event transport and cleans up", async () => {
    const onData = vi.fn();
    const { result, unmount } = renderHook(() =>
      useTerminalSession({
        appId: 1,
        enabled: true,
        cols: 80,
        rows: 24,
        onData,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(onData).toHaveBeenCalledWith("ready\n");
    expect(terminalListeners.get("terminal:data:term-1")?.size).toBe(1);
    expect(terminalListeners.get("terminal:exit:term-1")?.size).toBe(1);

    act(() => {
      emit("terminal:data:term-1", {
        sessionId: "term-1",
        chunk: "changed\n",
        startOffset: 6,
        endOffset: 14,
      });
    });
    expect(onData).toHaveBeenCalledWith("changed\n");

    unmount();
    expect(terminalListeners.get("terminal:data:term-1")?.size).toBe(0);
    expect(terminalListeners.get("terminal:exit:term-1")?.size).toBe(0);
    expect(closeMock).toHaveBeenCalledWith({ sessionId: "term-1" });
  });

  it("writes, resizes, and kills the active terminal session", async () => {
    const onExit = vi.fn();
    const { result } = renderHook(() =>
      useTerminalSession({
        appId: 1,
        enabled: true,
        cols: 80,
        rows: 24,
        onData: vi.fn(),
        onExit,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => result.current.write("ls\n"));
    expect(writeMock).toHaveBeenCalledWith({
      sessionId: "term-1",
      data: "ls\n",
    });

    act(() => result.current.resize(100, 30));
    expect(resizeMock).toHaveBeenCalledWith({
      sessionId: "term-1",
      cols: 100,
      rows: 30,
    });

    act(() => {
      emit("terminal:exit:term-1", {
        sessionId: "term-1",
        exitCode: 0,
        signal: null,
      });
    });
    expect(result.current.status).toBe("exited");
    expect(onExit).toHaveBeenCalledOnce();

    act(() => result.current.kill());
    expect(killMock).toHaveBeenCalledWith({ sessionId: "term-1" });
  });
});

function emit(channel: string, payload: unknown) {
  for (const listener of terminalListeners.get(channel) ?? []) {
    listener(payload);
  }
}
