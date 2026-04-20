# Frontend Audit

## Resumen ejecutivo

El frontend funciona bien como mock/demo B2B de ticketera integrada con backend, especialmente para:

- catálogo
- carrito
- checkout
- panel admin
- wallet
- marketplace

El mayor problema no es visual ni de React, sino de **narrativa y consistencia sistémica**.

Varias pantallas afirman ideas como:
- “NFT”
- “reventa P2P segura”
- “custodiado por Soroban”
- “validación on-chain”

pero backend y contratos no sostienen completamente esas afirmaciones hoy.

Por tanto, el frontend sí es defendible para la tesis si se presenta como:

> **interfaz de integración y demostrador de flujos**, no como una ticketera blockchain plenamente trustless.

---

## Qué representa bien el frontend

### 1. Flujo Web2 principal
El frontend representa bien:
- catálogo
- selección de entradas
- carrito
- checkout
- confirmación

Eso lo hace adecuado como demo del flujo principal de ticketera.

### 2. Integración con wallet
Sí existe integración real con Freighter para el flujo de compra de reventa:
- el frontend pide XDR al backend
- el usuario firma con wallet
- el frontend reenvía la transacción

### 3. Panel admin como consola operativa
La sección admin funciona razonablemente como consola B2B para:
- crear venues
- crear eventos
- disparar despliegues desde backend

### 4. Observabilidad de tickets
Las vistas de tickets muestran datos útiles para demo:
- contrato
- ticket root id
- versión
- estado
- reventa

### 5. Scanner como validación operativa
El scanner es válido si se presenta como:
- validación basada en backend/DB
- no como verificación on-chain plena

---

## Qué representa mal o de forma engañosa

### 1. “Asegurar en Blockchain”
El botón exige wallet, pero el usuario no firma realmente la operación.
La acción se apoya en el backend, que firma con `ORGANIZER_SECRET`.

Eso no equivale a:
- “el usuario aseguró su ticket en su wallet”
- ni a “el usuario es dueño on-chain”

### 2. “Revender NFT”
El copy es engañoso.
El contrato maneja estructuras de boleto y lógica de burn/remint, pero no se expone como NFT estándar transferible al estilo que sugiere la UI.

### 3. “Reventa P2P Segura”
El lenguaje es más fuerte que la realidad actual.
La UI presenta una reventa P2P custodiada por Soroban, pero el backend puede estar operando con la clave del organizador en lugar del owner real on-chain.

### 4. Scanner con “validación on-chain”
Hoy el scanner no ejecuta la redención real en cadena.
La UI sugiere más garantía blockchain de la que existe en el flujo actual.

### 5. Admin “descentralizado con factory”
La UI sugiere una arquitectura con factory plenamente activa, pero el despliegue actual del backend parece usar contratos de evento de forma directa.

---

## Problemas críticos

### 1. Ownership on-chain no coincide con lo que la UI sugiere
La UI puede mostrar el ticket como asegurado para el usuario, mientras el contrato sigue considerando owner al organizador.

Esto rompe:
- claridad del ownership
- consistencia entre capas
- narrativa de custodia

### 2. Reventa no alineada con autorización real
La UI deja listar/cancelar como si el usuario fuese owner on-chain, pero el contrato exige `require_auth` del propietario real.

Esto hace que el flujo parezca más trustless/P2P de lo que es hoy.

### 3. Compra P2P que puede ejecutarse como venta primaria
La UI presenta “reventa P2P”, pero el contrato puede entrar al flujo de venta primaria si `es_reventa` no cambió realmente.

### 4. Scanner no redime on-chain
La UI da a entender una validación fuerte de acceso, pero el contrato de redención no está realmente conectado al flujo mostrado.

---

## Problemas importantes

### 1. `AppContext` concentra demasiada responsabilidad
Acumula lógica de:
- auth
- usuario
- carrito
- órdenes
- tickets
- wallet
- blockchain
- reventa
- checkout

Eso aumenta:
- acoplamiento
- riesgo de estados inconsistentes
- dificultad de mantenimiento

