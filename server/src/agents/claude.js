// Adaptador de Claude Code. Cada agente exporta esta misma forma (ver agents/index.js).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { summaryPrompt } from '../voice/persona.js';
import path from 'node:path';
import fs from 'node:fs';

const run = promisify(execFile);
const bin = (cfg = {}) => cfg.bin || process.env.CLAUDE_BIN || 'claude';
const modelArgs = (cfg = {}) => (cfg.model ? ['--model', cfg.model] : []);

export default {
  id: 'claude',
  label: 'Claude Code',
  bin,
  versionArgs: ['--version'],
  installHint: 'Instala Claude Code (npm i -g @anthropic-ai/claude-code) o indica la ruta del binario.',

  /** Campos configurables que el onboarding pinta como formulario. */
  fields: [
    { key: 'bin', label: 'Binario', placeholder: 'claude', help: 'Nombre en el PATH o ruta absoluta. Vacío = "claude".' },
    { key: 'model', label: 'Modelo (opcional)', placeholder: 'por defecto de Claude Code', help: 'Alias (sonnet, opus…) o id completo.' },
  ],

  /** Argumentos para lanzar un prompt; con sessionId reanuda esa sesión. */
  buildArgs({ prompt, sessionId, config }) {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose',
      '--dangerously-skip-permissions', ...modelArgs(config)];
    if (sessionId) args.push('--resume', sessionId);
    return args;
  },

  /** Comando que inicia sesión: imprime una URL y luego espera un código pegado por stdin. */
  loginArgs: ['auth', 'login'],

  /** Id de sesión reanudable que aparece en una línea de salida ya parseada (o null). */
  sessionIdFrom: (obj) => obj?.session_id || null,

  /** ¿Hay sesión iniciada? -> { loggedIn, method?, plan?, loginCommand } */
  async auth(config) {
    const loginCommand = `${bin(config)} auth login`;
    let out;
    try {
      ({ stdout: out } = await run(bin(config), ['auth', 'status'], { timeout: 15_000 }));
    } catch (e) {
      out = e.stdout; // sin sesión suele salir con código ≠ 0 pero imprime JSON
      if (!out) return { loggedIn: false, error: (e.message || '').split('\n')[0], loginCommand };
    }
    try {
      const s = JSON.parse(out);
      return { loggedIn: !!s.loggedIn, method: s.authMethod, plan: s.subscriptionType, email: s.email, loginCommand };
    } catch {
      return { loggedIn: false, error: 'Respuesta no reconocida de `auth status`', loginCommand };
    }
  },

  /**
   * Uso de la cuenta activa: % de la sesión (ventana de 5 h) y de la semana, con su hora de reinicio.
   * Lee el token OAuth que guarda Claude Code y consulta el endpoint de uso de Anthropic (no documentado
   * oficialmente: si cambia, la cabecera muestra "no disponible"). Lanza Error con un motivo legible.
   */
  async usage(config) {
    const file = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), '.credentials.json');
    let oauth;
    try { oauth = JSON.parse(fs.readFileSync(file, 'utf8')).claudeAiOauth; } catch { /* sin fichero */ }
    if (!oauth?.accessToken) throw new Error('No se encontraron credenciales de Claude en este equipo');
    if (oauth.expiresAt && oauth.expiresAt < Date.now()) throw new Error('La sesión de Claude ha caducado; se renueva al usar Claude Code');
    const r = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${oauth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(r.status === 429 ? 'Demasiadas consultas de uso; se reintentará' : `El servicio de uso respondió ${r.status}`);
    const u = await r.json();
    const win = (w) => (w && typeof w.utilization === 'number'
      ? { percent: Math.round(w.utilization), resetsAt: w.resets_at ? Date.parse(w.resets_at) : null } : null);
    const session = win(u.five_hour), week = win(u.seven_day);
    if (!session && !week) throw new Error('Respuesta de uso no reconocida');
    const auth = await this.auth(config).catch(() => ({}));
    return { account: auth.email || null, plan: oauth.subscriptionType || auth.plan || null, session, week };
  },

  /**
   * Ejecuta una orden del asistente de Orquestrator: Claude SIN herramientas propias (nada de archivos
   * ni shell) y solo con el servidor MCP indicado. Devuelve { reply, sessionId }.
   */
  async assistant({ text, config, mcpServers, system, sessionId }) {
    const args = ['-p', text, '--output-format', 'json', '--tools', '',
      '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers }),
      '--allowedTools', ...Object.keys(mcpServers).map((n) => `mcp__${n}`),
      '--append-system-prompt', system, ...modelArgs(config)];
    if (sessionId) args.push('--resume', sessionId);
    const { stdout } = await run(bin(config), args, { cwd: os.tmpdir(), timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
    const r = JSON.parse(stdout);
    if (r.is_error) throw new Error(r.result || 'El asistente devolvió un error');
    return { reply: String(r.result || '').trim(), sessionId: r.session_id || null };
  },

  /** Resumen de una frase, pensado para leerse en voz alta (modelo barato, sin herramientas). */
  async summarize({ text, config }) {
    const prompt = summaryPrompt(text);
    const model = config?.model ? [] : ['--model', 'haiku'];
    const { stdout } = await run(bin(config), ['-p', prompt, '--output-format', 'json', '--tools', '', ...model, ...modelArgs(config)],
      { cwd: os.tmpdir(), timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
    const r = JSON.parse(stdout);
    if (r.is_error) throw new Error(r.result || 'error al resumir');
    return String(r.result || '').trim();
  },

  /** Prueba real extremo a extremo: un prompt mínimo fuera de cualquier repo. */
  async test(config) {
    const t0 = Date.now();
    try {
      const { stdout } = await run(bin(config),
        ['-p', 'Responde solo con la palabra OK', '--output-format', 'json', ...modelArgs(config)],
        { cwd: os.tmpdir(), timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
      const r = JSON.parse(stdout);
      if (r.is_error) return { ok: false, error: r.result || 'Claude devolvió un error' };
      return { ok: true, reply: String(r.result || '').trim().slice(0, 200), ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: (e.stderr || e.message || '').toString().trim().split('\n')[0] };
    }
  },
};
