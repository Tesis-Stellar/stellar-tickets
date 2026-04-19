# Documentación Técnica — Contratos Inteligentes Stellar Tickets

## 1. Visión General

Stellar Tickets utiliza dos contratos inteligentes escritos en Rust para Soroban (el motor de smart contracts de Stellar):

1. **factory_contract** (Fábrica): Crea y registra contratos de evento.
2. **event_contract** (Evento): Gestiona boletos dentro de un evento específico.

Cada evento tiene su propio contrato independiente, desplegado programáticamente por la fábrica. Esto aísla los datos de cada evento y facilita la auditoría.

## 2. Conceptos Técnicos de Rust y Soroban

### 2.1 Rust Básico

| Concepto | Qué es | Para qué se usa |
|----------|--------|------------------|
| `#![no_std]` | Directiva que elimina la librería estándar de Rust | Los contratos corren en la blockchain, no en un SO. No hay acceso a archivos, red ni consola |
| `struct` | Tipo de dato compuesto con campos nombrados | Definir estructuras como `Boleto` o `ConfiguracionEvento` |
| `enum` | Tipo que puede ser una de varias variantes | Definir claves de storage (`ClaveDato`) y errores (`ErrorContrato`) |
| `impl` | Bloque de implementación que define funciones para un tipo | Agregar funciones al contrato |
| `pub fn` | Función pública | Funciones invocables desde fuera del contrato |
| `fn` (sin pub) | Función privada | Funciones de ayuda internas |
| `Result<T, E>` | Tipo que puede ser `Ok(valor)` o `Err(error)` | Retornar éxito o error de forma controlada, sin abortar el programa |
| `-> Result<u32, ErrorContrato>` | Tipo de retorno | "Esta función retorna un u32 si todo sale bien, o un ErrorContrato si falla" |
| `?` (operador) | Propagación automática de errores | Si la expresión da `Err`, la función retorna ese error inmediatamente |
| `clone()` | Crear una copia de un valor | Soroban necesita copias porque los valores se mueven al guardarlos |
| `as i128` | Conversión de tipo | Convertir un `u32` a `i128` cuando se necesita compatibilidad de tipos |
| `#[cfg(test)]` | Compilación condicional | Incluir código solo cuando se corren tests, no en producción |

### 2.2 Macros de Soroban

| Macro | Qué hace | Ejemplo |
|-------|----------|---------|
| `#[contract]` | Marca un struct como contrato inteligente | `pub struct ContratoEvento;` |
| `#[contractimpl]` | Marca un bloque `impl` como la interfaz pública del contrato | `impl ContratoEvento { ... }` |
| `#[contracttype]` | Permite que un struct/enum se serialice para guardarse en la blockchain | `pub struct Boleto { ... }` |
| `#[contracterror]` | Define errores tipados con códigos numéricos | `pub enum ErrorContrato { ... }` |
| `#[contractevent]` | Define un evento que se puede emitir a la blockchain | `pub struct BoletoCreado { ... }` |
| `#[topic]` | Marca un campo del evento como indexable (filtrable) | `pub ticket_root_id: u32` |
| `#[derive(...)]` | Auto-genera implementaciones de traits comunes | `#[derive(Clone, Debug, Eq, PartialEq)]` |
| `#[repr(u32)]` | Fuerza representación como enteros de 32 bits | Requerido por `#[contracterror]` |

### 2.3 Objeto `Env` (Entorno)

El `Env` es el contexto de ejecución que Soroban inyecta automáticamente en cada llamada al contrato. Proporciona acceso a:

- **Storage** (`entorno.storage().instance()`): Base de datos clave-valor del contrato. Funciones: `set()`, `get()`, `has()`, `remove()`.
- **Auth** (`address.require_auth()`): Verifica que la dirección firmó la transacción.
- **Deployer** (`entorno.deployer()`): Permite crear otros contratos programáticamente.
- **Eventos** (`.publish(&entorno)`): Emite eventos inmutables a la blockchain.

### 2.4 `Address` y `require_auth()`

`Address` es una dirección en Stellar: puede ser una cuenta de usuario o la dirección de otro contrato.

`require_auth()` verifica que esa dirección firmó la transacción actual. Si no la firmó, la transacción falla y se revierte todo. Este es el mecanismo central de seguridad.

## 3. Event Contract — API de Funciones

### 3.1 Inicialización

