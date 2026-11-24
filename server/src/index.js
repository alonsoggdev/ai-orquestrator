import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { q } from './db.js';
import * as G from './git.js';
import { startRun, stopRun, isRunning, onMessage, recoverOrphans } from './runner.js';

const PORT = Number(process.env.PORT || 3001);
const app = express();
app.use(express.json());

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'tarea';
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(400).json({ error: e.message }));
const getTask = (req) => {
  const t = q.getTask.get(req.params.id);
  if (!t) throw new Error('Tarea no encontrada');
  return t;
};

app.get('/api/tasks', (_req, res) => res.json(q.listTasks.all()));
app.get('/api/tasks/:id', wrap(async (req, res) => res.json(getTask(req))));

app.post('/api/tasks', wrap(async (req, res) => {
  const { repo, prompt, name, base } = req.body;
  if (!repo || !prompt) throw new Error('Faltan repo y prompt');
  const info = await G.repoInfo(repo);
  const baseBranch = base || info.current;
  const id = crypto.randomBytes(3).toString('hex');
  const taskName = name?.trim() || prompt.trim().split('\n')[0].slice(0, 60);
  const branch = `tarea-${slug(taskName)}-${id}`;
  const { top, worktreePath } = await G.createWorktree({ repoPath: info.top, branch, base: baseBranch });
  q.insertTask.run({
    id, name: taskName, repo_path: top, base_branch: baseBranch, branch,
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
  if (msg.type === 'task') return broadcast(msg);
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
