import { useState, useRef, useEffect } from "react";
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { ChatPanel } from "../components/ChatPanel";
import { PreviewPanel } from "../components/preview_panel/PreviewPanel";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { isPreviewOpenAtom, isChatPanelHiddenAtom } from "@/atoms/viewAtoms";
import { useChats } from "@/hooks/useChats";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { usePlanImplementation } from "@/hooks/usePlanImplementation";
import { ipc } from "@/ipc/types";

const DEFAULT_CHAT_PANEL_SIZE = 50;
const MIN_VISIBLE_CHAT_PANEL_SIZE = 20;

function useIsMobileChatLayout() {
  const [isMobileLayout, setIsMobileLayout] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const updateLayout = () => setIsMobileLayout(mediaQuery.matches);

    updateLayout();
    mediaQuery.addEventListener("change", updateLayout);
    return () => mediaQuery.removeEventListener("change", updateLayout);
  }, []);

  return isMobileLayout;
}

export default function ChatPage() {
  const { id: chatId, appId: routeAppId } = useSearch({ from: "/chat" });
  const navigate = useNavigate();
  const [isPreviewOpen, setIsPreviewOpen] = useAtom(isPreviewOpenAtom);
  const [isChatPanelHidden, setIsChatPanelHidden] = useAtom(
    isChatPanelHiddenAtom,
  );
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const [isResizing, setIsResizing] = useState(false);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const { chats, loading } = useChats(selectedAppId);
  const previousSizeRef = useRef<number>(DEFAULT_CHAT_PANEL_SIZE);
  const isInitialMountRef = useRef(true);
  const selectedAppIdRef = useRef(selectedAppId);
  const ref = useRef<ImperativePanelHandle>(null);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);
  const isMobileLayout = useIsMobileChatLayout();
  const [mobilePane, setMobilePane] = useState<"chat" | "preview">("chat");

  useEffect(() => {
    selectedAppIdRef.current = selectedAppId;
  }, [selectedAppId]);

  // Sync selectedChatIdAtom with the chatId from the URL
  useEffect(() => {
    setSelectedChatId(chatId ?? null);
  }, [chatId, setSelectedChatId]);

  useEffect(() => {
    setMobilePane("chat");
  }, [chatId]);

  // Handle plan implementation when a plan is accepted
  usePlanImplementation();

  useEffect(() => {
    if (chatId || loading) {
      return;
    }

    if (!selectedAppId) {
      navigate({ to: "/", replace: true });
      return;
    }

    if (chats.length) {
      // Not a real navigation, just a redirect, when the user navigates to /chat
      // without a chatId, we redirect to the first chat
      setSelectedAppId(chats[0].appId);
      navigate({
        to: "/chat",
        search: { id: chats[0].id, appId: chats[0].appId },
        replace: true,
      });
      return;
    }

    navigate({
      to: "/app-details",
      search: { appId: selectedAppId },
      replace: true,
    });
  }, [chatId, chats, loading, navigate, selectedAppId, setSelectedAppId]);

  useEffect(() => {
    if (!chatId) {
      return;
    }

    if (routeAppId) {
      if (routeAppId !== selectedAppIdRef.current) {
        selectedAppIdRef.current = routeAppId;
        setSelectedAppId(routeAppId);
      }
      return;
    }

    // If chatId is already in our loaded chats list, selectedAppId is correct
    // for this chat (useChats filters by selectedAppId), so skip the IPC fetch.
    if (chats.some((c) => c.id === chatId)) {
      return;
    }

    let isCancelled = false;
    ipc.chat
      .getChat(chatId)
      .then((chat) => {
        if (!isCancelled && chat.appId !== selectedAppIdRef.current) {
          selectedAppIdRef.current = chat.appId;
          setSelectedAppId(chat.appId);
        }
      })
      .catch(() => {
        // Let the chat panel surface any load error for the selected chat.
      });
    return () => {
      isCancelled = true;
    };
  }, [chatId, routeAppId, chats, setSelectedAppId]);

  useEffect(() => {
    if (isPreviewOpen) {
      ref.current?.expand();
      const chatPanelSize = chatPanelRef.current?.getSize() ?? 0;
      const previewPanelSize = ref.current?.getSize() ?? 0;
      if (
        chatPanelSize > 100 - MIN_VISIBLE_CHAT_PANEL_SIZE ||
        previewPanelSize < MIN_VISIBLE_CHAT_PANEL_SIZE
      ) {
        chatPanelRef.current?.resize(DEFAULT_CHAT_PANEL_SIZE);
        ref.current?.resize(DEFAULT_CHAT_PANEL_SIZE);
      }
    } else {
      ref.current?.collapse();
    }
  }, [isPreviewOpen]);

  // Keep chat panel size in sync with hidden state (from toolbar button / other views)
  useEffect(() => {
    if (!chatPanelRef.current) return;
    // Skip the initial mount to preserve persisted panel size from autoSaveId
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    if (isChatPanelHidden) {
      // Save current size before collapsing
      const currentSize = chatPanelRef.current.getSize();
      if (currentSize > 5) {
        previousSizeRef.current = currentSize;
      }
      // Visually collapsed but keep a sliver so the handle is usable
      chatPanelRef.current.resize(1);
    } else {
      // Restore to previous size when re-opened via button
      chatPanelRef.current.resize(previousSizeRef.current);
    }
  }, [isChatPanelHidden]);

  if (isMobileLayout) {
    return (
      <div className="h-full min-w-0 flex-1 overflow-hidden">
        {mobilePane === "preview" ? (
          <PreviewPanel
            onBackToChat={() => {
              setMobilePane("chat");
              setIsPreviewOpen(false);
            }}
          />
        ) : (
          <ChatPanel
            chatId={chatId}
            isPreviewOpen={false}
            onTogglePreview={() => {
              setMobilePane("preview");
              setIsPreviewOpen(true);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <PanelGroup autoSaveId="persistence" direction="horizontal">
      <Panel
        id="chat-panel"
        ref={chatPanelRef}
        collapsible
        minSize={1}
        className={cn(!isResizing && "transition-all duration-100 ease-in-out")}
      >
        <div className="h-full w-full">
          {!isChatPanelHidden && (
            <ChatPanel
              chatId={chatId}
              isPreviewOpen={isPreviewOpen}
              onTogglePreview={() => {
                const nextPreviewOpen = !isPreviewOpen;
                setIsPreviewOpen(nextPreviewOpen);
                if (nextPreviewOpen) {
                  chatPanelRef.current?.resize(DEFAULT_CHAT_PANEL_SIZE);
                  ref.current?.resize(DEFAULT_CHAT_PANEL_SIZE);
                } else {
                  ref.current?.collapse();
                }
              }}
            />
          )}
        </div>
      </Panel>
      <PanelResizeHandle
        onDragging={(isDragging) => {
          setIsResizing(isDragging);
          // When dragging ends, sync the hidden state based on final width
          if (!isDragging) {
            // Small delay to let the panel settle
            requestAnimationFrame(() => {
              const panel = document.getElementById("chat-panel");
              if (panel) {
                const panelWidth = panel.getBoundingClientRect().width;
                const containerWidth =
                  panel.parentElement?.getBoundingClientRect().width || 1;
                const percentage = (panelWidth / containerWidth) * 100;
                // Consider hidden if panel is less than 5% width
                setIsChatPanelHidden(percentage < 5);
              }
            });
          }
        }}
        className={cn(
          "relative bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors cursor-col-resize",
          isChatPanelHidden ? "w-2" : "w-1",
        )}
      />

      <Panel
        collapsible
        ref={ref}
        id="preview-panel"
        minSize={20}
        className={cn(!isResizing && "transition-all duration-100 ease-in-out")}
      >
        <PreviewPanel />
      </Panel>
    </PanelGroup>
  );
}
