#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { once } from "node:events";

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const publisherContentSecurityPolicy = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "font-src 'self' data:",
  "connect-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--require-scroll-video") {
      values["require-scroll-video"] = true;
      continue;
    }
    if (!key.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(`Invalid argument: ${key}`);
    }
    values[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  if ((!values["site-dir"] && !values.url) || (values["site-dir"] && values.url)
      || !values["output-dir"] || !values["business-name"]) {
    throw new Error("Usage: qa-site.mjs (--site-dir DIR | --url URL) --output-dir DIR --business-name NAME");
  }
  return values;
}

async function startStaticServer(siteDir) {
  const root = await realpath(siteDir);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const requested = resolve(root, `.${pathname}`);
      const rel = relative(root, requested);
      if (rel.startsWith(`..${sep}`) || rel === ".." || rel.includes(`..${sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      let target = requested;
      let targetStat;
      try {
        targetStat = await stat(target);
        if (targetStat.isDirectory()) {
          target = join(target, "index.html");
          targetStat = await stat(target);
        }
      } catch {
        response.writeHead(404).end("Not found");
        return;
      }
      if (!targetStat.isFile()) {
        response.writeHead(404).end("Not found");
        return;
      }
      const content = await readFile(target);
      const commonHeaders = {
        "accept-ranges": "bytes",
        "cache-control": "no-store",
        "content-security-policy": publisherContentSecurityPolicy,
        "content-type": mimeTypes.get(extname(target).toLowerCase()) || "application/octet-stream",
      };
      const range = request.headers.range;
      if (range && request.method !== "HEAD") {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        const start = match && match[1] ? Number.parseInt(match[1], 10) : 0;
        const requestedEnd = match && match[2]
          ? Number.parseInt(match[2], 10)
          : content.length - 1;
        const end = Math.min(requestedEnd, content.length - 1);
        if (!match || !Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= content.length) {
          response.writeHead(416, {
            ...commonHeaders,
            "content-range": `bytes */${content.length}`,
          }).end();
          return;
        }
        const partial = content.subarray(start, end + 1);
        response.writeHead(206, {
          ...commonHeaders,
          "content-length": partial.length,
          "content-range": `bytes ${start}-${end}/${content.length}`,
        });
        response.end(partial);
        return;
      }
      response.writeHead(200, {
        ...commonHeaders,
        "content-length": content.length,
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function launchChrome() {
  const profileDir = `/tmp/neural-labs-prospect-qa-${process.pid}-${Date.now()}`;
  const child = spawn(
    process.env.CHROME_BIN || "/usr/bin/chromium",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  let websocketUrl = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) websocketUrl = match[1];
  });
  const deadline = Date.now() + 10_000;
  while (!websocketUrl && Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Chrome exited early: ${stderr}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  if (!websocketUrl) {
    child.kill("SIGTERM");
    throw new Error(`Chrome did not expose DevTools: ${stderr}`);
  }
  const endpoint = new URL(websocketUrl);
  return {
    process: child,
    profileDir,
    baseUrl: `http://${endpoint.hostname}:${endpoint.port}`,
    stderr: () => stderr,
  };
}

class CdpClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open() {
    await new Promise((resolvePromise, reject) => {
      this.ws.addEventListener("open", resolvePromise, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  waitFor(method, timeoutMs = 15_000) {
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      this.on(method, (params) => {
        clearTimeout(timeout);
        resolvePromise(params);
      });
    });
  }

  async close() {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    const closed = new Promise((resolvePromise) => {
      this.ws.addEventListener("close", resolvePromise, { once: true });
    });
    this.ws.close();
    await Promise.race([
      closed,
      new Promise((resolvePromise) => setTimeout(resolvePromise, 1000)),
    ]);
  }
}

async function inspectViewport({ chrome, url, outputDir, businessName, viewport, requireScrollVideo }) {
  const response = await fetch(`${chrome.baseUrl}/json/new?${encodeURIComponent("about:blank")}`, {
    method: "PUT",
  });
  if (!response.ok) throw new Error(`Could not create Chrome target: ${response.status}`);
  const target = await response.json();
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.open();

  const consoleErrors = [];
  const exceptions = [];
  const failedRequests = [];
  const badResponses = [];
  cdp.on("Runtime.consoleAPICalled", (event) => {
    if (["error", "assert"].includes(event.type)) {
      consoleErrors.push(event.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ") || event.type);
    }
  });
  cdp.on("Runtime.exceptionThrown", (event) => {
    exceptions.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || "Exception");
  });
  cdp.on("Network.loadingFailed", (event) => {
    if (!event.canceled) failedRequests.push(`${event.type}: ${event.errorText}`);
  });
  cdp.on("Network.responseReceived", (event) => {
    if (event.response?.status >= 400 && !event.response.url.endsWith("/favicon.ico")) {
      badResponses.push(`${event.response.status} ${event.response.url}`);
    }
  });

  await Promise.all([
    cdp.send("Page.enable"),
    cdp.send("Runtime.enable"),
    cdp.send("Network.enable"),
  ]);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  });
  const loaded = cdp.waitFor("Page.loadEventFired");
  await cdp.send("Page.navigate", { url });
  await loaded;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200));

  const evaluation = await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `
      (async () => {
        const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const text = normalize(document.body?.innerText).toLowerCase();
        const expected = ${JSON.stringify(businessName.toLowerCase())};
        const internalLinks = [...new Set([...document.querySelectorAll('a[href]')]
          .map((node) => new URL(node.getAttribute('href'), location.href))
          .filter((link) => link.origin === location.origin && !link.hash)
          .map((link) => link.href))];
        const unnamedControls = [...document.querySelectorAll('button,input,select,textarea,summary')]
          .filter((node) => !normalize(node.innerText || node.value || node.getAttribute('aria-label') || node.getAttribute('title')))
          .map((node) => node.tagName.toLowerCase());
        const imagesMissingAlt = [...document.querySelectorAll('img:not([alt])')]
          .map((node) => node.getAttribute('src') || '<inline>');
        const executableScriptTypes = new Set([
          '',
          'application/ecmascript',
          'application/javascript',
          'module',
          'text/ecmascript',
          'text/javascript',
        ]);
        const inlineExecutableScripts = [...document.querySelectorAll('script:not([src])')]
          .filter((node) => executableScriptTypes.has((node.getAttribute('type') || '').trim().toLowerCase()))
          .map((node, index) => ({
            index,
            type: (node.getAttribute('type') || 'classic').trim(),
            preview: normalize(node.textContent).slice(0, 100),
          }));
        const inlineEventHandlers = [...document.querySelectorAll('*')]
          .flatMap((node) => [...node.attributes]
            .filter((attribute) => attribute.name.toLowerCase().startsWith('on'))
            .map((attribute) => node.tagName.toLowerCase() + '[' + attribute.name + ']'));
        const javascriptUrls = [...document.querySelectorAll('[href],[src],[action],[formaction]')]
          .flatMap((node) => ['href', 'src', 'action', 'formaction']
            .filter((attribute) => /^\\s*javascript:/i.test(node.getAttribute(attribute) || ''))
            .map((attribute) => node.tagName.toLowerCase() + '[' + attribute + ']'));
        let css = '';
        for (const sheet of [...document.styleSheets]) {
          try { css += [...sheet.cssRules].map((rule) => rule.cssText).join(' '); } catch {}
        }
        const hasMotion = /animation|transition/i.test(css);
        const metric = (node) => {
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          return {
            top: rect.top,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        };
        const intersectionRatio = (front, back) => {
          if (!front || !back || front.width <= 0 || front.height <= 0) return 0;
          const width = Math.max(0, Math.min(front.right, back.right) - Math.max(front.left, back.left));
          const height = Math.max(0, Math.min(front.bottom, back.bottom) - Math.max(front.top, back.top));
          return (width * height) / (front.width * front.height);
        };
        const profile = document.documentElement.dataset.presentationProfile
          || document.body?.dataset.presentationProfile
          || '';
        const profileRequired = profile === 'cinematic-media-first';
        const opening = document.querySelector('[data-opening-media-background]');
        const openingMedia = opening?.querySelector('img, video') || null;
        const openingHeading = opening?.querySelector('h1') || null;
        const openingRect = metric(opening);
        const openingMediaRect = metric(openingMedia);
        const openingHeadingRect = metric(openingHeading);
        const openingStyle = opening ? getComputedStyle(opening) : null;
        const openingUsesCssBackground = Boolean(
          openingStyle && openingStyle.backgroundImage && openingStyle.backgroundImage !== 'none'
        );
        const openingMediaCovers = Boolean(
          openingRect && (
            openingUsesCssBackground
            || (openingMediaRect
              && openingMediaRect.width >= openingRect.width * 0.85
              && openingMediaRect.height >= openingRect.height * 0.85)
          )
        );
        const openingHeadingOverMedia = Boolean(
          openingHeadingRect && (
            openingUsesCssBackground
            || intersectionRatio(openingHeadingRect, openingMediaRect) >= 0.75
          )
        );
        const openingHeadingSize = openingHeading
          ? Number.parseFloat(getComputedStyle(openingHeading).fontSize)
          : 0;

        const scrollScene = document.querySelector('[data-scroll-video-background]');
        const scrollStage = scrollScene?.querySelector('[data-scroll-video-stage]') || null;
        const scrollVideo = scrollStage?.querySelector('video') || null;
        const scrollCopy = scrollStage?.querySelector('[data-scroll-video-copy]') || null;
        const scrollStageRect = metric(scrollStage);
        const scrollVideoRect = metric(scrollVideo);
        const scrollCopyRect = metric(scrollCopy);
        const scrollVideoStyle = scrollVideo ? getComputedStyle(scrollVideo) : null;
        const motionScene = scrollScene
          || document.querySelector('[data-scroll-video-effect], [data-scroll-scene]');
        const motionVideo = motionScene?.querySelector('[data-scroll-video], video') || null;
        const motionRequired = ${Boolean(requireScrollVideo)}
          || Boolean(motionScene || motionVideo);
        const scrollVideoCovers = Boolean(
          scrollStageRect && scrollVideoRect
          && scrollVideoRect.width >= scrollStageRect.width * 0.85
          && scrollVideoRect.height >= scrollStageRect.height * 0.85
          && scrollVideoStyle?.objectFit === 'cover'
        );
        const compactViewport = window.innerWidth < 600;
        const cinematicProfile = {
          requested: profileRequired,
          profile,
          scrollVideoSelected: motionRequired,
          openingPresent: Boolean(opening),
          openingViewportScale: Boolean(
            openingRect
            && openingRect.width >= window.innerWidth * 0.92
            && openingRect.height >= window.innerHeight * 0.72
            && openingRect.top <= window.innerHeight * 0.25
          ),
          openingMediaCovers,
          openingHeadingOverMedia,
          openingHeadingDominant: openingHeadingSize >= (compactViewport ? 40 : 52),
          scrollScenePresent: Boolean(scrollScene && scrollStage && scrollVideo && scrollCopy),
          scrollStageViewportScale: Boolean(
            scrollStageRect
            && scrollStageRect.width >= window.innerWidth * 0.92
            && scrollStageRect.height >= window.innerHeight * 0.72
          ),
          scrollVideoCovers,
          scrollCopyOverVideo: intersectionRatio(scrollCopyRect, scrollVideoRect) >= 0.75,
          openingRect,
          openingMediaRect,
          openingHeadingRect,
          scrollStageRect,
          scrollVideoRect,
          scrollCopyRect,
          openingHeadingSize,
        };
        const cinematicOpeningPasses = [
          cinematicProfile.openingPresent,
          cinematicProfile.openingViewportScale,
          cinematicProfile.openingMediaCovers,
          cinematicProfile.openingHeadingOverMedia,
          cinematicProfile.openingHeadingDominant,
        ].every(Boolean);
        const cinematicOptionalScrollPasses = !motionRequired || [
          cinematicProfile.scrollScenePresent,
          cinematicProfile.scrollStageViewportScale,
          cinematicProfile.scrollVideoCovers,
          cinematicProfile.scrollCopyOverVideo,
        ].every(Boolean);
        const cinematicMediaFirst = !profileRequired
          || (cinematicOpeningPasses && cinematicOptionalScrollPasses);

        const wait = (milliseconds) => new Promise((resolvePromise) => {
          window.setTimeout(resolvePromise, milliseconds);
        });
        const waitFor = async (predicate, timeoutMs) => {
          const deadline = performance.now() + timeoutMs;
          while (performance.now() < deadline) {
            if (predicate()) return true;
            await wait(50);
          }
          return predicate();
        };
        const frameSignature = (video) => {
          if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 16;
            canvas.height = 9;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            const signature = [];
            for (let index = 0; index < pixels.length; index += 4) {
              signature.push(pixels[index], pixels[index + 1], pixels[index + 2]);
            }
            return signature;
          } catch {
            return null;
          }
        };
        const frameDifference = (first, second) => {
          if (!first || !second || first.length !== second.length || first.length === 0) return null;
          let difference = 0;
          for (let index = 0; index < first.length; index += 1) {
            difference += Math.abs(first[index] - second[index]);
          }
          return difference / first.length;
        };
        const scrollVideoMotion = {
          requested: motionRequired,
          tested: false,
          passed: !motionRequired,
          source: '',
          duration: 0,
          readyState: motionVideo?.readyState || 0,
          errorCode: motionVideo?.error?.code || null,
          muted: motionVideo?.muted === true,
          playsInline: motionVideo?.playsInline === true,
          sceneTravel: 0,
          minimumTimeDelta: 0,
          forwardTimes: [],
          reverseTime: null,
          forwardTimeDelta: 0,
          reverseTimeDelta: 0,
          forwardMonotonic: false,
          reverseMoved: false,
          frameDifference: null,
          videoVisible: false,
          motionState: '',
          fallbackReason: '',
          narrative: {
            tested: false,
            panelCount: 0,
            visibleCounts: [],
            states: [],
            passed: true,
          },
          rapidScroll: {
            tested: false,
            steps: 16,
            intervalMs: 55,
            expectedEndTime: null,
            endTime: null,
            settledTime: null,
            endProgressRatio: 0,
            settledError: null,
            frameDifference: null,
            passed: false,
          },
        };
        if (motionRequired && motionScene && motionVideo) {
          const originalScrollY = window.scrollY;
          const originalScrollBehavior = document.documentElement.style.scrollBehavior;
          document.documentElement.style.scrollBehavior = 'auto';
          try {
            const sceneRect = motionScene.getBoundingClientRect();
            const sceneTop = window.scrollY + sceneRect.top;
            const sceneTravel = Math.max(0, motionScene.offsetHeight - window.innerHeight);
            scrollVideoMotion.sceneTravel = sceneTravel;
            const scrollToProgress = (progress) => {
              window.scrollTo(0, Math.max(0, sceneTop + sceneTravel * progress));
            };
            const narrativePanels = [...motionScene.querySelectorAll(
              '[data-beat], [data-story-beat], [data-panel], [data-scroll-panel], .copy-state, .scene-beat'
            )];
            const visibleNarrative = () => narrativePanels
              .filter((node) => {
                const style = getComputedStyle(node);
                return style.display !== 'none'
                  && style.visibility !== 'hidden'
                  && Number.parseFloat(style.opacity || '1') > 0.1
                  && node.getAttribute('aria-hidden') !== 'true';
              })
              .map((node) => normalize(node.textContent));
            const sampleAt = async (progress) => {
              scrollToProgress(progress);
              await wait(650);
              await waitFor(() => !motionVideo.seeking, 1600);
              await wait(120);
              return {
                progress,
                time: Number.isFinite(motionVideo.currentTime) ? motionVideo.currentTime : null,
                signature: frameSignature(motionVideo),
                narrative: visibleNarrative(),
              };
            };

            scrollToProgress(0.08);
            const declaredSource = motionVideo.currentSrc
              || motionVideo.getAttribute('src')
              || motionVideo.dataset.src
              || motionVideo.querySelector('source[src]')?.getAttribute('src')
              || '';
            scrollVideoMotion.source = declaredSource;
            scrollVideoMotion.tested = true;
            const mediaReady = await waitFor(
              () => motionVideo.readyState >= 2
                && Number.isFinite(motionVideo.duration)
                && motionVideo.duration > 0,
              declaredSource ? 6000 : 0,
            );
            if (mediaReady) {
              const start = await sampleAt(0.08);
              const middle = await sampleAt(0.50);
              const end = await sampleAt(0.92);
              const reverse = await sampleAt(0.16);
              const rapidStart = await sampleAt(0.08);
              for (let step = 1; step <= scrollVideoMotion.rapidScroll.steps; step += 1) {
                const progress = 0.08 + (0.84 * step / scrollVideoMotion.rapidScroll.steps);
                scrollToProgress(progress);
                await wait(scrollVideoMotion.rapidScroll.intervalMs);
              }
              const rapidEndTime = Number.isFinite(motionVideo.currentTime)
                ? motionVideo.currentTime
                : null;
              const rapidEndSignature = frameSignature(motionVideo);
              await wait(720);
              await waitFor(() => !motionVideo.seeking, 900);
              await wait(80);
              const rapidSettledTime = Number.isFinite(motionVideo.currentTime)
                ? motionVideo.currentTime
                : null;
              const duration = motionVideo.duration;
              const minimumTimeDelta = Math.min(0.35, Math.max(0.12, duration * 0.04));
              const forwardTimes = [start.time, middle.time, end.time];
              const forwardTimeDelta = end.time - start.time;
              const reverseTimeDelta = end.time - reverse.time;
              const forwardMonotonic = forwardTimes.every(Number.isFinite)
                && start.time <= middle.time + 0.08
                && middle.time <= end.time + 0.08
                && forwardTimeDelta >= minimumTimeDelta;
              const reverseMoved = Number.isFinite(reverse.time)
                && reverseTimeDelta >= minimumTimeDelta;
              const visualDifference = frameDifference(start.signature, end.signature);
              const rapidExpectedDelta = end.time - rapidStart.time;
              const rapidEndProgressRatio = Number.isFinite(rapidEndTime) && rapidExpectedDelta > 0
                ? (rapidEndTime - rapidStart.time) / rapidExpectedDelta
                : 0;
              const rapidSettledError = Number.isFinite(rapidSettledTime)
                ? Math.abs(end.time - rapidSettledTime)
                : null;
              const rapidVisualDifference = frameDifference(
                rapidStart.signature,
                rapidEndSignature,
              );
              const rapidScrollPassed = rapidEndProgressRatio >= 0.6
                && rapidSettledError !== null
                && rapidSettledError <= Math.max(0.5, duration * 0.06)
                && rapidVisualDifference !== null
                && rapidVisualDifference >= 0.75;
              const narrativeRequested = narrativePanels.length > 1;
              const narrativeStates = [start, middle, end].map((sample) => sample.narrative.join(' | '));
              const narrativeVisibleCounts = [start, middle, end].map((sample) => sample.narrative.length);
              const narrativePassed = !narrativeRequested || (
                narrativeVisibleCounts.every((count) => count === 1)
                && new Set(narrativeStates).size >= 2
              );
              const videoStyle = getComputedStyle(motionVideo);
              const videoVisible = videoStyle.display !== 'none'
                && videoStyle.visibility !== 'hidden'
                && Number.parseFloat(videoStyle.opacity || '1') >= 0.5;
              Object.assign(scrollVideoMotion, {
                tested: true,
                source: motionVideo.currentSrc || motionVideo.src || motionVideo.dataset.src || '',
                duration,
                readyState: motionVideo.readyState,
                errorCode: motionVideo.error?.code || null,
                minimumTimeDelta,
                forwardTimes,
                reverseTime: reverse.time,
                forwardTimeDelta,
                reverseTimeDelta,
                forwardMonotonic,
                reverseMoved,
                frameDifference: visualDifference,
                videoVisible,
                motionState: motionScene.dataset.motionState || '',
                fallbackReason: motionScene.dataset.motionFallback
                  || document.documentElement.dataset.motionFallback
                  || '',
                narrative: {
                  tested: narrativeRequested,
                  panelCount: narrativePanels.length,
                  visibleCounts: narrativeVisibleCounts,
                  states: narrativeStates,
                  passed: narrativePassed,
                },
                rapidScroll: {
                  tested: true,
                  steps: scrollVideoMotion.rapidScroll.steps,
                  intervalMs: scrollVideoMotion.rapidScroll.intervalMs,
                  expectedEndTime: end.time,
                  endTime: rapidEndTime,
                  settledTime: rapidSettledTime,
                  endProgressRatio: rapidEndProgressRatio,
                  settledError: rapidSettledError,
                  frameDifference: rapidVisualDifference,
                  passed: rapidScrollPassed,
                },
                passed: sceneTravel >= window.innerHeight * 0.75
                  && motionVideo.muted === true
                  && motionVideo.playsInline === true
                  && !motionVideo.error
                  && videoVisible
                  && motionScene.dataset.motionState === 'enhanced'
                  && !(motionScene.dataset.motionFallback
                    || document.documentElement.dataset.motionFallback)
                  && forwardMonotonic
                  && reverseMoved
                  && visualDifference !== null
                  && visualDifference >= 0.75
                  && narrativePassed
                  && rapidScrollPassed,
              });
            }
          } finally {
            window.scrollTo(0, originalScrollY);
            document.documentElement.style.scrollBehavior = originalScrollBehavior;
            await wait(120);
          }
        }
        return {
          title: document.title,
          containsBusinessName: text.includes(expected),
          containsConceptDisclosure: text.includes('concept') && (text.includes('independent') || text.includes('not the official')),
          containsAlshivalAttribution: (text.includes('alshival') || text.includes('neural labs')),
          hasRobotsNoindex: [...document.querySelectorAll('meta[name="robots"]')].some((node) => /noindex/i.test(node.content)),
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
          hasResponsiveViewport: !${viewport.mobile} || window.innerWidth <= ${viewport.width} + 2,
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          h1Count: document.querySelectorAll('h1').length,
          imagesMissingAlt,
          unnamedControls,
          internalLinks,
          publisherCsp: {
            compatible: inlineExecutableScripts.length === 0
              && inlineEventHandlers.length === 0
              && javascriptUrls.length === 0,
            inlineExecutableScripts,
            inlineEventHandlers,
            javascriptUrls,
          },
          hasMotion,
          respectsReducedMotion: !hasMotion || /prefers-reduced-motion/i.test(css),
          cinematicMediaFirst,
          cinematicProfile,
          scrollVideoMotion,
        };
      })()
    `,
  });
  const page = evaluation.result?.value || {};
  page.brokenInternalLinks = [];
  for (const link of page.internalLinks || []) {
    try {
      const response = await fetch(link, { cache: "no-store" });
      if (!response.ok) page.brokenInternalLinks.push(`${response.status} ${link}`);
    } catch (error) {
      page.brokenInternalLinks.push(`request failed ${link}: ${error}`);
    }
  }
  const screenshot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const screenshotPath = join(outputDir, `${viewport.name}.png`);
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  let scrollVideoScreenshot = null;
  if (page.scrollVideoMotion?.requested) {
    await cdp.send("Runtime.evaluate", {
      awaitPromise: true,
      expression: `
        (async () => {
          const scene = document.querySelector(
            '[data-scroll-video-background], [data-scroll-video-effect], [data-scroll-scene]'
          );
          if (!scene) return;
          const top = window.scrollY + scene.getBoundingClientRect().top;
          const travel = Math.max(0, scene.offsetHeight - window.innerHeight);
          const originalBehavior = document.documentElement.style.scrollBehavior;
          document.documentElement.style.scrollBehavior = 'auto';
          window.scrollTo(0, Math.max(0, top + travel * 0.5));
          await new Promise((resolvePromise) => window.setTimeout(resolvePromise, 700));
          document.documentElement.style.scrollBehavior = originalBehavior;
        })()
      `,
    });
    const motionScreenshot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    scrollVideoScreenshot = join(outputDir, `${viewport.name}-scroll-video-mid.png`);
    await writeFile(scrollVideoScreenshot, Buffer.from(motionScreenshot.data, "base64"));
    await cdp.send("Runtime.evaluate", {
      expression: "window.scrollTo(0, 0)",
    });
  }
  let reducedMotionFallback = {
    requested: page.scrollVideoMotion?.requested === true,
    tested: false,
    passed: page.scrollVideoMotion?.requested !== true,
  };
  if (page.scrollVideoMotion?.requested) {
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    const reducedLoaded = cdp.waitFor("Page.loadEventFired");
    await cdp.send("Page.reload", { ignoreCache: true });
    await reducedLoaded;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200));
    const reducedEvaluation = await cdp.send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `
        (async () => {
          const wait = (milliseconds) => new Promise((resolvePromise) => {
            window.setTimeout(resolvePromise, milliseconds);
          });
          const waitFor = async (predicate, timeoutMs) => {
            const deadline = performance.now() + timeoutMs;
            while (performance.now() < deadline) {
              if (predicate()) return true;
              await wait(50);
            }
            return predicate();
          };
          const visible = (node) => {
            if (!node || node.hidden) return false;
            const style = getComputedStyle(node);
            return style.display !== 'none'
              && style.visibility !== 'hidden'
              && Number.parseFloat(style.opacity || '1') > 0.1;
          };
          const scene = document.querySelector(
            '[data-scroll-video-background], [data-scroll-video-effect], [data-scroll-scene]'
          );
          const video = scene?.querySelector('[data-scroll-video], video') || null;
          const status = scene?.querySelector('[data-motion-status]') || null;
          const optIn = scene?.querySelector('[data-motion-opt-in]') || null;
          const initial = {
            preferenceMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
            state: scene?.dataset.motionState || '',
            reason: scene?.dataset.motionFallback
              || document.documentElement.dataset.motionFallback
              || '',
            statusVisible: visible(status),
            statusText: String(status?.textContent || '').replace(/\\s+/g, ' ').trim(),
            optInVisible: visible(optIn),
            optInName: String(
              optIn?.innerText || optIn?.getAttribute('aria-label') || optIn?.title || ''
            ).replace(/\\s+/g, ' ').trim(),
          };
          let enhanced = false;
          let fallbackAfterOptIn = initial.reason;
          let startTime = null;
          let endTime = null;
          let moved = false;
          if (initial.optInVisible && initial.optInName && scene && video) {
            optIn.click();
            enhanced = await waitFor(
              () => scene.dataset.motionState === 'enhanced'
                && !scene.dataset.motionFallback,
              6000,
            );
            fallbackAfterOptIn = scene.dataset.motionFallback
              || document.documentElement.dataset.motionFallback
              || '';
            if (enhanced) {
              const top = window.scrollY + scene.getBoundingClientRect().top;
              const travel = Math.max(1, scene.offsetHeight - window.innerHeight);
              const originalBehavior = document.documentElement.style.scrollBehavior;
              document.documentElement.style.scrollBehavior = 'auto';
              window.scrollTo(0, Math.max(0, top + travel * 0.12));
              await wait(700);
              await waitFor(() => !video.seeking, 1600);
              startTime = Number.isFinite(video.currentTime) ? video.currentTime : null;
              window.scrollTo(0, Math.max(0, top + travel * 0.88));
              await wait(700);
              await waitFor(() => !video.seeking, 1600);
              endTime = Number.isFinite(video.currentTime) ? video.currentTime : null;
              document.documentElement.style.scrollBehavior = originalBehavior;
              moved = Number.isFinite(startTime)
                && Number.isFinite(endTime)
                && endTime - startTime >= 0.35;
            }
          }
          return {
            requested: true,
            tested: true,
            initial,
            enhancedAfterOptIn: enhanced,
            fallbackAfterOptIn,
            startTime,
            endTime,
            moved,
            passed: initial.preferenceMatches
              && initial.state === 'static'
              && initial.reason === 'reduced-motion'
              && initial.statusVisible
              && Boolean(initial.statusText)
              && initial.optInVisible
              && Boolean(initial.optInName)
              && enhanced
              && !fallbackAfterOptIn
              && moved,
          };
        })()
      `,
    });
    reducedMotionFallback = reducedEvaluation.result?.value || reducedMotionFallback;
  }
  await cdp.close();

  const checks = {
    businessName: page.containsBusinessName === true,
    conceptDisclosure: page.containsConceptDisclosure === true,
    alshivalAttribution: page.containsAlshivalAttribution === true,
    robotsNoindex: page.hasRobotsNoindex === true,
    noHorizontalOverflow: page.horizontalOverflow === false,
    responsiveViewport: page.hasResponsiveViewport === true,
    exactlyOneH1: page.h1Count === 1,
    imageAltAttributes: (page.imagesMissingAlt || []).length === 0,
    namedControls: (page.unnamedControls || []).length === 0,
    internalLinks: (page.brokenInternalLinks || []).length === 0,
    publisherCsp: page.publisherCsp?.compatible === true,
    reducedMotion: page.respectsReducedMotion === true
      && reducedMotionFallback.passed === true,
    cinematicMediaFirst: page.cinematicMediaFirst === true,
    scrollVideoMotion: page.scrollVideoMotion?.passed === true,
    noConsoleErrors: consoleErrors.length === 0,
    noRuntimeExceptions: exceptions.length === 0,
    noFailedRequests: failedRequests.length === 0 && badResponses.length === 0,
  };
  return {
    name: viewport.name,
    width: viewport.width,
    height: viewport.height,
    screenshot: screenshotPath,
    passed: Object.values(checks).every(Boolean),
    checks,
    diagnostics: {
      consoleErrors,
      exceptions,
      failedRequests,
      badResponses,
      imagesMissingAlt: page.imagesMissingAlt || [],
      unnamedControls: page.unnamedControls || [],
      brokenInternalLinks: page.brokenInternalLinks || [],
      publisherCsp: page.publisherCsp || {},
      cinematicProfile: page.cinematicProfile || {},
      scrollVideoMotion: page.scrollVideoMotion || {},
      reducedMotionFallback,
      scrollVideoScreenshot,
      documentWidth: page.documentWidth,
      viewportWidth: page.viewportWidth,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const siteDir = args["site-dir"] ? await realpath(args["site-dir"]) : null;
  const outputDir = resolve(args["output-dir"]);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  let server = null;
  let url = args.url || "";
  if (siteDir) {
    const local = await startStaticServer(siteDir);
    server = local.server;
    url = local.url;
  } else {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Unsupported QA URL protocol: ${parsed.protocol}`);
    }
    url = parsed.href;
  }
  const chrome = await launchChrome();
  try {
    const viewports = [
      { name: "desktop", width: 1440, height: 1000, mobile: false },
      { name: "tablet", width: 1024, height: 768, mobile: false },
      { name: "mobile", width: 390, height: 844, mobile: true },
    ];
    const results = [];
    for (const viewport of viewports) {
      results.push(
        await inspectViewport({
          chrome,
          url,
          outputDir,
          businessName: args["business-name"],
          viewport,
          requireScrollVideo: args["require-scroll-video"] === true,
        }),
      );
    }
    const report = {
      schemaVersion: 3,
      generatedAtUtc: new Date().toISOString(),
      businessName: args["business-name"],
      siteDir,
      sourceUrl: url,
      requirements: {
        scrollVideo: args["require-scroll-video"] === true,
      },
      passed: results.every((result) => result.passed),
      viewports: results,
    };
    await writeFile(join(outputDir, "QA-RESULT.json"), `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed) process.exitCode = 1;
  } finally {
    chrome.process.kill("SIGTERM");
    if (chrome.process.exitCode === null) {
      await Promise.race([
        once(chrome.process, "exit"),
        new Promise((resolvePromise) => setTimeout(resolvePromise, 3000)),
      ]);
    }
    if (chrome.process.exitCode === null) {
      chrome.process.kill("SIGKILL");
      await Promise.race([
        once(chrome.process, "exit"),
        new Promise((resolvePromise) => setTimeout(resolvePromise, 3000)),
      ]);
    }
    await rm(chrome.profileDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    if (server) {
      server.closeAllConnections();
      await new Promise((resolvePromise) => server.close(resolvePromise));
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