### 2. Manejo de errores mejorable
El frontend puede mostrar strings de error demasiado crudos o poco controlados.

### 3. Reset agresivo de estado
Ante ciertos fallos, se borran varios estados a la vez, lo que puede ocultar problemas reales durante demo o debugging.

### 4. `addToCart` usa IDs temporales
Eso puede romper acciones inmediatas sobre el carrito antes de una recarga/refresco.

### 5. `lastOrder.items` queda vacío
La confirmación puede perder información útil para demo o seguimiento visual.

### 6. `ConnectWallet` puede dar falsa sensación de éxito
Hay riesgo de que la UI crea que la wallet quedó vinculada aunque backend no lo haya persistido correctamente.

### 7. `getEventById` es frágil
Depende de un mecanismo de búsqueda que no es ideal para un identificador exacto.

### 8. `SeatSelection` puede sugerir una reserva de asientos más fuerte que la garantía real
La UI puede transmitir más robustez funcional de la que backend realmente ofrece hoy.

### 9. `openapi.v1.json` parece artefacto heredado
Si no se usa ni se regenera, solo añade ruido.

---

## Problemas menores

- Mezcla de copy en español e inglés
- Uso de `prompt` / `alert` para flujos sensibles
- Datos estáticos mezclados con datos reales
- `QueryClientProvider` sin uso claro en el flujo principal
- Etiquetas como “ON-CHAIN ✓” demasiado fuertes si solo reflejan DB

---

## Desalineaciones con backend y contratos

- Frontend dice: el usuario asegura ticket en blockchain  
  Backend/contrato hacen: el organizador firma `crear_boleto` y el owner inicial on-chain es el organizador.

- Frontend dice: el usuario revende NFT  
  Backend/contrato hacen: el backend firma listado con organizador y no hay NFT estándar expuesto como tal.

- Frontend dice: marketplace P2P seguro  
  Backend/contrato pueden ejecutar una venta primaria si `es_reventa` sigue en `false`.

- Frontend dice: scanner con validación on-chain  
  Backend hoy valida y actualiza DB, pero no usa todavía la redención on-chain real.

- Frontend admin dice: factory / despliegue descentralizado  
  Backend parece usar despliegue directo por contrato de evento.

---

## Recomendaciones

### 1. Ajustar copy crítico antes de demo
Cambiar lenguaje fuerte por lenguaje preciso:
- “Registrar referencia on-chain”
- “Reventa experimental”
- “Validación contra backend”
- evitar “NFT” si no corresponde técnicamente

### 2. Bloquear o esconder acciones Web3 que no estén respaldadas
Por ejemplo:
- revender solo si ownership on-chain está verificado
- no vender como P2P pleno algo que no lo es todavía

### 3. Renombrar o ajustar scanner
Hasta que exista redención on-chain real, presentarlo como validación Web2/backend.

### 4. Ajustar panel admin
No hablar de factory descentralizada si no es el flujo real actual.

### 5. Separar parcialmente `AppContext`
No hace falta rediseño enorme, pero sí reducir concentración de responsabilidades.

### 6. Reducir optimismo local en estados sensibles
Después de acciones blockchain, refrescar desde backend/indexación real.

### 7. Corregir problemas concretos del carrito y órdenes
- usar item real en carrito
- corregir `lastOrder.items`
- endurecer flujo de vinculación de wallet

### 8. Decidir el rol de `openapi.v1.json`
O se usa y regenera, o se saca de la historia del proyecto.

---

## Conclusión

El frontend sí sirve para la tesis.

Pero no debería presentarse hoy como:
- ticketera blockchain completa
- marketplace P2P trustless
- sistema con validación on-chain plena en todos los flujos

Sí es defendible como:
- mock de plataforma de boletería
- interfaz de integración
- demostrador de flujos Web2.5

La prioridad no es rehacer la UI, sino:
1. corregir lenguaje engañoso
2. poner guardas en flujos Web3
3. alinear mejor lo que la UI afirma con lo que backend y contratos realmente hacen