// Registro de agentes. Para añadir uno nuevo: crea agents/<id>.js con la misma forma que
// claude.js, impórtalo aquí, y añade su renderizador en web/src/agents/.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { q } from '../db.js';
import claude from './claude.js';

const run = promisify(execFile);
const agents = Object.fromEntries([claude].map((a) => [a.id, a]));

export const DEFAULT_AGENT = 'claude';
export const listAgents = () => Object.values(agents);
export const getAgent = (id) => {
  const a = agents[id || DEFAULT_AGENT];
  if (!a) throw new Error(`Agente desconocido: ${id}`);
  return a;
};

// Config por agente en la tabla settings: clave `agent.<id>.<campo>`.
export function getConfig(id) {
  const cfg = {};
  for (const f of getAgent(id).fields) cfg[f.key] = q.getSetting.get(`agent.${id}.${f.key}`)?.value || '';
  return cfg;
}
export function setConfig(id, values = {}) {
  for (const f of getAgent(id).fields) {
    if (f.key in values) q.setSetting.run(`agent.${id}.${f.key}`, String(values[f.key] ?? '').trim());
  }
  return getConfig(id);
}

/** Estado completo de un agente: instalado, versión, sesión iniciada y config actual. */
export async function agentStatus(id) {
  const a = getAgent(id);
  const config = getConfig(id);
  const base = {
    id: a.id, label: a.label, fields: a.fields, config,
    bin: a.bin(config), hint: a.installHint,
  };
  try {
    const { stdout } = await run(a.bin(config), a.versionArgs, { timeout: 10_000 });
    const auth = await a.auth(config);
    return { ...base, ok: true, version: stdout.trim().split('\n')[0], auth, ready: auth.loggedIn };
  } catch (e) {
    return { ...base, ok: false, ready: false, error: e.code === 'ENOENT' ? 'No encontrado en el PATH' : (e.message || '').split('\n')[0] };
  }
}

// ---- Inicio de sesión guiado: el agente imprime una URL y espera un código por stdin ----
const logins = new Map(); // agentId -> { child, output }

export function cancelLogin(id) {
  logins.get(id)?.child.kill('SIGTERM');
  logins.delete(id);
}

/** Lanza el login y devuelve la URL que el usuario debe abrir. */
export function startLogin(id) {
  const a = getAgent(id);
  if (!a.loginArgs) throw new Error('Este agente no soporta inicio de sesión guiado');
  cancelLogin(id);
  const child = spawn(a.bin(getConfig(id)), a.loginArgs, {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none' },
  });
  const entry = { child, output: '' };
  logins.set(id, entry);
  child.on('close', () => { if (logins.get(id) === entry) logins.delete(id); });
  child.on('error', () => logins.delete(id));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cancelLogin(id); reject(new Error('No se obtuvo el enlace de inicio de sesión')); }, 20_000);
    const onData = (c) => {
      entry.output += c.toString('utf8');
      const m = entry.output.match(/https?:\/\/\S+/);
      if (m) { clearTimeout(timer); resolve({ url: m[0] }); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/** Entrega el código que muestra la web de inicio de sesión y espera a que termine el proceso. */
export function submitLoginCode(id, code) {
  const entry = logins.get(id);
  if (!entry) throw new Error('No hay un inicio de sesión en curso. Vuelve a pulsar "Conectar cuenta".');
  const clean = String(code || '').trim();
  if (!clean) throw new Error('Pega el código que te mostró la página');
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cancelLogin(id); resolve({ ok: false, error: 'El código no fue aceptado o ha caducado. Inténtalo de nuevo.' }); }, 30_000);
    entry.child.on('close', (exit) => { clearTimeout(timer); resolve({ ok: exit === 0, error: exit === 0 ? null : 'El código no fue aceptado. Inténtalo de nuevo.' }); });
    entry.child.stdin.write(`${clean}\n`);
  });
}

export const detectAgents = () => Promise.all(listAgents().map((a) => agentStatus(a.id)));