#### `inicializar`
| | |
|---|---|
| **Propósito** | Configura el contrato con los datos del evento. Se llama una sola vez después del deploy |
| **Entradas** | `organizador: Address` — Dueño del evento; `plataforma: Address` — Recibe comisión en reventas; `token_pago: Address` — Contrato del token de pago (ej: USDC); `comision_organizador: i128` — Porcentaje para el organizador en reventas (0-99); `comision_plataforma: i128` — Porcentaje para la plataforma en reventas (0-99) |
| **Salida** | `Result<(), ErrorContrato>` — Ok si se inicializó correctamente |
| **Errores** | `YaInicializado` (1), `ComisionesMuyAltas` (2), `ComisionesNegativas` (3) |
| **Auth** | Requiere firma del organizador |

### 3.2 Gestión de Verificadores

#### `agregar_verificador`
| | |
|---|---|
| **Propósito** | Autoriza a una dirección para redimir boletos en la puerta del evento |
| **Entradas** | `verificador: Address` — Dirección a autorizar |
| **Salida** | `Result<(), ErrorContrato>` |
| **Errores** | `NoInicializado` (14), `VerificadorYaExiste` (15) |
| **Auth** | Requiere firma del organizador |

#### `remover_verificador`
| | |
|---|---|
| **Propósito** | Remueve la autorización de un verificador |
| **Entradas** | `verificador: Address` — Dirección a desautorizar |
| **Salida** | `Result<(), ErrorContrato>` |
| **Errores** | `NoInicializado` (14), `VerificadorNoEncontrado` (16) |
| **Auth** | Requiere firma del organizador |

#### `es_verificador`
| | |
|---|---|
| **Propósito** | Consulta si una dirección es verificador autorizado |
| **Entradas** | `verificador: Address` |
| **Salida** | `bool` — `true` si es verificador |
| **Auth** | Sin auth (solo lectura) |

### 3.3 Creación de Boletos

#### `crear_boleto`
| | |
|---|---|
| **Propósito** | Crea (mintea) un nuevo boleto asignado al organizador con version = 0 |
| **Entradas** | `id_evento: u32` — ID del evento; `precio: i128` — Precio base |
| **Salida** | `Result<u32, ErrorContrato>` — El `ticket_root_id` asignado |
| **Errores** | `PrecioInvalido` (4), `NoInicializado` (14) |
| **Auth** | Requiere firma del organizador |
| **Evento** | Emite `BoletoCreado` |

### 3.4 Listado y Cancelación

#### `listar_boleto`
| | |
|---|---|
| **Propósito** | Pone un boleto en venta a un precio determinado |
| **Entradas** | `ticket_root_id: u32`; `nuevo_precio: i128` |
| **Salida** | `Result<(), ErrorContrato>` |
| **Errores** | `BoletoNoEncontrado` (10), `YaEnVenta` (5), `BoletoUsado` (6), `BoletoInvalidado` (13), `PrecioInvalido` (4) |
| **Auth** | Requiere firma del propietario actual |
| **Evento** | Emite `BoletoListado` |

#### `cancelar_venta`
| | |
|---|---|
| **Propósito** | Cancela un listado de venta existente |
| **Entradas** | `ticket_root_id: u32` |
| **Salida** | `Result<(), ErrorContrato>` |
| **Errores** | `BoletoNoEncontrado` (10), `NoEnVenta` (7) |
| **Auth** | Requiere firma del propietario actual |
| **Evento** | Emite `VentaCancelada` |

### 3.5 Compra (Venta Primaria y Reventa)

#### `comprar_boleto`
| | |
|---|---|
| **Propósito** | Compra un boleto listado. Distingue automáticamente entre venta primaria y reventa |
| **Entradas** | `ticket_root_id: u32`; `comprador: Address` |
| **Salida** | `Result<u32, ErrorContrato>` — La versión resultante del boleto |
| **Errores** | `NoEnVenta` (7), `BoletoUsado` (6), `BoletoInvalidado` (13), `AutoCompra` (8), `NoInicializado` (14) |
| **Auth** | Requiere firma del comprador |

**Flujo de venta primaria** (`es_reventa == false`):
1. El comprador transfiere el precio completo al organizador.
2. El boleto se actualiza in-place: nuevo propietario, `es_reventa = true`.
3. Emite `BoletoCompradoPrimario`. Retorna la misma versión.

