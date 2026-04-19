
# Contratos Inteligentes: Mecánica y Direcciones (Testnet)

Este documento explica de manera sencilla cómo funcionan los contratos inteligentes de la plataforma y dónde se encuentran desplegados actualmente en la **Stellar Testnet**.

## 1. Direcciones Desplegadas (Testnet)

| Componente | Dirección (ID) |
|------------|----------------|
| **Factory Contract** | `CCWXS0...` *(Reemplazado dinámicamente por la base de datos)* |
| **WASM Hash (Event)** | `719d873d66dc88257893004c55e0c93dc482766d063a8bf23e332291ef4ce34ef` |
| **Admin Wallet** | `GBM6N2SUCK3Y6I5DHQKULZD3W27EYMU37VYHNKWLVBNS6VYZHRJPWJBT` |

*(Nota: En Soroban, cada vez que se crea un Evento desde el portal, el `Factory Contract` clona automáticamente el `WASM Hash` y genera una nueva dirección `C...` única para ese evento específico).*

---

## 2. ¿Cómo Funcionan los Contratos?

El sistema se divide en dos contratos principales diseñados en **Rust** para Soroban. 
Su diseño busca **seguridad atómica** (todo ocurre al mismo tiempo o nada ocurre) y **aislamiento** (cada evento tiene su propio contrato para que si uno falla, no afecte a los demás).

### A. Factory Contract (La Fábrica)
Es el contrato maestro ("La Casa Matriz"). 
- **Entradas**: Recibe la orden de crear un evento, el ID del evento, la wallet del organizador y los porcentajes de comisión de reventa.
- **¿Qué hace?**: Toma el "molde" (WASM Hash) del contrato de boletería y fabrica un nuevo contrato independiente exclusivamente para ese evento. Guarda la dirección de ese nuevo contrato en un registro para que la plataforma web pueda encontrarlo después.
- **Salidas**: Retorna la nueva dirección `C...` del contrato de evento que acaba de nacer.

### B. Event Contract (El Controlador del Evento)
Este es el contrato que gestiona los boletos individuales de un concierto/evento. Vive dentro de la blockchain de forma independiente por cada concierto.

Tiene **cuatro funciones principales**:

#### 1. Crear Boleto (Venta Primaria)
- **Entradas**: Precio base.
- **¿Qué hace?**: El organizador emite un boleto digital a su propio nombre.
- **Salidas**: El ID único del boleto.

#### 2. Comprar Boleto (Mercado Primario/Secundario)
- **Entradas**: ID del Boleto y la Wallet del Comprador.
- **¿Qué hace?**: Aquí ocurre la "magia" atómica P2P.
  - Verifica que el comprador tenga suficientes dólares digitales (USDC).
  - Si es **reventa**, calcula matemáticamente el 10% para la tiquetera, el 10% para el organizador, y el restante para el vendedor.
  - Transfiere el USDC a todas las partes instantáneamente.
  - **Quema** (destruye) el código del boleto viejo del vendedor para que no sirva más en la puerta.
  - **Regenera** (Remint) un nuevo código para el comprador.
- **Salidas**: El nuevo número de versión segura del boleto.

#### 3. Listar / Cancelar en el Mercado
- **Entradas**: ID del Boleto y Precio de Reventa (si se lista).
- **¿Qué hace?**: Permite que un dueño ponga a la venta su boleto, o se arrepienta y lo quite del mercado. Solo el propietario criptográfico actual puede hacer esto.

#### 4. Redimir (Control de Acceso)
- **Entradas**: ID del Boleto y la Wallet del Escáner/Verificador de puerta.
- **¿Qué hace?**: La persona de la puerta escanea el QR. El contrato verifica matemáticamente si la wallet dueña firmó ese QR. Si es válido y no ha sido usado antes, lo marca como "Utilizado".
- **Salidas**: Confirmación de acceso concedido, impidiendo que el boleto sirva por segunda vez.

---

## 3. ¿Por qué se diseñó así? (Beneficios para el Usuario)

1. **Atómico e Irreversible**: Al comprar de segunda mano, el pago y la entrega del boleto se unifican en milisegundos. Es 100% imposible que alguien pague y no reciba el boleto, o viceversa (adiós a las estafas de grupos de Facebook).
2. **Adiós al Boleto Duplicado**: Al quemar el boleto viejo en cada reventa, si el vendedor original guardó un PDF con un QR de hace dos días, cuando llegue a la puerta en el evento, el contrato dirá "Ese boleto de versión antigua ya fue quemado".
3. **Distribución de Ganancias Automática**: Nadie tiene que "ir a cobrar" su comisión de reventa. Al momento de la compra, los fondos caen en las cuentas bancarias criptográficas de la organizadora y la tiquetera sin intervención humana.
```
