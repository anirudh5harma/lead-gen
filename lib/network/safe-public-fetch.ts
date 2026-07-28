import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import {
  isPublicIpAddress,
  normalizePublicHttpUrl,
} from "./public-url.ts";

const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type PublicHostAddress = {
  address: string;
  family: 4 | 6;
};

export type PublicHostResolver = (
  hostname: string,
) => Promise<PublicHostAddress[]>;

export type PinnedHttpRequest = (
  url: URL,
  address: string,
  family: 4 | 6,
  signal?: AbortSignal,
) => Promise<Response>;

export interface FetchPublicHttpUrlOptions {
  headers?: HeadersInit;
  maxRedirects?: number;
  maxResponseBytes?: number;
  request?: PinnedHttpRequest;
  resolveHost?: PublicHostResolver;
  signal?: AbortSignal;
}

export async function fetchPublicHttpUrl(
  rawUrl: string,
  options: FetchPublicHttpUrlOptions = {},
): Promise<Response | null> {
  const normalized = normalizePublicHttpUrl(rawUrl);
  if (!normalized) return null;

  const resolveHost = options.resolveHost ?? resolvePublicHost;
  const request = options.request ?? requestPinned;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let currentUrl = new URL(normalized);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const addresses = await waitForWithAbort(
      resolveHost(currentUrl.hostname),
      options.signal,
    );
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => !isPublicIpAddress(address))
    ) {
      return null;
    }

    const selected = addresses[0];
    const response = await request(
      currentUrl,
      selected.address,
      selected.family,
      options.signal,
    );
    if (!isRedirect(response.status)) return response;
    if (redirectCount === maxRedirects) return null;

    const location = response.headers.get("location");
    if (!location) return null;
    const redirectUrl = normalizePublicHttpUrl(
      new URL(location, currentUrl).toString(),
    );
    if (!redirectUrl) return null;
    currentUrl = new URL(redirectUrl);
  }

  return null;

  async function requestPinned(
    url: URL,
    address: string,
    family: 4 | 6,
    signal?: AbortSignal,
  ): Promise<Response> {
    return requestPinnedHttpUrl(url, address, family, {
      headers: options.headers,
      maxResponseBytes:
        options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      signal,
    });
  }
}

async function resolvePublicHost(hostname: string): Promise<PublicHostAddress[]> {
  const literalFamily = isIP(hostname);
  if (literalFamily) {
    return [{ address: hostname, family: literalFamily === 6 ? 6 : 4 }];
  }
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }));
}

function requestPinnedHttpUrl(
  url: URL,
  address: string,
  family: 4 | 6,
  {
    headers,
    maxResponseBytes,
    signal,
  }: {
    headers?: HeadersInit;
    maxResponseBytes: number;
    signal?: AbortSignal;
  },
): Promise<Response> {
  const request = url.protocol === "https:" ? requestHttps : requestHttp;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        headers: headers ? Object.fromEntries(new Headers(headers)) : undefined,
        lookup: (_hostname, lookupOptions, callback) => {
          if (
            typeof lookupOptions === "object" &&
            lookupOptions !== null &&
            lookupOptions.all
          ) {
            callback(null, [{ address, family }]);
            return;
          }
          callback(null, address, family);
        },
        signal,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        incoming.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxResponseBytes) {
            req.destroy(new Error("public website response exceeded size limit"));
            return;
          }
          chunks.push(chunk);
        });
        incoming.on("end", () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) responseHeaders.append(name, item);
            } else if (value !== undefined) {
              responseHeaders.set(name, value);
            }
          }
          resolve(
            new Response(allowsResponseBody(incoming.statusCode) ? Buffer.concat(chunks) : null, {
              status: incoming.statusCode ?? 500,
              headers: responseHeaders,
            }),
          );
        });
        incoming.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function allowsResponseBody(status: number | undefined): boolean {
  return status !== 204 && status !== 205 && status !== 304;
}

function waitForWithAbort<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(signal.reason);

  return new Promise((resolve, reject) => {
    const stopWaiting = () => {
      signal.removeEventListener("abort", stopWaiting);
      reject(signal.reason);
    };
    signal.addEventListener("abort", stopWaiting, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", stopWaiting);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", stopWaiting);
        reject(error);
      },
    );
  });
}
