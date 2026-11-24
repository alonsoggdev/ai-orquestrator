import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';

const run = promisify(execFile);

export async function git(cwd, ...args) {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim();
  } catch (e) {
    const msg = (e.stderr || e.message || '').toString().trim();
    throw new Error(`git ${args.join(' ')}: ${msg}`);
  }
}

export async function repoInfo(repoPath) {
  if (!fs.existsSync(repoPath)) throw new Error(`No existe la ruta: ${repoPath}`);
  const top = await git(repoPath, 'rev-parse', '--show-toplevel');
  const current = await git(top, 'rev-parse', '--abbrev-ref', 'HEAD');
  return { top, current };
}

/** Crea worktree hermano del repo en una rama nueva desde la rama base. */
export async function createWorktree({ repoPath, branch, base }) {
  const { top } = await repoInfo(repoPath);
  const wt = path.join(path.dirname(top), `${path.basename(top)}-${branch}`);
  await git(top, 'worktree', 'add', wt, '-b', branch, base);
  return { top, worktreePath: wt };
}

/** Commitea cualquier cambio pendiente en el worktree (para que el diff sea estable). */
export async function autoCommit(worktreePath, message) {
  await git(worktreePath, 'add', '-A');
  const status = await git(worktreePath, 'status', '--porcelain');
  if (!status) return false;
  await git(worktreePath, '-c', 'user.name=orquestrator', '-c', 'user.email=orquestrator@local',
    'commit', '-m', message);
  return true;
}

export async function diff(task) {
  await git(task.worktree_path, 'add', '-A'); // incluye ficheros nuevos
  const base = await git(task.worktree_path, 'merge-base', task.base_branch, 'HEAD');
  const stat = await git(task.worktree_path, 'diff', '--stat', base);
  const patch = await git(task.worktree_path, 'diff', base);
  return { stat, patch };
}

export async function merge(task) {
  const { top, current } = await repoInfo(task.repo_path);
  if (current !== task.base_branch) {
    throw new Error(`El repo principal está en '${current}', no en '${task.base_branch}'. Haz checkout de '${task.base_branch}' y reintenta.`);
  }
  const dirty = await git(top, 'status', '--porcelain', '--untracked-files=no');
  if (dirty) throw new Error('El repo principal tiene cambios sin commitear; límpialo antes de mergear.');
  await autoCommit(task.worktree_path, `tarea ${task.name}`);
  try {
    await git(top, 'merge', '--no-ff', task.branch, '-m', `Merge ${task.branch}: ${task.name}`);
  } catch (e) {
    await git(top, 'merge', '--abort').catch(() => {});
    throw new Error(`Conflicto al mergear (abortado): ${e.message}`);
  }
  await removeWorktree(task);
}

export async function removeWorktree(task) {
  const { top } = await repoInfo(task.repo_path);
  await git(top, 'worktree', 'remove', '--force', task.worktree_path).catch(() => {});
  await git(top, 'worktree', 'prune').catch(() => {});
  await git(top, 'branch', '-D', task.branch).catch(() => {});
}
