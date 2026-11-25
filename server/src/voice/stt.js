// Voz → texto con Whisper local (transformers.js + ONNX). El modelo se descarga una vez a data/models.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = 'onnx-community/whisper-small';
const CACHE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/models');
const MODEL_FILE = path.join(CACHE, MODEL, 'onnx', 'decoder_model_merged_quantized.onnx');

let asr = null;
let loading = null;
const state = { status: fs.existsSync(MODEL_FILE) ? 'ready' : 'missing', progress: 0, error: null };
const files = new Map(); // fichero -> { loaded, total }

export const sttStatus = () => ({ ...state, model: MODEL, sizeMb: 250 });

/** Descarga (si hace falta) y carga el modelo. onProgress(state) se llama durante la descarga. */
export function prepareStt(onProgress = () => {}) {
  if (asr) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    state.error = null;
    if (state.status !== 'ready') { state.status = 'downloading'; state.progress = 0; }
    onProgress(sttStatus());
    try {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = CACHE;
      asr = await pipeline('automatic-speech-recognition', MODEL, {
        dtype: 'q8', device: 'cpu',
        progress_callback: (p) => {
          if (p.status !== 'progress' || !p.total) return;
          files.set(p.file, { loaded: p.loaded, total: p.total });
          let l = 0, t = 0;
          for (const f of files.values()) { l += f.loaded; t += f.total; }
          state.progress = t ? Math.min(99, Math.round((l / t) * 100)) : 0;
          onProgress(sttStatus());
        },
      });
      state.status = 'ready'; state.progress = 100;
    } catch (e) {
      state.status = fs.existsSync(MODEL_FILE) ? 'ready' : 'missing';
      state.error = e.message;
      throw e;
    } finally { loading = null; onProgress(sttStatus()); }
  })();
  return loading;
}

// Whisper "alucina" frases de vídeos de YouTube cuando oye silencio o ruido: se descartan.
const PHANTOM = /subt[ií]tulos|amara\.org|suscr[ií]b|gracias por (ver|vuestra|su atenci)|hasta la pr[oó]xima|m[uú]sica|^[\s.,!¡¿?…-]*$/i;
const MIN_RMS = 0.003; // por debajo es silencio

/** audio: Float32Array mono a 16 kHz. Devuelve '' si no hay voz reconocible. */
export async function transcribe(audio) {
  if (state.status === 'missing' || state.status === 'downloading') {
    throw Object.assign(new Error('El modelo de voz aún no está descargado.'), { code: 'MODEL_MISSING' });
  }
  let sum = 0;
  for (let i = 0; i < audio.length; i++) sum += audio[i] * audio[i];
  if (Math.sqrt(sum / audio.length) < MIN_RMS) return '';
  await prepareStt();
  const out = await asr(audio, { language: 'spanish', task: 'transcribe', chunk_length_s: 30 });
  const text = String(out.text || '').trim();
  return PHANTOM.test(text) && text.length < 60 ? '' : text;
}
