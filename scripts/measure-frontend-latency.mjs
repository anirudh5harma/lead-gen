import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : "1"];
  }),
);

const url = args.get("url") ?? "http://localhost:3024/";
const selector = args.get("selector") ?? 'a[href="/dashboard"]';
const cpuRate = Number(args.get("cpu") ?? "1");
const port = Number(args.get("port") ?? "9347");
const chromePath = args.get("chrome") ?? DEFAULT_CHROME;
const json = args.has("json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGetJson(targetUrl) {
  return new Promise((resolve, reject) => {
    const req = http.get(targetUrl, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(10_000, () => {
      req.destroy(new Error(`Timed out reading ${targetUrl}`));
    });
  });
}

async function waitForJson(targetUrl, timeoutMs = 10_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await httpGetJson(targetUrl);
    } catch (err) {
      lastError = err;
      await sleep(100);
    }
  }
  throw lastError ?? new Error(`Timed out waiting for ${targetUrl}`);
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (!msg.method) return;
      for (const handler of this.handlers.get(msg.method) ?? []) {
        handler(msg.params ?? {});
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) ?? [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // Ignore close races; Chrome is about to exit.
    }
  }
}

async function startChrome() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "bombsell-perf-"));
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-extensions",
      "--disable-component-update",
      "--hide-scrollbars",
      "--window-size=1440,1000",
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  chrome.stderr.on("data", () => {});
  await waitForJson(`http://127.0.0.1:${port}/json/version`);
  return { chrome, userDataDir };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result?.value;
}

