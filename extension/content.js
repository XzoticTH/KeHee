(() => {
  if (window.__LINE_OA_QR_V16__) return;
  window.__LINE_OA_QR_V16__ = true;

  const SELECTORS = [
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[role="textbox"]',
    'textarea',
    'input:not([type="hidden"]):not([type="file"])'
  ];

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  }

  function collect(root = document) {
    const out = [];
    const walk = node => {
      if (!node?.querySelectorAll) return;
      try { node.querySelectorAll(SELECTORS.join(',')).forEach(e => out.push(e)); } catch (_) {}
      try {
        node.querySelectorAll('*').forEach(e => { if (e.shadowRoot) walk(e.shadowRoot); });
      } catch (_) {}
    };
    walk(root);
    return [...new Set(out)].filter(visible);
  }

  function score(el) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    let n = 0;
    if (el.isContentEditable || el.getAttribute('contenteditable') !== null) n += 120;
    if (el.getAttribute('role') === 'textbox') n += 60;
    const meta = [
      el.getAttribute('placeholder'), el.getAttribute('aria-label'),
      el.getAttribute('data-placeholder'), el.getAttribute('data-testid'),
      el.getAttribute('name'), typeof el.className === 'string' ? el.className : ''
    ].join(' ').toLowerCase();
    if (/enter|message|ข้อความ|chat|reply|composer|editor|input|พิมพ์/.test(meta)) n += 150;
    if (r.bottom > innerHeight - 280) n += 100;
    if (r.top > innerHeight * 0.50) n += 40;
    if (r.width > 250) n += 40;
    if (r.height >= 35) n += 10;
    if (s.position === 'fixed' || s.position === 'sticky') n += 10;
    return n;
  }

  function pickEditor() {
    return collect().sort((a, b) => score(b) - score(a))[0] || null;
  }

  function readText(el) {
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') return String(el.value || '');
    return String(el.innerText || el.textContent || '');
  }

  function prepareSelection(el) {
    el.focus({ preventScroll: true });
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') {
      try {
        el.setSelectionRange(0, String(el.value || '').length);
      } catch (_) {}
      return;
    }
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function prepareCaretEnd(el) {
    el.focus({ preventScroll: true });
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') {
      try {
        const len = String(el.value || '').length;
        el.setSelectionRange(len, len);
      } catch (_) {}
      return;
    }
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function highlight(el) {
    const old = el.style.outline;
    el.style.outline = '3px solid #e11';
    setTimeout(() => { if (el.isConnected) el.style.outline = old; }, 1500);
  }

  async function insertAsRealBrowserText(el, text) {
    prepareSelection(el);

    // This is the key change from V14/V15: do NOT set textContent/value and
    // do NOT dispatch a fake input event. Let Chrome perform the edit at the
    // browser input layer so LINE's own editor/state handler receives it.
    const result = await chrome.runtime.sendMessage({
      type: 'CDP_INSERT_TEXT',
      text
    });

    if (!result?.ok) {
      return { ok: false, error: result?.error || 'CDP_INSERT_TEXT_FAILED' };
    }

    const actual = readText(el).replace(/\u00a0/g, ' ');
    const wanted = String(text).replace(/\u00a0/g, ' ');
    return { ok: actual.trim() === wanted.trim(), actual, wanted };
  }


  // Calculator: watch the same LINE editor used by Quick Reply. When the user
  // finishes a simple + / - expression with '=', append the result as real
  // browser input. We never press Send/Enter automatically.
  let calcEnabled = false;
  let calcBusy = false;
  let lastCalculated = '';

  async function loadCalcSetting() {
    try {
      const r = await chrome.storage.local.get({ calcEnabled: false });
      calcEnabled = !!r.calcEnabled;
    } catch (_) {}
  }

  function normalizeCalcText(s) {
    return String(s || '').replace(/\u00a0/g, ' ').replace(/[×xX]/g, '*').trim();
  }

  function evaluatePlusMinus(expr) {
    const clean = expr.replace(/\s+/g, '');
    if (!/^\d+(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)+$/.test(clean)) return null;
    const nums = clean.match(/[+-]?\d+(?:\.\d+)?/g);
    if (!nums || nums.length < 2) return null;
    let total = Number(nums[0]);
    for (let i = 1; i < nums.length; i++) total += Number(nums[i]);
    if (!Number.isFinite(total)) return null;
    return Number.isInteger(total) ? String(total) : String(Number(total.toFixed(10)));
  }

  function findTrailingExpression(text) {
    const clean = normalizeCalcText(text);
    const m = clean.match(/(\d+(?:\.\d+)?(?:\s*[+-]\s*\d+(?:\.\d+)?)+)\s*=\s*$/);
    if (!m) return null;
    return { expression: m[1], answer: evaluatePlusMinus(m[1]) };
  }

  async function tryCalculateFromEditor(el) {
    if (!calcEnabled || calcBusy || !el || !visible(el)) return;
    const text = readText(el);
    const found = findTrailingExpression(text);
    if (!found?.answer) return;
    const marker = `${found.expression}=${found.answer}`;
    if (lastCalculated === marker) return;

    // Do not duplicate if the answer is already present after '='.
    const tail = normalizeCalcText(text).slice(-80);
    if (new RegExp(`=\\s*\\*?${found.answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*?$`).test(tail)) {
      lastCalculated = marker;
      return;
    }

    calcBusy = true;
    try {
      // Calculator must APPEND the answer, not replace the whole message.
      // Quick Reply intentionally selects/replaces all text, but calculator
      // always moves the caret to the end before inserting its result.
      prepareCaretEnd(el);
      const result = await chrome.runtime.sendMessage({
        type: 'CDP_INSERT_TEXT',
        text: ` *${found.answer}*`
      });
      if (result?.ok) lastCalculated = marker;
    } catch (_) {
      // Keep Quick Reply working even if calculator insertion fails.
    } finally {
      calcBusy = false;
    }
  }

  function bindCalculatorEditor(el) {
    if (!el || el.__LINE_OA_CALC_BOUND__) return;
    el.__LINE_OA_CALC_BOUND__ = true;
    const onEdit = () => setTimeout(() => tryCalculateFromEditor(el), 0);
    el.addEventListener('input', onEdit, true);
    el.addEventListener('keyup', onEdit, true);
    el.addEventListener('beforeinput', onEdit, true);
    el.addEventListener('compositionend', onEdit, true);
  }

  function scanCalculatorEditors() {
    if (!calcEnabled) return;
    for (const el of collect()) bindCalculatorEditor(el);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.calcEnabled) return;
    calcEnabled = !!changes.calcEnabled.newValue;
    lastCalculated = '';
    if (calcEnabled) {
      scanCalculatorEditors();
      startCalcPolling();
    }
  });

  let calcPollTimer = null;
  async function pollCalculator() {
    if (!calcEnabled || calcBusy) return;
    const editor = pickEditor();
    if (editor) {
      bindCalculatorEditor(editor);
      await tryCalculateFromEditor(editor);
    }
  }

  function startCalcPolling() {
    if (calcPollTimer) return;
    calcPollTimer = setInterval(() => { pollCalculator(); }, 250);
    pollCalculator();
  }

  loadCalcSetting().then(() => {
    if (calcEnabled) {
      scanCalculatorEditors();
      startCalcPolling();
    }
  });

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req?.type !== 'INSERT_QUICK_REPLY') return;

    (async () => {
      const text = String(req.text ?? '');
      if (!text) {
        sendResponse({ ok: false, message: 'ข้อความว่าง' });
        return;
      }

      const editor = pickEditor();
      if (!editor) {
        sendResponse({ ok: false, message: 'ไม่พบช่องพิมพ์ LINE OA' });
        return;
      }

      highlight(editor);
      const result = await insertAsRealBrowserText(editor, text);

      if (result.ok) {
        sendResponse({
          ok: true,
          message: 'ใส่ข้อความแล้ว — ตอนนี้กดปุ่มส่งของ LINE OA ได้เลย',
          tag: editor.tagName,
          role: editor.getAttribute('role'),
          contenteditable: !!editor.isContentEditable,
          actual: result.actual
        });
      } else {
        sendResponse({
          ok: false,
          message: 'LINE ยังไม่รับข้อความเป็นสถานะของช่องพิมพ์',
          error: result.error,
          actual: result.actual,
          wanted: result.wanted,
          tag: editor.tagName,
          role: editor.getAttribute('role')
        });
      }
    })().catch(e => sendResponse({ ok: false, message: String(e?.message || e) }));

    return true;
  });
})();
