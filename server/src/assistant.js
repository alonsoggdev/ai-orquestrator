// Asistente de Orquestrator: recibe una orden en texto (o voz ya transcrita) y deja que un agente
// la ejecute usando el servidor MCP del orquestador.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAgent, getConfig, DEFAULT_AGENT } from './agents/index.js';
import { q } from './db.js';
import { buildInstructions, cleanForSpeech } from './voice/persona.js';

const MCP_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'mcp/orchestrator-mcp.js');

/** La respuesta ya se escribe para ser escuchada; si el modelo añade una línea "VOZ:" se usa esa. */
export function splitSpoken(text) {
  const m = String(text).match(/^([\s\S]*?)\n?\s*VOZ:\s*([\s\S]*)$/);
  const reply = (m ? m[2] : text).trim();
  const spoken = cleanForSpeech(reply);
  return { reply: m && m[1].trim() ? m[1].trim() : reply, spoken, expectsReply: /[?？]\s*$/.test(spoken) };
}

const SESSION_TTL = 10 * 60_000; // la conversación se retoma durante 10 min (para contestar a preguntas del asistente)
let session = { id: null, at: 0 };
let busy = false;

export async function runAssistant({ text, reset = false, fromVoice = false, port }) {
  if (busy) throw new Error('El asistente sigue con la orden anterior. Espera un momento.');
  const clean = String(text || '').trim();
  if (!clean) throw new Error('Escribe o di qué quieres hacer.');
  const agent = getAgent(DEFAULT_AGENT);
  if (reset || Date.now() - session.at > SESSION_TTL) session = { id: null, at: 0 };
  busy = true;
  try {
    const r = await agent.assistant({
      text: clean, config: getConfig(agent.id), system: buildInstructions({ projects: q.listProjects.all().map((p) => p.name), fromVoice }), sessionId: session.id,
      mcpServers: { orquestrator: { command: process.execPath, args: [MCP_PATH], env: { ORQ_URL: `http://127.0.0.1:${port}` } } },
    });
    session = { id: r.sessionId, at: Date.now() };
    return splitSpoken(r.reply);
  } finally { busy = false; }
}