async function measure() {
  const targets = await httpGetJson(`http://127.0.0.1:${port}/json/list`);
  const page = targets.find((target) => target.type === "page") ?? targets[0];
  const cdp = new CDP(page.webSocketDebuggerUrl);
  const requests = [];
  const responses = [];
  const navigations = [];

  cdp.on("Network.requestWillBeSent", (params) => {
    requests.push({
      url: params.request.url,
      type: params.type,
      wallTime: params.wallTime,
      timestamp: params.timestamp,
    });
  });
  cdp.on("Network.responseReceived", (params) => {
    responses.push({
      url: params.response.url,
      status: params.response.status,
      type: params.type,
      timestamp: params.timestamp,
      fromDiskCache: params.response.fromDiskCache,
      fromPrefetchCache: params.response.fromPrefetchCache,
      encodedDataLength: params.response.encodedDataLength,
    });
  });
  cdp.on("Page.frameNavigated", (params) => {
    navigations.push({ url: params.frame.url, at: Date.now() });
  });

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Performance.enable");
  if (Number.isFinite(cpuRate) && cpuRate > 1) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
  }

  let loadResolve;
  const loadPromise = new Promise((resolve) => {
    loadResolve = resolve;
  });
  cdp.on("Page.loadEventFired", loadResolve);
  await cdp.send("Page.navigate", { url });
  await loadPromise;
  await sleep(1200);

  await evaluate(
    cdp,
    `(() => {
      window.__bombsellPerf = { longtasks: [], events: [] };
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            window.__bombsellPerf.longtasks.push({
              name: e.name,
              startTime: e.startTime,
              duration: e.duration
            });
          }
        }).observe({ type: "longtask", buffered: true });
      } catch (err) {
        window.__bombsellPerf.longtaskError = String(err);
      }
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            window.__bombsellPerf.events.push({
              name: e.name,
              startTime: e.startTime,
              duration: e.duration,
              processingStart: e.processingStart,
              processingEnd: e.processingEnd,
              interactionId: e.interactionId
            });
          }
        }).observe({ type: "event", buffered: true, durationThreshold: 0 });
      } catch (err) {
        window.__bombsellPerf.eventError = String(err);
      }
    })()`,
  );

  const initial = await evaluate(
    cdp,
    `(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const resources = performance.getEntriesByType("resource").map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        startTime: entry.startTime,
        duration: entry.duration,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize
      }));
      return {
        href: location.href,
        navigation: nav ? {
          responseStart: nav.responseStart,
          responseEnd: nav.responseEnd,
          domInteractive: nav.domInteractive,
          domContentLoaded: nav.domContentLoadedEventEnd,
          load: nav.loadEventEnd,
          transferSize: nav.transferSize,
          encodedBodySize: nav.encodedBodySize
        } : null,
        domNodes: document.getElementsByTagName("*").length,
        scriptCount: document.scripts.length,
        linkCount: document.querySelectorAll("link").length,
        scripts: [...document.scripts].map((script) => ({
          src: script.src || "inline",
          async: script.async,
          defer: script.defer,
          type: script.type
        })),
        links: [...document.querySelectorAll("link")].map((link) => ({
          rel: link.rel,
          href: link.href,
          as: link.as,
          fetchPriority: link.fetchPriority
        })),
        resourceTotals: resources.reduce((acc, entry) => {
          acc.transfer += entry.transferSize || 0;
          acc.encoded += entry.encodedBodySize || 0;
          if (entry.initiatorType === "script") acc.scriptEncoded += entry.encodedBodySize || 0;
          if (entry.initiatorType === "css" || entry.name.includes(".css")) acc.cssEncoded += entry.encodedBodySize || 0;
          if (entry.initiatorType === "img") acc.imageEncoded += entry.encodedBodySize || 0;
          if (entry.initiatorType === "link" || entry.name.includes("fonts")) acc.fontEncoded += entry.encodedBodySize || 0;
          return acc;
        }, { transfer: 0, encoded: 0, scriptEncoded: 0, cssEncoded: 0, imageEncoded: 0, fontEncoded: 0 }),
        largestResources: resources
          .sort((a, b) => (b.encodedBodySize || 0) - (a.encodedBodySize || 0))
          .slice(0, 14)
      };
    })()`,
  );

  const clickTarget = await evaluate(
    cdp,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        text: el.textContent.trim(),
        href: el.href,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      };
    })()`,
  );

  const clickWallTime =
    (await evaluate(cdp, "performance.timeOrigin / 1000 + performance.now() / 1000")) ??
    Date.now() / 1000;
  if (clickTarget) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: clickTarget.x,
      y: clickTarget.y,
      button: "none",
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: clickTarget.x,
      y: clickTarget.y,
      button: "left",
      clickCount: 1,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: clickTarget.x,
      y: clickTarget.y,
      button: "left",
      clickCount: 1,
    });
  }

  const current = new URL(url);
  const startedAt = Date.now();
  let finalUrl = "";
  while (Date.now() - startedAt < 6000) {
    try {
      finalUrl = await evaluate(cdp, "location.href");
      if (finalUrl && finalUrl !== current.href) break;
    } catch {
      break;
    }
    await sleep(50);
  }
  await sleep(500);

  const perfAfterClick =
    (await evaluate(cdp, "(() => window.__bombsellPerf || null)()").catch(() => null)) ?? {};
  const afterClickRequests = requests.filter(
    (request) => request.wallTime && request.wallTime >= clickWallTime - 0.02,
  );
  const firstDocumentRequest = afterClickRequests.find((request) => request.type === "Document");
  const firstRelevantRequest = afterClickRequests.find((request) =>
    request.url.includes("/dashboard") ||
    request.url.includes("/auth/google") ||
    request.url.includes("/auth/v1/authorize"),
  );

  const output = {
    url,
    selector,
    cpuRate,
    initial,
    click: {
      target: clickTarget,
      finalUrl,
      firstRelevantRequestMs: firstRelevantRequest
        ? Math.round((firstRelevantRequest.wallTime - clickWallTime) * 1000)
        : null,
      firstDocumentRequestMs: firstDocumentRequest
        ? Math.round((firstDocumentRequest.wallTime - clickWallTime) * 1000)
        : null,
      events: (perfAfterClick.events ?? [])
        .filter((entry) => ["pointerdown", "pointerup", "mousedown", "mouseup", "click"].includes(entry.name))
        .slice(-12),
      requests: afterClickRequests.slice(0, 12).map((request) => ({
        url: request.url,
        type: request.type,
        deltaMs: Math.round((request.wallTime - clickWallTime) * 1000),
      })),
      responses: responses.slice(-10),
      navigations: navigations.slice(-8),
    },
    longtasks: (perfAfterClick.longtasks ?? [])
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10),
  };

  cdp.close();
  return output;
}

let chrome;
try {
  chrome = await startChrome();
  const output = await measure();
  if (json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`URL: ${output.url}`);
    console.log(`Selector: ${output.selector}`);
    console.log(`CPU throttle: ${output.cpuRate}x`);
    console.log(
      `Navigation: responseStart=${Math.round(output.initial.navigation?.responseStart ?? 0)}ms domInteractive=${Math.round(output.initial.navigation?.domInteractive ?? 0)}ms load=${Math.round(output.initial.navigation?.load ?? 0)}ms`,
    );
    console.log(
      `Resources: total=${output.initial.resourceTotals.encoded}B script=${output.initial.resourceTotals.scriptEncoded}B css=${output.initial.resourceTotals.cssEncoded}B font=${output.initial.resourceTotals.fontEncoded}B image=${output.initial.resourceTotals.imageEncoded}B`,
    );
    console.log(
      `Click: firstRequest=${output.click.firstRelevantRequestMs}ms firstDocument=${output.click.firstDocumentRequestMs}ms final=${output.click.finalUrl}`,
    );
    console.log(
      `Long tasks: ${output.longtasks.map((task) => `${Math.round(task.duration)}ms@${Math.round(task.startTime)}ms`).join(", ") || "none"}`,
    );
    console.log("Largest resources:");
    for (const resource of output.initial.largestResources.slice(0, 8)) {
      console.log(
        `  ${resource.encodedBodySize}B ${resource.initiatorType.padEnd(8)} ${resource.name}`,
      );
    }
  }
} finally {
  if (chrome?.chrome) chrome.chrome.kill("SIGKILL");
}
