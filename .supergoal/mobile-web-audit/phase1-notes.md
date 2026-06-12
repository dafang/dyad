# Phase 1 Mobile Web Baseline Notes

Local Web: http://127.0.0.1:55841 (API http://127.0.0.1:55842)

## Issue Inventory

### chat

- mobile/chat: control-outside-viewport — preview-refresh-button rect={"x":543,"y":13,"width":22,"height":22} viewport=390x844; owners: src/pages/chat.tsx, src/components/ChatPanel.tsx, src/components/chat/ChatInput.tsx, src/components/chat/MessagesList.tsx, src/components/chat/ChatHeader.tsx
- mobile/chat: control-outside-viewport — preview-restart-button rect={"x":580,"y":12,"width":24,"height":24} viewport=390x844; owners: src/pages/chat.tsx, src/components/ChatPanel.tsx, src/components/chat/ChatInput.tsx, src/components/chat/MessagesList.tsx, src/components/chat/ChatHeader.tsx
- mobile/chat: control-outside-viewport — preview-open-browser-button rect={"x":565,"y":13,"width":22,"height":22} viewport=390x844; owners: src/pages/chat.tsx, src/components/ChatPanel.tsx, src/components/chat/ChatInput.tsx, src/components/chat/MessagesList.tsx, src/components/chat/ChatHeader.tsx
- mobile/chat: narrow-chat-pane — chat input width 169px at 390px viewport; desktop split-pane remains active; owners: src/pages/chat.tsx, src/components/ChatPanel.tsx, src/components/chat/ChatInput.tsx, src/components/chat/MessagesList.tsx, src/components/chat/ChatHeader.tsx

### preview

- mobile/preview: control-outside-viewport — preview-refresh-button rect={"x":596,"y":12,"width":22,"height":22} viewport=390x844; owners: src/pages/chat.tsx, src/components/preview_panel/PreviewPanel.tsx, src/components/preview_panel/PreviewIframe.tsx, src/components/preview_panel/PreviewToolbar.tsx
- mobile/preview: control-outside-viewport — preview-restart-button rect={"x":633,"y":11,"width":24,"height":24} viewport=390x844; owners: src/pages/chat.tsx, src/components/preview_panel/PreviewPanel.tsx, src/components/preview_panel/PreviewIframe.tsx, src/components/preview_panel/PreviewToolbar.tsx
- mobile/preview: control-outside-viewport — preview-open-browser-button rect={"x":618,"y":12,"width":22,"height":22} viewport=390x844; owners: src/pages/chat.tsx, src/components/preview_panel/PreviewPanel.tsx, src/components/preview_panel/PreviewIframe.tsx, src/components/preview_panel/PreviewToolbar.tsx
- mobile/preview: cropped-preview-pane — preview toolbar actions extend to x=640px in 390px viewport; preview content is visibly cropped; owners: src/pages/chat.tsx, src/components/preview_panel/PreviewPanel.tsx, src/components/preview_panel/PreviewIframe.tsx, src/components/preview_panel/PreviewToolbar.tsx

## Screenshots

- desktop/home: /Users/wyattfang/work/github/dyad/.supergoal/mobile-web-audit/phase1-desktop-home.png
- desktop/apps: /Users/wyattfang/work/github/dyad/.supergoal/mobile-web-audit/phase1-desktop-apps.png
- desktop/chat: /Users/wyattfang/work/github/dyad/.supergoal/mobile-web-audit/phase1-desktop-chat.png
- desktop/preview: /Users/wyattfang/work/github/dyad/.supergoal/mobile-web-audit/phase1-desktop-preview.png
- desktop/settings: /Users/wyattfang/work/github/dyad/.supergoal/mobile-web-audit/phase1-desktop-settings.png
- desktop/library: /Users/wyattfang/work/github/dyad/.supergoal/mobile-web-audit/phase1-desktop-library.png
- mobile/home: /Users/wyattfang/work/github/dyad/.supergoal/mobile-web-audit/phase1-mobile-home.png
- mobile/apps: /Users/wyattfang/work/github/dyad/.supergoal/mobile-web-audit/phase1-mobile-apps.png
- mobile/chat: /Users/wyattfang/work/github/dyad/.supergoal/mobile-web-audit/phase1-mobile-chat.png
- mobile/preview: /Users/wyattfang/work/github/dyad/.supergoal/mobile-web-audit/phase1-mobile-preview.png
- mobile/settings: /Users/wyattfang/work/github/dyad/.supergoal/mobile-web-audit/phase1-mobile-settings.png
- mobile/library: /Users/wyattfang/work/github/dyad/.supergoal/mobile-web-audit/phase1-mobile-library.png
