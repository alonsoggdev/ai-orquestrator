import React, { useEffect, useRef } from 'react';

function Block({ ev }) {
  if (ev.kind === 'prompt') return <div className="msg prompt"><b>Prompt</b><pre>{ev.data}</pre></div>;
  if (ev.kind === 'stderr') return <div className="msg stderr"><pre>{ev.data}</pre></div>;
  if (ev.kind === 'system') return <div className="msg stderr"><pre>{ev.data}</pre></div>;

  let o; try { o = JSON.parse(ev.data); } catch { return null; }
  if (o.type === 'system' && o.subtype === 'init') {
    return <div className="msg sys">sesión {o.session_id?.slice(0, 8)} · modelo {o.model} · {o.cwd}</div>;
  }
  if (o.type === 'assistant') {
    return o.message.content.map((c, i) => {
      if (c.type === 'text') return <div key={i} className="msg assistant"><pre>{c.text}</pre></div>;
      if (c.type === 'tool_use') {
        return <div key={i} className="msg tool"><b>⚙ {c.name}</b><pre>{summarize(c.input)}</pre></div>;
      }
      return null;
    });
  }
  if (o.type === 'user' && Array.isArray(o.message?.content)) {
    return o.message.content.filter((c) => c.type === 'tool_result').map((c, i) => (
      <details key={i} className="msg result"><summary>resultado</summary>
        <pre>{typeof c.content === 'string' ? c.content : JSON.stringify(c.content, null, 2)}</pre>
      </details>
    ));
  }
  if (o.type === 'result') {
    return <div className={`msg final ${o.is_error ? 'bad' : ''}`}>
      <b>{o.is_error ? 'Terminó con error' : 'Terminada'}</b>
      {o.total_cost_usd != null && <> · ${o.total_cost_usd.toFixed(4)}</>}
      {o.duration_ms != null && <> · {(o.duration_ms / 1000).toFixed(1)}s</>}
      {o.result && <pre>{o.result}</pre>}
    </div>;
  }
  return null;
}

const summarize = (input) => {
  const s = JSON.stringify(input, null, 2);
  return s.length > 1200 ? s.slice(0, 1200) + '…' : s;
};

export default function LogView({ events, running }) {
  const ref = useRef(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div className="log" ref={ref}
      onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
      {events.map((ev) => <Block key={ev.seq} ev={ev} />)}
      {running && <div className="msg sys pulse">trabajando…</div>}
    </div>
  );
}
