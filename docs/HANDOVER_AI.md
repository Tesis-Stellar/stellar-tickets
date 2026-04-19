# 🤖 HANDOVER PARA AGENTES DE INTELIGENCIA ARTIFICIAL (IA)
**Proyecto**: Stellar Tickets (Tesis Arquitectura Híbrida Web2.5)  
**Blockchain**: Soroban (Stellar Testnet) + Freighter Wallet  
**Objetivo del Sistema**: Eliminar fraude de reventa de boletos usando Smart Contracts como capa de custodia y propiedad inmutable p2p.

---

## 🏗 Arquitectura Actual (Monorepo)
El proyecto usa una arquitectura monolítica con múltiples entornos desacoplados de forma segura:

1. **/contracts/** (Rust/Soroban): 
   - `factory_contract`: Despliega instancias del evento.
   - `event_contract`: Contrato NFT Custodial, maneja la emisión (`inicializar_boleto`), transferencias atómicas (`comprar_boleto` y `listar_boleto`) y quemado (`redimir_boleto`).
2. **/backend/** (Node Express TS + Prisma PostgreSQL):
   - `schema.prisma`: Inyecté campos críticos Web3 en la base de datos de los compañeros (`contract_address` para eventos, `ticket_root_id`, `version`, `is_for_sale`, y `owner_wallet` para boletos).
   - `src/server.ts`: Actúa como Proxy stateless. NO guarda llaves. El endpoint `POST /api/transactions/buy` construye pasivamente el objeto XDR para que el Frontend detone su firma con Freighter. **[ADVERTENCIA: Aquí mockeé endpoints básicos de Web2 Checkout / Auth para mantener vivo el Front de Vite]**.
   - `src/indexer.ts`: Demonio autónomo que sincroniza bloque por bloque. Si escanea un XDR de Soroban, muta la BD (`is_for_sale = false`) para que el Frontend reaccione veloz.
3. **/frontend/** (React Vite + Shadcn UI + Tailwind):
   - Mantiene la simulación hiper-realista Web2 (El usuario compra primero con su tarjeta falsa). 
   - Modifiqué `TicketCard.tsx` y `EventDetail.tsx` (Fase 3): Si el boleto es de origen fiat, aparece un botón **"Asegurar en Web3"**. Si ya es Web3, el botón cambia a **"Revender NFT"** integrando `@stellar/freighter-api`.

---

## 🎯 Instrucciones para ti (La Otra IA)

**Estás asumiendo la Fase 4: La Integración Web y Despliegue en la Nube**.  
Debes cumplir lo estipulado por los usuarios sin romper mis conexiones del Indexador de Soroban.

### 1. Desconectar Mockeos Locales y Leer de Supabase (Front <> Back)
Actualmente, Vite lee la lista de eventos desde `frontend/src/data/events.ts` (Datos Forzados estáticamente en cliente).
- **TU TRABAJO**: Debes borrar ese archivo y modificar React (ej. `EventDetail.tsx`) para consumir `fetch('TU_URL_DEL_BACKEND/api/events')`. El backend usará Prisma para conectarse al Supabase Cloud de verdad.

### 2. Panel Administrativo (Crucial para Tesis)
El usuario necesita ver cómo el organizador inyecta un Evento en el sistema y despacha (Mint) los códigos Web3.
- **TU TRABAJO**: Desarrolla una ruta segura (ej. `/admin` en React). Debe contener un Formulario que invoque a `POST /api/events` en el Express para persistir un evento nuevo en **Supabase**. Una vez escrito, el administrador necesitará un botón en la UI para detonar la creación de Contratos Soroban (`deploy_v2` en el FactoryContract) con su propia wallet de Freighter.

### 3. Migrar al Borde de la Web (Despliegue Cloud)
El usuario exigió salir de `localhost`.
- Para **Backend**: Crea los archivos necesarios (ej. `render.yaml`) o instructivos de CLI para desplegar `Express` a Render.com, conectándole variables de entorno (DATABASE_URL a Supabase).
- Para **Frontend**: Configura o indica los comandos (ej. `npx vercel`) para poner el Frontend en vivo. Asegúrate de inyectar las variables de entorno para que sepa dónde llamar al render del backend.

⚠️ **IMPORTANTE**: No borres los inyectores XDR ni reescribas los esquemas Prisma sin mapearlos al código de Rust, de lo contrario colapsará el indexador y el Smart Contract.
