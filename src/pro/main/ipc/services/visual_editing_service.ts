import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import path from "node:path";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  type AnalyseComponentParams,
  type ApplyVisualEditingChangesParams,
} from "@/ipc/types";
import { VALID_IMAGE_MIME_TYPES } from "@/ipc/types/visual-editing";
import { ensureDyadGitignored } from "@/ipc/handlers/gitignoreUtils";
import { safeJoin } from "@/ipc/utils/path_utils";
import { DYAD_MEDIA_DIR_NAME } from "@/ipc/utils/media_path_utils";
import { extractClassPrefixes, stylesToTailwind } from "@/utils/style-utils";
import { normalizePath } from "../../../../../shared/normalizePath";
import {
  analyzeComponent,
  transformContent,
} from "../../utils/visual_editing_utils";

// Client allows 7.5 MB raw; base64 expands by ~4/3 plus data URL prefix.
export const MAX_VISUAL_EDIT_IMAGE_SIZE =
  Math.ceil((7.5 * 1024 * 1024) / 3) * 4 + 100;

export const DEFAULT_COMPONENT_ANALYSIS = {
  isDynamic: false,
  hasStaticText: false,
  hasImage: false,
} as const;

interface VisualEditingApp {
  id: number;
  path: string;
}

export interface VisualEditingServiceDeps {
  findAppById(appId: number): Promise<VisualEditingApp | undefined | null>;
  resolveAppPath(appPath: string): string;
  now?: () => number;
  pathExists?: (targetPath: string) => boolean | Promise<boolean>;
  ensureDyadGitignored?: (appPath: string) => Promise<void>;
  gitAdd?: (params: { path: string; filepath: string }) => Promise<void>;
  gitCommit?: (params: { path: string; message: string }) => Promise<unknown>;
  gitResetFile?: (params: { path: string; filepath: string }) => Promise<void>;
  queueSnapshotSync?: (params: {
    appId: number;
    changedPaths: string[];
  }) => void;
}

interface AnalyseComponentResult {
  isDynamic: boolean;
  hasStaticText: boolean;
  hasImage: boolean;
  imageSrc?: string;
  isDynamicImage?: boolean;
}

