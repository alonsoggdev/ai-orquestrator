// Asistente de Orquestrator: recibe una orden en texto (o voz ya transcrita) y deja que un agente
// la ejecute usando el servidor MCP del orquestador.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAgent, getConfig, DEFAULT_AGENT } from './agents/index.js';
import { q } from './db.js';
import { buildInstructions, cleanForSpeech, noticesBlock } from './voice/persona.js';

const MCP_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'mcp/orchestrator-mcp.js');

/** Un único contenido: el texto que se muestra es el mismo que se sintetiza. */
export function finalizeReply(text) {
  const reply = cleanForSpeech(String(text).replace(/^\s*VOZ:\s*/gim, ''));
  return { reply, expectsReply: /[?？]\s*$/.test(reply) };
}

const SESSION_TTL = 10 * 60_000; // la conversación se retoma durante 10 min (para contestar a preguntas del asistente)
let session = { id: null, at: 0 };
let busy = false;

export async function runAssistant({ text, reset = false, fromVoice = false, notices = [], port }) {
  if (busy) throw new Error('El asistente sigue con la orden anterior. Espera un momento.');
  const clean = String(text || '').trim();
  if (!clean) throw new Error('Escribe o di qué quieres hacer.');
  const agent = getAgent(DEFAULT_AGENT);
  if (reset || Date.now() - session.at > SESSION_TTL) session = { id: null, at: 0 };
  busy = true;
  try {
    const r = await agent.assistant({
      text: clean + noticesBlock(notices), config: getConfig(agent.id), system: buildInstructions({ projects: q.listProjects.all().map((p) => p.name), fromVoice }), sessionId: session.id,
      mcpServers: { orquestrator: { command: process.execPath, args: [MCP_PATH], env: { ORQ_URL: `http://127.0.0.1:${port}` } } },
    });
    session = { id: r.sessionId, at: Date.now() };
    return finalizeReply(r.reply);
  } finally { busy = false; }
}
