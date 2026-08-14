(() => {
  let busy = false;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function findComposer() {
    const selectors = [
      "#prompt-textarea",
      '[data-testid="prompt-textarea"]',
      "textarea[placeholder]",
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

  function findSendButton() {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send"]',
      'button[aria-label="Enviar prompt"]',
      'button[aria-label="Enviar"]'
    ];
    for (const selector of selectors) {
      const found = [...document.querySelectorAll(selector)].find((el) => isVisible(el) && !el.disabled);
      if (found) return found;
    }
    return [...document.querySelectorAll("button")].filter(isVisible).find((btn) => {
      if (btn.disabled) return false;
      const text = [btn.getAttribute("aria-label") || "", btn.getAttribute("title") || "", btn.textContent || ""].join(" ").toLowerCase();
      return /\b(send|enviar)\b/.test(text);
    }) || null;
  }

  function setComposerText(el, text) {
    el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text); else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    el.replaceChildren();
    const p = document.createElement("p");
    p.textContent = text;
    el.appendChild(p);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }

  function compose(job) {
    const lines = [
      `CORVO_BRIDGE_JOB: ${job.jobId}`,
      `ESPECIALISTA: ${job.specialist || "SCOUT"}`,
      "",
      "Execute a solicitação abaixo normalmente usando suas instruções e ferramentas.",
      "Ao concluir, envie o resultado completo para a Action de retorno do CorvoQuiz usando exatamente este JOB_ID.",
      "Não dependa de eu copiar ou selecionar a mensagem na interface.",
      "",
      "SOLICITAÇÃO DO APP:",
      job.prompt
    ];
    if (job.meta && Object.keys(job.meta).length) lines.push("", "CONTEXTO DO APP:", JSON.stringify(job.meta));
    return lines.join("\n");
  }

  async function waitForComposer(timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const composer = findComposer();
      if (composer) return composer;
      await sleep(300);
    }
    throw new Error("COMPOSER_NOT_FOUND");
  }

  async function sendPrompt(job) {
    if (busy) throw new Error("BRIDGE_BUSY");
    busy = true;
    try {
      const composer = await waitForComposer();
      setComposerText(composer, compose(job));
      await sleep(500);
      const btn = findSendButton();
      if (btn) btn.click();
      else composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      await sleep(700);
      chrome.runtime.sendMessage({ type: "CORVO_GPT_SENT", payload: { jobId: job.jobId } }).catch(() => {});
    } catch (error) {
      chrome.runtime.sendMessage({ type: "CORVO_GPT_ERROR", payload: { jobId: job.jobId, message: error.message || "Falha ao enviar ao GPT." } }).catch(() => {});
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
      sendPrompt(message.payload).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
  });

  chrome.runtime.sendMessage({ type: "CORVO_GPT_READY", payload: { href: location.href } }).catch(() => {});
})();
