// Popup de l'extension : réglages (on/off, niveau) écrits dans
// chrome.storage.local — le content script les applique en direct via
// chrome.storage.onChanged, pas besoin de recharger la page.

const levelSel = document.getElementById("level");
const enabledBox = document.getElementById("enabled");

SFA_LEVEL_ORDER.forEach((key) => {
  const opt = document.createElement("option");
  opt.value = key;
  opt.textContent = SFA_LEVELS[key].label;
  levelSel.appendChild(opt);
});

chrome.storage.local.get({ enabled: true, level: "max" }, (v) => {
  enabledBox.checked = Boolean(v.enabled);
  levelSel.value = sfaNormalizeLevel(v.level);
});

levelSel.addEventListener("change", () => {
  chrome.storage.local.set({ level: sfaNormalizeLevel(levelSel.value) });
});

enabledBox.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabledBox.checked });
});
