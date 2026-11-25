import React, { useState } from 'react';
import Modal from './Modal.jsx';
import { api } from './api.js';
import { COLUMNS, columnOf, timeAgo } from './projects.js';

// Movimientos permitidos al arrastrar (de columna -> a columna). El resto los decide el asistente.
const MOVES = { 'review>finished': 'apply', 'review>progress': 'rework' };

/** Ventana para confirmar el movimiento: aplicar cambios o pedir retoques. */
export function MoveModal({ move, onClose }) {
  const { kind, task } = move;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const run = async () => {
    setBusy(true); setErr('');
    try {
      if (kind === 'apply') await api.merge(task.id); else await api.cont(task.id, text);
      onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return kind === 'apply' ? (
    <Modal title="Dar por terminada" onClose={onClose}>
      <div className="modal-body">
        <p>Los cambios de <b>«{task.name}»</b> se añadirán a tu proyecto y la tarea pasará a Terminada.</p>
        <p className="tmeta">Si hay algo que no te convence, cancela y pide retoques arrastrando la tarea a «En progreso».</p>
        {err && <div className="error">{err}</div>}
        <footer className="modal-foot">
          <button onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={busy} onClick={run}>{busy ? 'Aplicando…' : 'Aplicar cambios'}</button>
        </footer>
      </div>
    </Modal>
  ) : (
    <Modal title="Pedir retoques" onClose={onClose}>
      <div className="modal-body">
        <p>¿Qué hay que cambiar en <b>«{task.name}»</b>?</p>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} autoFocus
          placeholder="Por ejemplo: haz el título más grande y cambia el color del botón" />
        {err && <div className="error">{err}</div>}
        <footer className="modal-foot">
          <button onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={busy || !text.trim()} onClick={run}>{busy ? 'Enviando…' : 'Enviar al asistente'}</button>
        </footer>
      </div>
    </Modal>
  );
}

function Card({ task, onOpen, onDragStart }) {
  const col = columnOf(task);
  const movable = col === 'review';
  return (
    <div className={`card ${movable ? 'movable' : ''}`} draggable={movable} onClick={() => onOpen(task)}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(task); }}
      title={movable ? 'Arrástrala a «Terminada» o a «En progreso»' : undefined}>
      <div className="tname wrap">{task.name}</div>
      <div className="tmeta">
        {col === 'progress' && <span className="pulse">Trabajando… </span>}
        {task.status === 'error' && <span className="warn-text">Algo salió mal · </span>}
        {timeAgo(task.created_at)}
      </div>
    </div>
  );
}

export default function Kanban({ tasks, onOpenTask, onNewTask }) {
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const [move, setMove] = useState(null);
  const [hint, setHint] = useState('');

  const drop = (colId) => {
    const task = dragging;
    setOver(null); setDragging(null);
    if (!task || columnOf(task) === colId) return;
    const kind = MOVES[`${columnOf(task)}>${colId}`];
    if (!kind) { setHint('Esa tarea no se puede mover ahí.'); setTimeout(() => setHint(''), 2500); return; }
    setMove({ kind, task });
  };
  const canDrop = (colId) => dragging && MOVES[`${columnOf(dragging)}>${colId}`];

  return (
    <>
      {hint && <div className="notice small">{hint}</div>}
      <div className="board">
        {COLUMNS.map((c) => {
          const items = tasks.filter((t) => columnOf(t) === c.id).sort((a, b) => b.created_at - a.created_at);
          return (
            <div key={c.id} className={`column ${over === c.id && canDrop(c.id) ? 'over' : ''} ${dragging && canDrop(c.id) ? 'droppable' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(c.id); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); drop(c.id); }}>
              <div className="column-head"><span>{c.title}</span><span className="count">{items.length}</span></div>
              <div className="column-body">
                {(c.id === 'pending' || c.id === 'progress') && (
                  <button className="add-card" onClick={onNewTask}>+ Nueva tarea</button>
                )}
                {items.map((t) => <Card key={t.id} task={t} onOpen={onOpenTask} onDragStart={setDragging} />)}
                {!items.length && <div className="tmeta empty-col">{c.empty}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {move && <MoveModal move={move} onClose={() => setMove(null)} />}
    </>
  );
}
