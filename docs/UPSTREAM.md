# Atomic CRM upstream

- Repositorio: https://github.com/marmelab/atomic-crm
- Release: https://github.com/marmelab/atomic-crm/releases/tag/v1.6.0
- Versión fijada: `v1.6.0` (publicada el 22 de septiembre de 2026).
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
| `backoffice/src/components/atomic-crm/providers/commons/getContactAvatar.test.ts` | Corregir dos fallos del upstream (`mockResolvedValue is not a function`). Simular fetch de Gravatar y favicons y reiniciarlo en cada caso para obtener pruebas deterministas, sin mock de módulos ni cambios en la lógica de producción. | `417004f0b1a3e0b0b98aa01c889f750b44f9d378` |
