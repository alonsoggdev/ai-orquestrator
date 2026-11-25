import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const FolderIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </svg>
);
const Chevron = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
);
const UpIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
);
const HomeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8M5 10v10h14V10" /></svg>
);

/** Navegador de carpetas: clic para entrar, buscador para filtrar y botón para elegir la actual. */
export default function FolderPicker({ start, onPick, onCancel }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');

  const go = async (p) => {
    setErr(''); setFilter('');
    try { setData(await api.listFolders(p)); } catch (e) { setErr(e.message); }
  };
  useEffect(() => { go(start || undefined); }, []); // eslint-disable-line

  const crumbs = data ? data.path.split('/').filter(Boolean) : [];
  const crumbPath = (i) => '/' + crumbs.slice(0, i + 1).join('/');
  const current = crumbs[crumbs.length - 1] || 'Equipo';
  const dirs = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (data?.dirs || []).filter((d) => !f || d.name.toLowerCase().includes(f));
  }, [data, filter]);

  return (
    <div className="picker">
      <div className="picker-top">
        <div className="picker-title">
          <button type="button" className="round-btn" onClick={() => data?.parent && go(data.parent)}
            disabled={!data?.parent} title="Subir un nivel" aria-label="Subir un nivel"><UpIcon /></button>
          <div className="grow">
            <div className="picker-current">{current}</div>
            <div className="picker-crumbs">
              <button type="button" onClick={() => go('/')}>Equipo</button>
              {crumbs.map((c, i) => (
                <React.Fragment key={i}>
                  <span>/</span>
                  <button type="button" onClick={() => go(crumbPath(i))}>{c}</button>
                </React.Fragment>
              ))}
            </div>
          </div>
          {data?.home && data.path !== data.home && (
            <button type="button" className="chip" onClick={() => go(data.home)}><HomeIcon /> Inicio</button>
          )}
        </div>
        <input className="picker-search" value={filter} onChange={(e) => setFilter(e.target.value)}
          placeholder="Buscar en esta carpeta…" aria-label="Buscar carpeta" />
      </div>

      <ul className="picker-list">
        {dirs.map((d) => (
          <li key={d.path} onClick={() => go(d.path)}>
            <span className="picker-icon"><FolderIcon /></span>
            <span className="picker-name">{d.name}</span>
            <span className="picker-go"><Chevron /></span>
          </li>
        ))}
        {data && !dirs.length && (
          <li className="picker-empty">{filter ? 'Ninguna carpeta coincide' : 'No hay más carpetas aquí'}</li>
        )}
        {!data && !err && <li className="picker-empty">Cargando…</li>}
      </ul>
      {err && <div className="error">{err}</div>}

      <div className="picker-foot">
        <div className="picker-chosen">
          <span className="tmeta">Carpeta elegida</span>
          <span className="picker-path" title={data?.path}>{data?.path || '…'}</span>
        </div>
        <div className="actions">
          <button type="button" onClick={onCancel}>Atrás</button>
          <button type="button" className="primary" disabled={!data} onClick={() => onPick(data.path)}>Elegir esta carpeta</button>
        </div>
      </div>
    </div>
  );
}
