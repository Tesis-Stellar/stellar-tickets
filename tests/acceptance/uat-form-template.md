# UAT-01 - Plantilla de aceptacion de usuario

No ejecutar en esta fase. Este instrumento queda listo para aplicar con usuarios, companeros, director o stakeholders.

## Datos de la sesion

- Fecha:
- Ambiente:
- Frontend URL:
- Backend URL:
- Red blockchain configurada: Stellar/Soroban Testnet / No aplica para tarea
- Participante:
- Rol probado: Comprador / Vendedor-revendedor / Comprador de reventa / Staff-verificador / Admin-organizador
- Navegador/dispositivo:
- Facilitador:
- Observador:

## Perfiles minimos

| Perfil | Usuario asignado | Datos requeridos | Observaciones |
|---|---|---|---|
| Comprador | | Cuenta CUSTOMER, evento publicado, ticket disponible | Compra primaria simulada/off-chain |
| Vendedor/revendedor | | Cuenta CUSTOMER con ticket propio activo | Requiere Freighter/Testnet si se ejecuta reventa real |
| Comprador de reventa | | Cuenta CUSTOMER distinta al vendedor | Requiere ticket listado en marketplace |
| Staff/verificador | | Cuenta STAFF o ADMIN, QR valido preparado | Scanner operativo DB-first |
| Admin/organizador | | Cuenta ADMIN, evento/ticket preparado | Invalidacion completa depende de flujo disponible |

## Tareas por perfil

### Comprador

| Tarea | Completada: si/no | Ayuda requerida | Observaciones |
|---|---|---|---|
| Iniciar sesion | | | |
| Consultar eventos | | | |
| Seleccionar evento/ticket | | | |
| Comprar ticket mediante compra primaria simulada | | | |
| Revisar inventario | | | |
| Interpretar estado del ticket | | | |

### Vendedor/revendedor

| Tarea | Completada: si/no | Ayuda requerida | Observaciones |
|---|---|---|---|
| Iniciar sesion con usuario propietario | | | |
| Seleccionar ticket propio | | | |
| Revisar politica de reventa | | | |
| Listar ticket para reventa | | | |
| Confirmar aparicion en marketplace | | | |
| Cancelar listado, si aplica | | | |

### Comprador de reventa

| Tarea | Completada: si/no | Ayuda requerida | Observaciones |
|---|---|---|---|
| Iniciar sesion con usuario comprador distinto | | | |
| Consultar marketplace o detalle de evento con reventas | | | |
| Comprar ticket de reventa, si el flujo esta disponible | | | |
| Verificar ticket adquirido en inventario | | | |
| Interpretar propietario/version vigente | | | |

### Staff/verificador

| Tarea | Completada: si/no | Ayuda requerida | Observaciones |
|---|---|---|---|
| Iniciar sesion como STAFF/ADMIN | | | |
| Abrir scanner | | | |
| Escanear QR valido | | | |
| Intentar doble escaneo | | | |
| Interpretar mensaje de rechazo | | | |

### Admin/organizador

| Tarea | Completada: si/no | Ayuda requerida | Observaciones |
|---|---|---|---|
| Iniciar sesion como ADMIN | | | |
| Revisar eventos/tickets | | | |
| Revisar politica de reventa | | | |
| Ejecutar o validar invalidacion si el flujo existe | | | |
| Revisar estado posterior del ticket | | | |

## Preguntas con escala 1 a 5

1 = Muy en desacuerdo / Muy dificil. 5 = Muy de acuerdo / Muy facil.

| Pregunta | 1 | 2 | 3 | 4 | 5 | Comentario |
|---|---:|---:|---:|---:|---:|---|
| Pude completar la tarea asignada | | | | | | |
| El flujo fue claro | | | | | | |
| Entendi el estado del ticket | | | | | | |
| Los mensajes de error fueron comprensibles | | | | | | |
| El sistema transmite confianza sobre la autenticidad del ticket | | | | | | |
| El flujo de reventa fue comprensible | | | | | | |
| El flujo de verificacion QR fue comprensible | | | | | | |
| La interfaz fue facil de usar | | | | | | |
| Calificacion general del sistema | | | | | | |

## Preguntas abiertas

- Que error encontro?
- Que parte fue confusa?
- Que mejoraria?
- Confiaria en este sistema para validar una boleta revendida? Por que?
- Que dato le ayudo mas a entender si el ticket era autentico?
- Que mensaje o pantalla deberia ser mas claro?

## Criterio de cierre de la sesion

La sesion se considera util si el participante completa o intenta completar las tareas asignadas, se registran bloqueos observables y se obtiene retroalimentacion sobre claridad, confianza y comprension del estado del ticket.
