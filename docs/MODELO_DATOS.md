
# Modelo de Datos Híbrido (Web2.5)

Este diagrama representa cómo se fusionó la visión tradicional de e-commerce (creada por el equipo Frontend/Backend) con la capa de infraestructura descentralizada de Soroban (Web3).

## Diagrama Entidad-Relación (ER)

```mermaid
erDiagram
    %% ==========================================
    %% IDENTIDAD Y AUTENTICACIÓN
    %% ==========================================
    USERS {
        uuid id PK
        string email "Web2 Auth"
        string password_hash "Web2 Auth"
        string wallet_address "Web3 Auth (Soroban)"
        string role
        boolean is_active
    }

    %% ==========================================
    %% CATÁLOGO DE EVENTOS (Dominio Web2)
    %% ==========================================
    ORGANIZERS {
        uuid id PK
        string legal_name
        string support_email
    }

    VENUES {
        uuid id PK
        string name
        string address_line
        string venue_type
    }

    EVENTS {
        uuid id PK
        string contract_address "WASM Contract (Web3)"
        uuid organizer_id FK
        uuid venue_id FK
        string title
        datetime starts_at
        enum status
    }

    EVENT_TICKET_TYPES {
        uuid id PK
        uuid event_id FK
        string ticket_type_name
        decimal price_amount
        int inventory_quantity
    }

    %% ==========================================
    %% FLUJO DE COMERCIO (Carrito y Pagos Web2)
    %% ==========================================
    CARTS {
        uuid id PK
        uuid user_id FK
        enum status
    }

    ORDERS {
        uuid id PK
        uuid user_id FK
        string order_number
        decimal total_amount
        enum status
    }

    PAYMENTS {
        uuid id PK
        uuid order_id FK
        enum payment_method
        enum status
    }

    %% ==========================================
    %% GESTIÓN DE PROPIEDAD Y BLOCKCHAIN (Web3)
    %% ==========================================
    TICKETS {
        uuid id PK
        uuid owner_user_id FK "Dueño en DB"
        string ticket_code "QR Payload Web2"
        int ticket_root_id "ID Soroban"
        int version "Versión Soroban (Reventas)"
        boolean is_for_sale "Si está listado en SC"
        enum status
    }

    INDEXER_STATE {
        int id PK
        int last_ledger "Último bloque leído"
        datetime updated_at
    }

    %% Relaciones
    USERS ||--o{ CARTS : "crea"
    USERS ||--o{ ORDERS : "compra"
    USERS ||--o{ TICKETS : "posee"
    
    ORGANIZERS ||--o{ EVENTS : "organiza"
    VENUES ||--o{ EVENTS : "alberga"
    
    EVENTS ||--o{ EVENT_TICKET_TYPES : "ofrece"
    
    CARTS ||--o{ ORDERS : "convierte a"
    ORDERS ||--o{ PAYMENTS : "se paga con"
    ORDERS ||--o{ TICKETS : "genera"
```

## Simbiosis de Modelos: Lo Mejor de Dos Mundos

Hemos integrado ambos enfoques para que la tiquetera funcione exactamente igual a plataformas reales (Tuboleto, Ticketmaster), pero con el superpoder de impedir el fraude en reventa.

### Lo que aportó tu compañero (Web2)
Su diseño era muy robusto para simular el **comercio tradicional**. Él tuvo en cuenta:
1. **Carrito de Compras y Órdenes**: Control de expiración del carrito y flujo transaccional (`orders`, `cart_items`, `seat_holds`).
2. **Inventario Físico Complejo**: Consideró tipos de boleto (`Vip`, `General`), locaciones físicas (`venues`, `cities`), secciones y control de sillas numeradas (`seats`, `venue_sections`).
3. **Plataformas de Pago**: Control exhaustivo del estado de los abonos tradicionales (Tarjeta de crédito, PSE) mediante la tabla `payments`.

### Lo que le faltaba y le inyectamos de nuestra parte (Web3 / Stellar)
Su esquema ignoraba por completo **cómo íbamos a conectar a los usuarios con la blockchain y cómo rastrear la propiedad real del boleto**. Nosotros corregimos y agreamos:
1. **El Vínculo del Wallet (`wallet_address` en `Users`)**: Ahora los usuarios inician sesión y si quieren el boleto web3, pueden vincular su billetera.
2. **El Escudo Antifraude (`ticket_root_id` y `version` en `Tickets`)**: Agregamos las variables que leen directamente del Smart Contract. Así, si el boleto es revendido, la versión aumenta automáticamente en la DB, haciendo inútil el QR viejo (evitamos que el usuario inicial entre con un pantallazo).
3. **Control Descentralizado del Evento (`contract_address` en `Events`)**: Como tenemos la "Factory", cada evento ahora almacena en su fila la dirección única `C...` que se le desplegó en la red de Stellar.
4. **El Sincronizador (`indexer_state`)**: Añadimos el "cerebro" que le dirá a nuestro indexador de Node.js en qué bloque de la red (Ledger) se quedó buscando eventos de nuestros contratos.
```
