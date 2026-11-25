import { spawn } from 'node:child_process';
import { q } from './db.js';
import { autoCommit } from './git.js';
import { getAgent, getConfig } from './agents/index.js';

const procs = new Map();           // taskId -> ChildProcess
const listeners = new Set();       // (msg) => void ; msg = {type:'task'|'event', ...}

export const onMessage = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = (msg) => listeners.forEach((fn) => fn(msg));

export const isRunning = (id) => procs.has(id);

export function addEvent(taskId, kind, data) {
  const seq = q.nextSeq.get(taskId).n;
  const ts = Date.now();
  q.insertEvent.run(taskId, seq, kind, data, ts);
  emit({ type: 'event', taskId, event: { seq, kind, data, ts } });
}

function setStatus(id, status, extra = {}) {
  q.setStatus.run({
    id, status, exit_code: extra.exit_code ?? null, error: extra.error ?? null,
    finished_at: status === 'running' ? null : Date.now(),
  });
  emit({ type: 'task', task: q.getTask.get(id) });
}

/** Lanza (o reanuda con sessionId) Claude Code dentro del worktree de la tarea. */
export function startRun(task, prompt, { resume = false } = {}) {
  const agent = getAgent(task.agent);
  const config = getConfig(task.agent);
  const args = agent.buildArgs({ prompt, sessionId: resume ? task.session_id : null, config });

  addEvent(task.id, 'prompt', prompt);
  setStatus(task.id, 'running');

  const child = spawn(agent.bin(config), args, {
    cwd: task.worktree_path,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  procs.set(task.id, child);

  let buf = '';
  const handleLine = (line) => {
    if (!line.trim()) return;
    try {
      const obj = JSON.parse(line);
      const sid = agent.sessionIdFrom(obj);
      if (sid && sid !== q.getTask.get(task.id).session_id) q.setSession.run(sid, task.id);
      if (obj.type === 'result' && obj.result) lastResult = obj.result;
      addEvent(task.id, 'json', line);
    } catch {
      addEvent(task.id, 'stderr', line); // salida no-JSON: la mostramos tal cual
    }
  };
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      handleLine(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  });
  child.stdout.on('end', () => handleLine(buf));
  child.stderr.on('data', (c) => addEvent(task.id, 'stderr', c.toString('utf8')));

  let finished = false;
  const finish = async (status, extra) => {
    if (finished) return;
    finished = true;
    procs.delete(task.id);
    if (status === 'done') {
      try { await autoCommit(task.worktree_path, `tarea ${task.name}`); }
      catch (e) { addEvent(task.id, 'system', `autocommit falló: ${e.message}`); }
    }
    setStatus(task.id, status, extra);
    announce(status);
  };

  // Resumen hablado de lo que ha hecho el asistente: se guarda en el log y se avisa a las ventanas.
  const announce = async (status) => {
    let text;
    try {
      if (status === 'done' && lastResult) text = await agent.summarize({ text: lastResult, config });
      else if (status === 'error') text = `La tarea ${task.name} ha fallado.`;
      if (!text) return;
      addEvent(task.id, 'voice', text);
      emit({ type: 'speak', taskId: task.id, name: task.name, text });
    } catch { /* el resumen es opcional */ }
  };
  let lastResult = '';
  child.on('error', (e) => finish('error', { error: e.message }));
  child.on('close', (code, signal) => {
    if (signal) finish('error', { exit_code: code, error: `terminado por ${signal}` });
    else finish(code === 0 ? 'done' : 'error', { exit_code: code });
  });
}

export function stopRun(id) {
  procs.get(id)?.kill('SIGTERM');
}

/** Al arrancar el servidor, las tareas "running" huérfanas pasan a error. */
export function recoverOrphans() {
  for (const t of q.listTasks.all()) {
    if (t.status === 'running') {
      addEvent(t.id, 'system', 'El servidor se reinició mientras la tarea corría.');
      setStatus(t.id, 'error', { error: 'servidor reiniciado' });
    }
  }
}