export async function applyVisualEditingChanges(
  params: ApplyVisualEditingChangesParams,
  deps: VisualEditingServiceDeps,
): Promise<void> {
  const { appId } = params;
  const changes = params.changes.map((change) => ({ ...change }));
  const writtenImagePaths: string[] = [];
  const stagedGitPaths: { appPath: string; filepath: string }[] = [];

  try {
    if (changes.length === 0) {
      return;
    }

    const app = await deps.findAppById(appId);
    if (!app) {
      throw new DyadError(`App not found: ${appId}`, DyadErrorKind.NotFound);
    }

    const appPath = deps.resolveAppPath(app.path);
    validateImageUploads(changes);

    for (const change of changes) {
      if (!change.imageUpload) {
        continue;
      }

      const { fileName, base64Data } = change.imageUpload;
      const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const timestamp = deps.now?.() ?? Date.now();
      const finalFileName = `${timestamp}-${sanitizedFileName}`;
      const buffer = Buffer.from(
        base64Data.replace(/^data:[^;]+;base64,/, ""),
        "base64",
      );

      const mediaDir = path.join(appPath, DYAD_MEDIA_DIR_NAME);
      await fsPromises.mkdir(mediaDir, { recursive: true });
      const mediaPath = path.join(mediaDir, finalFileName);
      await fsPromises.writeFile(mediaPath, buffer);
      await (deps.ensureDyadGitignored ?? ensureDyadGitignored)(appPath);

      const publicImagesDir = path.join(appPath, "public", "images");
      await fsPromises.mkdir(publicImagesDir, { recursive: true });
      const publicImagePath = path.join(publicImagesDir, finalFileName);
      await fsPromises.writeFile(publicImagePath, buffer);
      writtenImagePaths.push(publicImagePath, mediaPath);

      change.imageSrc = `/images/${finalFileName}`;

      if (await hasGitRepository(appPath, deps)) {
        const imageFilepath = normalizePath(
          path.join("public", "images", finalFileName),
        );
        await deps.gitAdd?.({
          path: appPath,
          filepath: imageFilepath,
        });
        if (deps.gitAdd) {
          stagedGitPaths.push({ appPath, filepath: imageFilepath });
        }
      }
    }

    const fileChanges = new Map<
      string,
      Map<
        number,
        {
          classes: string[];
          prefixes: string[];
          textContent?: string;
          imageSrc?: string;
        }
      >
    >();

    for (const change of changes) {
      if (!fileChanges.has(change.relativePath)) {
        fileChanges.set(change.relativePath, new Map());
      }
      const tailwindClasses = stylesToTailwind(change.styles);
      const changePrefixes = extractClassPrefixes(tailwindClasses);

      fileChanges.get(change.relativePath)!.set(change.lineNumber, {
        classes: tailwindClasses,
        prefixes: changePrefixes,
        ...(change.textContent !== undefined && {
          textContent: change.textContent,
        }),
        ...(change.imageSrc !== undefined && {
          imageSrc: change.imageSrc,
        }),
      });
    }

    const changedPaths = new Set<string>();

    for (const [relativePath, lineChanges] of fileChanges) {
      const normalizedRelativePath = normalizePath(relativePath);
      const filePath = safeJoin(appPath, normalizedRelativePath);
      const content = await fsPromises.readFile(filePath, "utf-8");
      const transformedContent = transformContent(content, lineChanges);
      await fsPromises.writeFile(filePath, transformedContent, "utf-8");
      changedPaths.add(normalizedRelativePath);

      if (await hasGitRepository(appPath, deps)) {
        await deps.gitAdd?.({
          path: appPath,
          filepath: normalizedRelativePath,
        });
        await deps.gitCommit?.({
          path: appPath,
          message: `Updated ${normalizedRelativePath}`,
        });
      }
    }

    for (const absoluteImagePath of writtenImagePaths) {
      changedPaths.add(
        normalizePath(path.relative(appPath, absoluteImagePath)),
      );
    }

    deps.queueSnapshotSync?.({
      appId,
      changedPaths: [...changedPaths],
    });
  } catch (error) {
    for (const { appPath, filepath } of stagedGitPaths) {
      try {
        await deps.gitResetFile?.({ path: appPath, filepath });
      } catch {
        // Ignore cleanup errors.
      }
    }
    for (const filePath of writtenImagePaths) {
      try {
        await fsPromises.unlink(filePath);
      } catch {
        // Ignore cleanup errors.
      }
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function analyzeVisualEditingComponent(
  params: AnalyseComponentParams,
  deps: VisualEditingServiceDeps,
): Promise<AnalyseComponentResult> {
  const { appId, componentId } = params;
  const [filePath, lineStr] = componentId.split(":");
  const line = Number.parseInt(lineStr, 10);

  if (!filePath || Number.isNaN(line)) {
    return { ...DEFAULT_COMPONENT_ANALYSIS };
  }

  const app = await deps.findAppById(appId);
  if (!app) {
    throw new DyadError(`App not found: ${appId}`, DyadErrorKind.NotFound);
  }

  const appPath = deps.resolveAppPath(app.path);
  const fullPath = safeJoin(appPath, filePath);
  const content = await fsPromises.readFile(fullPath, "utf-8");
  return analyzeComponent(content, line);
}

function validateImageUploads(
  changes: ApplyVisualEditingChangesParams["changes"],
): void {
  const imageValidationErrors: string[] = [];

  for (const change of changes) {
    if (!change.imageUpload) {
      continue;
    }

    const { fileName, base64Data, mimeType } = change.imageUpload;

    if (!(VALID_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
      imageValidationErrors.push(
        `"${fileName}": Unsupported image type (${mimeType}). Allowed types: JPEG, PNG, GIF, WebP.`,
      );
    }

    if (base64Data.length > MAX_VISUAL_EDIT_IMAGE_SIZE) {
      imageValidationErrors.push(
        `"${fileName}": The image is too large (max 7.5 MB). Please choose a smaller file.`,
      );
    }
  }

  if (imageValidationErrors.length === 0) {
    return;
  }

  throw new DyadError(
    imageValidationErrors.length === 1
      ? imageValidationErrors[0]
      : `Multiple image issues:\n${imageValidationErrors.join("\n")}`,
    DyadErrorKind.Validation,
  );
}

async function hasGitRepository(
  appPath: string,
  deps: VisualEditingServiceDeps,
): Promise<boolean> {
  const gitPath = path.join(appPath, ".git");
  if (deps.pathExists) {
    return await deps.pathExists(gitPath);
  }
  return fs.existsSync(gitPath);
}
