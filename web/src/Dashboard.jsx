import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import Kanban from './Kanban.jsx';
import { STATUS_LABEL, buildHeatmap, projectName, timeAgo } from './projects.js';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DAYS = ['lun', '', 'mié', '', 'vie', '', ''];

function Heatmap({ tasks }) {
  const ref = useRef(null);
  const [weeks, setWeeks] = useState(26);
  // tantas semanas como quepan en el ancho disponible (cada columna mide 15px; ~40px de etiquetas y márgenes)
  useLayoutEffect(() => {
    const fit = () => setWeeks(Math.max(8, Math.min(52, Math.floor((ref.current.clientWidth - 70) / 15))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const { cols, level } = useMemo(() => buildHeatmap(tasks, weeks), [tasks, weeks]);
  return (
    <div className="heatmap" ref={ref}>
      <div className="hm-grid">
        <div className="hm-days">{DAYS.map((d, i) => <span key={i}>{d}</span>)}</div>
        <div>
          <div className="hm-months">
            {cols.map((col, i) => {
              const first = col[0].date;
              const show = i === 0 || first.getMonth() !== cols[i - 1][0].date.getMonth();
              return <span key={i}>{show ? MONTHS[first.getMonth()] : ''}</span>;
            })}
          </div>
          <div className="hm-cols">
            {cols.map((col, i) => (
              <div key={i} className="hm-col">
                {col.map((c, j) => (
                  <i key={j} className={`hm-cell l${level(c.count)}`}
                    title={c.count == null ? '' : `${c.count} ${c.count === 1 ? 'tarea' : 'tareas'} · ${c.date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}`} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="hm-legend">Menos {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`hm-cell l${l}`} />)} Más</div>
    </div>
  );
}

function Stat({ value, label }) {
  return <div className="stat"><div className="stat-v">{value}</div><div className="tmeta">{label}</div></div>;
}

/** Resumen de un proyecto, o de todos si `project` es null. */
export default function Dashboard({ tasks, project, onOpenTask, onNewTask }) {
  const count = (s) => tasks.filter((t) => t.status === s).length;
  const recent = [...tasks].sort((a, b) => b.created_at - a.created_at).slice(0, 8);
  const showProject = !project;

  return (
    <div className="dashboard">
      <header className="dash-head">
        <div>
          <h2>{project ? project.name : 'Resumen'}</h2>
          <div className="tmeta">{project ? project.path : 'Todos tus proyectos'}</div>
        </div>
      </header>

      <div className="overview">
        <section className="overview-stats">
          <h3>Tareas</h3>
          <div className="stats">
            <Stat value={tasks.length} label="En total" />
            <Stat value={count('running')} label="En curso" />
            <Stat value={count('done')} label="Para revisar" />
            <Stat value={count('merged')} label="Terminadas" />
          </div>
        </section>
        <section className="overview-activity">
          <h3>Actividad</h3>
          <Heatmap tasks={tasks} />
        </section>
      </div>

      {project && (
        <section>
          <div className="section-bar">
            <h3>Tablero</h3>
            <button className="primary" onClick={onNewTask}>+ Nueva tarea</button>
          </div>
          <Kanban tasks={tasks} onOpenTask={onOpenTask} onNewTask={onNewTask} />
        </section>
      )}

      {!project && <section>
        <h3>Tareas recientes</h3>
        {!recent.length && <div className="tmeta">Todavía no hay tareas. Cuando lances una, aparecerá aquí.</div>}
        <ul className="recent">
          {recent.map((t) => (
            <li key={t.id} onClick={() => onOpenTask(t)}>
              <span className={`dot ${t.status}`} />
              <div className="grow">
                <div className="tname">{t.name}</div>
                <div className="tmeta">{showProject && <>{projectName(t.repo_path)} · </>}{timeAgo(t.created_at)}</div>
              </div>
              <span className={`badge ${t.status}`}>{STATUS_LABEL[t.status] || t.status}</span>
            </li>
          ))}
        </ul>
      </section>}
    </div>
  );
}
