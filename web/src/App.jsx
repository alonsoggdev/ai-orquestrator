import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, connectWS } from './api.js';
import Onboarding from './Onboarding.jsx';
import Dashboard from './Dashboard.jsx';
import NewProjectModal from './NewProjectModal.jsx';
import NewTaskModal from './NewTaskModal.jsx';
import ContextMenu from './ContextMenu.jsx';
import AssistantBar from './AssistantBar.jsx';
import { MoveModal } from './Kanban.jsx';
import { EditProjectModal, DeleteProjectModal } from './ProjectModals.jsx';
import TaskView from './TaskView.jsx';
import { groupProjects, timeAgo } from './projects.js';
import ConversationPanel from './ConversationPanel.jsx';
import SettingsModal from './SettingsModal.jsx';
import { announce } from './voice.js';

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [projectList, setProjectList] = useState([]);
  const [selected, setSelected] = useState(null); // id de tarea abierta (detalle)
  const [projectPath, setProjectPath] = useState(null); // null = resumen de todos
  const [modal, setModal] = useState(null); // 'project' | 'task' | { edit } | { remove }
  const [menu, setMenu] = useState(null); // { x, y, project }
  const [confirm, setConfirm] = useState(null); // { kind, id, label } pedido por el asistente
  const [events, setEvents] = useState({}); // taskId -> [event]
  const [onboarded, setOnboarded] = useState(null); // null = cargando
  const wsRef = useRef(null);
  const selectedRef = useRef(null);
  selectedRef.current = selected;

  const loadProjects = () => api.projects().then((p) => setProjectList(Array.isArray(p) ? p : []));

  useEffect(() => {
    api.list().then(setTasks);
    loadProjects();
    api.setup().then((s) => setOnboarded(s.completed)).catch(() => setOnboarded(true));
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
        } else if (m.type === 'projects') {
          loadProjects(); // otra ventana (o el asistente) cambió los proyectos
        } else if (m.type === 'speak') {
          // resumen hablado de una tarea; solo suena en la ventana visible
          if (document.visibilityState === 'visible') announce(m.text);
        } else if (m.type === 'confirm') {
          setConfirm(m); // el asistente pide confirmación de una acción peligrosa
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

  const openTask = (id) => {
    if (selected) wsRef.current.send({ type: 'unsubscribe', taskId: selected });
    setSelected(id);
    if (id) wsRef.current.send({ type: 'subscribe', taskId: id, after: 0 });
  };
  const goProject = (path = null) => { openTask(null); setProjectPath(path); };

  const projects = useMemo(() => groupProjects(projectList, tasks), [projectList, tasks]);
  const project = projects.find((p) => p.path === projectPath) || null;
  const task = useMemo(() => tasks.find((t) => t.id === selected), [tasks, selected]);
  const scoped = project ? project.tasks : tasks;

  if (onboarded === null) return null;
  if (!onboarded) return <Onboarding onDone={() => setOnboarded(true)} />;

  return (
    <div className="layout"
      // menú del navegador fuera de los campos de texto (ahí sirve para copiar y pegar)
      onContextMenu={(e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); }}>
      <aside>
        <h1>Orquestrator</h1>
        <ul className="tasks nav">
          <li className={!selected && !project ? 'active' : ''} onClick={() => goProject(null)}>
            <div className="tname">Resumen</div>
          </li>
        </ul>
        <div className="section-head">
          <span className="tmeta section-title">Proyectos</span>
          <button className="link-btn" onClick={() => setModal('project')}>+ Nuevo proyecto</button>
        </div>
        <ul className="tasks">
          {projects.map((p) => (
            <li key={p.path} className={project?.path === p.path ? 'active' : ''} onClick={() => goProject(p.path)}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, project: p }); }}>
              <span className={`dot ${p.running ? 'running' : 'idle'}`} />
              <div>
                <div className="tname">{p.name}</div>
                <div className="tmeta">{timeAgo(p.last)} · {p.tasks.length} {p.tasks.length === 1 ? 'tarea' : 'tareas'}</div>
              </div>
            </li>
          ))}
          {!projects.length && <li className="empty">Sin proyectos todavía</li>}
        </ul>
        <button className="link-btn settings-link" onClick={() => setModal('settings')}>Ajustes</button>
      </aside>

      <main>
        {selected && task ? (
          <TaskView key={task.id} task={task} events={events[task.id] || []}
            onBack={() => goProject(task.repo_path)} onDeleted={() => goProject(task.repo_path)} />
        ) : (
          <Dashboard tasks={scoped} project={project} onNewTask={() => setModal('task')}
            onOpenTask={(t) => { setProjectPath(t.repo_path); openTask(t.id); }} />
        )}
        {!projects.length && !selected && (
          <div className="welcome">
            <div>Empieza creando tu primer proyecto</div>
            <button className="primary" onClick={() => setModal('project')}>+ Nuevo proyecto</button>
          </div>
        )}
      </main>

      <AssistantBar />
      <ConversationPanel />
      {confirm?.kind === 'delete_project' && projects.find((p) => p.id === confirm.id) && (
        <DeleteProjectModal project={projects.find((p) => p.id === confirm.id)} onClose={() => setConfirm(null)}
          onDeleted={() => {
            const gone = projects.find((p) => p.id === confirm.id); setConfirm(null);
            if (gone && projectPath === gone.path) goProject(null);
            loadProjects();
          }} />
      )}
      {confirm?.kind === 'apply_task' && tasks.find((t) => t.id === confirm.id) && (
        <MoveModal move={{ kind: 'apply', task: tasks.find((t) => t.id === confirm.id) }} onClose={() => setConfirm(null)} />
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          { label: 'Editar proyecto', onClick: () => setModal({ edit: menu.project }) },
          { label: 'Eliminar proyecto', danger: true, onClick: () => setModal({ remove: menu.project }) },
        ]} />
      )}
      {modal?.edit && (
        <EditProjectModal project={modal.edit} onClose={() => setModal(null)}
          onSaved={() => { setModal(null); loadProjects(); }} />
      )}
      {modal?.remove && (
        <DeleteProjectModal project={modal.remove} onClose={() => setModal(null)}
          onDeleted={() => {
            const gone = modal.remove; setModal(null);
            if (projectPath === gone.path) goProject(null);
            loadProjects();
          }} />
      )}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {modal === 'project' && (
        <NewProjectModal onClose={() => setModal(null)}
          onCreated={(p) => { setModal(null); loadProjects().then(() => goProject(p.path)); }} />
      )}
      {modal === 'task' && project && (
        <NewTaskModal project={project} onClose={() => setModal(null)}
          onCreated={() => setModal(null)} />
      )}
    </div>
  );
}
