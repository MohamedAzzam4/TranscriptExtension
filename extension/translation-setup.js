const setupManager = DubTranslationReadiness.createManager();
const params = new URL(location.href).searchParams;
const validLanguage = value => /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value || '');
const pair = { sourceLanguage: params.get('source') || 'de', targetLanguage: params.get('target') || 'en' };
const setupStatus = document.querySelector('#setupStatus');
const setupProgress = document.querySelector('#setupProgress');
const prepareButton = document.querySelector('#prepareTranslation');
document.querySelector('#pair').textContent = `${pair.sourceLanguage} → ${pair.targetLanguage}`;
let setupRevision = 0;
function renderSetup(update) {
  setupStatus.dataset.state = update.state;
  setupStatus.textContent = update.state === 'ready' ? 'Ready. You can close this tab and return to the video.'
    : update.state === 'downloading' ? `Downloading/preparing${update.progress == null ? '…' : ` ${update.progress}%`}`
    : 'Preparing translation…';
  setupProgress.hidden = update.state !== 'downloading';
  if (update.progress == null) setupProgress.removeAttribute('value');
  else setupProgress.value = update.progress;
}
prepareButton.addEventListener('click', () => {
  const revision = ++setupRevision;
  prepareButton.disabled = true;
  // Direct user activation must reach create() before any asynchronous work.
  const preparing = setupManager.prepare(pair, update => { if (revision === setupRevision) renderSetup(update); });
  void preparing.catch(error => {
    if (revision !== setupRevision) return;
    setupStatus.dataset.state = 'failed'; setupStatus.textContent = `Failed: ${error.message}`;
    setupProgress.hidden = true; prepareButton.disabled = false; prepareButton.textContent = 'Retry preparation';
  });
});
async function checkSetup() {
  try {
    if (!validLanguage(pair.sourceLanguage) || !validLanguage(pair.targetLanguage)) throw new Error('Invalid language pair. Reopen setup from the extension.');
    const result = await setupManager.check(pair);
    if (result.state === 'ready') renderSetup(result);
    else if (result.state === 'unavailable') { setupStatus.dataset.state = 'unavailable'; setupStatus.textContent = 'This language pair is unavailable in this browser.'; }
    else {
      const downloading = result.availability === 'downloading';
      setupStatus.dataset.state = downloading ? 'preparing' : 'preparation-required';
      setupStatus.textContent = downloading ? 'Chrome reports preparation in progress. Select Download language resources to follow preparation here.' : 'Preparation required. Select Download language resources to begin.';
      prepareButton.disabled = false;
    }
  } catch (error) {
    setupStatus.dataset.state = 'failed'; setupStatus.textContent = `Failed: ${error.message}`;
    prepareButton.disabled = !validLanguage(pair.sourceLanguage) || !validLanguage(pair.targetLanguage);
    prepareButton.textContent = 'Retry preparation';
  }
}
void checkSetup();
