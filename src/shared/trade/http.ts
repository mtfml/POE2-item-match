// Replaces EE2's Host.proxy() (a WebSocket hop from renderer to main, which
// then used Electron's net.request to dodge CORS/Cloudflare bot-detection).
// This module already runs in the main process, so it calls net.request
// directly - confirmed live against the real trade API that this alone is
// enough to get past Cloudflare (a bare Node/curl request gets a 403; this
// doesn't, because it rides Chromium's real network stack/TLS fingerprint).
import { app, net } from "electron";

export interface SimpleResponse {
  status: number;
  headers: Headers;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export function httpFetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<SimpleResponse> {
  return new Promise((resolve, reject) => {
    const req = net.request({
      url,
      method: init?.method ?? "GET",
      useSessionCookies: true,
      referrerPolicy: "no-referrer-when-downgrade",
    });

    req.setHeader("user-agent", app.userAgentFallback);
    for (const [key, value] of Object.entries(init?.headers ?? {})) {
      req.setHeader(key, value);
    }

    let body = "";
    req.on("response", (res) => {
      const headers = new Headers();
      for (const [key, values] of Object.entries(res.headers)) {
        for (const value of Array.isArray(values) ? values : [values]) {
          if (value != null) headers.append(key, value);
        }
      }

      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers,
          json: async () => JSON.parse(body),
          text: async () => body,
        });
      });
      res.on("error", reject);
    });
    req.on("error", reject);

    if (init?.body) req.write(init.body);
    req.end();
  });
}
