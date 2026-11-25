// Historial de la conversación con el asistente (lo que dice el usuario y lo que dice el asistente).
// Es el único sitio donde se guarda el contenido: lo que se muestra es lo mismo que se oye.
import { useSyncExternalStore } from 'react';

const KEY = 'conversation';
const MAX = 200;

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
let messages = load();
const subs = new Set();
const emit = () => {
  try { localStorage.setItem(KEY, JSON.stringify(messages)); } catch { /* sin espacio: seguimos en memoria */ }
  subs.forEach((f) => f());
};

/** role: 'user' | 'assistant' | 'divider'. extra: { voice, error, notice }. */
export function addMessage(role, text, extra = {}) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  messages = [...messages, { id, role, text, at: Date.now(), ...extra }].slice(-MAX);
  emit();
}
export function clearMessages() { messages = []; emit(); }

export const useMessages = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => messages);
