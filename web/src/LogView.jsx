import React, { useEffect, useRef } from 'react';
import { rendererFor } from './agents/index.js';

function Block({ ev, render }) {
  if (ev.kind === 'prompt') return <div className="msg prompt"><b>Prompt</b><pre>{ev.data}</pre></div>;
  if (ev.kind === 'stderr') return <div className="msg stderr"><pre>{ev.data}</pre></div>;
  if (ev.kind === 'voice') return <div className="msg voice"><b>Resumen hablado</b><pre>{ev.data}</pre></div>;
  if (ev.kind === 'system') return <div className="msg stderr"><pre>{ev.data}</pre></div>;

  let o; try { o = JSON.parse(ev.data); } catch { return null; }
  return render(o);
}

export default function LogView({ events, running, agent }) {
  const ref = useRef(null);
  const stick = useRef(true);
  const render = rendererFor(agent);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div className="log" ref={ref}
      onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
      {events.map((ev) => <Block key={ev.seq} ev={ev} render={render} />)}
      {running && <div className="msg sys pulse">trabajando…</div>}
    </div>
  );
}
