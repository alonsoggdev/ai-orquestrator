import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import LogView from './LogView.jsx';
import DiffView from './DiffView.jsx';

export default function TaskView({ task, events, onDeleted, onBack }) {
  const [tab, setTab] = useState('log');
  const [err, setErr] = useState('');
  const [followUp, setFollowUp] = useState('');
  const running = task.status === 'running';
  const closed = task.status === 'merged' || task.status === 'discarded';

  const act = (fn, confirmMsg) => async () => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setErr('');
    try { await fn(); } catch (e) { setErr(e.message); }
  };

  return (
    <div className="taskview">
      <header>
        <div>
          {onBack && <button className="link" onClick={onBack}>← Volver al proyecto</button>}
          <h2>{task.name} <span className={`badge ${task.status}`}>{task.status}</span></h2>
          <div className="tmeta">
            {task.branch} ← {task.base_branch} · <code>{task.worktree_path}</code>
          </div>
        </div>
        <div className="actions">
          {running && <button onClick={act(() => api.stop(task.id))}>Detener</button>}
          {!running && !closed && (
            <>
              <button className="ok" onClick={act(() => api.merge(task.id),
                `¿Mergear ${task.branch} en ${task.base_branch}? (se borrará el worktree)`)}>Merge a {task.base_branch}</button>
              <button className="danger" onClick={act(() => api.discard(task.id),
                '¿Descartar? Se borra el worktree y la rama.')}>Descartar</button>
            </>
          )}
          {closed && <button onClick={act(async () => { await api.remove(task.id); onDeleted(); })}>Quitar del listado</button>}
        </div>
      </header>
      {err && <div className="error">{err}</div>}
      {task.error && <div className="error">{task.error}</div>}
      <nav className="tabs">
        <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Log</button>
        <button className={tab === 'diff' ? 'on' : ''} onClick={() => setTab('diff')} disabled={running || closed}>Diff</button>
      </nav>
      {tab === 'log' ? <LogView events={events} running={running} agent={task.agent} /> : <DiffView task={task} />}
      {!running && !closed && (
        <form className="followup" onSubmit={(e) => {
          e.preventDefault();
          if (!followUp.trim()) return;
          act(() => api.cont(task.id, followUp))().then(() => { setFollowUp(''); setTab('log'); });
        }}>
          <input value={followUp} onChange={(e) => setFollowUp(e.target.value)}
            placeholder="Prompt de seguimiento (continúa la misma sesión)…" />
          <button className="primary">Enviar</button>
        </form>
      )}
    </div>
  );
}
