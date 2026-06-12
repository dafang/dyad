import { toLocalWebPreviewPublicUrl } from "@/lib/local_web_transport";

export function normalizePreviewUrlForApp({
  url,
  appUrl,
  appId,
}: {
  url: string | null | undefined;
  appUrl: string | null;
  appId: number | null;
}): string | null {
  if (!url || !appUrl || appId === null) {
    return null;
  }
  try {
    const resolvedUrl = url.startsWith("/")
      ? new URL(`.${url}`, appUrl).href
      : new URL(url, appUrl).href;
    return toLocalWebPreviewPublicUrl(resolvedUrl, appId);
  } catch {
    return null;
  }
}

export function isSamePreviewOrigin(url: string, appUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

export function isPreviewRootUrl(url: string, appId: number): boolean {
  const pathname = new URL(url).pathname;
  const localWebPrefix = `/api/preview/${appId}`;
  return (
    pathname === "/" ||
    pathname === "" ||
    pathname === localWebPrefix ||
    pathname === `${localWebPrefix}/`
  );
}

export function getPreviewDisplayPath({
  url,
  appId,
}: {
  url: string | null | undefined;
  appId: number | null;
}): string {
  if (!url) {
    return "/";
  }

  try {
    const parsed = new URL(url);
    if (appId === null) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    const localWebPrefix = `/api/preview/${appId}`;
    if (
      parsed.pathname === localWebPrefix ||
      parsed.pathname === `${localWebPrefix}/`
    ) {
      return `/${parsed.search}${parsed.hash}`;
    }
    if (parsed.pathname.startsWith(`${localWebPrefix}/`)) {
      return `${parsed.pathname.slice(localWebPrefix.length)}${parsed.search}${parsed.hash}`;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}
