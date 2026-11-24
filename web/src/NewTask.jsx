import React, { useState } from 'react';
import { api } from './api.js';

export default function NewTask({ onCreated }) {
  const [repo, setRepo] = useState(localStorage.getItem('lastRepo') || '');
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      localStorage.setItem('lastRepo', repo);
      onCreated(await api.create({ repo, prompt, name }));
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  return (
    <form className="newtask" onSubmit={submit}>
      <h2>Nueva tarea</h2>
      <label>Ruta del repo local
        <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="/home/yo/proyectos/mi-repo" required />
      </label>
      <label>Nombre (opcional)
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="se deriva del prompt" />
      </label>
      <label>Prompt
        <textarea rows={8} value={prompt} onChange={(e) => setPrompt(e.target.value)} required
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }} />
      </label>
      {err && <div className="error">{err}</div>}
      <button className="primary" disabled={busy}>{busy ? 'Creando…' : 'Crear y lanzar (Ctrl+Enter)'}</button>
    </form>
  );
}
