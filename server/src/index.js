import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { q } from './db.js';
import * as G from './git.js';
import { checkRequirements } from './setup.js';
import { runAssistant } from './assistant.js';
import { sttStatus, prepareStt, transcribe } from './voice/stt.js';
import { ttsStatus, synthesize } from './voice/tts.js';
import { getAgent, getConfig, setConfig, agentStatus, startLogin, submitLoginCode } from './agents/index.js';
import { startRun, stopRun, isRunning, onMessage, recoverOrphans } from './runner.js';

const PORT = Number(process.env.PORT || 3001);
const app = express();
app.use(express.json());

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'tarea';
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(400).json({ error: e.message, code: e.code }));
const userError = (message, code) => Object.assign(new Error(message), { code });
const getTask = (req) => {
  const t = q.getTask.get(req.params.id);
  if (!t) throw new Error('Tarea no encontrada');
  return t;
};

// Onboarding: requisitos del sistema + marca de configuración completada
app.get('/api/setup', wrap(async (_req, res) => {
  res.json({ completed: q.getSetting.get('onboarded')?.value === '1', checks: await checkRequirements() });
}));
app.post('/api/setup/complete', wrap(async (_req, res) => {
  const checks = await checkRequirements();
  if (!checks.ready) throw new Error(`Faltan requisitos: ${checks.problems.join(', ')}`);
  q.setSetting.run('onboarded', '1');
  res.json({ completed: true, checks });
}));

// Configuración de agentes (formulario del onboarding)
app.put('/api/agents/:id/config', wrap(async (req, res) => {
  setConfig(req.params.id, req.body);
  res.json(await agentStatus(req.params.id));
}));
app.post('/api/agents/:id/login', wrap(async (req, res) => res.json(await startLogin(req.params.id))));
app.post('/api/agents/:id/login/code', wrap(async (req, res) => {
  res.json(await submitLoginCode(req.params.id, req.body.code));
}));
app.post('/api/agents/:id/test', wrap(async (req, res) => {
  const a = getAgent(req.params.id);
  res.json(await a.test(getConfig(a.id)));
}));

// ---------- Voz ----------
app.get('/api/voice/status', (_req, res) => res.json({ stt: sttStatus(), tts: ttsStatus() }));
app.post('/api/voice/prepare', wrap(async (_req, res) => {
  // la descarga sigue en segundo plano; el progreso se consulta con /status
  prepareStt().catch((e) => console.error('voz:', e.message));
  res.json(sttStatus());
}));
app.post('/api/voice/transcribe', express.raw({ type: 'application/octet-stream', limit: '40mb' }), wrap(async (req, res) => {
  if (!req.body?.length || req.body.length % 4) throw new Error('Audio no válido');
  const audio = new Float32Array(req.body.buffer.slice(req.body.byteOffset, req.body.byteOffset + req.body.length));
  res.json({ text: await transcribe(audio) });
}));
app.post('/api/voice/speak', wrap(async (req, res) => {
  const wav = await synthesize(String(req.body.text || ''));
  res.type('audio/wav').send(wav);
}));

// ---------- Asistente (texto/voz → MCP) ----------
app.post('/api/assistant', wrap(async (req, res) => {
  res.json(await runAssistant({ text: req.body.text, reset: !!req.body.reset, port: PORT }));
}));
// Las acciones peligrosas las confirma el usuario en pantalla: el MCP solo avisa, la UI ejecuta.
app.post('/api/assistant/confirm', wrap(async (req, res) => {
  const { kind, id, label } = req.body;
  if (!['delete_project', 'apply_task'].includes(kind)) throw new Error('Acción desconocida');
  broadcast({ type: 'confirm', kind, id, label });
  res.json({ ok: true });
}));

