# Arquitectura inicial

El backoffice usa React y Atomic CRM. Durante F1-B0 funciona con FakeRest y datos
sintéticos en el navegador. La futura core-api usará Fastify y TypeScript sobre
Node 24; su proveedor de datos sustituirá al proveedor Supabase del original.

Las migraciones propias vivirán en db/, los despliegues en infra/ y los flujos
sin secretos en n8n/. Esta entrega no implementa ni despliega esos servicios.
