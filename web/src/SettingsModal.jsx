import React, { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { getVoiceChoice, setVoiceChoice, speak, stopSpeaking, systemVoices } from './voice.js';

/** Ajustes de la aplicación. Por ahora: qué voz usa el asistente para hablar (se guarda al elegirla). */
export default function SettingsModal({ onClose }) {
  const [choice, setChoice] = useState(getVoiceChoice());
  const [local, setLocal] = useState([]); // voces de Piper instaladas en el servidor
  const [system, setSystem] = useState(systemVoices());

  useEffect(() => {
    fetch('/api/voice/status').then((r) => r.json()).then((s) => setLocal(s.tts?.voices || [])).catch(() => {});
    const update = () => setSystem(systemVoices());
    window.speechSynthesis?.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', update);
  }, []);

  const pick = (v) => { setChoice(v); setVoiceChoice(v); };
  const test = () => { stopSpeaking(); speak('Hola, soy tu asistente. Así sueno al hablar.'); };

  return (
    <Modal title="Ajustes" onClose={onClose}>
      <div className="modal-body">
        <label>
          Voz del asistente
          <select value={choice} onChange={(e) => pick(e.target.value)}>
            <option value="">Automática</option>
            {local.length > 0 && (
              <optgroup label="Voces locales (sin conexión)">
                {local.map((v) => <option key={v.id} value={`piper:${v.id}`}>{v.label}</option>)}
              </optgroup>
            )}
            {system.length > 0 && (
              <optgroup label="Voces del sistema">
                {system.map((v) => <option key={v.name} value={`system:${v.name}`}>{v.name}</option>)}
              </optgroup>
            )}
          </select>
        </label>
        <p className="tmeta">Se guarda al elegirla. Las voces locales se instalan en la carpeta data/voice.</p>
        <footer className="modal-foot">
          <button onClick={test}>Probar voz</button>
          <button className="primary" onClick={onClose}>Listo</button>
        </footer>
      </div>
    </Modal>
  );
}
