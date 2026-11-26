import React, { useEffect, useState } from 'react';
import { api } from './api.js';

const REFRESH_MS = 60_000;
const level = (p) => (p >= 90 ? 'bad' : p >= 70 ? 'warn' : 'ok');

const resetText = (ts) => {
  if (!ts) return '';
  const min = Math.max(0, Math.round((ts - Date.now()) / 60_000));
  if (min < 60) return `se reinicia en ${min} min`;
  if (min < 48 * 60) return `se reinicia en ${Math.floor(min / 60)} h ${min % 60} min`;
  return `se reinicia en ${Math.round(min / 1440)} días`;
};

function Meter({ label, win }) {
  if (!win) return null;
  const p = Math.max(0, Math.min(100, win.percent));
  return (
    <div className="meter" title={`${label}: ${win.percent}% usado${win.resetsAt ? ` · ${resetText(win.resetsAt)}` : ''}`}>
      <span className="meter-label">{label}</span>
      <span className="meter-track"><i className={`meter-fill ${level(p)}`} style={{ width: `${p}%` }} /></span>
      <span className={`meter-pct ${level(p)}`}>{win.percent}%</span>
    </div>
  );
}

/** Cabecera global: marca + uso de la cuenta activa del asistente (sesión y semana). */
export default function Header() {
  // undefined = cargando; { available: false, reason } = sin dato; { available: true, ... } = con dato
  const [usage, setUsage] = useState(undefined);

  useEffect(() => {
    let alive = true;
    const load = () => api.usage()
      .then((u) => alive && setUsage(u))
      .catch(() => alive && setUsage((cur) => (cur?.available ? cur : { available: false, reason: 'No se pudo consultar el uso' })));
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <header className="topbar">
      <h1>Orquestrator</h1>
      <div className="usage">
        {usage?.available ? (
          <>
            <span className="usage-account" title={[usage.account, usage.plan].filter(Boolean).join(' · ')}>
              {usage.label}{usage.plan ? ` ${usage.plan}` : ''}{usage.account ? ` · ${usage.account}` : ''}
            </span>
            <Meter label="Sesión" win={usage.session} />
            <Meter label="Semana" win={usage.week} />
          </>
        ) : usage ? (
          <span className="tmeta" title={usage.reason}>Uso no disponible</span>
        ) : null}
      </div>
    </header>
  );
}
