# Wallets y Roles (Testnet)

## Objetivo
Definir asignación operativa de wallets para demo/integración en testnet, separando responsabilidades por rol.

## Inventario vigente
Fuente: `wallets.txt`

- `admin_fabrica`: `GBM6N2SUCK3Y6I5DHQKULZD3W27EYMU37VYHNKWLVBNS6VYZHRJPWJBT`
- `organizador_evento`: `GC2X5T6HTLJJ7P2EASP4PK64ZD24KDN57F6B4XEDA3AF4YX5PTGQKJSS`
- `wallet_plataforma`: `GBMFIYOGHHNXJGUVWXTDUMLZJ2IRO3T2OOPG5CQPBEVLA2OO3SYPK2B2`
- `buyer_1`: `GAMEE24JUUULZ422PUIQZHUTELJFZBVOPV5LWBLMOD4O3VGEQPMSCK5J`
- `buyer_2`: `GBOKAXAVPOYEIWBWVPGXNDYBXY6PJAYTQ6U24ES3ESSNJSNGFXMT5VZQ`
- `verificador`: `GBJOI4X22GZY26YZASKHV7ZWYEZVU7ZN77EXZFE7WOCMAGQHLR26EMBZ`

## Matriz de responsabilidades

### 1) `admin_fabrica`
- Inicializa `factory_contract`.
- Configura parámetros administrativos de fábrica.
- Crea nuevos eventos (contratos hijo) en producción de demo.

### 2) `organizador_evento`
- Crea boletos del evento.
- Lista/cancela ventas bajo reglas del contrato del evento.
- Actúa como dueño inicial de boletos primarios.

### 3) `wallet_plataforma`
- Recibe comisiones de plataforma en reventas.
- No debe operar funciones administrativas salvo que la política lo indique explícitamente.

### 4) `buyer_1` y `buyer_2`
- Ejecutan compras de flujo E2E (primaria/reventa).
- Permiten validar cambios de propiedad y comisiones en cadena.

### 5) `verificador`
- Ejecuta redención/verificación de acceso (fase de control de puerta).
- Debe estar aislada de roles de compra/administración para trazabilidad operativa.

## Política de semillas (seed phrase)

### Mínimo aceptable para MVP testnet
- Varias cuentas bajo una misma seed phrase: válido para acelerar demo.
- Riesgo: punto único de falla si se compromete esa seed.

### Recomendado para cierre production-like
- Una seed phrase por wallet crítica.
- Separación mínima obligatoria recomendada:
  - `admin_fabrica`
  - `verificador`
  - (idealmente también `organizador_evento`)

## Checklist pre-deploy testnet
- [ ] Las 6 wallets están fondeadas en testnet.
- [ ] Se confirmó firma/transacción de prueba por cada wallet.
- [ ] `admin_fabrica` puede inicializar factory.
- [ ] `organizador_evento` puede firmar creación/listado.
- [ ] `buyer_1` y `buyer_2` pueden comprar.
- [ ] `verificador` puede ejecutar flujo de redención.

## Reglas operativas
- No reutilizar wallets personales para demo del proyecto.
- No publicar seeds en repositorio, chats, ni documentación.
- Guardar únicamente addresses públicas en archivos versionados.
- Registrar cualquier rotación de wallet en este archivo y en `wallets.txt`.
