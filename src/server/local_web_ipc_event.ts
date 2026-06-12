import type { IpcInvokeEventLike } from "@/ipc/utils/ipc_event";
import type { WebContentsLike } from "@/ipc/utils/safe_sender";
import type { LocalEventStream } from "./local_event_stream";

export function createLocalWebIpcEvent(
  events: Pick<LocalEventStream, "publish">,
  onSend?: (channel: string, payload: unknown) => void,
): IpcInvokeEventLike {
  return {
    sender: createLocalWebSender(events, onSend),
  };
}

function createLocalWebSender(
  events: Pick<LocalEventStream, "publish">,
  onSend?: (channel: string, payload: unknown) => void,
): WebContentsLike {
  return {
    isDestroyed: () => false,
    isCrashed: () => false,
    send(channel, ...args) {
      const payload = args.length <= 1 ? args[0] : args;
      events.publish(channel, payload);
      onSend?.(channel, payload);
    },
  };
}
