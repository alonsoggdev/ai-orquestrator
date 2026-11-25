import React, { useState } from 'react';
import Modal from './Modal.jsx';
import { api } from './api.js';

export function EditProjectModal({ project, onClose, onSaved }) {
  const [name, setName] = useState(project.name);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.renameProject(project.id, name); onSaved(); } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Editar proyecto" onClose={onClose}>
      <form className="modal-body" onSubmit={save}>
        <label>Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </label>
        <div className="tmeta">Carpeta: <code>{project.path}</code></div>
        {err && <div className="error">{err}</div>}
        <footer className="modal-foot">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={busy || !name.trim() || name.trim() === project.name}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </footer>
      </form>
    </Modal>
  );
}

export function DeleteProjectModal({ project, onClose, onDeleted }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = project.tasks.filter((t) => !['merged', 'discarded'].includes(t.status)).length;
  const remove = async () => {
    setBusy(true); setErr('');
    try { await api.deleteProject(project.id); onDeleted(); } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title="Eliminar proyecto" onClose={onClose}>
      <div className="modal-body">
        <p>¿Quieres quitar <b>«{project.name}»</b> de Orquestrator?</p>
        <p className="tmeta">Tu carpeta y tus archivos no se borran. Solo desaparecen el proyecto y su historial de tareas de esta aplicación.</p>
        {pending > 0 && (
          <div className="notice">
            Hay {pending} {pending === 1 ? 'tarea sin terminar' : 'tareas sin terminar'}. Se pararán y sus cambios sin aplicar se perderán.
          </div>
        )}
        {err && <div className="error">{err}</div>}
        <footer className="modal-foot">
          <button onClick={onClose}>Cancelar</button>
          <button className="danger-solid" disabled={busy} onClick={remove}>{busy ? 'Eliminando…' : 'Eliminar proyecto'}</button>
        </footer>
      </div>
    </Modal>
  );
}
