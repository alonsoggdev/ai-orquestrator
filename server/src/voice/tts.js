// Texto → voz con una voz de Piper en español ejecutada localmente (sherpa-onnx).
// Los archivos de la voz viven en data/voice/. Si no están, la interfaz usa las voces del sistema.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/voice/vits-piper-es_ES-davefx-medium');
const MODEL = path.join(DIR, 'es_ES-davefx-medium.onnx');

let tts = null;
let failed = null;

const installed = () => fs.existsSync(MODEL);
export const ttsStatus = () => ({ engine: 'piper', voice: 'es_ES-davefx-medium', ready: installed() && !failed, error: failed });

function load() {
  if (tts) return tts;
  const sherpa = require('sherpa-onnx-node');
  tts = new sherpa.OfflineTts({
    model: {
      vits: { model: MODEL, tokens: path.join(DIR, 'tokens.txt'), dataDir: path.join(DIR, 'espeak-ng-data') },
      debug: false, numThreads: 2, provider: 'cpu',
    },
    maxNumSentences: 2,
  });
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

/** Devuelve un WAV con el texto hablado. Lanza TTS_MISSING si la voz no está disponible. */
export async function synthesize(text) {
  const clean = String(text || '').replace(/[*_`#]/g, '').trim().slice(0, 1500);
  if (!clean) throw new Error('No hay texto que leer');
  if (!installed()) throw Object.assign(new Error('La voz local no está instalada.'), { code: 'TTS_MISSING' });
  try {
    const a = load().generate({ text: clean, sid: 0, speed: 1.0 });
    return toWav(a.samples, a.sampleRate);
  } catch (e) {
    failed = e.message;
    throw Object.assign(new Error(`La voz local falló: ${e.message}`), { code: 'TTS_MISSING' });
  }
}
