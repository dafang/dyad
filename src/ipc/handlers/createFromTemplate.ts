import path from "path";
import fs from "fs-extra";
import { copyDirectoryRecursive } from "../utils/file_utils";
import { gitClone, getCurrentCommitHash } from "../utils/git_utils";
import { readSettings } from "@/main/settings";
import { getTemplateOrThrow } from "../utils/template_utils";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getUserDataPath } from "@/paths/paths";
import { appendNextAppRouterRules } from "../utils/ai_rules_patcher";

const logger = log.scope("createFromTemplate");

function isScaffoldPath(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "package.json")) &&
    fs.existsSync(path.join(candidate, "src"))
  );
}

export function getBundledScaffoldPath(): string {
  const candidates = [
    // Local web and Electron dev mode run from the repo root.
    path.resolve(process.cwd(), "scaffold"),
    // vite-node keeps __dirname at src/ipc/handlers.
    path.resolve(__dirname, "..", "..", "..", "scaffold"),
    // Vite main bundle resolves __dirname under .vite/build.
    path.resolve(__dirname, "..", "..", "scaffold"),
  ];

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  if (resourcesPath) {
    candidates.push(
      path.join(resourcesPath, "app.asar", "scaffold"),
      path.join(resourcesPath, "app", "scaffold"),
    );
  }

  const uniqueCandidates = Array.from(new Set(candidates));
  const scaffoldPath = uniqueCandidates.find(isScaffoldPath);
  if (scaffoldPath) {
    return scaffoldPath;
  }

  throw new DyadError(
    `Could not find the bundled React scaffold. Checked: ${uniqueCandidates.join(
      ", ",
    )}`,
    DyadErrorKind.Internal,
  );
}

export async function createFromTemplate({
  fullAppPath,
  templateId: requestedTemplateId,
}: {
  fullAppPath: string;
  templateId?: string;
}) {
  const settings = readSettings();
  const templateId = requestedTemplateId ?? settings.selectedTemplateId;

  if (templateId === "react") {
    await copyDirectoryRecursive(getBundledScaffoldPath(), fullAppPath);
    return;
  }

  const template = await getTemplateOrThrow(templateId);
  if (!template.githubUrl) {
    throw new DyadError(
      `Template ${templateId} has no GitHub URL`,
      DyadErrorKind.External,
    );
  }
  const repoCachePath = await cloneRepo(template.githubUrl);
  await copyRepoToApp(repoCachePath, fullAppPath);
  await patchTemplateAppRules(fullAppPath);
}

async function cloneRepo(repoUrl: string): Promise<string> {
  const url = new URL(repoUrl);
  if (url.protocol !== "https:") {
    throw new DyadError(
      "Repository URL must use HTTPS.",
      DyadErrorKind.External,
    );
  }
  if (url.hostname !== "github.com") {
    throw new DyadError(
      "Repository URL must be a github.com URL.",
      DyadErrorKind.Validation,
    );
  }

  // Pathname will be like "/org/repo" or "/org/repo.git"
  const pathParts = url.pathname.split("/").filter((part) => part.length > 0);

  if (pathParts.length !== 2) {
    throw new Error(
      "Invalid repository URL format. Expected 'https://github.com/org/repo'",
    );
  }

  const orgName = pathParts[0];
  const repoName = path.basename(pathParts[1], ".git"); // Remove .git suffix if present

  if (!orgName || !repoName) {
    // This case should ideally be caught by pathParts.length !== 2
    throw new Error(
      "Failed to parse organization or repository name from URL.",
    );
  }
  logger.info(`Parsed org: ${orgName}, repo: ${repoName} from ${repoUrl}`);

  const cachePath = path.join(
    getUserDataPath(),
    "templates",
    orgName,
    repoName,
  );

  if (fs.existsSync(cachePath)) {
    try {
      logger.info(
        `Repo ${repoName} already exists in cache at ${cachePath}. Checking for updates.`,
      );

      // Construct GitHub API URL
      const apiUrl = `https://api.github.com/repos/${orgName}/${repoName}/commits/HEAD`;
      logger.info(`Fetching remote SHA from ${apiUrl}`);

      // Use native fetch instead of isomorphic-git http.request
      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Dyad", // GitHub API requires this
          Accept: "application/vnd.github.v3+json",
        },
      });
      // Handle non-200 responses
      if (!response.ok) {
        throw new Error(
          `GitHub API request failed with status ${response.status}: ${response.statusText}`,
        );
      }
      // Parse JSON directly (fetch handles streaming internally)
      const commitData = await response.json();
      const remoteSha = commitData.sha;
      if (!remoteSha) {
        throw new DyadError(
          "SHA not found in GitHub API response.",
          DyadErrorKind.NotFound,
        );
      }

      logger.info(`Successfully fetched remote SHA: ${remoteSha}`);

      // Compare with local SHA
      const localSha = await getCurrentCommitHash({ path: cachePath });

      if (remoteSha === localSha) {
        logger.info(
          `Local cache for ${repoName} is up to date (SHA: ${localSha}). Skipping clone.`,
        );
        return cachePath;
      } else {
        logger.info(
          `Local cache for ${repoName} (SHA: ${localSha}) is outdated (Remote SHA: ${remoteSha}). Removing and re-cloning.`,
        );
        fs.rmSync(cachePath, { recursive: true, force: true });
        // Continue to clone…
      }
    } catch (err) {
      logger.warn(
        `Error checking for updates or comparing SHAs for ${repoName} at ${cachePath}. Will attempt to re-clone. Error: `,
        err,
      );
      return cachePath;
    }
  }

  fs.ensureDirSync(path.dirname(cachePath));

  logger.info(`Cloning ${repoUrl} to ${cachePath}`);
  try {
    await gitClone({ path: cachePath, url: repoUrl, depth: 1 });
    logger.info(`Successfully cloned ${repoUrl} to ${cachePath}`);
  } catch (err) {
    logger.error(`Failed to clone ${repoUrl} to ${cachePath}: `, err);
    throw err; // Re-throw the error after logging
  }
  return cachePath;
}

async function copyRepoToApp(repoCachePath: string, appPath: string) {
  logger.info(`Copying from ${repoCachePath} to ${appPath}`);
  try {
    await fs.copy(repoCachePath, appPath, {
      filter: (src, _dest) => {
        const excludedDirs = ["node_modules", ".git"];
        const relativeSrc = path.relative(repoCachePath, src);
        if (excludedDirs.includes(path.basename(relativeSrc))) {
          logger.info(`Excluding ${src} from copy`);
          return false;
        }
        return true;
      },
    });
    logger.info("Finished copying repository contents.");
  } catch (err) {
    logger.error(
      `Error copying repository from ${repoCachePath} to ${appPath}: `,
      err,
    );
    throw err; // Re-throw the error after logging
  }
}

async function patchTemplateAppRules(appPath: string) {
  if (await isNextApp(appPath)) {
    await appendNextAppRouterRules(appPath);
  }
}

async function isNextApp(appPath: string): Promise<boolean> {
  const packageJsonPath = path.join(appPath, "package.json");
  let packageJson: {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  try {
    packageJson = await fs.readJson(packageJsonPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw err;
  }

  return (
    typeof packageJson.dependencies?.next === "string" ||
    typeof packageJson.devDependencies?.next === "string"
  );
}
