(() => {
  if (globalThis.__CORVO_CHATGPT_BRIDGE_V0629__) return;
  globalThis.__CORVO_CHATGPT_BRIDGE_V0629__ = true;

  let busy = false;
  const capturedImageAssignments = new Map();
  const COMPOSER_TIMEOUT_MS = 30000;
  const BUTTON_TIMEOUT_MS = 60000;
  const CONFIRM_TIMEOUT_MS = 60000;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function shortText(value, max = 180) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function elementDiagnostic(element) {
    if (!element) return null;
    let rect = null;
    try {
      const r = element.getBoundingClientRect();
      rect = { x:Math.round(r.x), y:Math.round(r.y), width:Math.round(r.width), height:Math.round(r.height) };
    } catch {}
    return {
      tag:String(element.tagName || "").toLowerCase(),
      id:String(element.id || ""),
      role:String(element.getAttribute?.("role") || ""),
      type:String(element.getAttribute?.("type") || ""),
      name:String(element.getAttribute?.("name") || ""),
      testid:String(element.getAttribute?.("data-testid") || ""),
      ariaLabel:shortText(element.getAttribute?.("aria-label") || "", 140),
      title:shortText(element.getAttribute?.("title") || "", 140),
      accept:String(element.getAttribute?.("accept") || ""),
      multiple:Boolean(element.multiple),
      disabled:Boolean(element.disabled),
      ariaDisabled:String(element.getAttribute?.("aria-disabled") || ""),
      contentEditable:String(element.getAttribute?.("contenteditable") || ""),
      visible:isVisible(element),
      enabled:isEnabled(element),
      rect,
      text:shortText(element.textContent || "", 160)
    };
  }

  function pageDiagnostic() {
    const composer = findComposer();
    const fileInputs = [...document.querySelectorAll('input[type="file"]')];
    const userMessages = [...document.querySelectorAll('[data-message-author-role="user"]')];
    return {
      url:`${location.origin}${location.pathname}`,
      readyState:document.readyState,
      visibilityState:document.visibilityState,
      hasFocus:document.hasFocus(),
      title:shortText(document.title, 160),
      composer:elementDiagnostic(composer),
      composerTextLength:composerText(composer).length,
      fileInputs:fileInputs.slice(0, 10).map(elementDiagnostic),
      fileInputCount:fileInputs.length,
      userMessageCount:userMessages.length,
      buttonCount:document.querySelectorAll('button').length
    };
  }

  async function reportDiagnostic(jobId, event, details = {}) {
    await chrome.runtime.sendMessage({
      type:"CORVO_GPT_DIAG",
      payload:{ jobId, event, details }
    }).catch(() => {});
  }

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

  function composerRoot() {
    const composer = findComposer();
    if (!composer) return null;
    return composer.closest("form") || composer.parentElement || null;
  }

  function scoreAttachmentInput(input, root) {
    if (!(input instanceof HTMLInputElement) || input.type !== "file") return -1;
    let score = 0;
    if (root?.contains(input)) score += 100;
    if (input.multiple) score += 25;
    const accept = String(input.accept || "").toLowerCase();
    if (accept && !/^image\/?\*?$/.test(accept)) score += 8;
    const marker = [input.id, input.name, input.getAttribute("data-testid"), input.getAttribute("aria-label")]
      .filter(Boolean).join(" ").toLowerCase();
    if (/(file|attach|upload|composer|prompt)/.test(marker)) score += 20;
    return score;
  }

  function attachmentInput() {
    const root = composerRoot();
    const inputs = uniqueElements([
      ...(root ? root.querySelectorAll('input[type="file"]') : []),
      ...document.querySelectorAll('input[type="file"]')
    ]).filter((input) => input instanceof HTMLInputElement);
    return inputs
      .map((input) => ({ input, score: scoreAttachmentInput(input, root) }))
      .filter((entry) => entry.score >= 20)
      .sort((a, b) => b.score - a.score)[0]?.input || null;
  }

  function findAttachmentButtons() {
    const root = composerRoot();
    const local = root ? [...root.querySelectorAll("button")] : [];
    const global = [...document.querySelectorAll("button")];
    return uniqueElements([...local, ...global]).filter((button) => {
      const label = [button.getAttribute("aria-label"), button.getAttribute("title"), button.textContent]
        .filter(Boolean).join(" ").toLowerCase();
      return /(attach|upload|add files?|anexar|adicionar arquivo|arquivo)/i.test(label) && isEnabled(button);
    });
  }

  function findUploadMenuAction() {
    const candidates = [...document.querySelectorAll('button,[role="menuitem"],[role="option"]')].filter(isEnabled);
    return candidates.find((element) => {
      const label = [element.getAttribute("aria-label"), element.getAttribute("title"), element.textContent]
        .filter(Boolean).join(" ").trim().toLowerCase();
      return /(add photos? (and|&) files?|upload from computer|upload file|adicionar fotos? e arquivos?|carregar do computador|carregar arquivo|anexar arquivos?)/i.test(label);
    }) || null;
  }

  async function waitForAttachmentInput(timeout = 15000, jobId = "", fileName = "") {
    const deadline = Date.now() + timeout;
    let clickedAttach = false;
    let clickedUploadAction = false;
    const existing = new Set([...document.querySelectorAll('input[type="file"]')]);
    await reportDiagnostic(jobId, "ATTACHMENT_INPUT_WAIT_START", { fileName, page:pageDiagnostic(), attachmentButtons:findAttachmentButtons().slice(0, 8).map(elementDiagnostic) });
    while (Date.now() < deadline) {
      const direct = attachmentInput();
      if (direct) {
        await reportDiagnostic(jobId, "ATTACHMENT_INPUT_DIRECT_FOUND", { fileName, input:elementDiagnostic(direct), score:scoreAttachmentInput(direct, composerRoot()) });
        return direct;
      }

      if (!clickedAttach) {
        const button = findAttachmentButtons()[0];
        if (button) {
          await reportDiagnostic(jobId, "ATTACH_BUTTON_CLICK", { fileName, button:elementDiagnostic(button) });
          clickButton(button);
          clickedAttach = true;
          await sleep(700);
          await reportDiagnostic(jobId, "ATTACH_BUTTON_AFTER", { fileName, fileInputs:[...document.querySelectorAll('input[type="file"]')].slice(0, 10).map(elementDiagnostic), uploadAction:elementDiagnostic(findUploadMenuAction()) });
        }
      } else if (!clickedUploadAction) {
        const action = findUploadMenuAction();
        if (action) {
          await reportDiagnostic(jobId, "UPLOAD_MENU_ACTION_CLICK", { fileName, action:elementDiagnostic(action) });
          clickButton(action);
          clickedUploadAction = true;
          await sleep(500);
        }
      }

      const created = [...document.querySelectorAll('input[type="file"]')]
        .find((input) => input instanceof HTMLInputElement && !existing.has(input));
      if (created) {
        await reportDiagnostic(jobId, "ATTACHMENT_INPUT_CREATED", { fileName, input:elementDiagnostic(created), score:scoreAttachmentInput(created, composerRoot()) });
        return created;
      }
      await sleep(250);
    }
    await reportDiagnostic(jobId, "ATTACHMENT_INPUT_TIMEOUT", { fileName, page:pageDiagnostic(), attachmentButtons:findAttachmentButtons().slice(0, 8).map(elementDiagnostic), uploadAction:elementDiagnostic(findUploadMenuAction()) });
    throw new Error("ATTACHMENT_INPUT_NOT_FOUND");
  }

  function attachmentVisible(name) {
    const expected = String(name || "").trim().toLowerCase();
    if (!expected) return false;
    const nodes = [...document.querySelectorAll("span,div,p,button")];
    return nodes.some((node) => {
      if (!isVisible(node)) return false;
      const text = String(node.textContent || "").trim().toLowerCase();
      return text === expected || (text.length < expected.length + 80 && text.includes(expected));
    });
  }

  async function attachmentLoaded(name, timeout = 90000, jobId = "") {
    const deadline = Date.now() + timeout;
    let lastReport = 0;
    while (Date.now() < deadline) {
      if (attachmentVisible(name)) {
        await reportDiagnostic(jobId, "ATTACHMENT_NAME_VISIBLE", { fileName:name, elapsedMs:timeout - Math.max(0, deadline - Date.now()) });
        return true;
      }
      if (Date.now() - lastReport > 5000) {
        lastReport = Date.now();
        await reportDiagnostic(jobId, "ATTACHMENT_WAITING_VISIBLE", { fileName:name, elapsedMs:timeout - Math.max(0, deadline - Date.now()), page:pageDiagnostic() });
      }
      await sleep(350);
    }
    await reportDiagnostic(jobId, "ATTACHMENT_VISIBLE_TIMEOUT", { fileName:name, timeout, page:pageDiagnostic() });
    return false;
  }

  async function reportStage(jobId, state, message, extra = {}) {
    await chrome.runtime.sendMessage({
      type: "CORVO_GPT_STAGE",
      payload: { jobId, state, message, ...extra }
    }).catch(() => {});
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

  async function fetchAttachmentThroughApp(job, attachment) {
    const appOrigin = String(job?.meta?.appOrigin || "").trim().replace(/\/$/, "");
    // A imagem do Refinador pertence ao JOB do Analista, não ao JOB do Refinador.
    // Preserve a origem do objeto para que o proxy continue funcionando após reload
    // ou expiração da URL assinada do R2.
    const uploadToken = String(attachment?.sourceUploadToken || job?.meta?.uploadToken || "").trim();
    const jobId = String(attachment?.sourceJobId || job?.jobId || "").trim();
    const url = String(attachment?.url || "").trim();
    const name = String(attachment?.name || "arquivo").trim() || "arquivo";
    if (!appOrigin || !/^https:\/\//i.test(appOrigin) || !uploadToken || !jobId || !url) throw new Error("ATTACHMENT_PROXY_CONTEXT_MISSING");
    const proxyUrl = `${appOrigin}/api/corvo/download?jobId=${encodeURIComponent(jobId)}&url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    try {
      const response = await fetch(proxyUrl, {
        method:"GET",
        cache:"no-store",
        credentials:"omit",
        headers:{ "x-corvo-upload-token":uploadToken },
        signal:controller.signal,
      });
      if (!response.ok) {
        let body = {};
        try { body = await response.json(); } catch {}
        const code = String(body?.code || "").trim();
        const message = String(body?.message || "").trim();
        if (code) throw new Error(`${code}${message ? `:${message}` : ""}`);
        throw new Error(`ATTACHMENT_PROXY_FETCH_${response.status}${message ? `:${message}` : ""}`);
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error("ATTACHMENT_PROXY_EMPTY");
      if (blob.size > 480 * 1024 * 1024) throw new Error("ATTACHMENT_TOO_LARGE_FOR_CHAT");
      return new File([blob], name, { type:blob.type || String(attachment?.contentType || "application/octet-stream") });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("ATTACHMENT_PROXY_TIMEOUT");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function attachJobFiles(job) {
    const attachments = Array.isArray(job?.meta?.attachments) ? job.meta.attachments : [];
    await reportDiagnostic(job.jobId, "ATTACHMENTS_PLAN", { count:attachments.length, files:attachments.map((item) => ({ name:String(item?.name || ""), contentType:String(item?.contentType || ""), url:(() => { try { const u=new URL(String(item?.url || "")); return `${u.origin}${u.pathname}`; } catch { return ""; } })() })) });
    if (!attachments.length) return 0;
    let totalBytes = 0;
    for (let index = 0; index < attachments.length; index++) {
      const attachment = attachments[index];
      const url = String(attachment?.url || "").trim();
      const name = String(attachment?.name || "arquivo").trim() || "arquivo";
      if (!url) continue;

      if (attachmentVisible(name)) {
        await reportDiagnostic(job.jobId, "ATTACHMENT_REUSED", { fileName:name, page:pageDiagnostic() });
        await reportStage(job.jobId, "ATTACHMENT_READY", `${name} já está anexado.`, { fileName:name, attachmentIndex:index + 1, attachmentTotal:attachments.length });
        continue;
      }

      await reportStage(job.jobId, "FETCHING_ATTACHMENT", `Baixando ${name} para anexar ao GPT...`, { fileName:name, attachmentIndex:index + 1, attachmentTotal:attachments.length });
      await reportDiagnostic(job.jobId, "ATTACHMENT_FETCH_START", { fileName:name, index:index + 1, total:attachments.length });
      let file;
      try {
        file = await fetchAttachmentDirect(attachment);
        await reportDiagnostic(job.jobId, "ATTACHMENT_FETCH_DIRECT_OK", { fileName:name, bytes:file.size, type:file.type });
      } catch (directError) {
        await reportDiagnostic(job.jobId, "ATTACHMENT_FETCH_DIRECT_FAIL", { fileName:name, error:String(directError?.message || directError || "") });
        try {
          await reportStage(job.jobId, "FETCHING_ATTACHMENT_PROXY", `O armazenamento recusou leitura direta. Recuperando ${name} pelo CorvoQuiz...`, { fileName:name, attachmentIndex:index + 1, attachmentTotal:attachments.length });
          await reportDiagnostic(job.jobId, "ATTACHMENT_PROXY_FETCH_START", { fileName:name, appOrigin:String(job?.meta?.appOrigin || "") });
          file = await fetchAttachmentThroughApp(job, attachment);
          await reportDiagnostic(job.jobId, "ATTACHMENT_PROXY_FETCH_OK", { fileName:name, bytes:file.size, type:file.type });
        } catch (proxyError) {
          await reportDiagnostic(job.jobId, "ATTACHMENT_PROXY_FETCH_FAIL", { fileName:name, error:String(proxyError?.message || proxyError || "") });
          const fetched = await chrome.runtime.sendMessage({
            type: "CORVO_FETCH_ATTACHMENT",
            payload: {
              url, name, contentType: String(attachment?.contentType || ""),
              jobId:String(attachment?.sourceJobId || job?.jobId || ""),
              uploadToken:String(attachment?.sourceUploadToken || job?.meta?.uploadToken || ""),
              appOrigin:String(job?.meta?.appOrigin || "")
            }
          });
          if (!fetched?.ok || !fetched?.dataUrl) throw new Error(fetched?.error || proxyError?.message || directError?.message || "ATTACHMENT_FETCH_FAILED");
          file = dataUrlToFile(fetched.dataUrl, name, fetched.contentType);
          await reportDiagnostic(job.jobId, "ATTACHMENT_FETCH_BACKGROUND_OK", { fileName:name, bytes:file.size, type:file.type, source:fetched.source || "background" });
        }
      }

      totalBytes += Number(file?.size || 0);
      await reportStage(job.jobId, "ATTACHING_FILE", `Anexando ${name} ao editor do GPT...`, { fileName:name, fileBytes:file.size, attachmentIndex:index + 1, attachmentTotal:attachments.length });
      const input = await waitForAttachmentInput(15000, job.jobId, name);
      await reportDiagnostic(job.jobId, "ATTACHMENT_INPUT_SELECTED", { fileName:name, input:elementDiagnostic(input), score:scoreAttachmentInput(input, composerRoot()), page:pageDiagnostic() });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true, composed:true }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed:true }));
      await reportDiagnostic(job.jobId, "ATTACHMENT_EVENTS_DISPATCHED", { fileName:name, input:elementDiagnostic(input), files:[...input.files].map((f) => ({ name:f.name, size:f.size, type:f.type })) });

      const loadTimeout = Math.max(30000, Math.min(180000, 15000 + Math.floor(Number(file?.size || 0) / 250)));
      const loaded = await attachmentLoaded(name, loadTimeout, job.jobId);
      if (!loaded) throw new Error(`ATTACHMENT_NOT_CONFIRMED:${name}`);
      await reportStage(job.jobId, "ATTACHMENT_READY", `${name} confirmado no editor.`, { fileName:name, fileBytes:file.size, attachmentIndex:index + 1, attachmentTotal:attachments.length });
      await reportDiagnostic(job.jobId, "ATTACHMENT_CONFIRMED", { fileName:name, fileBytes:file.size, page:pageDiagnostic() });
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

  function responseIsStreaming() {
    const selectors = [
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Parar" i]',
      '[data-is-streaming="true"]',
      '[aria-busy="true"][data-message-author-role="assistant"]'
    ];
    return selectors.some((selector) => [...document.querySelectorAll(selector)].some(isVisible));
  }

  function userMessageState() {
    const userMessages = [...document.querySelectorAll('[data-message-author-role="user"]')];
    const assistantMessages = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    return {
      count: userMessages.length,
      lastText: (userMessages.at(-1)?.textContent || "").trim(),
      assistantCount: assistantMessages.length,
      streaming: responseIsStreaming(),
      conversationId: conversationIdFromPath(),
      composerLength: composerText(findComposer()).length
    };
  }

  function conversationHasJob(jobId) {
    return [...document.querySelectorAll('[data-message-author-role="user"]')]
      .some((message) => (message.textContent || "").includes(jobId));
  }

  async function waitForEnabledButtons(composer, timeout = BUTTON_TIMEOUT_MS, jobId = "") {
    const deadline = Date.now() + timeout;
    let lastHeartbeat = 0;
    while (Date.now() < deadline) {
      if (jobId && conversationHasJob(jobId)) return [];
      const buttons = findSendButtons(composer || findComposer());
      if (buttons.length) return buttons;
      const now = Date.now();
      if (jobId && now - lastHeartbeat >= 5000) {
        lastHeartbeat = now;
        await reportDiagnostic(jobId, "SEND_CONTROL_WAIT", { elapsedMs:timeout - Math.max(0, deadline - now), composer:elementDiagnostic(findComposer()), streaming:responseIsStreaming(), page:pageDiagnostic() });
      }
      await sleep(250);
    }
    return [];
  }

  async function waitForSendConfirmation(previousState, jobId, timeout = CONFIRM_TIMEOUT_MS) {
    const deadline = Date.now() + timeout;
    let lastHeartbeat = 0;
    let draftGoneSince = 0;
    while (Date.now() < deadline) {
      if (conversationHasJob(jobId)) return true;
      const currentState = userMessageState();
      if (currentState.count > previousState.count && currentState.lastText.includes(jobId)) return true;
      if (currentState.lastText !== previousState.lastText && currentState.lastText.includes(jobId)) return true;

      const draftHasJob = composerText(findComposer()).includes(jobId);
      const threadAdvanced = currentState.assistantCount > (previousState.assistantCount || 0) || currentState.streaming;
      const routeCommitted = Boolean(currentState.conversationId && currentState.conversationId !== previousState.conversationId);
      if (!draftHasJob && (threadAdvanced || routeCommitted)) {
        if (!draftGoneSince) draftGoneSince = Date.now();
        if (Date.now() - draftGoneSince >= 800) return true;
      } else {
        draftGoneSince = 0;
      }

      const now = Date.now();
      if (now - lastHeartbeat >= 5000) {
        lastHeartbeat = now;
        await reportDiagnostic(jobId, "SEND_CONFIRM_WAIT", { elapsedMs:timeout - Math.max(0, deadline - now), previousState, currentState, draftHasJob, threadAdvanced, routeCommitted });
      }
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


  function conversationIdFromPath(pathname = location.pathname) {
    const match = String(pathname || "").match(/(?:^|\/)c\/([^/?#]+)/);
    return match ? match[1] : "";
  }

  async function currentConversationUrl(timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (conversationIdFromPath()) return location.origin + location.pathname;
      await sleep(200);
    }
    return conversationIdFromPath() ? location.origin + location.pathname : "";
  }

  async function reportSent(jobId) {
    const conversationUrl = await currentConversationUrl();
    await chrome.runtime.sendMessage({ type: "CORVO_GPT_SENT", payload: { jobId, conversationUrl } }).catch(() => {});
  }

  function textOf(el) { return String(el?.innerText || el?.textContent || el?.getAttribute?.("aria-label") || "").trim().toLowerCase(); }
  function visible(el) { if (!el) return false; const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0 && r.height>0 && s.visibility!=="hidden" && s.display!=="none"; }
  function clickEl(el) { el.scrollIntoView({block:"center"}); el.dispatchEvent(new MouseEvent("mouseover",{bubbles:true})); el.click(); }

  async function waitUntil(fn, timeout = 5000, step = 120) {
    const deadline = Date.now() + timeout;
    let last = null;
    while (Date.now() < deadline) {
      try {
        const value = fn();
        if (value) return value;
        last = value;
      } catch (error) { last = error; }
      await sleep(step);
    }
    return null;
  }


  async function waitForStableElement(getter, { timeout = 10000, stableMs = 700, step = 120 } = {}) {
    const deadline = Date.now() + timeout;
    let candidate = null;
    let stableSince = 0;
    while (Date.now() < deadline) {
      let next = null;
      try { next = getter(); } catch {}
      if (next && next.isConnected && visible(next)) {
        if (next !== candidate) {
          candidate = next;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= stableMs) {
          return next;
        }
      } else {
        candidate = null;
        stableSince = 0;
      }
      await sleep(step);
    }
    return null;
  }

  function pageIsBusy() {
    const main = document.querySelector('main');
    if (!main) return true;
    return [...main.querySelectorAll('[aria-busy="true"], [data-loading="true"]')].some(visible);
  }

  async function waitForConversationInteractive(expected, timeout = 22000) {
    const deadline = Date.now() + timeout;
    let stableSince = 0;
    let lastMenu = null;
    while (Date.now() < deadline) {
      const onExpected = conversationIdFromPath() === expected;
      const main = document.querySelector('main');
      const hasContent = conversationTurnsExist() || String(main?.innerText || main?.textContent || '').trim().length > 80;
      const menu = currentConversationHeaderMenuButton();
      const ready = document.readyState === 'complete' && onExpected && main && visible(main) && hasContent && menu && !pageIsBusy();
      if (ready) {
        if (menu !== lastMenu) {
          lastMenu = menu;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= 1000) {
          return menu;
        }
      } else {
        lastMenu = null;
        stableSince = 0;
      }
      await sleep(150);
    }
    return null;
  }

  function sidebarConversationLink(expected) {
    return [...document.querySelectorAll('a[href*="/c/"]')].find((a) => {
      try {
        return conversationIdFromPath(new URL(a.getAttribute("href") || "", location.origin).pathname) === expected;
      } catch {
        return false;
      }
    }) || null;
  }

  function deleteDialogIsVisible() {
    return [...document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], dialog, [data-radix-dialog-content], [data-radix-alert-dialog-content], [data-slot="alert-dialog-content"]'
    )].some(visible);
  }

  function deletionSuccessNotice() {
    const scopes = [
      ...document.querySelectorAll('[role="status"], [role="alert"], [data-sonner-toast], [data-testid*="toast" i], [class*="toast" i]')
    ].filter(visible);
    return scopes.find((el) => {
      const t = textOf(el);
      return /(chat|conversation|conversa).*(deleted|removed|exclu[ií]d|apagad|removid)/.test(t)
        || /(deleted|removed|exclu[ií]d|apagad|removid).*(chat|conversation|conversa)/.test(t);
    }) || null;
  }

  async function ensureSidebarConversationLink(expected, timeout = 4500) {
    let link = sidebarConversationLink(expected);
    if (link) return link;

    const toggles = [...document.querySelectorAll('button')].filter((button) => {
      const label = [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent]
        .filter(Boolean).join(' ').trim().toLowerCase();
      return visible(button) && /(open|show|expand|abrir|mostrar|expandir).*(sidebar|side bar|barra lateral)|(?:sidebar|barra lateral).*(open|show|expand|abrir|mostrar|expandir)/.test(label);
    });
    if (toggles[0]) {
      clickElRobust(toggles[0]);
      await sleep(350);
    }

    link = await waitUntil(() => sidebarConversationLink(expected), timeout, 150);
    return link || null;
  }

  function currentConversationHeaderMenuButton() {
    const viewportW = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const viewportH = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    const candidates = [...document.querySelectorAll('button')].filter((button) => {
      if (!visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
      const rect = button.getBoundingClientRect();
      // Menu mostrado no print do ChatGPT: cabeçalho, canto superior direito.
      if (rect.top > Math.min(170, viewportH * 0.25)) return false;
      if (rect.left < viewportW * 0.68) return false;
      const descriptor = [
        button.getAttribute('aria-label'),
        button.getAttribute('title'),
        button.getAttribute('data-testid'),
        button.textContent
      ].filter(Boolean).join(' ').trim().toLowerCase();
      if (/(share|compartilhar)/.test(descriptor)) return false;
      return /(more|mais|options|opções|opcoes|actions|ações|acoes|menu)/.test(descriptor)
        || /^(⋯|\.\.\.|•••)$/.test(String(button.textContent || '').trim());
    });

    // Preferir o botão mais à direita; em empate, o mais alto.
    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return (rb.right - ra.right) || (ra.top - rb.top);
    });
    return candidates[0] || null;
  }

  function menuActionElement(el) {
    if (!el) return null;
    return el.closest('button, [role="menuitem"], [role="option"], a, [data-radix-collection-item], [data-slot*="menu-item"], [data-testid*="delete" i]') || el;
  }

  function looksLikeConversationMenuContainer(el) {
    if (!el || !visible(el)) return false;
    const rect = el.getBoundingClientRect();
    const viewportW = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const viewportH = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    // O popover do cabeçalho fica no quadrante superior direito. Evita casar texto da conversa.
    if (rect.right < viewportW * 0.62 || rect.top > Math.min(520, viewportH * 0.65)) return false;
    if (rect.width > 560 || rect.height > 700) return false;
    const t = textOf(el);
    const hasDelete = /(^|\n|\s)(delete|excluir|apagar)( chat| conversa)?($|\n|\s)/.test(t);
    const hasArchive = /(^|\n|\s)(archive|arquivar)($|\n|\s)/.test(t);
    const hasSecondarySignature = /(pin|fixar|move|mover|project|projeto|files|arquivos)/.test(t);
    return hasDelete && hasArchive && hasSecondarySignature;
  }

  function currentConversationDeleteMenuItem() {
    // Caminho 1: componentes semânticos conhecidos.
    const scopes = [
      ...document.querySelectorAll('[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper], [data-slot="dropdown-menu-content"], [data-slot*="dropdown-menu"], [data-radix-menu-content]')
    ].filter(visible);

    for (const scope of scopes.slice().reverse()) {
      const items = [...scope.querySelectorAll('[role="menuitem"], [role="option"], button, a, [data-radix-collection-item], [data-slot*="menu-item"]')].filter(visible);
      const texts = items.map(textOf);
      const hasChatMenuSignature = texts.some((t) => /^(archive|arquivar)$/.test(t))
        || texts.some((t) => /^(pin|fixar)( chat| conversa)?$/.test(t))
        || texts.some((t) => /(move|mover).*(project|projeto)/.test(t))
        || looksLikeConversationMenuContainer(scope);
      const deleteItem = items.find((el) => {
        const t = textOf(el);
        return /^(delete|excluir|apagar)( chat| conversa)?$/.test(t)
          || /delete (this )?(chat|conversation)|excluir (esta )?conversa|apagar (esta )?conversa/.test(t);
      });
      if (deleteItem && hasChatMenuSignature) return menuActionElement(deleteItem);
    }

    // Caminho 2: a UI atual pode renderizar o popover sem role=menu. Procuramos o
    // item Excluir visível no quadrante superior direito e validamos seus ancestrais
    // pelo conjunto Arquivar + Excluir + Fixar/Mover/Arquivos.
    const viewportW = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const viewportH = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    const raw = [...document.querySelectorAll('button, [role="menuitem"], [role="option"], a, [tabindex], [data-radix-collection-item], [data-slot*="menu-item"], span, div')]
      .filter((el) => {
        if (!visible(el)) return false;
        const t = textOf(el);
        if (!/^(delete|excluir|apagar)( chat| conversa)?$/.test(t)) return false;
        const r = el.getBoundingClientRect();
        return r.right > viewportW * 0.62 && r.top < Math.min(520, viewportH * 0.65);
      });

    for (const rawItem of raw) {
      const action = menuActionElement(rawItem);
      let ancestor = action;
      for (let depth = 0; ancestor && depth < 8; depth += 1, ancestor = ancestor.parentElement) {
        if (looksLikeConversationMenuContainer(ancestor)) return action;
      }
    }
    return null;
  }

  async function brieflyHighlight(el, ms = 900) {
    if (!el || !el.isConnected) return;
    const oldOutline = el.style.outline;
    const oldOffset = el.style.outlineOffset;
    const oldBg = el.style.backgroundColor;
    try {
      el.style.outline = '3px solid #ff3b30';
      el.style.outlineOffset = '2px';
      el.style.backgroundColor = 'rgba(255,59,48,.12)';
      await sleep(ms);
    } finally {
      if (el.isConnected) {
        el.style.outline = oldOutline;
        el.style.outlineOffset = oldOffset;
        el.style.backgroundColor = oldBg;
      }
    }
  }

  async function openConversationMenuAndFindDelete(expected, attempts = 3) {
    let lastReason = 'DELETE_MENU_ITEM_NOT_READY';
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const menuButton = await waitForStableElement(
        () => conversationIdFromPath() === expected ? currentConversationHeaderMenuButton() : null,
        { timeout: 6500, stableMs: 650, step: 120 }
      );
      if (!menuButton) {
        lastReason = 'HEADER_MENU_BUTTON_NOT_READY';
        continue;
      }

      clickElRobust(menuButton);
      // Dar tempo para o portal/popover montar e animar.
      await sleep(650);

      const deleteItem = await waitForStableElement(
        () => currentConversationDeleteMenuItem(),
        { timeout: 6500, stableMs: 650, step: 120 }
      );
      if (deleteItem) return deleteItem;

      lastReason = `DELETE_MENU_ITEM_NOT_READY_ATTEMPT_${attempt}`;
      // Se o menu fechou sozinho ou abriu incompleto, resetar e tentar de novo.
      try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); } catch {}
      await sleep(700);
    }
    throw new Error(lastReason);
  }

  function clickElRobust(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const rect = el.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, clientX: rect.left + Math.max(rect.width, 1) / 2, clientY: rect.top + Math.max(rect.height, 1) / 2 };
    try { el.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse', button: 0 })); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', { ...init, button: 0 })); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse', button: 0 })); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', { ...init, button: 0 })); } catch {}
    // O click() nativo é o principal; eventos acima são apenas compatibilidade.
    try { el.click(); } catch {}
  }

  function deletionDialogElement() {
    const dialogs = [...document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], dialog, [data-radix-dialog-content], [data-radix-alert-dialog-content], [data-slot="alert-dialog-content"]'
    )].filter(visible);
    return dialogs.slice().reverse().find((dialog) => {
      const t = textOf(dialog);
      return /(delete|excluir|apagar)/.test(t) && /(chat|conversation|conversa)/.test(t);
    }) || null;
  }

  function deletionConfirmButton(dialog) {
    if (!dialog || !visible(dialog)) return null;
    const buttons = [...dialog.querySelectorAll('button')].filter((el) => {
      return visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    });
    const matches = buttons.filter((el) => {
      const t = textOf(el);
      const testid = String(el.getAttribute('data-testid') || '').toLowerCase();
      return /^(delete|excluir|apagar)$/.test(t)
        || /delete.*(chat|conversation)|excluir.*conversa|apagar.*conversa/.test(t)
        || /(delete|confirm).*(chat|conversation)/.test(testid);
    });
    return matches.at(-1) || null;
  }

  function conversationMissingNotice() {
    const t = String(document.body?.innerText || document.body?.textContent || '').toLowerCase();
    return /(conversation|chat).*(not found|does not exist|unable to load|couldn.t load|deleted|removed)|(?:conversa|chat).*(não encontrada|nao encontrada|não existe|nao existe|não foi possível carregar|nao foi possivel carregar|excluída|excluida|removida)/.test(t);
  }

  function conversationTurnsExist() {
    return document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]').length > 0;
  }

  async function checkCurrentConversationExists(payload = {}) {
    const expected = String(payload?.conversationId || '').trim();
    if (!expected) return { ok:false, error:'CONVERSATION_ID_REQUIRED' };
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const current = conversationIdFromPath();
      if (current && current !== expected) return { ok:true, exists:false, reason:'ROUTE_CHANGED' };
      if (!current && location.pathname === '/') return { ok:true, exists:false, reason:'HOME_REDIRECT' };
      if (conversationMissingNotice()) return { ok:true, exists:false, reason:'MISSING_NOTICE' };
      if (current === expected && conversationTurnsExist()) return { ok:true, exists:true, reason:'CONVERSATION_LOADED' };
      await sleep(180);
    }
    const current = conversationIdFromPath();
    if (current === expected) return { ok:true, exists:null, reason:'CONVERSATION_NOT_READY' };
    return { ok:true, exists:false, reason:'ROUTE_NOT_PRESENT' };
  }

  async function verifyCurrentConversationDeleted(payload = {}) {
    const expected = String(payload?.conversationId || '').trim();
    if (!expected) return { ok: false, error: 'CONVERSATION_ID_REQUIRED' };

    // Não declarar "ainda existe" no primeiro frame carregado. A remoção do ChatGPT
    // pode levar alguns segundos para se propagar depois da confirmação.
    const startedAt = Date.now();
    const deadline = startedAt + 10000;
    let sawConversation = false;
    while (Date.now() < deadline) {
      const current = conversationIdFromPath();
      if (current && current !== expected) return { ok: true, deleted: true, exists: false, reason: 'ROUTE_CHANGED' };
      if (!current && location.pathname === '/') return { ok: true, deleted: true, exists: false, reason: 'HOME_REDIRECT' };
      if (conversationMissingNotice()) return { ok: true, deleted: true, exists: false, reason: 'MISSING_NOTICE' };
      if (current === expected && conversationTurnsExist()) sawConversation = true;
      await sleep(220);
    }
    if (sawConversation) return { ok: true, deleted: false, exists: true, reason: 'CONVERSATION_STILL_LOADS' };
    return { ok: true, deleted: false, exists: null, reason: 'VERIFY_UNKNOWN' };
  }

  async function waitForDeletionToApply(expected, timeout = 12000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const current = conversationIdFromPath();
      if (current && current !== expected) return { applied: true, reason: 'ROUTE_CHANGED_AFTER_CONFIRM' };
      if (!current && location.pathname === '/') return { applied: true, reason: 'HOME_REDIRECT_AFTER_CONFIRM' };
      if (deletionSuccessNotice()) return { applied: true, reason: 'SUCCESS_NOTICE' };

      // Quando a sidebar está montada, o desaparecimento do link exato é um bom sinal
      // de que a mutação já foi aplicada. Não usamos isso sozinho para marcar deleted=true;
      // o background ainda fará a reabertura forte da URL.
      if (!deleteDialogIsVisible()) {
        const anySidebarChats = document.querySelectorAll('a[href*="/c/"]').length > 0;
        if (anySidebarChats && !sidebarConversationLink(expected)) {
          return { applied: true, reason: 'SIDEBAR_LINK_REMOVED' };
        }
      }
      await sleep(180);
    }
    return { applied: false, reason: 'DELETE_APPLY_TIMEOUT' };
  }

  async function deleteCurrentChat(payload) {
    const expected = String(payload?.conversationId || '').trim();
    if (!expected) throw new Error('CONVERSATION_ID_REQUIRED');

    // V0.6.14: a limpeza é guiada pelo ESTADO real da SPA. Não avançar apenas
    // porque o document terminou de carregar ou porque passaram poucos ms.
    const menuButton = await waitForConversationInteractive(expected, 22000);
    if (!menuButton) {
      const current = conversationIdFromPath();
      if (current !== expected) throw new Error(`CONVERSATION_ID_MISMATCH:${current || 'NONE'}`);
      throw new Error('CONVERSATION_NOT_INTERACTIVE');
    }

    // A conversa ficou estável. Agora abrir o menu e localizar Excluir com até
    // três tentativas. A UI do ChatGPT pode montar o popover em um portal sem role=menu.
    const deleteItem = await openConversationMenuAndFindDelete(expected, 3);
    await brieflyHighlight(deleteItem, 950);
    if (!deleteItem.isConnected || !visible(deleteItem)) throw new Error('DELETE_MENU_ITEM_BECAME_UNREADY');
    clickElRobust(deleteItem);

    // Não procurar um botão "Excluir" global. O segundo clique só pode ocorrer
    // depois que o modal de confirmação específico da exclusão existir e ficar
    // estável. Isso evita clicar antes da animação/modal realmente aparecer.
    const dialog = await waitForStableElement(
      () => deletionDialogElement(),
      { timeout: 12000, stableMs: 700, step: 120 }
    );
    if (!dialog) throw new Error('DELETE_CONFIRM_DIALOG_NOT_READY');

    const confirm = await waitForStableElement(
      () => {
        const liveDialog = deletionDialogElement();
        return liveDialog ? deletionConfirmButton(liveDialog) : null;
      },
      { timeout: 9000, stableMs: 650, step: 120 }
    );
    if (!confirm) throw new Error('DELETE_CONFIRM_BUTTON_NOT_READY');

    // Tornar o alvo visível para diagnóstico antes do clique destrutivo.
    await brieflyHighlight(confirm, 950);
    await sleep(250);
    if (!confirm.isConnected || !visible(confirm) || confirm.disabled || confirm.getAttribute('aria-disabled') === 'true') {
      throw new Error('DELETE_CONFIRM_BUTTON_BECAME_UNREADY');
    }
    clickElRobust(confirm);

    // Agora esperar o modal/alertdialog REAL desaparecer.
    const dialogClosed = await waitUntil(() => !deletionDialogElement() && !deleteDialogIsVisible(), 12000, 150);
    if (!dialogClosed) throw new Error('DELETE_CONFIRM_CLICK_NOT_APPLIED');

    // A mutação pode levar alguns segundos para aparecer na SPA. Não navegar
    // para fora enquanto ainda está aplicando. A prova final continua sendo a
    // reabertura forte feita pelo background.
    const applied = await waitForDeletionToApply(expected, 15000);
    return {
      ok: true,
      deleteRequested: true,
      conversationId: expected,
      applyObserved: applied.applied === true,
      applyReason: applied.reason
    };
  }

  function assistantLikeScopes() {
    const explicit = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    const turns = [...document.querySelectorAll('article[data-testid^="conversation-turn"]')].filter((scope) => {
      const ownRole = scope.getAttribute?.('data-message-author-role');
      if (ownRole === 'user') return false;
      if (ownRole === 'assistant') return true;
      if (scope.querySelector?.('[data-message-author-role="user"]')) return false;
      return true;
    });
    return [...explicit, ...turns].filter((scope, index, all) => all.indexOf(scope) === index);
  }

  function manifestOutputFileNames(payload = {}) {
    const supplied = Array.isArray(payload?.expectedFiles) ? payload.expectedFiles : [];
    const names = supplied.map((value) => String(value || '').trim()).filter(Boolean);
    // Quando o app fornece expectedFiles, esta lista é o contrato oficial. Não
    // misturamos ARQUIVO= antigos/errados lidos do DOM, porque isso altera índices
    // A/B do preset OU e pode transformar 8 slots em uma contagem incorreta.
    if (names.length) return [...new Map(names.map((name) => [name.toLocaleLowerCase('pt-BR'), name])).values()];
    const scopes = assistantLikeScopes();
    // Em retries semânticos a mesma conversa pode conter manifestos antigos.
    // Só o manifesto mais recente pertence às imagens após a última mensagem
    // do usuário e, portanto, só ele define os ARQUIVO= desta captura.
    const manifestScopes = scopes.filter((scope) => /\[CORVO_(?:THUMBNAIL|IMAGE_(?:GENERATION|REFINEMENT))\]/i.test(String(scope?.textContent || '')));
    const scope = manifestScopes.at(-1) || null;
    if (scope) {
      const text = String(scope.textContent || '');
      for (const match of text.matchAll(/(?:^|\n)\s*ARQUIVO\s*=\s*([^\n\r]+)/gi)) {
        const name = String(match?.[1] || '').trim();
        if (name) names.push(name);
      }
    }
    return [...new Map(names.map((name) => [name.toLocaleLowerCase('pt-BR'), name])).values()];
  }

  function generatedImageCandidates(payload = {}) {
    const seenElements = new Set();
    const rawItems = [];
    const assistantScopes = assistantLikeScopes();
    const latestUser = [...document.querySelectorAll('[data-message-author-role="user"]')].at(-1) || null;
    let latestUserY = -Infinity;
    try {
      if (latestUser) latestUserY = latestUser.getBoundingClientRect().top + window.scrollY;
    } catch {}

    function addImage(image, scope = null, scopeIndex = -1) {
      if (!image || seenElements.has(image)) return;
      seenElements.add(image);

      const authorNode = image.closest?.('[data-message-author-role]');
      if (authorNode?.getAttribute('data-message-author-role') === 'user') return;
      if (image.closest?.('form, textarea, [contenteditable="true"], nav, header, aside')) return;

      const turn = scope || image.closest?.('article[data-testid^="conversation-turn"], [data-message-author-role="assistant"]') || null;
      const turnRole = turn?.getAttribute?.('data-message-author-role');
      if (turnRole === 'user') return;
      if (turn && !turnRole && turn.querySelector?.('[data-message-author-role="user"]')) return;

      if (!visible(image)) return;
      const naturalWidth = image.naturalWidth || 0;
      const naturalHeight = image.naturalHeight || 0;
      const renderedWidth = image.clientWidth || image.width || 0;
      const renderedHeight = image.clientHeight || image.height || 0;
      const naturalArea = naturalWidth * naturalHeight;
      const renderedArea = renderedWidth * renderedHeight;
      const src = String(image.currentSrc || image.src || '');
      const alt = String(image.alt || '').toLowerCase();
      if (!src || src.startsWith('data:image/svg')) return;
      if (/avatar|profile|ícone|icon|favicon|emoji/.test(alt)) return;

      // A UI nova do ChatGPT pode renderizar 2 variantes por geração em tiles
      // relativamente pequenos. Aceitamos tiles pequenos quando o arquivo real
      // possui resolução de imagem, mas continuamos rejeitando ícones/thumbnails.
      const hasRealResolution = naturalWidth >= 256 && naturalHeight >= 160 && naturalArea >= 70000;
      const hasUsefulRenderedSize = renderedWidth >= 110 && renderedHeight >= 70 && renderedArea >= 10000;
      if (!hasRealResolution && !hasUsefulRenderedSize) return;

      const rect = image.getBoundingClientRect();
      const y = rect.top + window.scrollY;
      const x = rect.left + window.scrollX;
      if (Number.isFinite(latestUserY) && y + Math.max(renderedHeight, 1) < latestUserY - 40) return;

      const text = String(turn?.textContent || '');
      const manifest = /\[CORVO_THUMBNAIL\]|TIPO_ARQUIVO\s*=\s*THUMBNAIL|\[CORVO_IMAGE_(GENERATION|REFINEMENT)\]/i.test(text) ? 1 : 0;
      const jobMatch = payload?.jobId && text.includes(String(payload.jobId)) ? 1 : 0;
      const fileMatch = payload?.name && text.includes(String(payload.name)) ? 1 : 0;
      const selected = image.closest?.('[aria-selected="true"], [aria-pressed="true"], [data-state="active"], [data-selected="true"]') ? 1 : 0;
      const ancestorText = String(image.closest?.('button, figure, [role="group"], [role="listitem"]')?.textContent || '').toLowerCase();
      const generatedHint = /oaiusercontent\.com|blob:/i.test(src) || /editar|edit image|share|compartilhar/.test(ancestorText) ? 1 : 0;
      rawItems.push({
        image, scope:turn, scopeIndex, manifest, jobMatch, fileMatch, selected, generatedHint,
        naturalArea, renderedArea, area:Math.max(naturalArea, renderedArea), x, y,
        centerY:y + Math.max(renderedHeight, naturalHeight ? Math.min(naturalHeight, renderedHeight || naturalHeight) : 0) / 2,
        renderedWidth, renderedHeight, naturalWidth, naturalHeight, src
      });
    }

    assistantScopes.forEach((scope, scopeIndex) => {
      [...scope.querySelectorAll('img')].forEach((image) => addImage(image, scope, scopeIndex));
    });

    // Fallback para o novo componente de geração de imagens: em algumas versões
    // o gallery/card fica dentro de <main>, mas fora do nó que carrega
    // data-message-author-role="assistant". Coletamos apenas imagens grandes o
    // suficiente e nunca imagens pertencentes a mensagens do usuário/composer.
    const main = document.querySelector('main') || document.body;
    [...main.querySelectorAll('img')].forEach((image) => addImage(image, null, 9999));

    // A mesma imagem pode aparecer como preview grande + miniatura. Mantemos a
    // ocorrência visualmente maior para que Thumb com 2 opções escolha o asset
    // principal, não o thumbnail lateral.
    const bySrc = new Map();
    for (const item of rawItems) {
      const key = String(item.src || '');
      const previous = bySrc.get(key);
      if (!previous || item.renderedArea > previous.renderedArea || (item.renderedArea === previous.renderedArea && item.selected > previous.selected)) {
        bySrc.set(key, item);
      }
    }

    return [...bySrc.values()].sort((a, b) =>
      b.jobMatch - a.jobMatch ||
      b.fileMatch - a.fileMatch ||
      b.manifest - a.manifest ||
      b.selected - a.selected ||
      b.generatedHint - a.generatedHint ||
      a.y - b.y ||
      a.x - b.x ||
      b.renderedArea - a.renderedArea ||
      b.naturalArea - a.naturalArea
    );
  }

  function visualRows(candidates = []) {
    const sorted = [...candidates].sort((a,b) => a.y - b.y || a.x - b.x);
    if (!sorted.length) return [];
    const heights = sorted.map((item) => Number(item.renderedHeight || 0)).filter((value) => value > 0).sort((a,b) => a-b);
    const medianHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 120;
    const tolerance = Math.max(24, Math.min(100, medianHeight * 0.45));
    const rows = [];
    for (const item of sorted) {
      let row = rows.find((entry) => Math.abs(entry.centerY - item.centerY) <= tolerance);
      if (!row) {
        row = { centerY:item.centerY, items:[] };
        rows.push(row);
      }
      row.items.push(item);
      row.centerY = row.items.reduce((sum, current) => sum + current.centerY, 0) / row.items.length;
    }
    return rows.sort((a,b) => a.centerY - b.centerY).map((row) => row.items.sort((a,b) => a.x - b.x));
  }

  function bestVariant(group = []) {
    const all = [...group];
    const maxRenderedArea = all.reduce((max, item) => Math.max(max, Number(item.renderedArea || 0)), 0);
    // A gallery de Thumb mostra um preview grande e miniaturas laterais. Um
    // thumbnail pode estar aria-selected=true, mas o asset a capturar é o preview
    // grande correspondente. Descartamos ocorrências muito menores antes de
    // considerar estado selecionado.
    const meaningful = maxRenderedArea > 0
      ? all.filter((item) => Number(item.renderedArea || 0) >= maxRenderedArea * 0.28)
      : all;
    const pool = meaningful.length ? meaningful : all;
    return pool.sort((a,b) =>
      b.selected - a.selected ||
      b.generatedHint - a.generatedHint ||
      b.renderedArea - a.renderedArea ||
      b.naturalArea - a.naturalArea ||
      a.x - b.x ||
      a.y - b.y
    )[0] || null;
  }

  function logicalGeneratedImageSlots(candidates = [], payload = {}) {
    const expectedNames = manifestOutputFileNames(payload);
    const expectedCount = Math.max(1, expectedNames.length || Number(payload?.expectedCount || 0) || 1);
    const ordered = [...candidates].sort((a,b) => a.y - b.y || a.x - b.x);
    if (!ordered.length) return { expectedNames, slots:[] };

    // Thumb / saída única: pode haver duas opções ou preview + miniaturas. A
    // variante visualmente principal/selecionada é a saída física do manifesto.
    if (expectedCount === 1) return { expectedNames, slots:[bestVariant(ordered)] };

    const rows = visualRows(ordered);
    if (rows.length >= expectedCount) {
      return { expectedNames, slots:rows.slice(0, expectedCount).map((row) => bestVariant(row)).filter(Boolean) };
    }

    // Fallback para galerias sem coordenadas de linha confiáveis. Quando o
    // ChatGPT devolve N variantes para cada um dos IDs, o número total costuma
    // ser múltiplo da quantidade de ARQUIVO=. Dividimos em grupos visuais iguais
    // e escolhemos uma variante de cada grupo.
    if (ordered.length >= expectedCount && ordered.length % expectedCount === 0) {
      const variantsPerOutput = ordered.length / expectedCount;
      const slots = [];
      for (let index = 0; index < expectedCount; index += 1) {
        const group = ordered.slice(index * variantsPerOutput, (index + 1) * variantsPerOutput);
        slots.push(bestVariant(group));
      }
      return { expectedNames, slots:slots.filter(Boolean) };
    }

    return { expectedNames, slots:ordered.slice(0, expectedCount) };
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

  function inferCompositeGridColumns(width, height, count, preferred) {
    const explicit = Number(preferred || 0);
    if (Number.isInteger(explicit) && explicit > 0) return Math.max(1, Math.min(count, explicit));
    const safeWidth = Math.max(1, Number(width || 1));
    const safeHeight = Math.max(1, Number(height || 1));
    let bestColumns = 1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let columns = 1; columns <= count; columns += 1) {
      if (count % columns !== 0) continue;
      const rows = count / columns;
      const cellAspect = (safeWidth / columns) / (safeHeight / rows);
      const score = Math.abs(Math.log(Math.max(0.0001, cellAspect)));
      if (score < bestScore) { bestScore = score; bestColumns = columns; }
    }
    return Math.max(1, Math.min(count, bestColumns));
  }

  async function cropCompositeCandidate(candidate, payload = {}, expectedNames = []) {
    const count = Math.max(1, expectedNames.length || Number(payload?.expectedCount || 0) || 1);
    if (count <= 1) return null;
    const requestedName = String(payload?.name || '').trim();
    let index = Number.isInteger(payload?.expectedIndex) ? Number(payload.expectedIndex) : -1;
    if (index < 0 && requestedName) {
      const key = requestedName.toLocaleLowerCase('pt-BR');
      index = expectedNames.findIndex((name) => String(name || '').toLocaleLowerCase('pt-BR') === key);
    }
    if (index < 0 || index >= count) throw new Error('COMPOSITE_EXPECTED_INDEX_UNKNOWN');

    const src = String(candidate?.src || candidate?.image?.currentSrc || candidate?.image?.src || '');
    let bitmap = null;
    let revoke = '';
    try {
      // Preferimos o blob real: evita canvas contaminado por CORS e permite
      // recortar o contact sheet mesmo quando o <img> visível é só um preview.
      try {
        const blob = await fetchImageBlob(src, 9000);
        bitmap = await createImageBitmap(blob);
      } catch (_) {
        const image = candidate?.image;
        if (!image) throw new Error('COMPOSITE_IMAGE_MISSING');
        const width = image.naturalWidth || image.width || 0;
        const height = image.naturalHeight || image.height || 0;
        if (!width || !height) throw new Error('COMPOSITE_DIMENSIONS_MISSING');
        const canvasSource = document.createElement('canvas');
        canvasSource.width = width;
        canvasSource.height = height;
        const sourceCtx = canvasSource.getContext('2d');
        if (!sourceCtx) throw new Error('CANVAS_UNAVAILABLE');
        sourceCtx.drawImage(image, 0, 0, width, height);
        const blob = await new Promise((resolve, reject) => canvasSource.toBlob((value) => value ? resolve(value) : reject(new Error('COMPOSITE_SOURCE_EXPORT_FAILED')), 'image/png'));
        revoke = URL.createObjectURL(blob);
        bitmap = await createImageBitmap(blob);
      }

      const width = bitmap.width || 0;
      const height = bitmap.height || 0;
      if (!width || !height) throw new Error('COMPOSITE_DIMENSIONS_MISSING');

      // Modo ROWS: uma faixa horizontal por asset.
      // Modo GRID: usado pelo preset Forma QUAL_VOCE_PREFERE. A ordem oficial é
      // 01_A,01_B,02_A,02_B...; a geometria é inferida pela proporção real do contact sheet; cada célula
      // é um arquivo físico independente para IMAGEM_A/IMAGEM_B.
      const mode = String(payload?.compositeSplitMode || 'AUTO').toUpperCase();
      let sx = 0, sy = 0, sw = width, sh = height;
      let gridRow = null, gridColumn = null, gridRows = null, gridColumns = null;
      if (mode === 'GRID') {
        const columns = inferCompositeGridColumns(width, height, count, payload?.compositeColumns);
        const rows = Math.max(1, Math.ceil(count / columns));
        const row = Math.floor(index / columns);
        const column = index % columns;
        const x0 = Math.round((width * column) / columns);
        const x1 = Math.round((width * (column + 1)) / columns);
        const y0 = Math.round((height * row) / rows);
        const y1 = Math.round((height * (row + 1)) / rows);
        sx = Math.max(0, x0); sw = Math.max(1, Math.min(width - sx, x1 - x0));
        sy = Math.max(0, y0); sh = Math.max(1, Math.min(height - sy, y1 - y0));
        gridRow = row; gridColumn = column; gridRows = rows; gridColumns = columns;
      } else if (mode === 'ROWS' || mode === 'AUTO') {
        const y0 = Math.round((height * index) / count);
        const y1 = Math.round((height * (index + 1)) / count);
        sy = Math.max(0, y0);
        sh = Math.max(1, Math.min(height - sy, y1 - y0));
      }

      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
      const outBlob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('COMPOSITE_CROP_EXPORT_FAILED')), 'image/png'));
      if (!outBlob.size) throw new Error('COMPOSITE_CROP_EMPTY');
      if (outBlob.size > 8 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE');
      return {
        ok:true,
        dataUrl:await blobToDataUrl(outBlob),
        src,
        contentType:outBlob.type || 'image/png',
        size:outBlob.size,
        width:sw,
        height:sh,
        composite:true,
        compositeIndex:index,
        compositeCount:count,
        compositeMode:mode,
        gridRow, gridColumn, gridRows, gridColumns
      };
    } finally {
      try { bitmap?.close?.(); } catch {}
      if (revoke) try { URL.revokeObjectURL(revoke); } catch {}
    }
  }

  async function captureGeneratedImage(payload = {}, timeout = 30000) {
    const deadline = Date.now() + Math.max(3000, Number(payload?.timeout || timeout));
    let lastError = "GENERATED_IMAGE_NOT_FOUND";
    let singleCompositeSince = 0;
    const jobId = String(payload?.jobId || "");
    const requestedName = String(payload?.name || "");
    const assignments = capturedImageAssignments.get(jobId) || new Map();
    capturedImageAssignments.set(jobId, assignments);
    while (Date.now() < deadline) {
      const candidates = generatedImageCandidates(payload);
      const layout = logicalGeneratedImageSlots(candidates, payload);

      // Novo fallback V0.6.36: se o lote declara N arquivos mas a UI contém
      // um único contact sheet, usamos a lista OFICIAL recebida do CorvoQuiz e
      // recortamos uma faixa por ID. Assim uma resposta 4-em-1 continua utilizável.
      const maxRenderedArea = candidates.reduce((max, item) => Math.max(max, Number(item?.renderedArea || 0)), 0);
      const meaningfulCompositeCandidates = maxRenderedArea > 0
        ? candidates.filter((item) => Number(item?.renderedArea || 0) >= maxRenderedArea * 0.28)
        : candidates;
      if (layout.expectedNames.length > 1 && meaningfulCompositeCandidates.length === 1) {
        const compositeCandidate = meaningfulCompositeCandidates[0];
        if (!singleCompositeSince) singleCompositeSince = Date.now();
        if (Date.now() - singleCompositeSince >= 700) {
          try {
            const cropped = await cropCompositeCandidate(compositeCandidate, payload, layout.expectedNames);
            reportDiagnostic(jobId, 'BATCH_COMPOSITE_IMAGE_SPLIT', {
              requestedName,
              expectedFiles:layout.expectedNames,
              expectedIndex:Number.isInteger(payload?.expectedIndex) ? payload.expectedIndex : null,
              candidateCount:candidates.length,
              meaningfulCount:meaningfulCompositeCandidates.length,
              candidateNatural:[compositeCandidate?.naturalWidth || 0, compositeCandidate?.naturalHeight || 0],
              outputSize:[cropped?.width || 0, cropped?.height || 0],
              splitMode:String(payload?.compositeSplitMode || 'AUTO'),
              compositeColumns:Number(payload?.compositeColumns || 0) || null,
              grid:[cropped?.gridRow, cropped?.gridColumn, cropped?.gridRows, cropped?.gridColumns]
            }).catch(() => {});
            return cropped;
          } catch (splitError) {
            const src = String(compositeCandidate?.src || compositeCandidate?.image?.currentSrc || compositeCandidate?.image?.src || '');
            const expectedIndex = Number.isInteger(payload?.expectedIndex)
              ? Number(payload.expectedIndex)
              : layout.expectedNames.findIndex((name) => String(name || '').toLocaleLowerCase('pt-BR') === requestedName.toLocaleLowerCase('pt-BR'));
            // Se o contexto isolado da página não conseguir ler pixels por CORS,
            // delegamos o download + crop ao service worker, que possui host_permissions.
            if (/^https:\/\//i.test(src) && expectedIndex >= 0) {
              reportDiagnostic(jobId, 'BATCH_COMPOSITE_SPLIT_BACKGROUND_FALLBACK', {
                requestedName, expectedIndex, expectedCount:layout.expectedNames.length,
                error:String(splitError?.message || splitError || 'UNKNOWN')
              }).catch(() => {});
              return {
                ok:true, src,
                crop:{ mode:String(payload?.compositeSplitMode || 'ROWS').toUpperCase(), index:expectedIndex, count:layout.expectedNames.length, columns:Number(payload?.compositeColumns || 0) || undefined },
                composite:true
              };
            }
            lastError = `COMPOSITE_SPLIT_FAILED:${splitError?.message || splitError || 'UNKNOWN'}`;
          }
        }
      } else {
        singleCompositeSince = 0;
      }
      const assignedSrc = assignments.get(requestedName) || "";
      const used = new Set([...assignments.entries()].filter(([name]) => name !== requestedName).map(([,src]) => src));
      let candidate = assignedSrc ? candidates.find((item) => String(item.src || item.image.currentSrc || item.image.src || "") === assignedSrc) : null;
      if (!candidate) {
        const requestedKey = requestedName.toLocaleLowerCase('pt-BR');
        const logicalIndex = layout.expectedNames.findIndex((name) => String(name || '').toLocaleLowerCase('pt-BR') === requestedKey);
        if (logicalIndex >= 0 && layout.slots[logicalIndex]) {
          const slot = layout.slots[logicalIndex];
          const slotSrc = String(slot.src || slot.image.currentSrc || slot.image.src || '');
          if (!used.has(slotSrc)) candidate = slot;
        }
        if (!candidate) {
          const unusedSlots = layout.slots.filter((item) => !used.has(String(item.src || item.image.currentSrc || item.image.src || '')));
          candidate = unusedSlots[0] || candidates.find((item) => !used.has(String(item.src || item.image.currentSrc || item.image.src || ''))) || null;
        }
        if (candidate) assignments.set(requestedName, String(candidate.src || candidate.image.currentSrc || candidate.image.src || ""));
      }
      if (candidate) {
        reportDiagnostic(jobId, 'CAPTURE_IMAGE_SLOT_SELECTED', {
          requestedName,
          expectedFiles:layout.expectedNames,
          candidateCount:candidates.length,
          slotCount:layout.slots.length,
          chosenSrc:shortText(String(candidate.src || candidate.image.currentSrc || candidate.image.src || ''), 160),
          chosenRendered:[candidate.renderedWidth || 0, candidate.renderedHeight || 0],
          chosenNatural:[candidate.naturalWidth || 0, candidate.naturalHeight || 0]
        }).catch(() => {});
      }
      if (candidate) {
        const src = String(candidate.src || candidate.image.currentSrc || candidate.image.src || "");
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
    if (requestedName) assignments.delete(requestedName);
    throw new Error(lastError);
  }


  function detectRateLimitDialog() {
    const nodes = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], body')];
    for (const node of nodes) {
      if (node !== document.body && !isVisible(node)) continue;
      const text = String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
      if (!/(excesso de solicitações|solicitações rápido demais|aguarde alguns minutos|too many requests|requests too quickly|try again in a few minutes)/i.test(text)) continue;
      return node;
    }
    return null;
  }

  async function rejectIfRateLimited(jobId) {
    const dialog = detectRateLimitDialog();
    if (!dialog) return false;
    const text = shortText(dialog.innerText || dialog.textContent || "", 500);
    const buttons = [...dialog.querySelectorAll('button')].filter(isVisible);
    const dismiss = buttons.find((button) => /(entendido|ok|got it|close|fechar)/i.test(String(button.innerText || button.textContent || button.getAttribute('aria-label') || '')));
    if (dismiss) clickButton(dismiss);
    await reportDiagnostic(jobId, "CHATGPT_RATE_LIMIT_DETECTED", { text, dismissed:Boolean(dismiss), page:pageDiagnostic() });
    await reportStage(jobId, "RATE_LIMITED", "O ChatGPT limitou temporariamente as solicitações. O lote será pausado e retomado depois, sem abrir Fallback.");
    throw new Error("CHATGPT_RATE_LIMITED");
  }

  async function sendPrompt(job) {
    if (busy) {
      await reportDiagnostic(job?.jobId, "SEND_REJECTED_BUSY", { page:pageDiagnostic() });
      throw new Error("BRIDGE_BUSY");
    }
    busy = true;
    try {
      await reportDiagnostic(job.jobId, "SEND_PROMPT_START", { specialist:job.specialist || "", attempt:job.bridgeAttempt || "background", page:pageDiagnostic(), promptLength:String(job.prompt || "").length, attachmentCount:Array.isArray(job?.meta?.attachments) ? job.meta.attachments.length : 0 });
      if (conversationHasJob(job.jobId)) {
        await reportDiagnostic(job.jobId, "JOB_ALREADY_IN_CONVERSATION", { streaming:responseIsStreaming(), page:pageDiagnostic() });
        await reportStage(job.jobId, "WAITING_ACTION", "Este job já está na conversa. Aguardando o GPT concluir; nenhuma nova mensagem será enviada.");
        await reportSent(job.jobId);
        return;
      }
      await rejectIfRateLimited(job.jobId);
      if (String(job.specialist || "").toUpperCase() === "ANALISTA" && responseIsStreaming()) {
        await reportDiagnostic(job.jobId, "ANALYST_PREVIOUS_RESPONSE_ACTIVE", { page:pageDiagnostic() });
        await reportStage(job.jobId, "WAITING_PREVIOUS_RESPONSE", "O Corvo Analista ainda está respondendo ao job anterior. Novo envio bloqueado.");
        throw new Error("ANALYST_PREVIOUS_RESPONSE_ACTIVE");
      }

      await reportStage(job.jobId, "WAITING_COMPOSER", "Aguardando o editor do GPT ficar pronto...");
      let composer = await waitForComposer();
      await reportDiagnostic(job.jobId, "COMPOSER_FOUND", { composer:elementDiagnostic(composer), page:pageDiagnostic() });
      const message = compose(job);
      const previousState = userMessageState();

      const existingDraft = composerText(composer);
      if (existingDraft.includes(job.jobId)) {
        await reportStage(job.jobId, "DRAFT_RECOVERED", "Rascunho do Analista recuperado. Continuando do ponto anterior...");
        await reportDiagnostic(job.jobId, "COMPOSER_DRAFT_REUSED", { length:existingDraft.length, composer:elementDiagnostic(composer) });
      } else {
        await reportStage(job.jobId, "FILLING_COMPOSER", "Preenchendo a solicitação no GPT...");
        setComposerText(composer, message);
        const fillDeadline = Date.now() + 45000;
        while (Date.now() < fillDeadline && !composerText(findComposer()).includes(job.jobId)) await sleep(180);
        if (!composerText(findComposer()).includes(job.jobId)) throw new Error("COMPOSER_FILL_FAILED");
        await reportDiagnostic(job.jobId, "COMPOSER_FILL_OK", { length:composerText(findComposer()).length, containsJob:true, composer:elementDiagnostic(findComposer()) });
      }

      const attachmentBytes = await attachJobFiles(job);
      await reportDiagnostic(job.jobId, "ATTACHMENTS_FINISHED", { attachmentBytes, page:pageDiagnostic() });
      composer = await waitForComposer();
      if (!composerText(composer).includes(job.jobId)) {
        setComposerText(composer, message);
        await sleep(500);
      }
      if (!composerText(findComposer()).includes(job.jobId)) throw new Error("COMPOSER_LOST_AFTER_ATTACHMENT");

      await rejectIfRateLimited(job.jobId);
      await reportStage(job.jobId, "WAITING_SEND_CONTROL", attachmentBytes ? "ZIP pronto. Aguardando o botão de enviar ficar disponível..." : "Solicitação pronta. Aguardando o botão de enviar...");
      const attachmentButtonTimeout = attachmentBytes
        ? Math.max(120000, Math.min(300000, 45000 + Math.floor(attachmentBytes / 180)))
        : Math.max(BUTTON_TIMEOUT_MS, 90000);
      const buttons = await waitForEnabledButtons(findComposer(), attachmentButtonTimeout, job.jobId);
      if (conversationHasJob(job.jobId)) {
        await reportDiagnostic(job.jobId, "MESSAGE_FOUND_BEFORE_CLICK", { page:pageDiagnostic() });
        await reportStage(job.jobId, "USER_MESSAGE_COMMITTED", "A mensagem já aparece na conversa. Aguardando o Analista...");
        await reportSent(job.jobId);
        return;
      }
      await reportDiagnostic(job.jobId, "SEND_BUTTON_SCAN", { timeout:attachmentButtonTimeout, found:buttons.length, buttons:buttons.map(elementDiagnostic), page:pageDiagnostic() });
      for (const button of buttons) {
        if (!isEnabled(button)) continue;
        await reportStage(job.jobId, "SEND_TRIGGERED", "Botão de enviar encontrado. Confirmando o envio...");
        await reportDiagnostic(job.jobId, "SEND_BUTTON_CLICK", { button:elementDiagnostic(button), previousState, composerLength:composerText(findComposer()).length });
        clickButton(button);
        const confirmed = await waitForSendConfirmation(previousState, job.jobId, 75000);
        await reportDiagnostic(job.jobId, confirmed ? "SEND_BUTTON_CONFIRMED" : "SEND_BUTTON_NOT_CONFIRMED", { button:elementDiagnostic(button), afterState:userMessageState(), page:pageDiagnostic() });
        if (confirmed) {
          await reportStage(job.jobId, "USER_MESSAGE_COMMITTED", "Mensagem confirmada na conversa. Aguardando o especialista...");
          await reportSent(job.jobId);
          return;
        }
      }

      const currentComposer = findComposer();
      if (currentComposer && composerText(currentComposer)) {
        const form = currentComposer.closest("form");
        const submitButton = form?.querySelector('button[type="submit"]');
        if (form && submitButton && isEnabled(submitButton) && typeof form.requestSubmit === "function") {
          await reportStage(job.jobId, "SENDING_MESSAGE", "Confirmando envio pelo formulário do GPT...");
          await reportDiagnostic(job.jobId, "FORM_REQUEST_SUBMIT", { submitButton:elementDiagnostic(submitButton), form:elementDiagnostic(form) });
          form.requestSubmit(submitButton);
          const confirmed = await waitForSendConfirmation(previousState, job.jobId, 75000);
          await reportDiagnostic(job.jobId, confirmed ? "FORM_SUBMIT_CONFIRMED" : "FORM_SUBMIT_NOT_CONFIRMED", { afterState:userMessageState(), page:pageDiagnostic() });
          if (confirmed) {
            await reportStage(job.jobId, "MESSAGE_CONFIRMED", "Mensagem confirmada na conversa. Aguardando o especialista...");
            await reportSent(job.jobId);
            return;
          }
        }
      }

      const fallbackComposer = findComposer();
      if (fallbackComposer && composerText(fallbackComposer)) {
        await reportStage(job.jobId, "SENDING_MESSAGE", "Tentando envio pelo teclado...");
        await reportDiagnostic(job.jobId, "KEYBOARD_SUBMIT", { composer:elementDiagnostic(fallbackComposer), composerLength:composerText(fallbackComposer).length });
        submitWithEnter(fallbackComposer);
        const confirmed = await waitForSendConfirmation(previousState, job.jobId, 75000);
        await reportDiagnostic(job.jobId, confirmed ? "KEYBOARD_SUBMIT_CONFIRMED" : "KEYBOARD_SUBMIT_NOT_CONFIRMED", { afterState:userMessageState(), page:pageDiagnostic() });
        if (confirmed) {
          await reportStage(job.jobId, "MESSAGE_CONFIRMED", "Mensagem confirmada na conversa. Aguardando o especialista...");
          await reportSent(job.jobId);
          return;
        }
      }

            if (composerText(findComposer()).includes(job.jobId)) {
        await reportStage(job.jobId, "SEND_PENDING_RECOVERY", "A solicitação continua no editor. O Bridge vai retomar desta mesma aba sem recriar o pacote.");
      }
      throw new Error("GPT_SEND_NOT_CONFIRMED");
    } catch (error) {
      await reportDiagnostic(job?.jobId, "SEND_PROMPT_ERROR", { error:String(error?.message || error || "GPT_SEND_FAILED"), stack:shortText(error?.stack || "", 700), page:pageDiagnostic() });
      throw error;
    } finally {
      busy = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CORVO_BRIDGE_PING") {
      chrome.runtime.sendMessage({ type: "CORVO_GPT_READY" }).catch(() => {});
      sendResponse({ ok: true, version:"0.6.36", page:pageDiagnostic() });
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
    if (message?.type === "CORVO_CHECK_CHAT_EXISTS") {
      checkCurrentConversationExists(message.payload || {})
        .then(sendResponse)
        .catch((error) => sendResponse({ ok:false, error:error.message || "CONVERSATION_CHECK_FAILED" }));
      return true;
    }
    if (message?.type === "CORVO_VERIFY_CHAT_DELETED") {
      verifyCurrentConversationDeleted(message.payload || {})
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message || "DELETE_VERIFY_FAILED" }));
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
