import crypto from "node:crypto";
import log from "electron-log";
import { desc, eq } from "drizzle-orm";
import {
  appBlueprintContracts,
  type AppBlueprintAddVisualPayload,
  type AppBlueprintApprovePayload,
  type AppBlueprintData,
  type AppBlueprintFieldEditPayload,
  type AppBlueprintRemoveVisualPayload,
  type AppBlueprintVisualEditPayload,
  type AppBlueprintVisual,
} from "../types/app_blueprint";
import { safeSend } from "../utils/safe_sender";
import type { IpcInvokeEventLike } from "../utils/ipc_event";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { db } from "../../db";
import { apps, chats, messages } from "../../db/schema";
import { createTypedHandler } from "./base";
import { extractAppBlueprintDataFromContent } from "@/lib/app_blueprint_data";

const logger = log.scope("app_blueprint_handlers");

// In-memory store for app blueprint data (keyed by chatId)
const appBlueprintStore = new Map<
  number,
  AppBlueprintData & { approved: boolean }
>();

export function getAppBlueprintForChat(chatId: number) {
  return appBlueprintStore.get(chatId);
}

export function setAppBlueprintForChat(chatId: number, data: AppBlueprintData) {
  appBlueprintStore.set(chatId, { ...data, approved: false });
}

export function deleteAppBlueprintForChat(chatId: number) {
  appBlueprintStore.delete(chatId);
}

export function updateAppBlueprintVisuals(
  chatId: number,
  visuals: AppBlueprintVisual[],
) {
  const plan = appBlueprintStore.get(chatId);
  if (plan) {
    plan.visuals = visuals;
  }
}

async function getOrRestoreAppBlueprintForChat(chatId: number) {
  const existing = appBlueprintStore.get(chatId);
  if (existing) {
    return existing;
  }

  const assistantMessages = await db
    .select({ content: messages.content })
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .all();

  for (const message of assistantMessages) {
    const data = extractAppBlueprintDataFromContent(message.content);
    if (data) {
      setAppBlueprintForChat(chatId, data);
      return appBlueprintStore.get(chatId);
    }
  }
  return undefined;
}

export async function approveAppBlueprintHandler(
  event: IpcInvokeEventLike,
  params: AppBlueprintApprovePayload,
): Promise<void> {
  const plan = await getOrRestoreAppBlueprintForChat(params.chatId);
  if (!plan) {
    logger.warn(`No app blueprint found for chat ${params.chatId} on approve`);
    return;
  }

  // Flip the per-app needs_app_blueprint flag so future chats in this app
  // skip the blueprint flow. Persist DB state BEFORE flipping the in-memory
  // `plan.approved` flag — if the DB write throws, the blueprint stays
  // unapproved in memory and the user can retry.
  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, params.chatId),
    columns: { appId: true },
  });
  if (chat) {
    await db
      .update(apps)
      .set({ needsAppBlueprint: false })
      .where(eq(apps.id, chat.appId));
  } else {
    logger.warn(
      `Chat ${params.chatId} not found when clearing needsAppBlueprint`,
    );
  }

  plan.approved = true;
  logger.info(`App blueprint approved for chat ${params.chatId}`);

  // Notify renderer that approval is confirmed
  safeSend(event.sender, "app-blueprint:approved", {
    chatId: params.chatId,
  });
}

export async function editAppBlueprintFieldHandler(
  params: AppBlueprintFieldEditPayload,
): Promise<void> {
  const plan = await getOrRestoreAppBlueprintForChat(params.chatId);
  if (!plan) {
    logger.warn(
      `No app blueprint found for chat ${params.chatId} when editing field ${params.field}`,
    );
    return;
  }

  if (plan.approved) {
    throw new DyadError(
      `Cannot edit approved app blueprint for chat ${params.chatId}`,
      DyadErrorKind.Precondition,
    );
  }

  switch (params.field) {
    case "appName":
      plan.appName = params.value;
      break;
    case "templateId":
      plan.templateId = params.value;
      break;
    case "themeId":
      plan.themeId = params.value;
      break;
    case "designDirection":
      plan.designDirection = params.value;
      break;
    case "primaryColor":
      plan.primaryColor = params.value;
      break;
    default:
      logger.warn(`Unknown app blueprint field: ${params.field}`);
  }
}

export async function editAppBlueprintVisualHandler(
  params: AppBlueprintVisualEditPayload,
): Promise<void> {
  const plan = await getOrRestoreAppBlueprintForChat(params.chatId);
  if (!plan) {
    logger.warn(
      `No app blueprint found for chat ${params.chatId} when editing visual ${params.field}`,
    );
    return;
  }

  if (plan.approved) {
    throw new DyadError(
      `Cannot edit approved app blueprint for chat ${params.chatId}`,
      DyadErrorKind.Precondition,
    );
  }

  const visual = plan.visuals.find((v) => v.id === params.visualId);
  if (!visual) {
    logger.warn(
      `Visual ${params.visualId} not found in app blueprint for chat ${params.chatId}`,
    );
    return;
  }

  visual[params.field] = params.value;
}

export async function addAppBlueprintVisualHandler(
  params: AppBlueprintAddVisualPayload,
): Promise<{ visualId: string }> {
  const plan = await getOrRestoreAppBlueprintForChat(params.chatId);
  if (!plan) {
    throw new DyadError(
      `No app blueprint found for chat ${params.chatId} when adding visual`,
      DyadErrorKind.NotFound,
    );
  }

  if (plan.approved) {
    throw new DyadError(
      `Cannot add visual to approved app blueprint for chat ${params.chatId}`,
      DyadErrorKind.Precondition,
    );
  }

  const visualId = `visual_${crypto.randomUUID().split("-")[0]}`;
  plan.visuals.push({
    id: visualId,
    type: params.type,
    description: params.description,
    prompt: params.prompt,
  });

  return { visualId };
}

export async function removeAppBlueprintVisualHandler(
  params: AppBlueprintRemoveVisualPayload,
): Promise<void> {
  const plan = await getOrRestoreAppBlueprintForChat(params.chatId);
  if (!plan) {
    logger.warn(
      `No app blueprint found for chat ${params.chatId} when removing visual`,
    );
    return;
  }

  if (plan.approved) {
    throw new DyadError(
      `Cannot remove visual from approved app blueprint for chat ${params.chatId}`,
      DyadErrorKind.Precondition,
    );
  }

  plan.visuals = plan.visuals.filter((v) => v.id !== params.visualId);
}

export function registerAppBlueprintHandlers() {
  createTypedHandler(appBlueprintContracts.approve, async (event, params) => {
    await approveAppBlueprintHandler(event, params);
  });

  createTypedHandler(appBlueprintContracts.editField, async (_, params) => {
    await editAppBlueprintFieldHandler(params);
  });

  createTypedHandler(appBlueprintContracts.editVisual, async (_, params) => {
    await editAppBlueprintVisualHandler(params);
  });

  createTypedHandler(appBlueprintContracts.addVisual, async (_, params) => {
    return addAppBlueprintVisualHandler(params);
  });

  createTypedHandler(appBlueprintContracts.removeVisual, async (_, params) => {
    await removeAppBlueprintVisualHandler(params);
  });
}
