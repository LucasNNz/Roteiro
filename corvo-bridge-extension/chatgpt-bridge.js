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

  async function sendPrompt(job) {
    if (busy) throw new Error("BRIDGE_BUSY");
    busy = true;
    try {
      const composer = await waitForComposer();
      const message = compose(job);
      const previousState = userMessageState();
      setComposerText(composer, message);

      const fillDeadline = Date.now() + 4000;
      while (Date.now() < fillDeadline && !composerText(findComposer()).includes(job.jobId)) await sleep(150);
      if (!composerText(findComposer()).includes(job.jobId)) throw new Error("COMPOSER_FILL_FAILED");

      const buttons = await waitForEnabledButtons(findComposer());
      for (const button of buttons) {
        if (!isEnabled(button)) continue;
        clickButton(button);
        if (await waitForSendConfirmation(previousState, job.jobId, 3500)) {
          await chrome.runtime.sendMessage({ type: "CORVO_GPT_SENT", payload: { jobId: job.jobId } }).catch(() => {});
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
            await chrome.runtime.sendMessage({ type: "CORVO_GPT_SENT", payload: { jobId: job.jobId } }).catch(() => {});
            return;
          }
        }
      }

      const fallbackComposer = findComposer();
      if (fallbackComposer && composerText(fallbackComposer)) {
        submitWithEnter(fallbackComposer);
        if (await waitForSendConfirmation(previousState, job.jobId)) {
          await chrome.runtime.sendMessage({ type: "CORVO_GPT_SENT", payload: { jobId: job.jobId } }).catch(() => {});
          return;
        }
      }

      throw new Error("GPT_SEND_FAILED");
    } catch (error) {
      const message = error?.message || "GPT_SEND_FAILED";
      await chrome.runtime.sendMessage({ type: "CORVO_GPT_ERROR", payload: { jobId: job.jobId, message } }).catch(() => {});
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
  });

  chrome.runtime.sendMessage({ type: "CORVO_GPT_READY", payload: { href: location.href } }).catch(() => {});
})();
