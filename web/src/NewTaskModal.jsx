import React, { useState } from 'react';
import Modal from './Modal.jsx';
import { api } from './api.js';

/** Crear una tarea la lanza al momento: el asistente empieza a trabajar. */
export default function NewTaskModal({ project, onClose, onCreated }) {
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true); setErr('');
    try { onCreated(await api.create({ repo: project.path, prompt, name })); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Nueva tarea" onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <p className="tmeta">Proyecto: <b>{project.name}</b>. El asistente empezará a trabajar en cuanto la crees.</p>
        <label>¿Qué quieres que haga?
          <textarea rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} autoFocus required
            placeholder="Por ejemplo: añade una página de contacto con un formulario"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }} />
        </label>
        <label>Título (opcional)
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Si lo dejas vacío se genera solo" />
        </label>
        {err && <div className="error">{err}</div>}
        <footer className="modal-foot">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={busy || !prompt.trim()}>{busy ? 'Lanzando…' : 'Crear y empezar'}</button>
        </footer>
      </form>
    </Modal>
  );
}
