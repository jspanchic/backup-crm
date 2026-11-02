# Salvionix Platform

Base de Salvionix para Bytogam. F1-B0: repositorio y CRM base.
Inicialmente se aloja en la cuenta personal del responsable, como repositorio
privado y con un GitHub Project. Se transferirá a la organización de la empresa
cuando exista. Consulte docs/ENTREGA-F1-B0.md para el estado real de la entrega.

## Estructura

- `backoffice/`: Atomic CRM (v1.6.0 + commits hasta 9a5cb4b9), importado con git subtree (MIT).
- `core-api/`: espacio reservado para Fastify + TypeScript.
- `db/`: migraciones y funciones SQL propias.
- `infra/`: configuración de infraestructura sin secretos.
- `n8n/`: flujos exportados sin credenciales ni datos reales.
- `docs/`: arquitectura, desarrollo, origen y entrega.
- `.github/`: CI y plantilla de PR.

## Demo local

Con Node 24 disponible:

```sh
git config core.hooksPath .githooks
cd backoffice
npm ci --ignore-scripts
npm run dev:demo -- --host 127.0.0.1
```

Abre http://127.0.0.1:5174. FakeRest no requiere Docker ni Supabase.
Consulta docs/DESARROLLO.md para Windows, comprobaciones y gitleaks.
