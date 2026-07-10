// Service worker : relaie les demandes d'analyse du content script vers le
// document offscreen (qui héberge Stockfish), et les résultats en sens inverse.

let creatingOffscreen = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (contexts.length > 0) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["WORKERS"],
        justification:
          "Exécuter le moteur d'échecs Stockfish (WebAssembly) dans un Web Worker",
      })
      .catch((err) => {
        // Une création concurrente peut avoir gagné la course : ignorer.
        if (!String(err).includes("Only a single offscreen")) throw err;
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

// Onglet ayant émis la dernière demande d'analyse (une partie à la fois).
let lastTabId = null;

function reportToTab(payload) {
  if (lastTabId == null) return;
  chrome.tabs.sendMessage(lastTabId, payload).catch(() => {
    // L'onglet a pu être fermé entre-temps.
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.target) return;

  if (msg.target === "background" && msg.type === "analyze") {
    if (sender.tab) lastTabId = sender.tab.id;
    sendResponse({ ok: true }); // accusé de réception pour le diagnostic côté content
    ensureOffscreen()
      .then(() => {
        chrome.runtime.sendMessage({
          target: "offscreen",
          type: "analyze",
          fen: msg.fen,
          depth: msg.depth,
        });
      })
      .catch((err) => {
        reportToTab({
          target: "content",
          type: "engine-error",
          message: "offscreen: " + String(err && err.message ? err.message : err),
        });
      });
  } else if (msg.target === "content") {
    reportToTab(msg);
  }
});
