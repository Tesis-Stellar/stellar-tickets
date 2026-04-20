# Roadmap Fase B: Separación en Factory + Event Contract

## Contexto

El contrato actual (`tesis_main_contract`) es una base funcional que maneja un único evento. En **Fase B**, nos separamos en:

1. **`factory_contract`**: Crea instancias de event contracts
2. **`event_contract`**: Gestiona boletos para un evento específico

## Razones

### Escalabilidad
- Cada evento tiene su propio contrato (inmutable, auditable)
- No hay límite de eventos en 1 contrato
- Reduce tamaño/costo por contrato

### Claridad Arquitectónica
- Factory es "punto de entrada" para crear eventos
- Event contracts son "operacionales"
- Separación de responsibilities

### Auditoría POR Evento
- Cada evento en blockchain es trazable
- Simplifica reportes por evento para organizadores

## Estructura de Directorios

```
contracts/
├── tesis_main_contract/              # Contract actual (DEPRECAR después Fase B)
│   ├── src/lib.rs
│   ├── src/test.rs
│   ├── Cargo.toml
│   └── Makefile
│
├── factory_contract/                 # NUEVO - Fase B
│   ├── src/
│   │   ├── lib.rs                    # Punto de entrada factory
│   │   ├── factory.rs                # Lógica crear evento
│   │   ├── types.rs                  # Tipos compartidos
│   │   └── test.rs                   # Tests factory
│   ├── Cargo.toml
│   └── Makefile
│
└── event_contract/                   # NUEVO - Fase B (copia de tesis_main_contract + refactor)
    ├── src/
    │   ├── lib.rs                    # Event contract (traducción de tesis_main_contract)
    │   ├── ticket.rs                 # Módulo de boletos
    │   ├── types.rs                  # Enum eventos, Struct Boleto
    │   ├── events.rs                 # Emisión de eventos (TicketMinted, etc)
    │   └── test.rs                   # Tests event_contract
    ├── Cargo.toml
    └── Makefile
```

## Cambios en Factory Contract

### 1. Nuevo Struct: `ConfiguracionEvento`

```rust
#[derive(Clone)]
pub struct ConfiguracionEvento {
    pub id_evento: u32,
    pub organizador: Address,
    pub token_pago: Address,  // Asset pai (XLM o USDC)
    pub comision_organizador: u32,  // 20% default
    pub comision_plataforma: u32,   // 10% default
    pub wallet_organizador: Address,
    pub wallet_plataforma: Address,
    pub capacidad_total: u32,
}
```

### 2. Nueva Función: `crear_evento_contrato`

```rust
pub fn crear_evento_contrato(
    entorno: Env,
    administrador_fabrica: Address,
    configuracion: ConfiguracionEvento,
) -> Address {
    // Requiere auth
    
    // Crear nueva instancia de event_contract
    // pasar configuracion como init data
    
    // Emitir evento: EventoCreado
    // {
    //   contrato_evento: Address,
    //   id_evento: u32,
    //   organizador: Address,
    //   timestamp: u64
    // }
    
    // Guardar mapping: id_evento -> contrato_evento
    // Retornar dirección de nuevo contrato
}
```

### 3. Getter: `obtener_contrato_evento`

```rust
pub fn obtener_contrato_evento(entorno: Env, id_evento: u32) -> Address {
    // Lookup en almacén
    // Si no existe: panic
}
```

## Cambios en Event Contract

Esencialmente, copiar `tesis_main_contract/src/lib.rs` y:

1. Quitar inicialización de configuración (viene del factory)
2. Refactor `inicializar()` → `marcar_listo()` (validación que factory pasó datos)
3. Agregar emisión de eventos:
   - `TicketMinted`
   - `TicketListedForSale`
   - `TicketResold` (con comisiones desglosadas)
   - `TicketRedeemed`
   - `TicketCancelled`
4. Refactor a módulos:
   - `src/ticket.rs`: lógica de boletos
   - `src/events.rs`: funciones de emisión

## Datos que Emitirá Event Contract

### TicketMinted

```json
{
  "id_boleto": u32,
  "id_evento": u32,
  "propietario": "G...",
  "precio": 1000000,
  "timestamp": 1699000000,
  "tipo": "primario"
}
```

### TicketListedForSale

```json
{
  "id_boleto": u32,
  "id_evento": u32,
  "propietario": "G...",
  "precio": 1000000,
  "es_reventa": false,
  "timestamp": 1699000000
}
```

### TicketResold

```json
{
  "id_boleto": u32,
  "id_evento": u32,
  "vendedor": "G...",
  "comprador": "G...",
  "precio_reventa": 1200000,
  "comision_organizador": 240000,
  "comision_plataforma": 120000,
  "comision_vendedor": 840000,
  "wallets_pagadas": {
    "wallet_organizador": "G...",
    "wallet_plataforma": "G...",
    "wallet_vendedor": "G..."
  },
  "hash_transaccion": "abc123...",
  "timestamp": 1699000000,
  "versión": 1
}
```

### TicketRedeemed

```json
{
  "id_boleto": u32,
  "id_evento": u32,
  "propietario_actual": "G...",
  "usado": true,
  "timestamp": 1699000000,
  "verificador": "G..." // Fase D
}
```

## Flujo de Deployment Fase B

1. **Escribir factory_contract** → tests pasen (15 tests approx)
2. **Refactor event_contract** → agregar eventos → tests pasen (27 tests adaptados)
3. **Integration tests** → factory crea evento, event_contract funciona (10 tests)
4. **Documentación** → README actualizar con factory address
5. **Deploy a testnet** → Grabar factory + ejemplo de event creado

## Estimación

- **Factory logic**: 2-3 días
- **Event refactor + eventos**: 2-3 días
- **Integration + testing**: 2-3 días
- **Documentation + deployment**: 1 día

**Total Fase B**: ~8-10 días

## Próximos Pasos Después de Fase B

- **Fase C**: Burn+remint (burn token viejo, remint token nuevo en cada reventa)
- **Fase D**: Rol `verificador`, separar redeem auth
- **Fase E**: Integración con off-chain (indexador consume eventos)
- **Fase F**: Testnet MVP + evidencia reproducible

---

## Notas Técnicas

- Ambos contratos en **Soroban SDK v23**
- Factory NO gestiona dinero; solo crea contratos
- Event contracts SÍ son custodios de dinero (transfers)
- Todos eventos en **JSON serializado como String**
- Idempotencia vía `hash_transaccion_stellar` + tipo evento

