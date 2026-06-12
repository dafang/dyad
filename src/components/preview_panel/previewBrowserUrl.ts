export async function resolvePreviewBrowserUrl(input: {
  isCloudMode: boolean;
  selectedAppId: number | null;
  appUrl?: string | null;
  originalUrl: string | null | undefined;
  createCloudSandboxShareLink: (params: {
    appId: number;
  }) => Promise<{ url: string }>;
}): Promise<string> {
  if (input.isCloudMode) {
    if (input.selectedAppId === null) {
      throw new Error("Cloud sandbox is not running.");
    }

    const shareLink = await input.createCloudSandboxShareLink({
      appId: input.selectedAppId,
    });
    return shareLink.url;
  }

  if (input.appUrl && isLocalWebPreviewUrl(input.appUrl, input.selectedAppId)) {
    return input.appUrl;
  }

  if (!input.originalUrl) {
    throw new Error("Preview URL is unavailable.");
  }

  return input.originalUrl;
}

function isLocalWebPreviewUrl(
  appUrl: string,
  selectedAppId: number | null,
): boolean {
  if (selectedAppId === null) {
    return false;
  }

  try {
    const pathname = new URL(appUrl).pathname;
    const previewPrefix = `/api/preview/${selectedAppId}`;
    return (
      pathname === previewPrefix || pathname.startsWith(`${previewPrefix}/`)
    );
  } catch {
    return false;
  }
}
