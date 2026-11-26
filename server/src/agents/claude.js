// Adaptador de Claude Code. Cada agente exporta esta misma forma (ver agents/index.js).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { summaryPrompt } from '../voice/persona.js';

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
      return { loggedIn: !!s.loggedIn, method: s.authMethod, plan: s.subscriptionType, loginCommand };
    } catch {
      return { loggedIn: false, error: 'Respuesta no reconocida de `auth status`', loginCommand };
    }
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
