import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
fs.mkdirSync(dir, { recursive: true });

export const db = new Database(path.join(dir, 'orquestrator.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  repo_path     TEXT NOT NULL,
  base_branch   TEXT NOT NULL,
  branch        TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  prompt        TEXT NOT NULL,
  status        TEXT NOT NULL,           -- running | done | error | merged | discarded
  session_id    TEXT,                    -- sesión de Claude (para --resume)
  exit_code     INTEGER,
  error         TEXT,
  created_at    INTEGER NOT NULL,
  finished_at   INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  task_id TEXT NOT NULL,
  seq     INTEGER NOT NULL,
  kind    TEXT NOT NULL,                 -- json | stderr | prompt | system
  data    TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  PRIMARY KEY (task_id, seq)
);
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  path       TEXT NOT NULL UNIQUE,           -- raíz del repo git
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Migración: agente que ejecuta la tarea (las anteriores eran de Claude Code)
if (!db.prepare('PRAGMA table_info(tasks)').all().some((c) => c.name === 'agent')) {
  db.exec("ALTER TABLE tasks ADD COLUMN agent TEXT NOT NULL DEFAULT 'claude'");
}

// Migración: los repos que ya tenían tareas pasan a ser proyectos
for (const r of db.prepare('SELECT repo_path, MIN(created_at) AS t FROM tasks GROUP BY repo_path').all()) {
  db.prepare('INSERT OR IGNORE INTO projects (id,name,path,created_at) VALUES (?,?,?,?)').run(
    Math.random().toString(16).slice(2, 8), r.repo_path.split(/[\\/]/).filter(Boolean).pop() || r.repo_path, r.repo_path, r.t);
}

export const q = {
  getProject: db.prepare('SELECT * FROM projects WHERE id = ?'),
  renameProject: db.prepare('UPDATE projects SET name = ? WHERE id = ?'),
  deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),
  tasksByRepo: db.prepare('SELECT * FROM tasks WHERE repo_path = ?'),
  listProjects: db.prepare('SELECT * FROM projects ORDER BY created_at DESC'),
  getProjectByPath: db.prepare('SELECT * FROM projects WHERE path = ?'),
  insertProject: db.prepare('INSERT INTO projects (id,name,path,created_at) VALUES (@id,@name,@path,@created_at)'),
  insertTask: db.prepare(`INSERT INTO tasks
    (id,name,agent,repo_path,base_branch,branch,worktree_path,prompt,status,created_at)
    VALUES (@id,@name,@agent,@repo_path,@base_branch,@branch,@worktree_path,@prompt,@status,@created_at)`),
  getTask: db.prepare('SELECT * FROM tasks WHERE id = ?'),
  listTasks: db.prepare('SELECT * FROM tasks ORDER BY created_at DESC'),
  setStatus: db.prepare(`UPDATE tasks SET status=@status, exit_code=@exit_code, error=@error,
    finished_at=@finished_at WHERE id=@id`),
  setSession: db.prepare('UPDATE tasks SET session_id=? WHERE id=?'),
  deleteTask: db.prepare('DELETE FROM tasks WHERE id = ?'),
  insertEvent: db.prepare('INSERT INTO events (task_id,seq,kind,data,ts) VALUES (?,?,?,?,?)'),
  nextSeq: db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS n FROM events WHERE task_id = ?'),
  eventsAfter: db.prepare('SELECT seq,kind,data,ts FROM events WHERE task_id=? AND seq>? ORDER BY seq'),
  deleteEvents: db.prepare('DELETE FROM events WHERE task_id = ?'),
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'),
};
