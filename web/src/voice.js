// Voz en el navegador: grabar (pulsar para hablar) y leer respuestas en voz alta.
import { addMessage } from './conversation.js';

/** Empieza a grabar. Devuelve { stop(): Promise<Float32Array|null>, cancel() }. El audio sale a 16 kHz mono. */
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks = [];
  const t0 = Date.now();
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.start();
  const release = () => stream.getTracks().forEach((t) => t.stop());
  return {
    cancel() { rec.onstop = release; if (rec.state !== 'inactive') rec.stop(); else release(); },
    stop: () => new Promise((resolve, reject) => {
      rec.onstop = async () => {
        release();
        if (Date.now() - t0 < 400) return resolve(null); // pulsación accidental
        try {
          const ctx = new AudioContext({ sampleRate: 16000 });
          const audio = await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer());
          ctx.close();
          resolve(audio.getChannelData(0).slice());
        } catch (e) { reject(e); }
      };
      rec.stop();
    }),
  };
}

export async function transcribeAudio(f32) {
  const r = await fetch('/api/voice/transcribe', {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'No se pudo transcribir'), { code: data.code });
  return data.text;
}

// ---- Elección de voz (se guarda en este navegador) ----
// Valores: '' (automática) | 'piper:<carpeta>' (voz local del servidor) | 'system:<nombre>' (voz del sistema).
export const getVoiceChoice = () => localStorage.getItem('voiceChoice') || '';
export const setVoiceChoice = (v) => localStorage.setItem('voiceChoice', v);

/** Voces en español del sistema (cargan de forma asíncrona en algunos navegadores). */
export const systemVoices = () => (window.speechSynthesis?.getVoices() || []).filter((v) => v.lang.toLowerCase().startsWith('es'));

// ---- Lectura en voz alta ----
export const voiceReplyEnabled = () => localStorage.getItem('voiceReply') !== '0';
export const setVoiceReply = (on) => localStorage.setItem('voiceReply', on ? '1' : '0');

// Todo lo que dice el asistente pasa por una única cola: nada se pisa y nada corta lo que se está diciendo.
const queue = [];
let current = null; // { stop() } de lo que suena ahora
let draining = false;

export function stopSpeaking() {
  queue.length = 0;
  current?.stop();
  window.speechSynthesis?.cancel();
}

/** Añade el texto a la cola de lectura. */
export function speak(text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  queue.push(clean);
  if (!draining) drain();
}

async function drain() {
  draining = true;
  while (queue.length) await playOne(queue.shift());
  draining = false;
}

/** Lee un texto con la voz elegida; si falla el motor local, con las voces del sistema. */
async function playOne(text) {
  const choice = getVoiceChoice();
  if (!choice.startsWith('system:')) {
    try {
      const r = await fetch('/api/voice/speak', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: choice.startsWith('piper:') ? choice.slice(6) : undefined }),
      });
      if (!r.ok) throw new Error('sin motor local');
      const audio = new Audio(URL.createObjectURL(await r.blob()));
      await new Promise((resolve) => {
        current = { stop: () => { audio.pause(); resolve(); } };
        audio.onended = audio.onerror = resolve;
        audio.play().catch(resolve);
      });
      current = null;
      return;
    } catch { /* alternativa: voz del sistema */ }
  }
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'es-ES';
  const wanted = choice.startsWith('system:') ? choice.slice(7) : null;
  const voices = systemVoices();
  const v = (wanted && voices.find((x) => x.name === wanted)) || voices[0];
  if (v) u.voice = v;
  await new Promise((resolve) => {
    current = { stop: resolve };
    u.onend = u.onerror = resolve;
    speechSynthesis.speak(u);
  });
  current = null;
}

// ---- Avisos del asistente (p. ej. "he terminado una tarea") ----
// Mientras el usuario habla (o el asistente trabaja en su orden) no se dicen: esperan y se añaden al final
// de la siguiente respuesta. Si no llega ninguna orden, se dicen al terminar.
let held = false;
const pending = [];

export function announce(text) {
  if (held) { pending.push(text); return; }
  addMessage('assistant', text, { notice: true });
  if (voiceReplyEnabled()) speak(text);
}
export const takePending = () => pending.splice(0);
export const restorePending = (items) => pending.unshift(...items);
/** El usuario está hablando o esperando respuesta: no hay que interrumpirle. Al soltar se vacía la cola. */
export function setHold(on) {
  held = on;
  if (!on) pending.splice(0).forEach(announce);
}
