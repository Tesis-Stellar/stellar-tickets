# Contracts Audit

## Resumen ejecutivo

La lógica del `event_contract` está bien encapsulada para el modelo on-chain planteado: ownership, listado, compra, reventa con burn/remint, comisiones y redención están protegidos con `require_auth` del actor correcto.

La suite de contratos pasa correctamente:
- `34` tests en `event_contract`
- `12` tests en `factory_contract`

El problema más serio no está dentro del contrato aislado, sino en la integración backend ↔ contrato:

- el backend trata tickets Web2 como si fueran propiedad on-chain del usuario
- pero `crear_boleto` siempre mintea el boleto al organizador

Eso rompe la narrativa de:
- custodia
- reventa P2P
- pagos al vendedor
- trazabilidad real

Además:
- la factory existe y está probada
- pero el backend no la usa en el despliegue actual
- y el indexador tiene huecos relevantes de reconstrucción de estado

---

## Qué garantiza realmente el contrato

### Ownership y autorización
- Solo el organizador puede:
  - inicializar evento
  - crear boletos
  - invalidar boletos
  - gestionar verificadores

- El boleto nace con:
  - `propietario = organizador`
  - `version = 0`
  - `en_venta = false`
  - `es_reventa = false`
  - `usado = false`
  - `invalidado = false`

- Solo el propietario on-chain actual puede:
  - listar el boleto
  - cancelar la venta

- Solo el comprador firma la compra

- El contrato bloquea:
  - compra de boletos no listados
  - compra de boletos usados
  - compra de boletos invalidados
  - auto-compra

### Pagos
- En venta primaria:
  - el pago completo va al organizador
  - no hay burn/remint

- En reventa:
  - el contrato divide el precio entre:
    - organizador
    - plataforma
    - vendedor
  - invalida la versión anterior
  - crea `version + 1`

### Redención
- La redención solo la puede ejecutar un verificador registrado
- El dueño del boleto no puede redimir directamente

### Lo que NO garantiza
- No controla capacidad/inventario del evento
- No garantiza que `id_evento` coincida con el evento real del backend
- No garantiza por sí solo consistencia con la base de datos off-chain

---

## Problemas críticos

### 1. Custodia on-chain desalineada con el backend
El backend “asegura” un ticket y luego actualiza PostgreSQL como si el usuario fuera dueño del ticket on-chain.

Pero en realidad:
- el contrato mintea el boleto al organizador
- no al comprador

Resultado:
- PostgreSQL dice “usuario dueño”
- blockchain dice “organizador dueño”

Esto rompe:
- ownership real
- autorización real
- trazabilidad real

### 2. La “reventa” del backend puede ejecutarse como venta primaria on-chain
Después de `secure-ticket`, el campo `es_reventa` sigue en `false`.

Entonces:
- el backend puede listar el ticket como si fuera del usuario
- pero on-chain el owner sigue siendo el organizador
- y la compra entra en flujo de venta primaria

Resultado:
- el vendedor Web2 no cobra on-chain
- no hay burn/remint
- la narrativa P2P queda rota

### 3. El indexador inventa estado que no coincide con cadena
El indexador intenta compensar esta desalineación creando una nueva versión en DB para un flujo que el contrato trata como primario.

Resultado:
- historial off-chain falso
- versión en DB distinta a la versión on-chain

### 4. `list-ticket` y `cancel-listing` dependen de `ORGANIZER_SECRET`
Eso solo funciona mientras el owner on-chain sea el organizador.

Después de una compra real:
- el owner ya no sería el organizador
- por tanto la lógica actual del backend deja de ser válida

### 5. La redención real on-chain no está integrada
`/api/admin/scan` solo actualiza PostgreSQL y no llama a `redimir_boleto`.

Resultado:
- on-chain el boleto sigue sin redimir
- la garantía antifraude del contrato no se usa en puerta

---

## Problemas importantes

### 1. `wallet_organizador` no se usa realmente en el contrato hijo
Existe en configuración, pero la lógica real paga a `organizador`, no a una tesorería separada.

### 2. La factory no se usa en el despliegue real
Aunque existe y está probada, el backend despliega contratos de evento directamente.

Resultado:
- la arquitectura real no coincide del todo con la arquitectura documentada

### 3. `capacidad_total` no impide sobreemisión
La factory valida que sea mayor que cero, pero no limita cuántos boletos se crean.

### 4. El indexador puede perder eventos
Por cursor/paginación, existe riesgo de saltarse eventos no procesados.

### 5. El indexador no reconstruye completamente el estado de listado
No usa todos los datos de evento on-chain, y depende de actualizaciones optimistas del backend.

### 6. `submit` acepta cualquier XDR firmado
El contrato protege su estado, pero el backend pierde control y trazabilidad del flujo de negocio.

---

## Problemas menores

- `cancelar_venta` podría validar explícitamente estados adicionales
- algunas consultas on-chain son O(n)
- parte de la documentación técnica quedó desactualizada
- CI permite fallos en build del `factory_contract`
- `secure-ticket` usa `id_evento = 1` fijo

---

## Desalineaciones con backend

- El backend asume que “asegurar ticket” significa ownership on-chain del usuario
- El contrato no hace eso: mintea al organizador

- El backend asume que listar ticket del usuario puede firmarse con `ORGANIZER_SECRET`
- El contrato exige firma del propietario on-chain real

- El backend asume que `resale_price` off-chain implica reventa P2P
- El contrato decide primaria/reventa con `es_reventa`

- El backend usa `CANCELLED` para scan/redención
- El contrato usa `usado = true` y `boleto_redimido`

- El backend/documentación asumen arquitectura con factory
- El despliegue real no la usa

---

## Conclusión

Los contratos son técnicamente sólidos dentro de su modelo.

El principal problema del proyecto no es una falla grave del contrato, sino la **desalineación entre lo que el contrato garantiza y lo que el backend/documentación afirman**.

Por tanto, las prioridades no deberían ser “reescribir el contrato”, sino:

1. alinear el flujo backend ↔ contrato
2. corregir la narrativa de ownership y reventa
3. integrar realmente la redención on-chain
4. decidir si la factory es parte real del sistema o solo una línea futura