// ---------- Explorador de carpetas (para elegir la carpeta de un proyecto sin escribir rutas) ----------
app.get('/api/fs/list', wrap(async (req, res) => {
  const home = os.homedir();
  const dir = path.resolve(String(req.query.path || home));
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { throw new Error('No se puede abrir esa carpeta.'); }
  const dirs = entries
    .filter((e) => !e.name.startsWith('.') && (e.isDirectory() || (e.isSymbolicLink() && isDir(path.join(dir, e.name)))))
    .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  const parent = path.dirname(dir);
  res.json({ path: dir, parent: parent === dir ? null : parent, home, dirs });
}));
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// ---------- Proyectos ----------
app.get('/api/projects', (_req, res) => res.json(q.listProjects.all()));

app.post('/api/projects', wrap(async (req, res) => {
  const dir = String(req.body.path || '').trim();
  if (!dir) throw userError('Indica la carpeta de tu proyecto', 'NO_PATH');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw userError('Esa carpeta no existe. Revisa la ruta.', 'NOT_FOUND');
  let top = await G.repoRoot(dir);
  if (!top) {
    // Carpeta normal: hay que prepararla (convertirla en repo git) y solo con permiso explícito
    if (!req.body.prepare) throw userError('Esta carpeta todavía no está preparada para trabajar con versiones.', 'NOT_PREPARED');
    await G.initRepo(dir);
    top = await G.repoRoot(dir);
  }
  if (q.getProjectByPath.get(top)) throw userError('Este proyecto ya está añadido.', 'DUPLICATE');
  await G.ensureCommit(top);
  const project = {
    id: crypto.randomBytes(3).toString('hex'), path: top, created_at: Date.now(),
    name: req.body.name?.trim() || top.split(/[\\/]/).filter(Boolean).pop(),
  };
  q.insertProject.run(project);
  broadcast({ type: 'projects' });
  res.status(201).json(project);
}));

app.put('/api/projects/:id', wrap(async (req, res) => {
  const p = q.getProject.get(req.params.id);
  if (!p) throw new Error('Proyecto no encontrado');
  const name = String(req.body.name || '').trim();
  if (!name) throw new Error('El nombre no puede estar vacío');
  q.renameProject.run(name, p.id);
  broadcast({ type: 'projects' });
  res.json(q.getProject.get(p.id));
}));

// Quita el proyecto de Orquestrator. NO toca la carpeta del usuario: solo detiene sus tareas
// y descarta las copias de trabajo (y ramas) de las tareas que no se llegaron a aplicar.
app.delete('/api/projects/:id', wrap(async (req, res) => {
  const p = q.getProject.get(req.params.id);
  if (!p) throw new Error('Proyecto no encontrado');
  for (const t of q.tasksByRepo.all(p.path)) {
    stopRun(t.id);
    if (!['merged', 'discarded'].includes(t.status)) await G.removeWorktree(t);
    q.deleteEvents.run(t.id); q.deleteTask.run(t.id);
    broadcast({ type: 'removed', taskId: t.id });
  }
  q.deleteProject.run(p.id);
  broadcast({ type: 'projects' });
  res.json({ ok: true });
}));

app.get('/api/tasks', (_req, res) => res.json(q.listTasks.all()));
app.get('/api/tasks/:id', wrap(async (req, res) => res.json(getTask(req))));

app.post('/api/tasks', wrap(async (req, res) => {
  const { repo, prompt, name, base } = req.body;
  if (!repo || !prompt) throw new Error('Faltan repo y prompt');
  const agent = getAgent(req.body.agent).id;
  const info = await G.repoInfo(repo);
  const baseBranch = base || info.current;
  const id = crypto.randomBytes(3).toString('hex');
  const taskName = name?.trim() || prompt.trim().split('\n')[0].slice(0, 60);
  const branch = `tarea-${slug(taskName)}-${id}`;
  await G.ensureCommit(info.top);
  const { top, worktreePath } = await G.createWorktree({ repoPath: info.top, branch, base: baseBranch });
  if (!q.getProjectByPath.get(top)) {
    q.insertProject.run({ id: crypto.randomBytes(3).toString('hex'), name: top.split(/[\\/]/).filter(Boolean).pop(), path: top, created_at: Date.now() });
  }
  q.insertTask.run({
    id, name: taskName, agent, repo_path: top, base_branch: baseBranch, branch,
    worktree_path: worktreePath, prompt, status: 'running', created_at: Date.now(),
  });
  startRun(q.getTask.get(id), prompt);
  res.status(201).json(q.getTask.get(id));
}));

