import React, { useEffect, useRef, useState } from 'react';
import { clearMessages, useMessages } from './conversation.js';

const hour = (at) => new Date(at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

/** Ventana flotante (abajo a la derecha) con toda la conversación: lo que dices y todo lo que dice el asistente. */
export default function ConversationPanel() {
  const messages = useMessages();
  const [open, setOpen] = useState(true);
  const listRef = useRef(null);
  const last = messages.length;

  // un mensaje nuevo despliega la ventana y baja hasta el final
  const prev = useRef(last);
  useEffect(() => { if (last > prev.current) setOpen(true); prev.current = last; }, [last]);
  useEffect(() => { if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [last, open]);

  if (!messages.length) return null;
  return (
    <section className={`conversation ${open ? 'open' : ''}`} aria-label="Conversación con el asistente">
      <header onClick={() => setOpen(!open)}>
        <span className="grow">Conversación <span className="tmeta">· {messages.filter((m) => m.role !== 'divider').length} mensajes</span></span>
        {open && <button className="link-btn" onClick={(e) => { e.stopPropagation(); clearMessages(); }}>Borrar</button>}
        <button className="icon-btn" aria-label={open ? 'Minimizar' : 'Abrir'}>{open ? '▾' : '▴'}</button>
      </header>
      {open && (
        <div className="conversation-list" ref={listRef} aria-live="polite">
          {messages.map((m) => m.role === 'divider' ? (
            <div key={m.id} className="conv-divider tmeta">{m.text}</div>
          ) : (
            <div key={m.id} className={`conv-msg ${m.role} ${m.error ? 'bad' : ''}`}>
              <div className="bubble">{m.text}</div>
              <div className="tmeta">{m.role === 'user' ? (m.voice ? 'Tú (voz)' : 'Tú') : m.notice ? 'Aviso' : 'Asistente'} · {hour(m.at)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
