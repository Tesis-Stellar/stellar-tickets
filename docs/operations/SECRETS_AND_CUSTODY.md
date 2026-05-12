# Secrets And Custodial Roles

## Alcance

Secure Ticket usa una arquitectura Web2.5: el backend opera como custodio limitado para algunas acciones administrativas y de despliegue, mientras las acciones de usuario se firman con Freighter cuando corresponde.

## Variables Sensibles

| Variable | Sensibilidad | Uso | Custodia |
| --- | --- | --- | --- |
| `DATABASE_URL` | Alta | Conexion PostgreSQL/Supabase | Secret manager del proveedor o `.env` local ignorado por git |
| `JWT_SECRET` | Alta | Firma de tokens de sesion | Secret manager; minimo 32 caracteres en produccion |
| `QR_SIGNING_SECRET` | Alta | Firma HMAC/JWS de QR | Secret manager; distinto de `JWT_SECRET` en demo/produccion |
| `ORGANIZER_SECRET` | Critica | Firma administrativa/custodial para despliegue, mint y operaciones permitidas | Solo backend o scripts de operacion; nunca frontend, docs publicos ni commits |
| `.env.deploy` | Critica | Wallets operativas de despliegue testnet | Archivo local ignorado por git; rotar si se comparte o se expone |

## Reglas Operativas

- Nunca commitear `.env`, `.env.*`, `.env.deploy`, seeds, mnemonics ni secret keys Stellar (`S...`).
- Public keys (`G...`) y contract ids (`C...`) se pueden documentar como evidencia, pero no junto a secretos.
- `ORGANIZER_SECRET` representa un rol custodial. En demo academica es aceptable si se declara como limitacion; en producto real debe migrarse a custodia institucional, HSM/KMS o firmas por rol con aprobaciones.
- `JWT_SECRET` y `QR_SIGNING_SECRET` deben ser diferentes en staging/demo.
- Rotar inmediatamente cualquier secret si aparece en una captura, log compartido o archivo versionado.

## Checklist Antes De Sustentacion

- `git ls-files | grep -E '(^|/)\\.env|\\.env\\.'` solo muestra archivos `.env.example`.
- `.gitignore` cubre `.env`, `.env.*`, `.env.deploy` y logs locales de despliegue.
- Backend despliega con secrets configurados en el proveedor, no escritos en el repo.
- Slides/memoria explican que `ORGANIZER_SECRET` es una llave custodial del backend para la demo Web2.5.
