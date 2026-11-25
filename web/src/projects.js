// Utilidades de "proyectos": un proyecto es un repo con tareas. Todo se deriva de la lista de tareas.
export const projectName = (repoPath) => repoPath.split(/[\\/]/).filter(Boolean).pop() || repoPath;

export const STATUS_LABEL = {
  running: 'En curso',
  done: 'Lista para revisar',
  error: 'Con error',
  merged: 'Aplicada',
  discarded: 'Descartada',
};

const lastActivity = (t) => Math.max(t.created_at, t.finished_at || 0);

/** Une proyectos (con o sin tareas) y sus tareas; ordenados del más al menos reciente. */
export function groupProjects(projects, tasks) {
  const map = new Map(projects.map((p) => [p.path, { ...p, tasks: [], last: p.created_at, running: 0 }]));
  for (const t of tasks) {
    // tareas de repos aún no registrados como proyecto (datos antiguos)
    if (!map.has(t.repo_path)) map.set(t.repo_path, { id: t.repo_path, path: t.repo_path, name: projectName(t.repo_path), created_at: t.created_at, tasks: [], last: 0, running: 0 });
    const p = map.get(t.repo_path);
    p.tasks.push(t);
    p.last = Math.max(p.last, lastActivity(t));
    if (t.status === 'running') p.running++;
  }
  return [...map.values()].sort((a, b) => b.last - a.last);
}

// Columnas del tablero. Cada tarea cae en una según su estado.
export const COLUMNS = [
  { id: 'pending', title: 'Pendiente', empty: 'Nada en espera' },
  { id: 'progress', title: 'En progreso', empty: 'El asistente no está trabajando en nada' },
  { id: 'review', title: 'Revisando', empty: 'Nada que revisar' },
  { id: 'finished', title: 'Terminada', empty: 'Aún no hay tareas terminadas' },
];
export const columnOf = (t) => ({
  pending: 'pending', running: 'progress', done: 'review', error: 'review', merged: 'finished',
}[t.status] || null); // descartadas no se muestran

export function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'ahora mismo';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Actividad por día (tareas creadas) de las últimas `weeks` semanas, columnas lunes→domingo. */
export function buildHeatmap(tasks, weeks = 52) {
  const counts = {};
  for (const t of tasks) counts[dayKey(new Date(t.created_at))] = (counts[dayKey(new Date(t.created_at))] || 0) + 1;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const mondayOffset = (today.getDay() + 6) % 7;
  const start = new Date(today); start.setDate(today.getDate() - mondayOffset - (weeks - 1) * 7);
  const cols = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start); date.setDate(start.getDate() + w * 7 + d);
      col.push({ date, count: date > today ? null : counts[dayKey(date)] || 0 });
    }
    cols.push(col);
  }
  const max = Math.max(1, ...Object.values(counts));
  const level = (c) => (c == null ? -1 : c === 0 ? 0 : Math.min(4, Math.ceil((c / max) * 4)));
  return { cols, level };
}
