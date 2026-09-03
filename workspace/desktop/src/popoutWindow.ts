export type PopoutSurface = {
  browserWindow: Window;
  mountNode: HTMLElement;
};

function copyStyles(source: Document, target: Document) {
  for (const node of source.querySelectorAll('link[rel="stylesheet"], style')) {
    if (node instanceof HTMLLinkElement) {
      const link = target.createElement("link");
      link.rel = "stylesheet";
      link.href = node.href;
      if (node.media) link.media = node.media;
      target.head.append(link);
    } else {
      target.head.append(target.importNode(node, true));
    }
  }
}

export function openPopoutSurface(title: string, windowId: string): PopoutSurface | undefined {
  const width = Math.max(720, Math.min(1280, Math.round(window.innerWidth * 0.84)));
  const height = Math.max(560, Math.min(960, Math.round(window.innerHeight * 0.86)));
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  const name = `neural-labs-${windowId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100)}`;

  let browserWindow: Window | null;
  try {
    browserWindow = window.open("about:blank", name, `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
  } catch {
    return undefined;
  }
  if (!browserWindow) return undefined;

  try {
    const document = browserWindow.document;
    document.documentElement.lang = globalThis.document.documentElement.lang || "en";
    document.documentElement.className = "popout-document";
    document.head.replaceChildren();
    document.body.replaceChildren();
    document.body.className = "popout-body";
    document.title = `${title} — Neural Labs`;

    const viewport = document.createElement("meta");
    viewport.name = "viewport";
    viewport.content = "width=device-width, initial-scale=1";
    document.head.append(viewport);

    const base = document.createElement("base");
    base.href = globalThis.document.baseURI;
    document.head.append(base);
    copyStyles(globalThis.document, document);

    const mountNode = document.createElement("main");
    mountNode.className = "popout-surface";
    mountNode.setAttribute("aria-label", `${title} pop-out window`);
    document.body.append(mountNode);
    browserWindow.focus();
    return { browserWindow, mountNode };
  } catch {
    browserWindow.close();
    return undefined;
  }
}
