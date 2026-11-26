import React from 'react';

const summarize = (input) => {
  const s = JSON.stringify(input, null, 2);
  return s.length > 1200 ? s.slice(0, 1200) + '…' : s;
};

/** Renderiza una línea JSON del stream de Claude Code (evento ya parseado). */
export default function renderEvent(o) {
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

const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const clip = (s, n = 4000) => (s.length > n ? s.slice(0, n) + '…' : s);
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text ?? '').join('\n') : JSON.stringify(c, null, 2));

/** Traduce una herramienta de Claude Code a una frase para personas: { key, group?, label, many?, doing, file? }. */
function describe(name, input = {}) {
  const file = input.file_path || input.notebook_path || input.path;
  const f = file ? `«${base(file)}»` : 'un archivo';
  switch (name) {
    case 'Read': return { key: 'read', group: 'read', label: `Ha leído ${f}`, many: (n) => `Ha leído ${n} archivos`, doing: `Está leyendo ${f}` };
    case 'Grep': case 'Glob': case 'LS':
      return { key: 'search', group: 'search', label: 'Ha buscado en el proyecto', doing: 'Está buscando en el proyecto' };
    case 'Edit': case 'MultiEdit': case 'NotebookEdit':
      return { key: 'edit', label: `Ha modificado ${f}`, doing: `Está modificando ${f}`, file };
    case 'Write': return { key: 'edit', label: `Ha escrito ${f}`, doing: `Está escribiendo ${f}`, file };
    case 'TodoWrite': return { key: 'plan', label: 'Ha planificado los pasos', doing: 'Está planificando los pasos' };
    case 'WebFetch': case 'WebSearch': return { key: 'web', label: 'Ha consultado información en internet', doing: 'Está consultando internet' };
    case 'Task': case 'Agent': return { key: 'helper', label: 'Ha pedido ayuda a un sub-asistente', doing: 'Está trabajando con un sub-asistente' };
    case 'Bash': {
      const cmd = String(input.command || '');
      if (/\b(test|jest|vitest|pytest|mocha)\b/.test(cmd)) return { key: 'test', label: 'Ha probado los cambios', doing: 'Está probando los cambios' };
      if (/\b(build|tsc|lint|eslint|compile)\b/.test(cmd)) return { key: 'check', label: 'Ha comprobado que el proyecto compila', doing: 'Está comprobando que el proyecto compila' };
      if (/\b(npm|yarn|pnpm|pip|bun)\s+(install|i|add)\b/.test(cmd)) return { key: 'install', label: 'Ha instalado dependencias', doing: 'Está instalando dependencias' };
      if (/^\s*git\s+commit/.test(cmd)) return { key: 'git', label: 'Ha guardado los cambios', doing: 'Está guardando los cambios' };
      if (/^\s*git\b/.test(cmd)) return { key: 'git', label: 'Ha revisado el estado de los cambios', doing: 'Está revisando los cambios' };
      if (/^\s*(ls|find|cat|head|tail|grep|rg|tree|pwd)\b/.test(cmd)) return { key: 'search', group: 'search', label: 'Ha buscado en el proyecto', doing: 'Está buscando en el proyecto' };
      return { key: 'command', label: 'Ha ejecutado un comando', doing: 'Está ejecutando un comando' };
    }
    default: return { key: 'tool', label: `Ha usado la herramienta ${name}`, doing: `Está usando ${name}` };
  }
}

const RANK = { done: 0, error: 1, running: 2 };

/**
 * Convierte los eventos de una tarea en pasos legibles.
 * Devuelve { steps, files, voice, result }; cada paso: { id, ts, status, label, doing, key, details: [{title, text}] }.
 * status: done | running | error. Los pasos consecutivos del mismo grupo (leer, buscar) se funden en uno.
 */
export function analyze(events, { running } = {}) {
  const steps = [];
  const byTool = new Map(); // tool_use_id -> paso
  const files = new Map();  // ruta -> true
  let voice = '', result = null, notes = [];

  const push = (seq, ts, step) => {
    const details = [...notes.map((text) => ({ title: 'Comentario del asistente', text })), ...(step.details || [])];
    notes = [];
    const last = steps[steps.length - 1];
    if (step.group && last?.group === step.group) {
      last.count++;
      last.details.push(...details);
      last.label = last.many ? last.many(last.count) : last.label;
      last.status = RANK[step.status] > RANK[last.status] ? step.status : last.status;
      last.doing = step.doing;
      return last;
    }
    const s = { id: seq, ts, count: 1, ...step, details };
    steps.push(s);
    return s;
  };

  for (const ev of events) {
    if (ev.kind === 'prompt') {
      push(ev.seq, ev.ts, { key: 'prompt', status: 'done', label: steps.length ? 'Ha recibido una nueva indicación' : 'Ha recibido la tarea',
        details: [{ title: 'Texto enviado', text: ev.data }] });
    } else if (ev.kind === 'voice') {
      voice = ev.data;
    } else if (ev.kind === 'system') {
      push(ev.seq, ev.ts, { key: 'problem', status: 'error', label: 'Ha habido un problema', details: [{ title: 'Detalle', text: ev.data }] });
    } else if (ev.kind === 'json') {
      let o; try { o = JSON.parse(ev.data); } catch { continue; }
      if (o.type === 'assistant') {
        for (const c of o.message?.content || []) {
          if (c.type === 'text' && c.text?.trim()) notes.push(c.text.trim());
          if (c.type === 'tool_use') {
            const d = describe(c.name, c.input);
            if (d.file) files.set(d.file, true);
            const detail = c.name === 'Bash'
              ? { title: 'Comando', text: String(c.input?.command || '') }
              : { title: c.name + (c.input?.file_path ? ` · ${c.input.file_path}` : ''), text: summarize(c.input) };
            const s = push(ev.seq, ev.ts, { ...d, status: 'running', details: [detail] });
            byTool.set(c.id, s);
          }
        }
      } else if (o.type === 'user' && Array.isArray(o.message?.content)) {
        for (const c of o.message.content) {
          if (c.type !== 'tool_result') continue;
          const s = byTool.get(c.tool_use_id);
          if (!s) continue;
          s.details.push({ title: c.is_error ? 'Error' : 'Resultado', text: clip(textOf(c.content)) });
          s.resolved = (s.resolved || 0) + 1; // un paso agrupado termina cuando terminan todas sus llamadas
          s.failed = s.failed || !!c.is_error;
        }
      } else if (o.type === 'result') {
        result = o;
        const meta = [o.total_cost_usd != null && `Coste: $${o.total_cost_usd.toFixed(4)}`,
          o.duration_ms != null && `Duración: ${(o.duration_ms / 1000).toFixed(1)} s`].filter(Boolean).join(' · ');
        push(ev.seq, ev.ts, { key: 'end', status: o.is_error ? 'error' : 'done',
          label: o.is_error ? 'Ha terminado con un error' : 'Ha terminado el trabajo',
          details: [meta && { title: 'Datos', text: meta }, o.result && { title: 'Mensaje final', text: o.result }].filter(Boolean) });
      }
    }
  }

  // Estado de cada paso a partir de sus resultados (los que siguen sin resultado: en curso, o interrumpidos si ya no corre)
  for (const s of steps) {
    if (s.status !== 'running') continue;
    const waiting = s.count - (s.resolved || 0);
    s.status = s.failed ? 'error' : waiting > 0 ? (running ? 'running' : 'error') : 'done';
  }
  return { steps, files: [...files.keys()], voice, result };
}
