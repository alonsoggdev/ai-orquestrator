import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectAgents } from './agents/index.js';

const run = promisify(execFile);

async function version(name, bin, hint) {
  try {
    const { stdout } = await run(bin, ['--version'], { timeout: 10_000 });
    return { name, ok: true, version: stdout.trim().split('\n')[0], hint };
  } catch (e) {
    return { name, ok: false, error: e.code === 'ENOENT' ? 'No encontrado en el PATH' : (e.message || '').split('\n')[0], hint };
  }
}

/** Herramientas base (git, node) y agentes de código disponibles. Hace falta al menos un agente. */
export async function checkRequirements() {
  const [tools, agents] = await Promise.all([
    Promise.all([
      version('git', 'git', 'Instálalo con tu gestor de paquetes (apt install git).'),
      version('node', process.execPath, 'Node 20 o superior.'),
    ]),
    detectAgents(),
  ]);
  const problems = tools.filter((t) => !t.ok).map((t) => t.name);
  if (!agents.some((a) => a.ready)) problems.push('un agente instalado y con sesión iniciada (p. ej. Claude Code)');
  return { tools, agents, ready: problems.length === 0, problems };
}

