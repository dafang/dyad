import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLocalRpcServer } from "./local_rpc_server";
import {
  createLocalWebMediaRoutes,
  getLocalWebMediaUrl,
} from "./local_web_media_routes";
import {
  createLocalWebPathResolver,
  type LocalWebPathResolver,
} from "./local_web_paths";
import { createLocalWebSettingsStore } from "./local_web_settings";

describe("local Web media routes", () => {
  let tempDir: string;
  let resolver: LocalWebPathResolver;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), "tmp-local-web-media-"));
    const settingsStore = createLocalWebSettingsStore({
      userDataPath: tempDir,
    });
    resolver = createLocalWebPathResolver({
      userDataPath: tempDir,
      settingsStore,
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("serves Dyad media and screenshot files over HTTP", async () => {
    const appPath = "sample-app";
    const appRoot = resolver.getDyadAppPath(appPath);
    fs.mkdirSync(path.join(appRoot, ".dyad", "screenshot"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(appRoot, ".dyad", "screenshot", "abc.png"),
      "image-bytes",
    );

    const server = createLocalRpcServer({
      token: "token",
      allowedOrigins: ["http://127.0.0.1:5173"],
      routes: createLocalWebMediaRoutes({ pathResolver: resolver }),
    });
    const listening = await server.listen();
    try {
      const url = getLocalWebMediaUrl({
        appPath,
        dyadRelativePath: ".dyad/screenshot/abc.png",
        baseUrl: listening.url,
      });
      const response = await request(url);
      expect(response.body).toBe("image-bytes");
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("image/png");
    } finally {
      await server.close();
    }
  });

  it("rejects paths outside allowed Dyad media directories", async () => {
    const server = createLocalRpcServer({
      token: "token",
      allowedOrigins: ["http://127.0.0.1:5173"],
      routes: createLocalWebMediaRoutes({ pathResolver: resolver }),
    });
    const listening = await server.listen();
    try {
      const baseUrl = `${listening.url}/api/media/sample-app`;
      await expect(request(`${baseUrl}/package.json`)).resolves.toMatchObject({
        status: 401,
      });
      await expect(
        request(`${baseUrl}/.dyad/screenshot/%2E%2E/secret.png`),
      ).resolves.toMatchObject({
        status: 401,
      });
    } finally {
      await server.close();
    }
  });
});

function request(url: string): Promise<{
  status: number | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      })
      .on("error", reject);
  });
}
