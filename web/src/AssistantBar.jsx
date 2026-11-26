import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import VoiceSetupModal from './VoiceSetupModal.jsx';
import { addMessage } from './conversation.js';
import { restorePending, setHold, setVoiceReply, speak, startRecording, stopSpeaking, takePending, transcribeAudio, voiceReplyEnabled } from './voice.js';

const MicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
const SpeakerIcon = ({ off }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 9v6h4l5 4V5L8 9H4z" />{off ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14" />}
  </svg>
);

/** Barra del asistente: escribes o mantienes pulsado el micrófono (o Ctrl+Espacio) y hablas. */
export default function AssistantBar() {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | recording | transcribing | working
  const [ask, setAsk] = useState(false); // el asistente ha hecho una pregunta y espera respuesta
  const [fresh, setFresh] = useState(true); // próxima orden empieza conversación nueva
  const [voiceOn, setVoiceOn] = useState(voiceReplyEnabled());
  const [setup, setSetup] = useState(false);
  const inputRef = useRef(null);
  const rec = useRef(null);
  const busy = phase === 'working' || phase === 'transcribing';

  // Ctrl/Cmd + K enfoca la barra
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Mientras hablas o esperas respuesta, los avisos del asistente esperan (y se añaden a su siguiente respuesta).
  useEffect(() => { setHold(phase !== 'idle'); }, [phase]);
  useEffect(() => () => setHold(false), []);

  const run = async (t, heard) => {
    setPhase('working'); setAsk(false);
    addMessage('user', t, { voice: !!heard });
    const notices = takePending();
    try {
      const r = await api.assistant(t, fresh, !!heard, notices);
      addMessage('assistant', r.reply); // el mismo texto que se lee en voz alta
      setAsk(!!r.expectsReply); setFresh(false); setText('');
      if (voiceOn) speak(r.reply);
    } catch (err) { restorePending(notices); addMessage('assistant', err.message, { error: true }); }
    finally { setPhase('idle'); }
  };

  const send = (e) => {
    e.preventDefault();
    if (text.trim() && !busy) run(text.trim());
  };

  // ---- pulsar para hablar ----
  const startTalking = async () => {
    if (phase !== 'idle') return;
    stopSpeaking();
    try {
      const st = (await (await fetch('/api/voice/status')).json()).stt;
      if (st.status !== 'ready') { setSetup(true); return; }
      setPhase('recording');
      rec.current = await startRecording();
    } catch (e) {
      setPhase('idle');
      addMessage('assistant', e.name === 'NotAllowedError' ? 'No tengo permiso para usar el micrófono. Actívalo en los permisos del navegador.' : `No se pudo usar el micrófono: ${e.message}`, { error: true });
    }
  };
  const stopTalking = async () => {
    const r = rec.current; rec.current = null;
    if (!r) { if (phase === 'recording') setPhase('idle'); return; }
    setPhase('transcribing');
    try {
      const audio = await r.stop();
      if (!audio) { setPhase('idle'); return; }
      const heard = await transcribeAudio(audio);
      if (!heard) { setPhase('idle'); addMessage('assistant', 'No te he oído bien. Acércate al micrófono e inténtalo de nuevo.', { error: true }); return; }
      setText(heard);
      await run(heard, heard);
    } catch (e) {
      setPhase('idle');
      if (e.code === 'MODEL_MISSING') setSetup(true); else addMessage('assistant', e.message, { error: true });
    }
  };

  // Ctrl + Espacio (mantener) = hablar
  const talkRef = useRef({ start: startTalking, stop: stopTalking });
  talkRef.current = { start: startTalking, stop: stopTalking };
  useEffect(() => {
    let down = false;
    const kd = (e) => {
      if (e.ctrlKey && e.code === 'Space' && !e.repeat && !down) { e.preventDefault(); down = true; talkRef.current.start(); }
    };
    const ku = (e) => {
      if (down && (e.code === 'Space' || e.key === 'Control')) { down = false; talkRef.current.stop(); }
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, []);

  const placeholder = {
    idle: ask ? 'Responde al asistente… (mantén el micrófono)' : 'Pídele algo al asistente… (Ctrl+K)',
    recording: 'Te escucho… suelta para enviar',
    transcribing: 'Transcribiendo lo que has dicho…',
    working: 'El asistente está trabajando…',
  }[phase];

  return (
    <div className="assistant">
      <form className="assistant-bar" onSubmit={send}>
        <span className="assistant-spark" aria-hidden="true">✦</span>
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} disabled={phase !== 'idle'} placeholder={placeholder} />
        {!fresh && phase === 'idle' && <button type="button" className="link-btn" onClick={() => { setFresh(true); setAsk(false); addMessage('divider', 'Nueva conversación'); }}>Nueva conversación</button>}
        <button type="button" className={`round-btn ${voiceOn ? '' : 'muted'}`} title={voiceOn ? 'Respuestas en voz alta: activadas' : 'Respuestas en voz alta: desactivadas'}
          onClick={() => { const v = !voiceOn; setVoiceOn(v); setVoiceReply(v); if (!v) stopSpeaking(); }}><SpeakerIcon off={!voiceOn} /></button>
        <button type="button" className={`round-btn mic ${phase === 'recording' ? 'live' : ''}`} disabled={busy}
          title="Mantén pulsado para hablar (Ctrl+Espacio)"
          onPointerDown={(e) => { e.preventDefault(); startTalking(); }} onPointerUp={stopTalking} onPointerLeave={() => { if (phase === 'recording') stopTalking(); }}>
          <MicIcon />
        </button>
        <button className="primary" disabled={busy || phase === 'recording' || !text.trim()}>{busy ? '…' : 'Enviar'}</button>
      </form>
      {setup && <VoiceSetupModal onClose={() => setSetup(false)} onReady={() => setSetup(false)} />}
    </div>
  );
}
