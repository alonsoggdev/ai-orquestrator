// Voz en el navegador: grabar (pulsar para hablar) y leer respuestas en voz alta.

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

// ---- Lectura en voz alta ----
export const voiceReplyEnabled = () => localStorage.getItem('voiceReply') !== '0';
export const setVoiceReply = (on) => localStorage.setItem('voiceReply', on ? '1' : '0');

let current = null;
export function stopSpeaking() {
  current?.pause(); current = null;
  window.speechSynthesis?.cancel();
}

/** Lee el texto con el motor local del servidor y, si no hay, con las voces del sistema. */
export async function speak(text) {
  const clean = String(text || '').replace(/[*_`#]/g, '').trim();
  if (!clean) return;
  stopSpeaking();
  try {
    const r = await fetch('/api/voice/speak', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: clean }),
    });
    if (!r.ok) throw new Error('sin motor local');
    const audio = new Audio(URL.createObjectURL(await r.blob()));
    current = audio;
    await audio.play();
    return;
  } catch { /* alternativa: voz del sistema */ }
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = 'es-ES';
  const es = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('es'));
  if (es) u.voice = es;
  speechSynthesis.speak(u);
}
