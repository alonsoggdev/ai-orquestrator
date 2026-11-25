import React, { useEffect, useState } from 'react';
import { api } from './api.js';

function Row({ ok, title, detail, action }) {
  return (
    <li className={ok ? 'ok' : 'bad'}>
      <span className={`dot ${ok ? 'done' : 'error'}`} />
      <div className="grow">
        <div className="tname">{title}</div>
        {detail && <div className="tmeta">{detail}</div>}
      </div>
      {action}
    </li>
  );
}

/** Conectar la cuenta sin terminal: abrir página, pegar código. */
function Connect({ agent, onConnected }) {
  const [step, setStep] = useState('idle'); // idle | starting | code | verifying
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  const start = async () => {
    setErr(''); setStep('starting');
    try { setUrl((await api.startLogin(agent.id)).url); setStep('code'); }
    catch (e) { setErr(e.message); setStep('idle'); }
  };
  const confirm = async () => {
    setErr(''); setStep('verifying');
    try {
      const r = await api.submitLoginCode(agent.id, code);
      if (!r.ok) throw new Error(r.error);
      setStep('idle'); setCode(''); onConnected();
    } catch (e) { setErr(e.message); setStep('code'); }
  };

  if (step === 'idle' || step === 'starting') {
    return (
      <>
        <button className="primary" onClick={start} disabled={step === 'starting'}>
          {step === 'starting' ? 'Preparando…' : 'Conectar cuenta'}
        </button>
        {err && <div className="error">{err}</div>}
      </>
    );
  }
  return (
    <div className="connect">
      <div>1. <a href={url} target="_blank" rel="noreferrer">Abre esta página</a> e inicia sesión con tu cuenta de Claude.</div>
      <div>2. Copia el código que te enseña y pégalo aquí:</div>
      <div className="inline">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código" autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }} />
        <button className="primary" onClick={confirm} disabled={!code.trim() || step === 'verifying'}>
          {step === 'verifying' ? 'Comprobando…' : 'Confirmar'}
        </button>
      </div>
      {err && <div className="error">{err}</div>}
    </div>
  );
}

function AgentCard({ agent, advanced, onChanged }) {
  const [form, setForm] = useState(agent.config);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState(null); // null | 'running' | {ok, ...}
  const [err, setErr] = useState('');
  const dirty = agent.fields.some((f) => (form[f.key] || '') !== (agent.config[f.key] || ''));

  const save = async () => {
    setBusy(true); setErr(''); setTest(null);
    try { await api.saveAgentConfig(agent.id, form); await onChanged(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const runTest = async () => {
    setTest('running');
    try { setTest(await api.testAgent(agent.id)); } catch (e) { setTest({ ok: false, error: e.message }); }
  };

  return (
    <>
      <Row ok={agent.ok}
        title={agent.ok ? `${agent.label} está instalado` : `${agent.label} no está instalado`}
        detail={agent.ok ? (advanced && agent.version) : `${agent.hint}`} />
      {agent.ok && (
        <Row ok={agent.auth.loggedIn}
          title={agent.auth.loggedIn ? 'Tu cuenta está conectada' : 'Falta conectar tu cuenta'}
          detail={agent.auth.loggedIn
            ? (advanced && [agent.auth.method, agent.auth.plan].filter(Boolean).join(' · '))
            : 'Necesitas una cuenta de Claude para que el asistente pueda trabajar.'}
          action={!agent.auth.loggedIn && <Connect agent={agent} onConnected={onChanged} />} />
      )}
      {agent.ready && (
        <li className="plain">
          <button onClick={runTest} disabled={test === 'running' || dirty}>
            {test === 'running' ? 'Comprobando…' : 'Comprobar que funciona'}
          </button>
          {test && test !== 'running' && (
            <span className={test.ok ? 'tmeta' : 'error'}>
              {test.ok ? '✓ Todo funciona correctamente' : test.error}
            </span>
          )}
        </li>
      )}
      {advanced && (
        <li className="plain fields">
          {agent.fields.map((f) => (
            <label key={f.key}>{f.label}
              <input value={form[f.key] || ''} placeholder={f.placeholder} title={f.help}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            </label>
          ))}
          <div className="actions">
            <button onClick={save} disabled={busy || !dirty}>{busy ? 'Guardando…' : 'Guardar ajustes'}</button>
          </div>
          {err && <div className="error">{err}</div>}
        </li>
      )}
    </>
  );
}

export default function Onboarding({ onDone }) {
  const [checks, setChecks] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(localStorage.getItem('advanced') === '1');

  const load = async () => {
    setErr('');
    try { setChecks((await api.setup()).checks); } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);
  const toggleAdvanced = () => {
    localStorage.setItem('advanced', advanced ? '0' : '1');
    setAdvanced(!advanced);
  };

  const finish = async () => {
    setBusy(true); setErr('');
    try { await api.completeSetup(); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const toolsOk = checks?.tools.every((t) => t.ok);

  return (
    <div className="modal-backdrop"><div className="onboarding" role="dialog" aria-modal="true">
      <h2>Vamos a conectar tu asistente</h2>
      <p className="tmeta">Orquestrator te deja encargar varias tareas a la vez a un asistente de IA, cada una por separado y sin riesgo para tus archivos. Solo hay que configurarlo una vez.</p>

      {!checks && !err && <ul className="checks"><li className="empty">Comprobando…</li></ul>}
      {checks && (
        <ul className="checks">
          <Row ok={toolsOk}
            title={toolsOk ? 'Tu ordenador está preparado' : 'Falta instalar algo en tu ordenador'}
            detail={toolsOk
              ? (advanced && checks.tools.map((t) => `${t.name} ${t.version}`).join(' · '))
              : checks.tools.filter((t) => !t.ok).map((t) => `${t.name}: ${t.hint}`).join(' ')} />
          {checks.agents.map((a) => (
            <AgentCard key={a.id + JSON.stringify(a.config)} agent={a} advanced={advanced} onChanged={load} />
          ))}
        </ul>
      )}

      <p className="tmeta">
        El asistente puede crear y modificar archivos en tus proyectos, pero siempre en una copia aparte: nada cambia en tu proyecto hasta que tú lo apruebes.
        {advanced && <> (Las tareas se ejecutan con <code>--dangerously-skip-permissions</code> dentro de un git worktree.)</>}
      </p>
      {err && <div className="error">{err}</div>}
      <div className="footer">
        <button className="link" onClick={toggleAdvanced}>{advanced ? 'Ocultar opciones avanzadas' : 'Opciones avanzadas'}</button>
        <div className="actions">
          <button onClick={load}>Volver a comprobar</button>
          <button className="primary" disabled={!checks?.ready || busy} onClick={finish}>Empezar</button>
        </div>
      </div>
    </div>
    </div>
  );
}
