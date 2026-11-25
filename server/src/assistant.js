// Asistente de Orquestrator: recibe una orden en texto (o voz ya transcrita) y deja que un agente
// la ejecute usando el servidor MCP del orquestador.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAgent, getConfig, DEFAULT_AGENT } from './agents/index.js';

const MCP_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'mcp/orchestrator-mcp.js');

const SYSTEM = `Eres el asistente de Orquestrator, una aplicación para encargar tareas de programación a un asistente de IA, organizadas por proyectos en un tablero (Pendiente, En progreso, Revisando, Terminada).
Controlas la aplicación SOLO con tus herramientas. Reglas:
- Responde siempre en español, en una o dos frases cortas, sin jerga técnica (nada de git, ramas ni worktrees).
- Si el usuario pide programar, cambiar o arreglar algo en un proyecto, usa create_task con un prompt claro y autocontenido. Si solo hay un proyecto, úsalo sin preguntar; si hay varios y no queda claro, pregunta cuál.
- Eliminar un proyecto o dar una tarea por terminada exige confirmación del usuario: usa request_delete_project / request_apply_task y dile que confirme en la ventana que aparece. Nunca digas que ya está hecho.
- No inventes proyectos ni tareas: consúltalos con las herramientas. Si el texto parece mal transcrito, interpreta lo más razonable y, si dudas, pregunta.
- Si te piden algo que no puedes hacer con tus herramientas, dilo claramente.
- FORMATO DE LA RESPUESTA FINAL: primero tu respuesta normal. Después, en una última línea aparte, escribe "VOZ: " seguido de un resumen de UNA frase corta pensado para leerse en voz alta (natural, sin markdown, sin símbolos, sin emojis, sin rutas ni nombres técnicos).`;

/** Separa la respuesta completa del resumen hablado ("VOZ: …" en la última línea). */
export function splitSpoken(text) {
  const m = text.match(/^([\s\S]*?)\n?\s*VOZ:\s*([\s\S]*)$/);
  if (!m) return { reply: text, spoken: text.replace(/[*_`#]/g, '').split(/(?<=[.!?])\s/)[0] };
  return { reply: m[1].trim(), spoken: m[2].trim() };
}

const SESSION_TTL = 10 * 60_000; // la conversación se retoma durante 10 min (para contestar a preguntas del asistente)
let session = { id: null, at: 0 };
let busy = false;

export async function runAssistant({ text, reset = false, port }) {
  if (busy) throw new Error('El asistente sigue con la orden anterior. Espera un momento.');
  const clean = String(text || '').trim();
  if (!clean) throw new Error('Escribe o di qué quieres hacer.');
  const agent = getAgent(DEFAULT_AGENT);
  if (reset || Date.now() - session.at > SESSION_TTL) session = { id: null, at: 0 };
  busy = true;
  try {
    const r = await agent.assistant({
      text: clean, config: getConfig(agent.id), system: SYSTEM, sessionId: session.id,
      mcpServers: { orquestrator: { command: process.execPath, args: [MCP_PATH], env: { ORQ_URL: `http://127.0.0.1:${port}` } } },
    });
    session = { id: r.sessionId, at: Date.now() };
    return splitSpoken(r.reply);
  } finally { busy = false; }
}
