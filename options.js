// options.js
document.getElementById('save').addEventListener('click', () => {
  const deepgramKey = document.getElementById('deepgramKey').value.trim();
  const chromeAiNotes = document.getElementById('chromeAiNotes').value.trim();
  chrome.storage.local.set({ deepgramKey, chromeAiNotes }, () => {
    document.getElementById('status').innerText = 'Saved';
  });
});

// Load existing
chrome.storage.local.get(['deepgramKey','chromeAiNotes'], (s) => {
  if (s.deepgramKey) document.getElementById('deepgramKey').value = s.deepgramKey;
  if (s.chromeAiNotes) document.getElementById('chromeAiNotes').value = s.chromeAiNotes;
});