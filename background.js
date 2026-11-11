/*
 * Service worker.
 *  - Serves synonyms.json to content scripts.
 *  - Shows the score on the toolbar icon for each tab.
 *  - Manages "opt-in" sites: origins the user enabled from the popup get the
 *    content script registered dynamically (chrome.scripting) — only after the
 *    user grants that single origin via chrome.permissions.request().
 */
'use strict';

const CONTENT_FILES = [
  'config/selectors.js',
  'lib/stopwords.js',
  'lib/skill-terms.js',
  'lib/matcher.js',
  'content/badge.js',
  'content/content.js'
];
const CUSTOM_SCRIPT_ID = 'job-match-custom-sites';
const BAND_COLORS = { red: '#b91c1c', amber: '#b45309', green: '#15803d', none: '#6b7280' };

// ------------------------------------------------------------ synonyms
let synonymsPromise = null;
function getSynonyms() {
  if (!synonymsPromise) {
    synonymsPromise = fetch(chrome.runtime.getURL('lib/synonyms.json'))
      .then((r) => r.json())
      .catch((e) => {
        console.warn('Job Match: could not parse lib/synonyms.json', e);
        synonymsPromise = null;
        return { groups: [] };
      });
  }
  return synonymsPromise;
}

// ------------------------------------------------- opt-in (custom) sites
let syncChain = Promise.resolve();
function syncCustomScripts() {
  // Serialise: overlapping register/unregister calls would throw "duplicate id".
  syncChain = syncChain.then(doSync).catch((e) => console.warn('Job Match: sync failed', e));
  return syncChain;
}

async function doSync() {
  const { customSites = [] } = await chrome.storage.local.get('customSites');
  const granted = [];
  for (const pattern of customSites) {
    if (await chrome.permissions.contains({ origins: [pattern] })) granted.push(pattern);
  }
  if (granted.length !== customSites.length) await chrome.storage.local.set({ customSites: granted });

  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CUSTOM_SCRIPT_ID] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [CUSTOM_SCRIPT_ID] });
  if (granted.length) {
    await chrome.scripting.registerContentScripts([{
      id: CUSTOM_SCRIPT_ID,
      matches: granted,
      js: CONTENT_FILES,
      runAt: 'document_idle',
      persistAcrossSessions: true
    }]);
  }
}

async function enableCustomSite(pattern, tabId) {
  if (!(await chrome.permissions.contains({ origins: [pattern] }))) throw new Error('Permission not granted');
  const { customSites = [] } = await chrome.storage.local.get('customSites');
  if (!customSites.includes(pattern)) await chrome.storage.local.set({ customSites: [...customSites, pattern] });
  await syncCustomScripts();
  if (tabId != null) await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
}

async function disableCustomSite(pattern, tabId) {
  if (tabId != null) await chrome.tabs.sendMessage(tabId, { type: 'teardown' }).catch(() => {});
  if (tabId != null) await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  const { customSites = [] } = await chrome.storage.local.get('customSites');
  await chrome.storage.local.set({ customSites: customSites.filter((p) => p !== pattern) });
  await chrome.permissions.remove({ origins: [pattern] }).catch(() => {});
  await syncCustomScripts();
}

// ------------------------------------------------------------ messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;
  switch (msg.type) {
    case 'getSynonyms':
      getSynonyms().then(sendResponse);
      return true;

    case 'openOptions':
      chrome.runtime.openOptionsPage();
      return false;

    case 'score': {
      const tabId = sender.tab && sender.tab.id;
      if (tabId == null) return false;
      const text = msg.score == null ? '' : String(msg.score);
      chrome.action.setBadgeText({ tabId, text }).catch(() => {});
      chrome.action.setBadgeBackgroundColor({ tabId, color: BAND_COLORS[msg.band] || BAND_COLORS.none }).catch(() => {});
      return false;
    }

    case 'enableCustomSite':
      enableCustomSite(msg.pattern, msg.tabId)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;

    case 'disableCustomSite':
      disableCustomSite(msg.pattern, msg.tabId)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;

    default:
      return false;
  }
});

chrome.runtime.onInstalled.addListener(() => { syncCustomScripts(); });
chrome.runtime.onStartup.addListener(() => { syncCustomScripts(); });
chrome.permissions.onRemoved.addListener(() => { syncCustomScripts(); });
