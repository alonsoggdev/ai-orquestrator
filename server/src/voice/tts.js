// Texto → voz con una voz de Piper en español ejecutada localmente (sherpa-onnx).
// Las voces viven en data/voice/<carpeta>/ (una por carpeta). Si no hay ninguna, la interfaz usa las voces del sistema.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { VOICE, cleanForSpeech } from './persona.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/voice');
const DEFAULT_VOICE = 'vits-piper-es_ES-davefx-medium';

const engines = new Map(); // id de voz -> OfflineTts
let failed = null;

/** Voces de Piper instaladas: una carpeta de data/voice/ con su .onnx y tokens.txt. */
export function listVoices() {
  let dirs = [];
  try { dirs = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return []; }
  return dirs.flatMap((d) => {
    const onnx = fs.readdirSync(path.join(ROOT, d.name)).find((f) => f.endsWith('.onnx'));
    if (!onnx || !fs.existsSync(path.join(ROOT, d.name, 'tokens.txt'))) return [];
    return [{ id: d.name, label: onnx.replace(/\.onnx$/, '').replace(/-/g, ' · ').replace(/_/g, '-'), model: path.join(ROOT, d.name, onnx) }];
  });
}

/** Voz pedida; si no existe, la predeterminada o la primera instalada. */
const pickVoice = (id) => {
  const all = listVoices();
  return all.find((v) => v.id === id) || all.find((v) => v.id === DEFAULT_VOICE) || all[0] || null;
};

export const ttsStatus = () => {
  const voices = listVoices().map(({ id, label }) => ({ id, label }));
  return { engine: 'piper', voices, ready: voices.length > 0 && !failed, error: failed };
};

function load(voice) {
  if (engines.has(voice.id)) return engines.get(voice.id);
  const sherpa = require('sherpa-onnx-node');
  const dir = path.join(ROOT, voice.id);
  const tts = new sherpa.OfflineTts({
    model: {
      vits: { model: voice.model, tokens: path.join(dir, 'tokens.txt'), dataDir: path.join(dir, 'espeak-ng-data') },
      debug: false, numThreads: 2, provider: 'cpu',
    },
    maxNumSentences: 2,
  });
  engines.set(voice.id, tts);
  return tts;
}

/** WAV PCM 16 bits mono a partir de muestras float. */
function toWav(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-1, Math.min(1, samples[i])) * 32767 | 0, 44 + i * 2);
  return buf;
}

/** Devuelve un WAV con el texto hablado con la voz indicada. Lanza TTS_MISSING si no hay voz disponible. */
export async function synthesize(text, voiceId) {
  const clean = cleanForSpeech(text, VOICE.maxChars * 3);
  if (!clean) throw new Error('No hay texto que leer');
  const voice = pickVoice(voiceId);
  if (!voice) throw Object.assign(new Error('La voz local no está instalada.'), { code: 'TTS_MISSING' });
  try {
    const a = load(voice).generate({ text: clean, sid: VOICE.speakerId, speed: VOICE.speed });
    return toWav(a.samples, a.sampleRate);
  } catch (e) {
    failed = e.message;
    throw Object.assign(new Error(`La voz local falló: ${e.message}`), { code: 'TTS_MISSING' });
  }
}
