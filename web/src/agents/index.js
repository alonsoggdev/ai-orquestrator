// Renderizadores del log por agente. Para añadir uno: crea agents/<id>.jsx con una función
// (eventoParseado) => JSX, y un `analyze(eventos, { running })` que lo resuma en pasos legibles
// (ver ProcessView); regístralos aquí con el mismo id que en server/src/agents.
import claude, { analyze as claudeAnalyze } from './claude.jsx';

export const renderers = { claude };
export const analyzers = { claude: claudeAnalyze };
export const rendererFor = (agent) => renderers[agent] || renderers.claude;
export const analyzerFor = (agent) => analyzers[agent] || analyzers.claude;
