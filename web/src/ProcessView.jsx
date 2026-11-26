import React, { useEffect, useMemo, useRef, useState } from 'react';
import { analyzerFor } from './agents/index.js';
import { STATUS_LABEL } from './projects.js';

const ICON = { done: '✓', error: '✕', running: '' };
const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const base = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || p;

/** Frase de "qué está pasando ahora" según el estado de la tarea. */
function nowLine(task, steps) {
  if (task.status === 'running') {
    const cur = [...steps].reverse().find((s) => s.status === 'running');
    return cur?.doing || (steps.length ? 'Pensando el siguiente paso…' : 'Empezando a trabajar…');
  }
  if (task.status === 'done') return 'Ha terminado y está lista para que la revises.';
  if (task.status === 'error') return task.error || 'Se ha detenido por un error.';
  if (task.status === 'merged') return `Los cambios ya están aplicados en ${task.base_branch}.`;
  if (task.status === 'discarded') return 'Esta tarea se ha descartado.';
  return 'Esperando para empezar.';
}

function Step({ step, open, onToggle }) {
  const hasDetails = step.details.length > 0;
  return (
    <li className={`step ${step.status}`}>
      <span className={`sicon ${step.status}`}>{ICON[step.status]}</span>
      <div className="step-main">
        <button className="step-head" onClick={onToggle} disabled={!hasDetails} aria-expanded={open}>
          <span className="step-label">{step.status === 'running' ? step.doing : step.label}</span>
          {step.status === 'error' && <span className="step-bad">No ha salido bien</span>}
          <span className="step-time">{time(step.ts)}</span>
          {hasDetails && <span className="step-chev">{open ? '▾' : '▸'}</span>}
        </button>
        {open && (
          <div className="step-detail">
            {step.details.map((d, i) => (
              <div key={i}><b>{d.title}</b>{d.text && <pre>{d.text}</pre>}</div>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

/** Resumen final: qué se ha cambiado (solo cuando la tarea ya terminó). */
function FinalSummary({ task, steps, files, voice, result }) {
  const tests = steps.filter((s) => s.key === 'test');
  const testsBad = tests.some((s) => s.status === 'error');
  return (
    <section className="p-final">
      <h3>Qué se ha cambiado</h3>
      {voice && <p className="p-voice">{voice}</p>}
      {files.length
        ? (
          <>
            <div className="p-sub">{files.length === 1 ? '1 archivo modificado' : `${files.length} archivos modificados`}</div>
            <ul className="p-files">{files.map((f) => <li key={f} title={f}>{base(f)}</li>)}</ul>
          </>
        )
        : <div className="p-sub">No se ha modificado ningún archivo.</div>}
      {tests.length > 0 && (
        <div className={`p-sub ${testsBad ? 'bad' : ''}`}>
          {testsBad ? 'Alguna prueba ha fallado: conviene revisarlo.' : 'Los cambios se han probado sin problemas.'}
        </div>
      )}
      {result?.result && (
        <details className="p-more"><summary>Ver el mensaje completo del asistente</summary><pre>{result.result}</pre></details>
      )}
      {task.status === 'done' && <div className="p-sub">Mira la pestaña «Cambios» para ver el detalle y decide si aplicarlos.</div>}
    </section>
  );
}

export default function ProcessView({ task, events, running, agent }) {
  const { steps, files, voice, result } = useMemo(() => analyzerFor(agent)(events, { running }), [events, running, agent]);
  const [open, setOpen] = useState(() => new Set());
  const ref = useRef(null);
  const stick = useRef(true);
  const toggle = (id) => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const finished = task.status === 'done' || task.status === 'merged';

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events.length, task.status]);

  const doneCount = steps.filter((s) => s.status === 'done').length;
  return (
    <div className="process">
      <section className={`p-summary ${task.status}`}>
        <div className="p-state">
          <span className={`badge ${task.status}`}>{STATUS_LABEL[task.status] || 'Pendiente'}</span>
          <span className="p-count">{steps.length ? `${doneCount} de ${steps.length} pasos hechos` : 'Sin pasos todavía'}</span>
        </div>
        <div className={`p-now ${running ? 'pulse' : ''}`}>{nowLine(task, steps)}</div>
      </section>
      <div className="p-steps" ref={ref}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
        {!steps.length && <div className="msg sys">{running ? 'El asistente está empezando…' : 'Todavía no hay actividad.'}</div>}
        <ol className="steps">
          {steps.map((s) => <Step key={s.id} step={s} open={open.has(s.id)} onToggle={() => toggle(s.id)} />)}
        </ol>
        {finished && <FinalSummary task={task} steps={steps} files={files} voice={voice} result={result} />}
      </div>
    </div>
  );
}
