import React, { useEffect, useState } from 'react';
import Modal from './Modal.jsx';

/** Primer uso del micrófono: explica y descarga el modelo de voz con barra de progreso. */
export default function VoiceSetupModal({ onClose, onReady }) {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState('');

  const refresh = async () => {
    try { setSt((await (await fetch('/api/voice/status')).json()).stt); } catch (e) { setErr(e.message); }
  };
  useEffect(() => { refresh(); }, []);
  // mientras se descarga, consultamos el progreso
  useEffect(() => {
    if (st?.status !== 'downloading') return undefined;
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, [st?.status]);
  useEffect(() => { if (st?.status === 'ready') onReady(); }, [st?.status]); // eslint-disable-line

  const start = async () => {
    setErr('');
    try { await fetch('/api/voice/prepare', { method: 'POST' }); await refresh(); } catch (e) { setErr(e.message); }
  };
  const downloading = st?.status === 'downloading';

  return (
    <Modal title="Activar la voz" onClose={onClose}>
      <div className="modal-body">
        <p>Para entender lo que dices, Orquestrator usa un modelo de reconocimiento de voz que funciona <b>en tu ordenador</b>: tu audio no sale de él.</p>
        <p className="tmeta">Hay que descargarlo una sola vez (unos {st?.sizeMb || 250} MB, desde Hugging Face).</p>
        {downloading && (
          <div className="progress" aria-label="Progreso de la descarga">
            <div className="progress-bar" style={{ width: `${st.progress}%` }} />
            <span>{st.progress}%</span>
          </div>
        )}
        {(err || st?.error) && <div className="error">{err || st.error}</div>}
        <footer className="modal-foot">
          <button onClick={onClose}>{downloading ? 'Seguir en segundo plano' : 'Ahora no'}</button>
          <button className="primary" disabled={downloading || !st} onClick={start}>
            {downloading ? 'Descargando…' : 'Descargar y activar'}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
