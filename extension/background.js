chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
chrome.runtime.onStartup.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

let authCache = { at: 0, ok: false };

async function serverAuthOK() {
  const s = await chrome.storage.session.get({ token: '', apiBase: '' });
  if (!s.token || !s.apiBase) return false;
  if (authCache.ok && Date.now() - authCache.at < 30000) return true;
  try {
    const r = await fetch(String(s.apiBase).replace(/\/$/, '') + '/me', {
      headers: { Authorization: 'Bearer ' + s.token },
      cache: 'no-store'
    });
    authCache = { at: Date.now(), ok: r.ok };
    if (!r.ok) {
      await chrome.storage.session.set({ token: '', user: null });
    }
    return r.ok;
  } catch (_) {
    // If the server cannot be reached, fail closed: no LINE insertion.
    authCache = { at: Date.now(), ok: false };
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'CDP_INSERT_TEXT') return;
  (async () => {
    if (!(await serverAuthOK())) {
      sendResponse({ ok: false, error: 'AUTH_REQUIRED' });
      return;
    }
    const tabId = sender?.tab?.id;
    if (!tabId) { sendResponse({ ok: false, error: 'NO_TAB' }); return; }
    let attached = false;
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      attached = true;
      await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', {
        text: String(msg.text ?? '')
      });
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    } finally {
      if (attached) {
        try { await chrome.debugger.detach({ tabId }); } catch (_) {}
      }
    }
  })();
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && (changes.token || changes.apiBase)) authCache = { at: 0, ok: false };
});
