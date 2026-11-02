# Base de datos

Esquema propio de Salvionix y sus migraciones. Sin dumps ni datos de clientes.

| Ruta | Qué es |
|---|---|
| `bootstrap/` | Roles del servidor. Corre una vez, con superusuario |
| `migrations/` | Migraciones propias, solo hacia adelante. Las aplica `core_owner` |
| `migrations/0002_atomic_baseline.sql` | Copia congelada de `backoffice/supabase/schemas`. **Generada:** no se edita |
| `seeds/sample/` | Datos de ejemplo, "por confirmar". Nunca en producción |
| `upstream-migrations.lock` | Migraciones de Atomic ya consideradas |

## Reglas

- **Lo nuevo va aquí**, nunca en `backoffice/supabase/`, que es referencia y no se despliega.
- **No se edita una migración ya publicada.** El runner compara checksums y se detiene si cambió.
- **Permisos:** por defecto, nada. Cada permiso se da por nombre. `core_api` solo ejecuta funciones del esquema `api`.
- **Códigos de error propios:** `CX001` dato inmutable, `CX002` cambio de estado inválido, `CX003` hold vencido, `CX004` entrada inválida.

## Si el upstream trae cambios

Tras `git subtree pull`, las pruebas de `core-api` fallan a propósito si:

1. **Llegó una migración nueva de Atomic.** Se revisa, se porta a `migrations/` si aplica y se agrega a `upstream-migrations.lock`.
2. **Cambió `backoffice/supabase/schemas`.** La línea base es para bases vacías. Con datos en producción, el cambio se porta como migración nueva; antes de eso se regenera con `npm run db:baseline`.

## Uso local

Desde `core-api/`, con Node 24 y Docker:

```bash
npm run local:init
```

```bash
npm run local:up
```

```bash
npm run db:bootstrap
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

Las pruebas usan su propia base (`salvionix_test`), que se crea de cero en cada corrida:

```bash
npm test
```
