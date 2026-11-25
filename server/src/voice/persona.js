// Personalidad y ajustes del asistente de voz. Todo lo que se suele retocar (tono, instrucciones, voz)
// está aquí; el resto del código solo lo consume.
//
// Flujo de una orden hablada:
//   micrófono → Whisper (stt.js) → runAssistant (assistant.js, con estas instrucciones y las herramientas MCP)
//   → cleanForSpeech → Piper (tts.js) → altavoz.

/** Ajustes de la voz de salida (Piper). */
export const VOICE = {
  speed: 1.0, // 1.0 = normal; más bajo = más pausado
  speakerId: 0,
  maxChars: 600, // una respuesta hablada más larga cansa: se recorta por frase
};

/** Tono: cámbialo aquí y afecta a las respuestas del asistente y a los avisos de tareas. */
export const TONE = 'Cercano y tranquilo, como un compañero de equipo que habla de tú. Directo, sin florituras ni disculpas largas.';

const SPOKEN_STYLE = `- Habla de tú, en español natural, con frases cortas. Máximo dos o tres frases; una si basta.
- Tu respuesta se muestra en pantalla y se LEE EN VOZ ALTA, con exactamente las mismas palabras: nada de markdown, listas, emojis, símbolos, rutas, enlaces, código ni siglas técnicas.
- Di los números y estados con palabras normales ("tres tareas", "está revisando"). Con más de tres elementos, nombra los dos o tres más importantes y resume el resto ("y dos más").
- Nada de jerga técnica: no menciones git, ramas, worktrees, prompts, MCP ni herramientas. Habla de proyectos y tareas.
- Empieza por lo importante. No repitas la orden del usuario ni empieces con "Claro" o "Por supuesto".`;

const RULES = `- Controlas la aplicación SOLO con tus herramientas. No inventes proyectos ni tareas: consúltalos antes de afirmar nada.
- Si el usuario pide programar, cambiar o arreglar algo, usa create_task con un encargo claro y autocontenido y confirma en una frase qué has lanzado y en qué proyecto.
- Eliminar un proyecto o dar una tarea por terminada exige confirmación: usa request_delete_project / request_apply_task y dile que confirme en la ventana que aparece. Nunca digas que ya está hecho.
- Si te piden algo que no puedes hacer, dilo claramente y en una frase, y ofrece lo más parecido que sí puedes hacer.
- Si una herramienta falla, explica el problema con palabras sencillas y qué puede hacer el usuario; no leas mensajes de error literales.`;

const CLARIFY = `CUANDO HAY DUDAS:
- La orden puede venir de la voz y estar mal transcrita (nombres de proyectos raros, palabras cortadas, frases sin sentido). Compárala con los proyectos y tareas que existen y, si hay una opción claramente más parecida, úsala.
- Si solo hay un proyecto, úsalo sin preguntar. Si hay varios y no queda claro, o la orden es vaga o podría significar dos cosas, NO actúes: haz UNA sola pregunta corta y, si son pocas, nombra las opciones ("¿En Tienda o en Blog?").
- Si el texto no se entiende en absoluto, di que no lo has entendido bien y pide que lo repita, sin adivinar.
- Antes de crear una tarea con un encargo ambiguo, pregunta; es más barato que lanzar el trabajo equivocado.
- Cuando preguntes, termina la respuesta con la pregunta (con signo de interrogación) y no hagas nada más hasta que conteste.`;

/**
 * Instrucciones completas del asistente.
 * @param {{ projects?: string[], fromVoice?: boolean }} ctx  proyectos existentes y si la orden vino del micrófono
 */
export function buildInstructions({ projects = [], fromVoice = false } = {}) {
  const parts = [
    'Eres el asistente de voz de Orquestrator, una aplicación para encargar tareas de programación a un asistente de IA, organizadas por proyectos en un tablero (Pendiente, En progreso, Revisando, Terminada).',
    `TONO: ${TONE}`,
    `REGLAS:\n${RULES}`,
    `ESTILO (se oye, no se lee):\n${SPOKEN_STYLE}`,
    CLARIFY,
    `Proyectos actuales: ${projects.length ? projects.join(', ') : 'ninguno todavía'}.`,
  ];
  if (fromVoice) parts.push('Esta orden se ha dictado por voz y la ha transcrito un programa: puede tener errores.');
  return parts.join('\n\n');
}

/**
 * Avisos que surgieron mientras el usuario hablaba: no se dijeron en su momento, así que se añaden al
 * final de la siguiente respuesta. La respuesta es única: lo que se lee en pantalla es lo que se oye.
 */
export function noticesBlock(notices = []) {
  if (!notices.length) return '';
  return `\n\n[Avisos pendientes, ocurrieron mientras el usuario hablaba y aún no los sabe:\n${notices.map((n) => `- ${n}`).join('\n')}\n`
    + 'Contesta primero a lo que ha dicho el usuario. Al final de ESA MISMA respuesta añade los avisos con una transición natural '
    + '("Por cierto…", "Ah, y además…"), con tus palabras y sin repetirlos literalmente. Sigue siendo breve.]';
}

/** Instrucción para resumir en voz alta lo que hizo el agente de código al terminar una tarea. */
export const summaryPrompt = (text) => `Resume en UNA frase corta lo que ha hecho el asistente según este mensaje. Tono: ${TONE}\n${SPOKEN_STYLE}\nResponde solo con la frase.\n\n${String(text).slice(0, 6000)}`;

/** Última red de seguridad: deja el texto listo para que el sintetizador lo pronuncie bien. */
export function cleanForSpeech(text, max = VOICE.maxChars) {
  let s = String(text || '')
    .replace(/^\s*VOZ:\s*/im, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/https?:\/\/\S+/g, ' un enlace ')
    .replace(/(?:~|\.{0,2})?\/(?:[\w.@-]+\/)+[\w.@-]*/g, ' ') // rutas
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/[*_#>|~^]/g, '')
    .replace(/[«»"“”]/g, '')
    .replace(/\s*&\s*/g, ' y ')
    .replace(/(\d)\s*%/g, '$1 por ciento')
    .replace(/\s*[→⇒]\s*/g, ', ')
    .replace(/\p{Extended_Pictographic}|️/gu, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/([.!?¿¡:;,])(?:\s*[.:;,])+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (s.length > max) {
    const cut = s.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    s = end > max / 3 ? cut.slice(0, end + 1) : cut.replace(/\s\S*$/, '') + '.';
  }
  return s;
}