**Flujo de reventa** (`es_reventa == true`):
1. Se calculan comisiones: X% organizador, Y% plataforma, resto al vendedor.
2. Se ejecutan 3 transferencias atómicas (si alguna falla, ninguna se ejecuta).
3. **BURN**: La versión actual se marca como `invalidado = true`.
4. **REMINT**: Se crea una nueva versión (`version + 1`) con el comprador como propietario.
5. Se actualiza el puntero `VersionActual` a la nueva versión.
6. Emite `BoletoRevendido`. Retorna la nueva versión.

### 3.6 Redención

#### `redimir_boleto`
| | |
|---|---|
| **Propósito** | Marca un boleto como usado en la puerta del evento |
| **Entradas** | `ticket_root_id: u32`; `verificador: Address` |
| **Salida** | `Result<(), ErrorContrato>` |
| **Errores** | `NoAutorizado` (11), `YaUsado` (9), `BoletoInvalidado` (13) |
| **Auth** | Requiere firma del verificador (NO del propietario) |
| **Evento** | Emite `BoletoRedimido` |

### 3.7 Invalidación

#### `invalidar_boleto`
| | |
|---|---|
| **Propósito** | Cancela un boleto administrativamente (evento cancelado, error, etc.) |
| **Entradas** | `ticket_root_id: u32` |
| **Salida** | `Result<(), ErrorContrato>` |
| **Errores** | `BoletoInvalidado` (13), `NoInicializado` (14) |
| **Auth** | Requiere firma del organizador |
| **Evento** | Emite `BoletoInvalidadoEvt` |

### 3.8 Consultas (Solo Lectura)

| Función | Entrada | Salida | Descripción |
|---------|---------|--------|-------------|
| `obtener_boleto` | `ticket_root_id` | `Result<Boleto>` | Boleto en su versión vigente |
| `obtener_boleto_version` | `ticket_root_id, version` | `Result<Boleto>` | Boleto en una versión específica (historial) |
| `obtener_version_vigente` | `ticket_root_id` | `Result<u32>` | Número de versión actual |
| `obtener_propietario` | `ticket_root_id` | `Result<Address>` | Propietario actual |
| `obtener_boletos_reventa` | (ninguna) | `Vec<Boleto>` | Todos los boletos en reventa activa |
| `obtener_boletos_evento` | `id_evento` | `Vec<Boleto>` | Todos los boletos de un evento |

## 4. Factory Contract — API de Funciones

#### `inicializar`
| | |
|---|---|
| **Propósito** | Configura la fábrica con un administrador |
| **Entradas** | `administrador: Address` |
| **Auth** | Requiere firma del administrador |
| **Panics** | `already_init` si ya fue inicializada |

#### `configurar_wasm_evento`
| | |
|---|---|
| **Propósito** | Guarda el hash WASM del event_contract para deploy programático |
| **Entradas** | `hash_wasm_evento: BytesN<32>` — Hash del WASM compilado |
| **Auth** | Requiere firma del administrador |

#### `crear_evento_contrato`
| | |
|---|---|
| **Propósito** | Crea un nuevo contrato de evento completo: deploy + inicialización + registro |
| **Entradas** | `configuracion: ConfiguracionEvento`; `direccion_evento_prueba: Address` (solo tests) |
| **Salida** | `Address` — Dirección del nuevo contrato de evento |
| **Auth** | Requiere firma del administrador Y del organizador (doble autorización) |
| **Panics** | `fees_too_high`, `invalid_capacity`, `event_exists`, `contract_already_registered` |
| **Evento** | Emite `EventoCreado` |

#### Consultas

| Función | Entrada | Salida | Descripción |
|---------|---------|--------|-------------|
| `obtener_wasm_evento` | (ninguna) | `BytesN<32>` | Hash WASM configurado |
| `obtener_contrato_evento` | `id_evento` | `Address` | Dirección del contrato de ese evento |
| `obtener_contador_eventos` | (ninguna) | `u32` | Total de eventos creados |

## 5. Modelo de Datos: Boleto

```
Boleto {
    ticket_root_id: u32    -- ID estable, no cambia en reventas
    version: u32           -- Se incrementa con cada reventa (0, 1, 2, ...)
    id_evento: u32         -- A qué evento pertenece
    propietario: Address   -- Dueño actual
    precio: i128           -- Precio actual en unidades del token
    en_venta: bool         -- Si está listado en el marketplace
    es_reventa: bool       -- true después de la primera venta
    usado: bool            -- true después de la redención
    invalidado: bool       -- true si fue quemado o cancelado
}
```

