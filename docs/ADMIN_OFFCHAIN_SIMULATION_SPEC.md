# Especificacion De Simulacion Admin Off-Chain

## Objetivo

Dejar explicito que construye el equipo off-chain para la simulacion web de la tesis y como se conecta con los contratos Soroban.

## Alcance De La Consola Admin

La consola admin representa a la ticketera u operador del evento. Debe permitir:

1. Crear eventos.
2. Configurar zonas y capacidad.
3. Marcar zonas o sillas que no se venderan para un evento especifico.
4. Publicar inventario inicial.
5. Ver sillas vendidas, disponibles, bloqueadas y en reventa.
6. Consultar redenciones o check-in.
7. Sincronizar estado on-chain con la base de datos local.

## Modelo Operativo Minimo

### Creacion De Evento

Entradas minimas:

- `id_evento`
- nombre del evento
- fecha y hora
- venue
- token de pago
- wallet del organizador
- wallet de plataforma
- porcentajes de comision

Resultado esperado:

- Registro del evento en PostgreSQL.
- Creacion o asociacion del `event_contract` correspondiente.
- Estado inicial del evento en `borrador` o `publicado`.

### Configuracion De Zonas

La web admin debe permitir definir zonas como `VIP`, `Platea`, `General` o cualquier otra categoria usada en la demo.

Cada zona debe tener:

- identificador interno
- nombre visible
- capacidad total
- precio base
- indicador `vendible`
- aforo reservado o bloqueado

Si una zona no se vende para un evento, no debe mintarse inventario on-chain para esa zona o debe quedar como `bloqueada` en la capa off-chain antes de publicar inventario.

### Configuracion De Sillas

Si el evento usa silleteria numerada, la plataforma debe modelar:

- zona
- fila
- numero de silla
- estado

Estados recomendados:

- `disponible`
- `reservada_temporal`
- `vendida`
- `en_reventa`
- `redimida`
- `bloqueada`

Si el evento no usa silleteria numerada, la UI debe operar por cupos de zona.

### Publicacion De Inventario

Responsabilidad off-chain:

- decidir cuantas entradas se publican
- asociar cada ticket a una zona o silla
- invocar el contrato para crear boletos
- persistir la relacion entre `ticket_id` on-chain y `seat_id` o `zone_slot_id` off-chain

Responsabilidad on-chain:

- registrar propiedad, precio y estado transaccional del boleto

## Vistas Minimas De La Web Admin

### Vista De Eventos

Debe mostrar:

- listado de eventos
- estado del despliegue on-chain
- cantidad de boletos emitidos
- vendidos
- en reventa
- redimidos

### Vista De Mapa O Inventario

Debe mostrar para un evento:

- zonas configuradas
- sillas disponibles
- sillas vendidas
- sillas en reventa
- sillas bloqueadas
- zonas no habilitadas para venta

### Vista De Operacion

Debe mostrar:

- ultimas compras
- ultimas reventas
- ultimas redenciones
- alertas de desincronizacion entre chain y base local

## Responsabilidades Por Capa

### On-chain

- propiedad del boleto
- compra
- reventa
- redencion
- reglas de comisiones

### API Back-End

- exponer CRUD de eventos, zonas y sillas
- traducir datos on-chain a vistas de negocio
- servir dashboards admin
- mantener lectura consolidada para frontend

### Indexador

- consumir eventos del contrato
- actualizar PostgreSQL de forma idempotente
- marcar estados derivados como `vendida`, `en_reventa`, `redimida`

### PostgreSQL

- guardar catalogo de eventos
- zonas
- sillas
- relacion ticket on-chain con asiento off-chain
- auditoria operativa

### Frontend Admin

- crear eventos
- configurar zonas y sillas
- bloquear inventario
- consultar disponibilidad y ventas
- revisar reventas y redenciones

## Recomendacion De Tablas Off-Chain

La simulacion admin debe tener, como minimo, tablas o entidades equivalentes a:

- `eventos`
- `zonas_evento`
- `sillas_evento`
- `tickets_emitidos`
- `tickets_reventa`
- `checkins`
- `sincronizaciones_on_chain`

## Relacion Con Event Contract

Mientras `factory_contract` termina de implementarse, la integracion puede trabajar asi:

1. Admin crea evento en la web.
2. API registra metadata del evento en PostgreSQL.
3. Operador despliega o registra `event_contract`.
4. Admin publica inventario llamando `crear_boleto`.
5. Indexador consolida compras, reventas y redenciones.
6. Frontend consulta el estado ya materializado en PostgreSQL.

## Criterio De Exito Para La Tesis

La simulacion queda suficientemente clara si un compañero puede responder sin ambiguedad:

1. Como se crea un evento.
2. Como se define que zonas o sillas se venden.
3. Como se identifica una silla vendida, disponible, bloqueada o en reventa.
4. Que datos dependen del contrato y cuales dependen de la base de datos.
5. Que pantallas minimas debe tener la consola administrativa.