// Prompt de seguimiento sobre la misma sesión/worktree
app.post('/api/tasks/:id/continue', wrap(async (req, res) => {
  const t = getTask(req);
  if (isRunning(t.id)) throw new Error('La tarea sigue corriendo');
  if (['merged', 'discarded'].includes(t.status)) throw new Error('La tarea ya está cerrada');
  if (!req.body.prompt) throw new Error('Falta prompt');
  startRun(t, req.body.prompt, { resume: true });
  res.json(q.getTask.get(t.id));
}));

app.post('/api/tasks/:id/stop', wrap(async (req, res) => { stopRun(getTask(req).id); res.json({ ok: true }); }));

app.get('/api/tasks/:id/diff', wrap(async (req, res) => {
  const t = getTask(req);
  if (isRunning(t.id)) throw new Error('Espera a que termine la tarea');
  res.json(await G.diff(t));
}));

app.post('/api/tasks/:id/merge', wrap(async (req, res) => {
  const t = getTask(req);
  if (isRunning(t.id)) throw new Error('La tarea sigue corriendo');
  await G.merge(t);
  q.setStatus.run({ id: t.id, status: 'merged', exit_code: t.exit_code, error: null, finished_at: Date.now() });
  broadcast({ type: 'task', task: q.getTask.get(t.id) });
  res.json(q.getTask.get(t.id));
}));

app.post('/api/tasks/:id/discard', wrap(async (req, res) => {
  const t = getTask(req);
  stopRun(t.id);
  await G.removeWorktree(t);
  q.setStatus.run({ id: t.id, status: 'discarded', exit_code: t.exit_code, error: null, finished_at: Date.now() });
  broadcast({ type: 'task', task: q.getTask.get(t.id) });
  res.json(q.getTask.get(t.id));
}));

// Quita del listado (y de la BD) una tarea ya cerrada
app.delete('/api/tasks/:id', wrap(async (req, res) => {
  const t = getTask(req);
  if (!['merged', 'discarded', 'error', 'done'].includes(t.status) || isRunning(t.id)) throw new Error('No se puede borrar ahora');
  if (['done', 'error'].includes(t.status) && fs.existsSync(t.worktree_path)) throw new Error('Haz merge o descarta primero');
  q.deleteEvents.run(t.id); q.deleteTask.run(t.id);
  broadcast({ type: 'removed', taskId: t.id });
  res.json({ ok: true });
}));

// Frontend compilado (modo `npm start`)
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// ---------- WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const subs = new Map(); // ws -> Set<taskId>

function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(s);
}
onMessage((msg) => {
  if (msg.type === 'task' || msg.type === 'speak') return broadcast(msg);
  const s = JSON.stringify(msg);
  for (const [ws, set] of subs) if (set.has(msg.taskId) && ws.readyState === 1) ws.send(s);
});

wss.on('connection', (ws) => {
  subs.set(ws, new Set());
  ws.on('close', () => subs.delete(ws));
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'subscribe') {
      // Backlog + alta de suscripción en el mismo tick síncrono: sin huecos ni duplicados.
      subs.get(ws).add(m.taskId);
      const events = q.eventsAfter.all(m.taskId, m.after || 0);
      ws.send(JSON.stringify({ type: 'backlog', taskId: m.taskId, events }));
    } else if (m.type === 'unsubscribe') subs.get(ws).delete(m.taskId);
  });
});

recoverOrphans();
server.listen(PORT, '127.0.0.1', () => console.log(`orquestrator → http://localhost:${PORT}`));
