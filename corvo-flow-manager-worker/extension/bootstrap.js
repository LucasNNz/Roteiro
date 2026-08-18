(() => {
  'use strict';
  async function bind() {
    try {
      const url = new URL(location.href);
      if (url.pathname !== '/worker-bootstrap') return;
      const profileId = url.searchParams.get('profileId') || '';
      const token = url.searchParams.get('token') || '';
      const managerBase = `${url.protocol}//${url.host}`;
      if (!profileId || !token) return;
      const result = await chrome.runtime.sendMessage({
        type: 'FLOW_MANAGER_BIND_PROFILE',
        profileId,
        token,
        managerBase
      });
      const status = document.getElementById('corvo-bootstrap-status');
      if (status) status.textContent = result?.ok
        ? `Perfil ${profileId} vinculado ao Worker. Aguardando o Flow...`
        : `Falha ao vincular: ${result?.error || 'erro desconhecido'}`;
      if (result?.ok) setTimeout(() => window.close(), 900);
    } catch (e) {
      const status = document.getElementById('corvo-bootstrap-status');
      if (status) status.textContent = `Falha ao vincular: ${String(e?.message || e)}`;
    }
  }
  bind();
})();
