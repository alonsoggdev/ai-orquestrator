import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, connectWS } from './api.js';
import NewTask from './NewTask.jsx';
import TaskView from './TaskView.jsx';

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [selected, setSelected] = useState(null);
  const [events, setEvents] = useState({}); // taskId -> [event]
  const wsRef = useRef(null);
  const selectedRef = useRef(null);
  selectedRef.current = selected;

  useEffect(() => {
    api.list().then(setTasks);
    const ws = connectWS({
      onOpen: () => {
        // tras (re)conectar, pedimos el log completo de la tarea abierta
        if (selectedRef.current) {
          ws.send({ type: 'subscribe', taskId: selectedRef.current, after: 0 });
        }
        api.list().then(setTasks);
      },
      onMessage: (m) => {
        if (m.type === 'task') {
          setTasks((ts) => ts.some((t) => t.id === m.task.id)
            ? ts.map((t) => (t.id === m.task.id ? m.task : t)) : [m.task, ...ts]);
        } else if (m.type === 'removed') {
          setTasks((ts) => ts.filter((t) => t.id !== m.taskId));
        } else if (m.type === 'backlog') {
          setEvents((e) => ({ ...e, [m.taskId]: m.events }));
        } else if (m.type === 'event') {
          setEvents((e) => ({ ...e, [m.taskId]: [...(e[m.taskId] || []), m.event] }));
        }
      },
    });
    wsRef.current = ws;
    return () => ws.close();
  }, []);

  const select = (id) => {
    if (selected) wsRef.current.send({ type: 'unsubscribe', taskId: selected });
    setSelected(id);
    if (id) wsRef.current.send({ type: 'subscribe', taskId: id, after: 0 });
  };

  const task = useMemo(() => tasks.find((t) => t.id === selected), [tasks, selected]);

  return (
    <div className="layout">
      <aside>
        <h1>Orquestrator</h1>
        <button className="primary" onClick={() => select(null)}>+ Nueva tarea</button>
        <ul className="tasks">
          {tasks.map((t) => (
            <li key={t.id} className={t.id === selected ? 'active' : ''} onClick={() => select(t.id)}>
              <span className={`dot ${t.status}`} />
              <div>
                <div className="tname">{t.name}</div>
                <div className="tmeta">{t.repo_path.split('/').pop()} · {t.status}</div>
              </div>
            </li>
          ))}
          {!tasks.length && <li className="empty">Sin tareas todavía</li>}
        </ul>
      </aside>
      <main>
        {task
          ? <TaskView key={task.id} task={task} events={events[task.id] || []} onDeleted={() => select(null)} />
          : <NewTask onCreated={(t) => select(t.id)} />}
      </main>
    </div>
  );
}
