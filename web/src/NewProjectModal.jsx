import React, { useState } from 'react';
import Modal from './Modal.jsx';
import { api } from './api.js';
import FolderPicker from './FolderPicker.jsx';

export default function NewProjectModal({ onClose, onCreated }) {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState(null); // { message, code }
  const [busy, setBusy] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  const create = async (prepare = false) => {
    setBusy(true); setErr(null);
    try { onCreated(await api.createProject({ path, name, prepare })); }
    catch (e) { setErr({ message: e.message, code: e.code }); }
    finally { setBusy(false); }
  };

  if (browsing) {
    return (
      <Modal title="Elige la carpeta" onClose={onClose} width={620}>
        <FolderPicker start={path.trim() || undefined}
          onPick={(p) => { setPath(p); setErr(null); setBrowsing(false); }} onCancel={() => setBrowsing(false)} />
      </Modal>
    );
  }

  return (
    <Modal title="Nuevo proyecto" onClose={onClose}>
      <form className="modal-body" onSubmit={(e) => { e.preventDefault(); create(false); }}>
        <p className="tmeta">Un proyecto es una carpeta de tu ordenador en la que el asistente va a trabajar.</p>
        <label>Carpeta del proyecto
          <div className="inline">
            <input value={path} onChange={(e) => setPath(e.target.value)} required readOnly={false}
              placeholder="Elige una carpeta con «Examinar»" />
            <button type="button" onClick={() => setBrowsing(true)}>Examinar…</button>
          </div>
        </label>
        <label>Nombre (opcional)
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Si lo dejas vacío usamos el de la carpeta" />
        </label>

        {err?.code === 'NOT_PREPARED' ? (
          <div className="notice">
            <div><b>Esta carpeta hay que prepararla primero.</b></div>
            <div className="tmeta">Así el asistente podrá trabajar en una copia y tú decidirás qué cambios aceptar. No se borra ni se mueve nada de lo que ya tienes.</div>
            <button type="button" className="primary" disabled={busy} onClick={() => create(true)}>
              {busy ? 'Preparando…' : 'Preparar carpeta y crear proyecto'}
            </button>
          </div>
        ) : err && <div className="error">{err.message}</div>}

        <footer className="modal-foot">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={busy || !path.trim()}>{busy ? 'Creando…' : 'Crear proyecto'}</button>
        </footer>
      </form>
    </Modal>
  );
}
