(() => {
  let busy = false;
  const COMPOSER_TIMEOUT_MS = 30000;
  const BUTTON_TIMEOUT_MS = 12000;
  const CONFIRM_TIMEOUT_MS = 9000;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function isEnabled(element) {
    return isVisible(element)
      && !element.disabled
      && element.getAttribute("aria-disabled") !== "true"
      && getComputedStyle(element).pointerEvents !== "none";
  }

  function findComposer() {
    const selectors = [
      "#prompt-textarea",
      '[data-testid="prompt-textarea"]',
      'textarea[placeholder]',
      "textarea",
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]'
    ];
    for (const selector of selectors) {
      const found = [...document.querySelectorAll(selector)].find(isVisible);
      if (found) return found;
    }
    return null;
  }

  function composerText(element) {
    if (!element) return "";
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value.trim();
    return (element.innerText || element.textContent || "").trim();
  }

  function uniqueElements(elements) {
    return [...new Set(elements.filter(Boolean))];
  }

  function findSendButtons(composer) {
    const form = composer?.closest("form");
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="Enviar" i]',
      'button[title*="Send" i]',
      'button[title*="Enviar" i]',
      'button[type="submit"]'
    ];
    const candidates = [];
    for (const selector of selectors) {
      if (form) candidates.push(...form.querySelectorAll(selector));
      candidates.push(...document.querySelectorAll(selector));
    }
    candidates.push(...[...document.querySelectorAll("button")].filter((button) => {
      const label = [button.getAttribute("aria-label"), button.getAttribute("title"), button.textContent]
        .filter(Boolean).join(" ").toLowerCase();
      return /(^|\s)(send|enviar)(\s|$)/i.test(label);
    }));
    return uniqueElements(candidates).filter(isEnabled).slice(0, 6);
  }

  function dispatchInputEvent(element, type, text, cancelable) {
    try {
      element.dispatchEvent(new InputEvent(type, {
        bubbles: true,
        cancelable,
        composed: true,
        inputType: "insertText",
        data: text
      }));
    } catch {
      element.dispatchEvent(new Event(type, { bubbles: true, cancelable }));
    }
  }

  function setComposerText(element, text) {
    element.focus();
    dispatchInputEvent(element, "beforeinput", text, true);

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, text);
      else element.value = text;
    } else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
      let inserted = false;
      try { inserted = document.execCommand("insertText", false, text); } catch {}
      if (!inserted || composerText(element) !== text.trim()) {
        element.replaceChildren();
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        element.appendChild(paragraph);
      }
    }

    dispatchInputEvent(element, "input", text, false);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function compose(job) {
    const lines = [
      `CORVO_BRIDGE_JOB: ${job.jobId}`,
      `ESPECIALISTA: ${job.specialist || "SCOUT"}`,
      "",
      "A solicitação completa já está nesta mensagem. Não tente buscá-la externamente.",
      "Execute normalmente a pesquisa e o trabalho solicitado usando suas instruções e ferramentas.",
      "Ao concluir, use obrigatoriamente a Action de retorno do CorvoQuiz.",
      "Envie exatamente este JOB_ID e todo o resultado final no campo resultado.",
      "Não peça que o usuário copie, selecione ou confirme a resposta.",
      "Considere concluído somente depois que a Action confirmar sucesso.",
      "",
      "SOLICITAÇÃO DO APP:",
      job.prompt
    ];
    if (job.meta && Object.keys(job.meta).length) {
      const safeMeta = Object.fromEntries(Object.entries(job.meta).filter(([key]) => !/token|secret|key|attachments/i.test(key)));
      if (Object.keys(safeMeta).length) lines.push("", "CONTEXTO DO APP:", JSON.stringify(safeMeta));
    }
    return lines.join("\n");
  }

  function dataUrlToFile(dataUrl, name, contentType) {
    const [header, encoded] = String(dataUrl || "").split(",", 2);
    if (!encoded) throw new Error("ATTACHMENT_DATA_INVALID");
    const mime = contentType || header.match(/^data:([^;]+)/i)?.[1] || "application/octet-stream";
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], name, { type: mime });
  }

  function attachmentInput() {
    const composer = findComposer();
    const form = composer?.closest("form");
    const inputs = [
      ...(form ? form.querySelectorAll('input[type="file"]') : []),
      ...document.querySelectorAll('input[type="file"]')
    ];
    return uniqueElements(inputs).find((input) => input instanceof HTMLInputElement) || null;
  }

  async function waitForAttachmentInput(timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const direct = attachmentInput();
      if (direct) return direct;
      const buttons = [...document.querySelectorAll("button")].filter((button) => {
        const label = [button.getAttribute("aria-label"), button.getAttribute("title"), button.textContent]
          .filter(Boolean).join(" ").toLowerCase();
        return /(attach|upload|add files?|anexar|arquivo)/i.test(label) && isEnabled(button);
      });
      if (buttons[0]) {
        clickButton(buttons[0]);
        await sleep(500);
      } else {
        await sleep(250);
      }
    }
    throw new Error("ATTACHMENT_INPUT_NOT_FOUND");
  }

  async function attachmentLoaded(name, timeout = 12000) {
    const deadline = Date.now() + timeout;
    const expected = String(name || "").toLowerCase();
    while (Date.now() < deadline) {
      const text = String(document.body?.innerText || document.body?.textContent || "").toLowerCase();
      if (expected && text.includes(expected.toLowerCase())) return true;
      await sleep(300);
    }
    return false;
  }

  async function fetchAttachmentDirect(attachment) {
    const url = String(attachment?.url || "").trim();
    const name = String(attachment?.name || "arquivo").trim() || "arquivo";
    if (!/^https:\/\//i.test(url)) throw new Error("ATTACHMENT_URL_INVALID");
    const response = await fetch(url, { cache:"no-store", credentials:"omit" });
    if (!response.ok) throw new Error(`ATTACHMENT_DIRECT_FETCH_${response.status}`);
    const blob = await response.blob();
    if (!blob.size) throw new Error("ATTACHMENT_EMPTY");
    if (blob.size > 480 * 1024 * 1024) throw new Error("ATTACHMENT_TOO_LARGE_FOR_CHAT");
    return new File([blob], name, { type:blob.type || String(attachment?.contentType || "application/octet-stream") });
  }

  async function attachJobFiles(job) {
    const attachments = Array.isArray(job?.meta?.attachments) ? job.meta.attachments : [];
    if (!attachments.length) return 0;
    let totalBytes = 0;
    for (const attachment of attachments) {
      const url = String(attachment?.url || "").trim();
      const name = String(attachment?.name || "arquivo").trim() || "arquivo";
      if (!url) continue;
      let file;
      try {
        file = await fetchAttachmentDirect(attachment);
      } catch (directError) {
        const fetched = await chrome.runtime.sendMessage({
          type: "CORVO_FETCH_ATTACHMENT",
          payload: { url, name, contentType: String(attachment?.contentType || "") }
        });
        if (!fetched?.ok || !fetched?.dataUrl) throw new Error(fetched?.error || directError?.message || "ATTACHMENT_FETCH_FAILED");
        file = dataUrlToFile(fetched.dataUrl, name, fetched.contentType);
      }
      const input = await waitForAttachmentInput();
      const transfer = new DataTransfer();
      transfer.items.add(file);
      totalBytes += Number(file?.size || 0);
      input.files = transfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const loadTimeout = Math.max(30000, Math.min(600000, 30000 + Math.floor(Number(file?.size || 0) / 2000)));
      await attachmentLoaded(name, loadTimeout).catch(() => false);
      await sleep(700);
    }
    return totalBytes;
  }

  async function waitForComposer(timeout = COMPOSER_TIMEOUT_MS) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const composer = findComposer();
      if (composer) return composer;
      await sleep(250);
    }
    throw new Error("COMPOSER_NOT_FOUND");
  }

  async function waitForEnabledButtons(composer, timeout = BUTTON_TIMEOUT_MS) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const buttons = findSendButtons(composer);
      if (buttons.length) return buttons;
      await sleep(200);
    }
    return [];
  }

  function userMessageState() {
    const messages = [...document.querySelectorAll('[data-message-author-role="user"]')];
    return {
      count: messages.length,
      lastText: (messages.at(-1)?.textContent || "").trim()
    };
  }

  function conversationHasJob(jobId) {
    return [...document.querySelectorAll('[data-message-author-role="user"]')]
      .some((message) => (message.textContent || "").includes(jobId));
  }

  async function waitForSendConfirmation(previousState, jobId, timeout = CONFIRM_TIMEOUT_MS) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const currentComposer = findComposer();
      if (currentComposer && composerText(currentComposer) === "") return true;

      const currentState = userMessageState();
      if (currentState.count > previousState.count) return true;
      if (currentState.lastText !== previousState.lastText && currentState.lastText.includes(jobId)) return true;
      await sleep(250);
    }
    return false;
  }

  function clickButton(button) {
    button.scrollIntoView({ block: "nearest", inline: "nearest" });
    button.focus();
    if (typeof PointerEvent === "function") {
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse" }));
    }
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    button.click();
  }

  function submitWithEnter(composer) {
    composer.focus();
    const options = {
      key: "Enter", code: "Enter", keyCode: 13, which: 13,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      bubbles: true, cancelable: true, composed: true
    };
    composer.dispatchEvent(new KeyboardEvent("keydown", options));
    composer.dispatchEvent(new KeyboardEvent("keypress", options));
    composer.dispatchEvent(new KeyboardEvent("keyup", options));
  }


  async function currentConversationUrl(timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (/^\/c\/[^/?#]+/.test(location.pathname)) return location.origin + location.pathname;
      await sleep(200);
    }
    return /^\/c\/[^/?#]+/.test(location.pathname) ? location.origin + location.pathname : "";
  }

  async function reportSent(jobId) {
    const conversationUrl = await currentConversationUrl();
    await chrome.runtime.sendMessage({ type: "CORVO_GPT_SENT", payload: { jobId, conversationUrl } }).catch(() => {});
  }

  function textOf(el) { return String(el?.innerText || el?.textContent || el?.getAttribute?.("aria-label") || "").trim().toLowerCase(); }
  function visible(el) { if (!el) return false; const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0 && r.height>0 && s.visibility!=="hidden" && s.display!=="none"; }
  function clickEl(el) { el.scrollIntoView({block:"center"}); el.dispatchEvent(new MouseEvent("mouseover",{bubbles:true})); el.click(); }

  async function deleteCurrentChat(payload) {
    const expected = String(payload?.conversationId || "");
    const actual = location.pathname.match(/^\/c\/([^/?#]+)/)?.[1] || "";
    if (!expected || actual !== expected) throw new Error("CONVERSATION_ID_MISMATCH");
    await sleep(1200);

    const exactLink = [...document.querySelectorAll('a[href^="/c/"]')].find(a => a.getAttribute("href")?.includes(`/c/${expected}`));
    let menuButton = null;
    if (exactLink) {
      let scope = exactLink;
      for (let i=0;i<5 && scope;i++,scope=scope.parentElement) {
        scope.dispatchEvent(new MouseEvent("mouseover",{bubbles:true}));
        const buttons=[...scope.querySelectorAll("button")].filter(visible);
        menuButton=buttons.find(b => /conversation.*(options|menu)|chat.*(options|menu)|opções.*conversa|mais.*conversa/.test(textOf(b)));
        if (menuButton) break;
      }
    }
    if (!menuButton) {
      const buttons=[...document.querySelectorAll("button")].filter(visible);
      menuButton=buttons.find(b => /conversation.*(options|menu)|opções.*conversa|mais.*conversa/.test(textOf(b)));
    }
    if (!menuButton) throw new Error("CONVERSATION_MENU_NOT_FOUND");
    clickEl(menuButton);
    await sleep(500);

    const menuItems=[...document.querySelectorAll('[role="menuitem"], [role="menu"] button, [data-radix-menu-content] button, button')].filter(visible);
    const deleteItem=menuItems.find(el => /^(delete|excluir|apagar)( chat| conversa)?$/.test(textOf(el)) || /delete chat|excluir conversa|apagar conversa/.test(textOf(el)));
    if (!deleteItem) throw new Error("DELETE_MENU_ITEM_NOT_FOUND");
    clickEl(deleteItem);
    await sleep(500);

    const dialogs=[...document.querySelectorAll('[role="dialog"], dialog')].filter(visible);
    const scope=dialogs.at(-1) || document;
    const confirm=[...scope.querySelectorAll("button")].filter(visible).find(el => /^(delete|excluir|apagar)$/.test(textOf(el)) || /delete.*chat|excluir.*conversa/.test(textOf(el)));
    if (!confirm) throw new Error("DELETE_CONFIRM_NOT_FOUND");
    clickEl(confirm);

    const deadline=Date.now()+8000;
    while(Date.now()<deadline){
      const nowId=location.pathname.match(/^\/c\/([^/?#]+)/)?.[1] || "";
      if(nowId!==expected) return {ok:true, deleted:true};
      await sleep(250);
    }
    throw new Error("DELETE_NOT_CONFIRMED");
  }

  function generatedImageCandidates(payload = {}) {
    const seen = new Set();
    const items = [];
    const scopes = [
      ...document.querySelectorAll('article[data-testid^="conversation-turn"]'),
      ...document.querySelectorAll('[data-message-author-role="assistant"]')
    ];

    function addImage(image, scope = null, scopeIndex = -1) {
      if (!image || seen.has(image)) return;
      seen.add(image);
      if (!visible(image)) return;
      const width = image.naturalWidth || image.width || image.clientWidth || 0;
      const height = image.naturalHeight || image.height || image.clientHeight || 0;
      const src = String(image.currentSrc || image.src || "");
      const alt = String(image.alt || "").toLowerCase();
      if (!src || src.startsWith("data:image/svg")) return;
      if (/avatar|profile|ícone|icon|favicon/.test(alt)) return;
      if (width < 420 || height < 220 || width * height < 180000) return;
      const turn = scope || image.closest('article[data-testid^="conversation-turn"], [data-message-author-role="assistant"]');
      const text = String(turn?.textContent || "");
      const manifest = /\[CORVO_THUMBNAIL\]|TIPO_ARQUIVO\s*=\s*THUMBNAIL|\[CORVO_IMAGE_(GENERATION|REFINEMENT)\]/i.test(text) ? 1 : 0;
      const jobMatch = payload?.jobId && text.includes(String(payload.jobId)) ? 1 : 0;
      const fileMatch = payload?.name && text.includes(String(payload.name)) ? 1 : 0;
      const rect = image.getBoundingClientRect();
      items.push({ image, scope: turn, scopeIndex, manifest, jobMatch, fileMatch, area: width * height, y: rect.top + window.scrollY });
    }

    scopes.forEach((scope, scopeIndex) => {
      [...scope.querySelectorAll('img')].forEach((image) => addImage(image, scope, scopeIndex));
    });
    [...document.querySelectorAll('img')].forEach((image) => addImage(image));

    return items.sort((a, b) =>
      a.jobMatch - b.jobMatch ||
      a.fileMatch - b.fileMatch ||
      a.manifest - b.manifest ||
      a.scopeIndex - b.scopeIndex ||
      a.y - b.y ||
      a.area - b.area
    );
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("IMAGE_READ_FAILED"));
      reader.readAsDataURL(blob);
    });
  }

  async function fetchImageBlob(src, timeout = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(src, { credentials: "include", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`IMAGE_FETCH_${response.status}`);
      const blob = await response.blob();
      if (!blob.type.startsWith("image/") || !blob.size) throw new Error("INVALID_IMAGE_BLOB");
      if (blob.size > 8 * 1024 * 1024) throw new Error("IMAGE_TOO_LARGE");
      return blob;
    } finally {
      clearTimeout(timer);
    }
  }

  async function canvasImageDataUrl(image) {
    const width = image.naturalWidth || image.width || 0;
    const height = image.naturalHeight || image.height || 0;
    if (!width || !height) throw new Error("IMAGE_DIMENSIONS_MISSING");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("CANVAS_UNAVAILABLE");
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("CANVAS_EXPORT_FAILED")), "image/png"));
    if (blob.size > 8 * 1024 * 1024) throw new Error("IMAGE_TOO_LARGE");
    return { dataUrl: await blobToDataUrl(blob), contentType: blob.type || "image/png", size: blob.size };
  }

  async function captureGeneratedImage(payload = {}, timeout = 30000) {
    const deadline = Date.now() + Math.max(5000, Number(payload?.timeout || timeout));
    let lastError = "GENERATED_IMAGE_NOT_FOUND";
    while (Date.now() < deadline) {
      const candidate = generatedImageCandidates(payload).at(-1);
      if (candidate) {
        const src = String(candidate.image.currentSrc || candidate.image.src || "");
        try {
          const blob = await fetchImageBlob(src, 7000);
          return {
            ok: true,
            dataUrl: await blobToDataUrl(blob),
            src,
            contentType: blob.type,
            size: blob.size,
            width: candidate.image.naturalWidth || candidate.image.width || 0,
            height: candidate.image.naturalHeight || candidate.image.height || 0
          };
        } catch (error) {
          lastError = error?.name === "AbortError" ? "IMAGE_FETCH_TIMEOUT" : (error?.message || "IMAGE_FETCH_FAILED");
          try {
            const canvas = await canvasImageDataUrl(candidate.image);
            return {
              ok: true,
              ...canvas,
              src,
              width: candidate.image.naturalWidth || candidate.image.width || 0,
              height: candidate.image.naturalHeight || candidate.image.height || 0
            };
          } catch (canvasError) {
            lastError = `${lastError};${canvasError?.message || "CANVAS_CAPTURE_FAILED"}`;
            // Retorna a URL como último recurso. O background possui permissões de host
            // e tentará baixar a imagem fora do contexto isolado da página.
            if (/^https:\/\//i.test(src)) {
              return {
                ok: true,
                src,
                contentType: "",
                size: 0,
                width: candidate.image.naturalWidth || candidate.image.width || 0,
                height: candidate.image.naturalHeight || candidate.image.height || 0
              };
            }
          }
        }
      }
      await sleep(750);
    }
    throw new Error(lastError);
  }


  async function sendPrompt(job) {
    if (busy) throw new Error("BRIDGE_BUSY");
    busy = true;
    try {
      if (conversationHasJob(job.jobId)) {
        await reportSent(job.jobId);
        return;
      }

      const composer = await waitForComposer();
      const attachmentBytes = await attachJobFiles(job);
      const message = compose(job);
      const previousState = userMessageState();
      setComposerText(composer, message);

      const fillDeadline = Date.now() + 4000;
      while (Date.now() < fillDeadline && !composerText(findComposer()).includes(job.jobId)) await sleep(150);
      if (!composerText(findComposer()).includes(job.jobId)) throw new Error("COMPOSER_FILL_FAILED");

      const attachmentButtonTimeout = attachmentBytes
        ? Math.max(BUTTON_TIMEOUT_MS, Math.min(600000, 30000 + Math.floor(attachmentBytes / 1500)))
        : BUTTON_TIMEOUT_MS;
      const buttons = await waitForEnabledButtons(findComposer(), attachmentButtonTimeout);
      for (const button of buttons) {
        if (!isEnabled(button)) continue;
        clickButton(button);
        if (await waitForSendConfirmation(previousState, job.jobId, 3500)) {
          await reportSent(job.jobId);
          return;
        }
      }

      const currentComposer = findComposer();
      if (currentComposer && composerText(currentComposer)) {
        const form = currentComposer.closest("form");
        const submitButton = form?.querySelector('button[type="submit"]');
        if (form && submitButton && isEnabled(submitButton) && typeof form.requestSubmit === "function") {
          form.requestSubmit(submitButton);
          if (await waitForSendConfirmation(previousState, job.jobId, 3500)) {
            await reportSent(job.jobId);
            return;
          }
        }
      }

      const fallbackComposer = findComposer();
      if (fallbackComposer && composerText(fallbackComposer)) {
        submitWithEnter(fallbackComposer);
        if (await waitForSendConfirmation(previousState, job.jobId)) {
          await reportSent(job.jobId);
          return;
        }
      }

      throw new Error("GPT_SEND_FAILED");
    } catch (error) {
      throw error;
    } finally {
      busy = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CORVO_BRIDGE_PING") {
      chrome.runtime.sendMessage({ type: "CORVO_GPT_READY" }).catch(() => {});
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "CORVO_SEND_PROMPT") {
      sendPrompt(message.payload)
        .then(() => sendResponse({ ok: true, confirmed: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message || "GPT_SEND_FAILED" }));
      return true;
    }
    if (message?.type === "CORVO_DELETE_CURRENT_CHAT") {
      deleteCurrentChat(message.payload)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message || "DELETE_FAILED" }));
      return true;
    }
    if (message?.type === "CORVO_CAPTURE_GENERATED_IMAGE") {
      captureGeneratedImage(message.payload || {})
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message || "GENERATED_IMAGE_NOT_FOUND" }));
      return true;
    }
  });

  chrome.runtime.sendMessage({ type: "CORVO_GPT_READY", payload: { href: location.href } }).catch(() => {});
})();
