import fs from "node:fs";
import path from "node:path";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { DEFAULT_SETTINGS } from "@/lib/default_user_settings";
import {
  migrateStoredSettings,
  type Secret,
  StoredUserSettingsSchema,
  UserSettingsSchema,
  type UserSettings,
} from "@/lib/schemas";

const SETTINGS_FILE = "user-settings.json";

export type LocalWebSecretStorageMode = "plaintext";

export interface LocalWebSettingsStoreOptions {
  userDataPath: string;
  secretStorageMode?: LocalWebSecretStorageMode;
}

export interface LocalWebSettingsStore {
  readonly userDataPath: string;
  readonly settingsFilePath: string;
  readonly secretStorageMode: LocalWebSecretStorageMode;
  readSettings(): UserSettings;
  writeSettings(settings: Partial<UserSettings>): void;
}

export function createLocalWebSettingsStore(
  options: LocalWebSettingsStoreOptions,
): LocalWebSettingsStore {
  const secretStorageMode = options.secretStorageMode ?? "plaintext";
  if (secretStorageMode !== "plaintext") {
    throw new DyadError(
      "Local Web settings only support plaintext secret storage",
      DyadErrorKind.Validation,
    );
  }

  const settingsFilePath = path.join(options.userDataPath, SETTINGS_FILE);
  return {
    userDataPath: options.userDataPath,
    settingsFilePath,
    secretStorageMode,
    readSettings: () => readLocalWebSettings(settingsFilePath),
    writeSettings: (settings) =>
      writeLocalWebSettings(settingsFilePath, settings),
  };
}

function readLocalWebSettings(filePath: string): UserSettings {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    writeSettingsFile(filePath, DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }

  const rawSettings = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const combinedSettings: UserSettings = {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    hasRunBefore: rawSettings.hasRunBefore ?? true,
  };
  normalizeSecretsForPlaintextStorage(combinedSettings);
  const storedSettings = StoredUserSettingsSchema.parse(combinedSettings);
  return UserSettingsSchema.parse(migrateStoredSettings(storedSettings));
}

function writeLocalWebSettings(
  filePath: string,
  settings: Partial<UserSettings>,
): void {
  const current = readLocalWebSettings(filePath);
  const nextSettings = { ...current, ...settings };
  normalizeSecretsForPlaintextStorage(nextSettings);
  const validatedSettings = StoredUserSettingsSchema.parse(nextSettings);
  writeSettingsFile(filePath, validatedSettings);
}

function normalizeSecretsForPlaintextStorage(settings: UserSettings): void {
  forEachSecret(settings, (secret, replace) => {
    if (secret.encryptionType === "electron-safe-storage") {
      replace(undefined);
      return;
    }
    replace({
      value: secret.value.trim(),
      encryptionType: "plaintext",
    });
  });
}

function forEachSecret(
  settings: UserSettings,
  visit: (
    secret: Secret,
    replace: (secret: Secret | undefined) => void,
  ) => void,
): void {
  if (settings.githubAccessToken) {
    visit(settings.githubAccessToken, (secret) => {
      settings.githubAccessToken = secret;
    });
  }
  if (settings.vercelAccessToken) {
    visit(settings.vercelAccessToken, (secret) => {
      settings.vercelAccessToken = secret;
    });
  }
  if (settings.supabase?.accessToken) {
    visit(settings.supabase.accessToken, (secret) => {
      settings.supabase!.accessToken = secret;
    });
  }
  if (settings.supabase?.refreshToken) {
    visit(settings.supabase.refreshToken, (secret) => {
      settings.supabase!.refreshToken = secret;
    });
  }
  if (settings.supabase?.organizations) {
    for (const orgId of Object.keys(settings.supabase.organizations)) {
      const org = settings.supabase.organizations[orgId];
      let dropOrganization = false;
      if (org.accessToken) {
        visit(org.accessToken, (secret) => {
          if (secret) {
            org.accessToken = secret;
          } else {
            dropOrganization = true;
          }
        });
      }
      if (org.refreshToken) {
        visit(org.refreshToken, (secret) => {
          if (secret) {
            org.refreshToken = secret;
          } else {
            dropOrganization = true;
          }
        });
      }
      if (dropOrganization || !org.accessToken || !org.refreshToken) {
        delete settings.supabase.organizations[orgId];
      }
    }
  }
  if (settings.neon?.accessToken) {
    visit(settings.neon.accessToken, (secret) => {
      settings.neon!.accessToken = secret;
    });
  }
  if (settings.neon?.refreshToken) {
    visit(settings.neon.refreshToken, (secret) => {
      settings.neon!.refreshToken = secret;
    });
  }
  for (const provider of Object.keys(settings.providerSettings)) {
    const providerSettings = settings.providerSettings[provider];
    if (providerSettings.apiKey) {
      visit(providerSettings.apiKey, (secret) => {
        providerSettings.apiKey = secret;
      });
    }
    const vertexSettings = providerSettings as {
      serviceAccountKey?: Secret;
    };
    if (provider === "vertex" && vertexSettings.serviceAccountKey) {
      visit(vertexSettings.serviceAccountKey, (secret) => {
        vertexSettings.serviceAccountKey = secret;
      });
    }
  }
}

function writeSettingsFile(filePath: string, settings: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempFilePath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tempFilePath, JSON.stringify(settings, null, 2));
    fs.renameSync(tempFilePath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch {
      // Best-effort cleanup only.
    }
    throw new DyadError(
      `Failed to write local Web settings: ${
        error instanceof Error ? error.message : String(error)
      }`,
      DyadErrorKind.External,
      { cause: error },
    );
  }
}
