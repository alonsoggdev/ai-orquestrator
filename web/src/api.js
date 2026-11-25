async function req(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { code: data.code });
  return data;
}
export const api = {
  setup: () => req('GET', '/api/setup'),
  saveAgentConfig: (id, cfg) => req('PUT', `/api/agents/${id}/config`, cfg),
  startLogin: (id) => req('POST', `/api/agents/${id}/login`),
  submitLoginCode: (id, code) => req('POST', `/api/agents/${id}/login/code`, { code }),
  testAgent: (id) => req('POST', `/api/agents/${id}/test`),
  completeSetup: () => req('POST', '/api/setup/complete'),
  projects: () => req('GET', '/api/projects'),
  assistant: (text, reset = false, fromVoice = false) => req('POST', '/api/assistant', { text, reset, fromVoice }),
  listFolders: (path) => req('GET', `/api/fs/list${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  createProject: (b) => req('POST', '/api/projects', b),
  renameProject: (id, name) => req('PUT', `/api/projects/${id}`, { name }),
  deleteProject: (id) => req('DELETE', `/api/projects/${id}`),
  list: () => req('GET', '/api/tasks'),
  create: (b) => req('POST', '/api/tasks', b),
  cont: (id, prompt) => req('POST', `/api/tasks/${id}/continue`, { prompt }),
  stop: (id) => req('POST', `/api/tasks/${id}/stop`),
  diff: (id) => req('GET', `/api/tasks/${id}/diff`),
  merge: (id) => req('POST', `/api/tasks/${id}/merge`),
  discard: (id) => req('POST', `/api/tasks/${id}/discard`),
  remove: (id) => req('DELETE', `/api/tasks/${id}`),
};

/** WebSocket con reconexión automática. */
export function connectWS({ onMessage, onOpen }) {
  let ws, closed = false, timer;
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => onOpen?.();
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => { if (!closed) timer = setTimeout(open, 1000); };
  };
  open();
  return {
    send: (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m)),
    close: () => { closed = true; clearTimeout(timer); ws?.close(); },
  };
}
