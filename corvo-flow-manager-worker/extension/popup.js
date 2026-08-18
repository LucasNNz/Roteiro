document.getElementById('togglePanel').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const flowTab = tabs.find(tab => /^(https:\/\/)?(labs\.google|flow\.google\.com)\//i.test(tab.url || ''));
  if (!flowTab?.id) {
    document.querySelector('p').textContent = 'Nenhuma aba do Google Flow foi encontrada nesta janela.';
    return;
  }
  try {
    await chrome.tabs.sendMessage(flowTab.id, { type: 'FLOW_BATCH_TOGGLE_PANEL' });
    await chrome.tabs.update(flowTab.id, { active: true });
    window.close();
  } catch (error) {
    document.querySelector('p').textContent = 'Atualize a aba do Flow e tente novamente.';
  }
});
