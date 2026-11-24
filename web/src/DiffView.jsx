import React, { useEffect, useState } from 'react';
import { api } from './api.js';

export default function DiffView({ task }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.diff(task.id).then(setD).catch((e) => setErr(e.message)); }, [task.id, task.status]);

  if (err) return <div className="error">{err}</div>;
  if (!d) return <div className="log">Cargando diff…</div>;
  if (!d.patch) return <div className="log">Sin cambios.</div>;
  return (
    <div className="log diff">
      <pre className="stat">{d.stat}</pre>
      <pre>{d.patch.split('\n').map((l, i) => {
        let c = '';
        if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ')) c = 'file';
        else if (l.startsWith('@@')) c = 'hunk';
        else if (l.startsWith('+')) c = 'add';
        else if (l.startsWith('-')) c = 'del';
        return <div key={i} className={`dl ${c}`}>{l || ' '}</div>;
      })}</pre>
    </div>
  );
}
