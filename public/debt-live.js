// Only the live local page loads this transport. Static exports omit the file.
document.getElementById('run').addEventListener('click', async () => {
  const button = document.getElementById('run');
  const view = globalThis.cancellationDebtView;
  button.disabled = true;
  view.setStatus('running');
  try {
    const response = await fetch('/experiment', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    if (!response.ok) { view.setStatus(response.status === 409 ? 'busy' : 'error'); return; }
    view.setReport(await response.json());
  } catch { view.setStatus('error'); }
  finally { button.disabled = false; }
});
