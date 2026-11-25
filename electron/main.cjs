// Envoltorio Electron: arranca el servidor con el `node` del sistema (así better-sqlite3
// no necesita recompilarse para el ABI de Electron) y abre el panel en una ventana propia.
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const PORT = process.env.PORT || '3737';
const ROOT = path.resolve(__dirname, '..');
let server = null;
let win = null;

function startServer() {
  server = spawn(process.env.NODE_BIN || 'node', [path.join(ROOT, 'server/src/index.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT },
    stdio: 'inherit',
  });
  server.on('exit', (code) => {
    server = null;
    if (!app.isQuitting) { console.error(`servidor terminó (${code})`); app.quit(); }
  });
}

function waitForServer(retries = 60) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      http.get({ host: '127.0.0.1', port: PORT, path: '/api/tasks' }, (res) => { res.resume(); resolve(); })
        .on('error', () => (n <= 0 ? reject(new Error('El servidor no arrancó')) : setTimeout(() => attempt(n - 1), 250)));
    };
    attempt(retries);
  });
}

async function createWindow() {
  await waitForServer();
  win = new BrowserWindow({
    width: 1400, height: 900, title: 'Orquestrator', backgroundColor: '#000',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL(`http://127.0.0.1:${PORT}`);
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { startServer(); return createWindow(); })
    .catch((e) => { console.error(e); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { app.isQuitting = true; server?.kill('SIGTERM'); });
}
