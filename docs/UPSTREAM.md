# Atomic CRM upstream

- Repositorio: https://github.com/marmelab/atomic-crm
- Release: https://github.com/marmelab/atomic-crm/releases/tag/v1.6.0
- Versión base: `v1.6.0` (publicada el 22 de septiembre de 2026).
- **Actualización del 02/11/2026:** commit `9a5cb4b974974beb8cad0879cdc3e7a8ae9667af` (`v1.6.0-249-g9a5cb4b9`). **No es una release:** no hay una posterior a v1.6.0, y el trabajo propio ya estaba validado sobre ese commit (decisión de Sebastián). Comando usado: `git subtree pull --prefix=backoffice . refs/remotes/upstream/main --squash` (GitHub no permite traer un SHA abreviado con `git subtree pull <url> <sha>`; se hizo `git fetch upstream` antes). Squash resultante: `5468b58db83e5f9b79e400743c11aafbdfcd8b41`. El `.devcontainer/` no reapareció en esta actualización.
- Publicación exacta (`published_at` de GitHub): `2026-09-22T20:38:53Z`
  (15:38:53 en Ecuador continental).
- Importación: 30 de octubre de 2026.
- `git-subtree-split`: `da954d965931b4a24a8185940890029dc7e85c54`.
- Prefijo: `backoffice/`; importación con `--squash`.
- Licencia original: `backoffice/LICENSE.md`, sin modificaciones.

Para actualizar, seleccionar y revisar una release publicada, crear una rama
con código de tarea y ejecutar desde una copia limpia:

```sh
git subtree pull --prefix=backoffice https://github.com/marmelab/atomic-crm.git <nueva-version> --squash
```

Después de cada `git subtree pull`, retirar de nuevo `backoffice/.devcontainer/`
del índice y del disco antes de validar y crear el PR. Si aparece `Permission
denied`, detenerse y avisar; no restaurar ni leer el script en cuarentena.

Actualizar este registro con versión, fecha y hash. Validar demo, lint y pruebas;
abrir PR para revisión. `backoffice/supabase/` es referencia y no se despliega.

## Fixtures públicas de desarrollo

El upstream ya versiona archivos `.env` de pruebas; `.gitignore` no los elimina.
Gitleaks identifica seis coincidencias en el commit squash: tres claves
publicables del Supabase local, un JWT con emisor `supabase-demo` para pruebas
locales y dos ejemplos Basic Auth de `testuser:testpwd` en comentarios de curl
contra localhost. Se revisaron y se exceptuaron únicamente sus fingerprints
exactos en `.gitleaksignore`. No hay exclusiones generales por carpeta o regla.
No reutilizar estas credenciales de prueba en un despliegue real.

## Cambios propios

| Archivo | Motivo y cambio | Commit |
| --- | --- | --- |
| `backoffice/src/components/atomic-crm/providers/commons/getContactAvatar.test.ts` | El arreglo propio de F1-B0 **se descartó** en la actualización del 02/11: se tomó la versión del upstream en un conflicto. Si el test falla, reaplicar el arreglo (simular fetch de Gravatar y favicons sin mock de módulos) | `417004f0` (histórico) |
| `backoffice/.devcontainer/` | Se quitó la carpeta completa porque no usamos devcontainers y Kaspersky detecta `install.sh` como `HEUR:Trojan-Downloader` (detección heurística de scripts instaladores). Repetir en cada `git subtree pull`. | `chore(backoffice): F1-B0 quita .devcontainer de upstream` |
| Idioma, marca, etapas y categorías, campos de servicio, tarea de seguimiento al ganar, entorno Windows | Trabajo de CRM-T0 reaplicado con `git am --directory=backoffice` sobre el squash de arriba. Archivos: `src/components/atomic-crm/**`, `src/index.css`, `index.html`, `supabase/schemas/01,02,04,05,06`, `supabase/migrations/20261031*`, `supabase/config.toml`, `supabase/functions/.env` (solo `SB_JWT_ISSUER`, URL local), `INICIAR-CRM.cmd` | Ver `git log -- backoffice` |
| `backoffice/CLAUDE.md`, `AGENTS.md`, `.claude/` | **Sin cambios.** Las reglas propias viven en el `CLAUDE.md` de la raíz | — |
