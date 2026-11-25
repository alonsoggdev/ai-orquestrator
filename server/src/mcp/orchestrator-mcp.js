// Servidor MCP (stdio) que deja a un agente controlar Orquestrator mediante su API local.
// Lo lanza `claude --mcp-config`; también sirve para usarlo desde cualquier cliente MCP.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = process.env.ORQ_URL || `http://127.0.0.1:${process.env.PORT || 3001}`;

async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

const ok = (data) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: e.message || String(e) }] });
const tool = (fn) => async (args) => { try { return ok(await fn(args)); } catch (e) { return fail(e); } };

const STATUS = { pending: 'pendiente', running: 'en progreso', done: 'revisando', error: 'revisando (con error)', merged: 'terminada', discarded: 'descartada' };
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Busca por nombre (o id/ruta) y falla si no hay coincidencia clara. */
function pick(items, query, label, nameOf) {
  const q = norm(query);
  const exact = items.filter((i) => i.id === query || i.path === query || norm(nameOf(i)) === q);
  const found = exact.length ? exact : items.filter((i) => norm(nameOf(i)).includes(q));
  if (found.length === 1) return found[0];
  if (!found.length) throw new Error(`No encuentro ${label === 'tarea' ? 'ninguna' : 'ningún'} ${label} que se llame «${query}». Disponibles: ${items.map(nameOf).join(', ') || 'ninguno'}`);
  throw new Error(`«${query}» es ambiguo, podría ser: ${found.map(nameOf).join(', ')}. Pregunta al usuario cuál.`);
}
const findProject = async (q) => pick(await api('GET', '/api/projects'), q, 'proyecto', (p) => p.name);
async function findTask(q, projectQuery) {
  let tasks = await api('GET', '/api/tasks');
  if (projectQuery) { const p = await findProject(projectQuery); tasks = tasks.filter((t) => t.repo_path === p.path); }
  return pick(tasks, q, 'tarea', (t) => t.name);
}
const summary = (t) => ({ id: t.id, nombre: t.name, estado: STATUS[t.status] || t.status, proyecto: t.repo_path.split('/').pop(), error: t.error || undefined });

const server = new McpServer({ name: 'orquestrator', version: '0.1.0' });

server.registerTool('list_projects', {
  description: 'Lista los proyectos de Orquestrator con su carpeta y cuántas tareas tienen.',
  inputSchema: {},
}, tool(async () => {
  const [projects, tasks] = await Promise.all([api('GET', '/api/projects'), api('GET', '/api/tasks')]);
  return projects.map((p) => ({ nombre: p.name, carpeta: p.path, tareas: tasks.filter((t) => t.repo_path === p.path).length }));
}));

server.registerTool('create_project', {
  description: 'Crea un proyecto a partir de una carpeta del ordenador. Si la carpeta no está preparada (no es un repo git) devuelve un aviso: pregunta al usuario antes de repetir con prepare=true.',
  inputSchema: { path: z.string().describe('Ruta absoluta de la carpeta'), name: z.string().optional(), prepare: z.boolean().optional() },
}, tool(async ({ path, name, prepare }) => api('POST', '/api/projects', { path, name, prepare })));

server.registerTool('rename_project', {
  description: 'Cambia el nombre de un proyecto.',
  inputSchema: { project: z.string().describe('Nombre actual del proyecto'), new_name: z.string() },
}, tool(async ({ project, new_name }) => api('PUT', `/api/projects/${(await findProject(project)).id}`, { name: new_name })));

server.registerTool('request_delete_project', {
  description: 'Pide eliminar un proyecto. NO lo borra: muestra al usuario una ventana de confirmación en pantalla. Avísale de que debe confirmarlo allí.',
  inputSchema: { project: z.string() },
}, tool(async ({ project }) => {
  const p = await findProject(project);
  await api('POST', '/api/assistant/confirm', { kind: 'delete_project', id: p.id, label: p.name });
  return `Se ha pedido al usuario que confirme en pantalla la eliminación de «${p.name}».`;
}));

server.registerTool('list_tasks', {
  description: 'Lista tareas, opcionalmente de un proyecto. Estados: pendiente, en progreso, revisando, terminada.',
  inputSchema: { project: z.string().optional() },
}, tool(async ({ project }) => {
  let tasks = await api('GET', '/api/tasks');
  if (project) { const p = await findProject(project); tasks = tasks.filter((t) => t.repo_path === p.path); }
  return tasks.filter((t) => t.status !== 'discarded').map(summary);
}));

server.registerTool('get_task', {
  description: 'Estado y detalle de una tarea.',
  inputSchema: { task: z.string().describe('Nombre o id de la tarea'), project: z.string().optional() },
}, tool(async ({ task, project }) => {
  const t = await findTask(task, project);
  return { ...summary(t), prompt: t.prompt };
}));

server.registerTool('create_task', {
  description: 'Crea una tarea en un proyecto y la lanza al momento: el asistente de código empieza a trabajar. Úsala cuando el usuario pida algo que hay que programar o cambiar en un proyecto. El prompt debe ser claro y autocontenido.',
  inputSchema: { project: z.string(), prompt: z.string().describe('Encargo para el asistente de código'), name: z.string().optional().describe('Título corto') },
}, tool(async ({ project, prompt, name }) => {
  const p = await findProject(project);
  return summary(await api('POST', '/api/tasks', { repo: p.path, prompt, name }));
}));

server.registerTool('send_followup', {
  description: 'Pide retoques en una tarea que está en «revisando»: la devuelve a «en progreso» con un nuevo mensaje.',
  inputSchema: { task: z.string(), prompt: z.string().describe('Qué hay que cambiar'), project: z.string().optional() },
}, tool(async ({ task, prompt, project }) => {
  const t = await findTask(task, project);
  return summary(await api('POST', `/api/tasks/${t.id}/continue`, { prompt }));
}));

server.registerTool('request_apply_task', {
  description: 'Pide dar por terminada una tarea (aplicar sus cambios al proyecto). NO lo hace: muestra al usuario una ventana de confirmación en pantalla. Avísale de que debe confirmarlo allí.',
  inputSchema: { task: z.string(), project: z.string().optional() },
}, tool(async ({ task, project }) => {
  const t = await findTask(task, project);
  if (t.status !== 'done') throw new Error(`La tarea «${t.name}» está ${STATUS[t.status] || t.status}; solo se puede terminar una que esté en «revisando».`);
  await api('POST', '/api/assistant/confirm', { kind: 'apply_task', id: t.id, label: t.name });
  return `Se ha pedido al usuario que confirme en pantalla aplicar los cambios de «${t.name}».`;
}));

await server.connect(new StdioServerTransport());