La clave primaria en el storage es `(ticket_root_id, version)`. La clave `VersionActual(ticket_root_id)` siempre apunta a la versión vigente.

## 6. Tabla de Errores

| Código | Nombre | Cuándo ocurre |
|--------|--------|---------------|
| 1 | `YaInicializado` | Se intenta inicializar un contrato que ya fue inicializado |
| 2 | `ComisionesMuyAltas` | La suma de comisiones >= 100% |
| 3 | `ComisionesNegativas` | Alguna comisión es negativa |
| 4 | `PrecioInvalido` | El precio es <= 0 |
| 5 | `YaEnVenta` | El boleto ya está listado para venta |
| 6 | `BoletoUsado` | El boleto ya fue redimido |
| 7 | `NoEnVenta` | El boleto no está en venta |
| 8 | `AutoCompra` | El propietario intenta comprarse su propio boleto |
| 9 | `YaUsado` | Intento de redimir un boleto ya redimido |
| 10 | `BoletoNoEncontrado` | No existe un boleto con ese ID/versión |
| 11 | `NoAutorizado` | La persona no tiene permisos |
| 12 | `VersionInvalida` | Versión especificada no existe |
| 13 | `BoletoInvalidado` | El boleto fue cancelado o quemado |
| 14 | `NoInicializado` | El contrato no fue inicializado |
| 15 | `VerificadorYaExiste` | La dirección ya es verificador |
| 16 | `VerificadorNoEncontrado` | La dirección no es verificador |

## 7. Eventos On-Chain

| Evento | Cuándo se emite | Topics (indexables) | Datos |
|--------|----------------|---------------------|-------|
| `BoletoCreado` | Al crear un boleto | `ticket_root_id`, `id_evento` | propietario, precio |
| `BoletoListado` | Al listar para venta | `ticket_root_id`, `id_evento` | propietario, precio, version, es_reventa |
| `VentaCancelada` | Al cancelar una venta | `ticket_root_id`, `id_evento` | propietario, version |
| `BoletoCompradoPrimario` | Venta primaria exitosa | `ticket_root_id`, `id_evento` | vendedor, comprador, precio |
| `BoletoRevendido` | Reventa exitosa (burn/remint) | `ticket_root_id`, `id_evento` | vendedor, comprador, precio, version_anterior, version_nueva |
| `BoletoRedimido` | Al marcar como usado | `ticket_root_id`, `id_evento` | propietario, verificador, version |
| `BoletoInvalidadoEvt` | Al invalidar un boleto | `ticket_root_id`, `id_evento` | version |
| `VerificadorAgregado` | Al agregar verificador | `verificador` | — |
| `VerificadorRemovido` | Al remover verificador | `verificador` | — |
| `EventoCreado` | Al crear evento (factory) | `id_evento` | organizador, contrato_evento, capacidad_total |

## 8. Decisiones de Diseño

### ¿Por qué burn/remint en vez de solo cambiar el propietario?
- **Trazabilidad**: Cada versión queda como registro inmutable en la blockchain.
- **Antifraude**: Una versión invalidada no puede ser reutilizada.
- **Auditabilidad**: Se puede reconstruir todo el historial de propiedad de un boleto consultando versiones 0, 1, 2, etc.

### ¿Por qué errores tipados en vez de `panic!("texto")`?
- **Eficiencia**: Un número es más barato de almacenar y transmitir que un string.
- **Programabilidad**: El código off-chain puede hacer `match` sobre el código de error.
- **Testing**: Soroban genera `try_*` methods que permiten capturar errores sin panic.

### ¿Por qué un verificador separado para la redención?
- **Separación de responsabilidades**: El propietario tiene el boleto, el verificador valida el acceso.
- **Seguridad**: Previene que alguien marque su boleto como "usado" remotamente sin asistir.
- **Trazabilidad**: El evento `BoletoRedimido` registra quién verificó, cuándo y qué boleto.

### ¿Por qué la factory crea contratos programáticamente?
- **Aislamiento**: Cada evento tiene su propio contrato con su propio storage.
- **Escalabilidad**: No hay límite de storage compartido entre eventos.
- **Seguridad**: Un bug en un contrato de evento no afecta a otros.

### ¿Por qué transacciones atómicas?
- Todos los pasos de una reventa (pagos + burn + remint) ocurren en una sola transacción.
- Si cualquier paso falla (ej: fondos insuficientes), nada se ejecuta.
- Esto previene estados inconsistentes como "se pagó pero no se transfirió el boleto".
