# ai-orquestrator

Panel web local para lanzar tareas de Claude Code en paralelo, cada una en su propio git worktree.

## Uso

```bash
npm install
npm run dev     # server :3001 + vite :5173  → abre http://localhost:5173
# o bien
npm start       # build del frontend y todo servido en http://localhost:3001
```

- Cada tarea: `git worktree add ../<repo>-<rama> -b tarea-<slug>-<id> <base>` y
  `claude -p "<prompt>" --output-format stream-json --verbose --dangerously-skip-permissions`.
- Streaming por WebSocket; eventos persistidos en SQLite (`data/orquestrator.db`).
- Al terminar se autocommitea en la rama; Diff = rama vs merge-base.
- Merge: `git merge --no-ff` en el repo principal (debe estar en la rama base y limpio). Aborta si hay conflictos.
- Seguimiento: prompt nuevo sobre la misma sesión con `--resume`.
- Variable `CLAUDE_BIN` para apuntar a otro binario; `PORT` para el puerto.
