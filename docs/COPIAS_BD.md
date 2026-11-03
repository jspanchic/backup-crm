# Copias de seguridad de la base de datos

Parte local de CRM-T12. Las dos órdenes están en `scripts/` y **ya se probaron en local** (restaurar y comprobar que todo coincide).
Falta lo que depende del servidor: dónde se guardan las copias fuera de él, el aviso a Discord y el horario real.

## Qué guarda una copia

| Entra | No entra |
|---|---|
| Toda la base `salvionix`: clientes, conversaciones, citas, cotizaciones, documentos, permisos | **Los roles y sus contraseñas** (se crean con `npm run db:bootstrap` desde el `.env` de esa máquina) |
| Los PDF de `DOCUMENTS_DIR` (la base guarda su hash; sin el archivo un documento no tendría PDF) | **Ningún secreto**: ni `.env`, ni llaves, ni tokens. Eso se guarda aparte |
| Una lista de comprobación (SHA-256 de cada archivo) | |

Es un archivo único, `salvionix-AAAAMMDDTHHMMSSZ.tar.gpg`, **cifrado con AES-256** y con su comprobación de integridad: si cambia un solo byte, no se abre.
Junto a él queda un `.sha256`. Siempre es una copia **completa** (no incremental) y es una foto del momento: no permite volver a un minuto cualquiera.

## Hacer una copia

```bash
export BACKUP_PASSPHRASE_FILE=/ruta/fuera-del-repo/clave-copias.txt   # una frase de 20 o más caracteres
scripts/db-backup.sh
```

La frase va en un archivo **fuera del repositorio** y, en el servidor, **fuera de la carpeta de copias**. Quien tenga el archivo de la frase y una copia puede leerlo todo.
**Si se pierde la frase, la copia no se puede abrir: no hay forma de recuperarla.** Guárdala también en un gestor de contraseñas.

Variables (todas menos la primera tienen un valor por omisión):

| Variable | Para qué | Por omisión |
|---|---|---|
| `BACKUP_PASSPHRASE_FILE` | Archivo con la frase. **Obligatoria** | |
| `BACKUP_DIR` | Dónde se dejan las copias | `backups/` del repositorio (ignorada por git) |
| `BACKUP_KEEP` | Cuántas copias se conservan; las más viejas se borran | 14 |
| `PGDATABASE` | Base a copiar | `salvionix` |
| `DOCUMENTS_DIR` | Carpeta privada de PDF | `core-api/.data/documents` |
| `PG_RUN` | Cómo se llaman las herramientas de Postgres | El contenedor `db` del entorno local (`docker compose … exec -T db`). Vacío (`PG_RUN=`) usa `pg_dump` y `psql` instalados en la máquina, con `PGHOST`, `PGPORT` y `PGPASSWORD` |
| `PG_USER` | Superusuario del servidor de Postgres | `postgres` |

Antes de dar la copia por buena, el script **la vuelve a abrir** con la frase. Si no se puede abrir, no la deja.

## Restaurar

```bash
export BACKUP_PASSPHRASE_FILE=/ruta/fuera-del-repo/clave-copias.txt
scripts/db-restore.sh salvionix-20261103T200000Z.tar.gpg                 # a una base NUEVA: salvionix_restored
scripts/db-restore.sh <copia> --target salvionix_prueba --documents-dir /tmp/pdf   # nombre propio, y copia los PDF
```

- Por seguridad, **restaura a una base nueva** y se niega a pisar una que exista (a menos que se pida `--replace`).
- Antes de tocar nada, **descifra y comprueba** cada archivo. Con la frase equivocada o un archivo cambiado o cortado, termina sin crear ninguna base.
- Si falla a la mitad, **borra la base a medias** para que no parezca completa.
- Los roles tienen que existir: en un servidor nuevo, primero `npm run db:bootstrap`.
- Los PDF se copian solo si se pide `--documents-dir`, y no pisa los que ya estén.

### Si el servidor se pierde (pasos)

1. Servidor nuevo con Postgres y `core-api`; `npm run db:bootstrap` (crea los roles con las contraseñas del `.env` nuevo).
2. Llevar la copia y la frase (que estaba guardada aparte).
3. `scripts/db-restore.sh <copia> --target salvionix --documents-dir <carpeta de PDF>`.
4. Arrancar `core-api` y mirar `/healthz` y una oportunidad con documentos.

## Cómo se probó

`scripts/test-db-backup.sh` hace una copia de la base local, la restaura en una base temporal (`salvionix_restore_check`, que borra al terminar) y compara
**cada tabla (filas, contenido y permisos), cada función y cada secuencia**, y que cada PDF vuelva idéntico byte por byte. Además comprueba:

- que el archivo no deja ver nada (ni el encabezado de Postgres ni nombres de tablas);
- que una frase equivocada, un archivo con un byte cambiado o uno cortado se rechazan **sin crear ninguna base**;
- que no pisa una base existente;
- que la propia comparación **sí detecta** una fila cambiada o un permiso de más (para que un "todo igual" tenga valor);
- que solo se conservan las copias más nuevas.

Resultado del 03/11/2026 con los datos de la demo: **17 comprobaciones correctas**, 148 objetos comparados, unos 50 s. Hay que correrlo con la pila local encendida (`npm run local:up`)
y sin escrituras en la base mientras corre.

```bash
scripts/test-db-backup.sh
```

## En el servidor

Un horario de ejemplo (diario a las 3:00). **Las rutas son un SUPUESTO**: el servidor todavía no existe y hay que ajustarlas a como lo dejemos.

```cron
0 3 * * * BACKUP_PASSPHRASE_FILE=/etc/salvionix/copias.clave BACKUP_DIR=/var/backups/salvionix DOCUMENTS_DIR=/var/lib/salvionix/documentos PG_RUN="docker compose -f /opt/salvionix/docker-compose.yml exec -T db" /opt/salvionix/scripts/db-backup.sh >> /var/log/salvionix-copias.log 2>&1
```

Necesita en el servidor: `bash`, `gpg`, `tar`, `sha256sum` y acceso a Docker (o a las herramientas de Postgres). Si los PDF viven en un volumen de Docker, `DOCUMENTS_DIR` es la ruta de ese volumen en el servidor.

## Lo que falta (depende del servidor y de decisiones)

- **Copia fuera del servidor.** Una copia que vive en el mismo disco no sirve si el disco se pierde. Falta elegir el destino (por ejemplo Cloudflare R2 o el equipo de BYTOGAM) y un paso que la suba.
- **Aviso a Discord** si una copia falla o no se hizo hoy (hoy el script termina con código distinto de cero y escribe en el registro, nada más).
- **Prueba de restauración periódica** en el servidor (la prueba de aquí corre en local).
- **Retención por días/semanas/meses**: hoy es "las últimas N copias".
- **Recuperación a un instante** (WAL): no está; la copia es una foto diaria, así que lo peor que se pierde es un día.
- **Frase en un gestor de secretos** del servidor, en lugar de un archivo.
