// Renderizadores del log por agente. Para añadir uno: crea agents/<id>.jsx con una función
// (eventoParseado) => JSX y regístrala aquí con el mismo id que en server/src/agents.
import claude from './claude.jsx';

export const renderers = { claude };
export const rendererFor = (agent) => renderers[agent] || renderers.claude;
