# Guía Rápida: On-Chain vs Off-Chain

## ¿Cuál es el flujo?

1. **Usuario compra boleto primario en frontend** → Firma tx en Freighter
2. **TX va al blockchain** → Event contract ejecuta `comprar_boleto()`
3. **Event contract emite evento** `TicketResold` con JSON
4. **Indexador escucha blockchain** → Ve evento
5. **Indexador valida + parsea JSON** → Inserta en PostgreSQL
6. **API consulta DB** → Retorna estado actual al frontend

## Responsabilidades Claras

### ✅ ON-CHAIN (Smart Contract Soroban)

- Autorización: `require_auth(usuario)`
- Mutación atómica: cambiar propietario, precio, flags
- Transferencias de tokens (XLM/USDC)
- Emisión de eventos

### ❌ NO ON-CHAIN

- Secretos (API keys, wallets privadas)
- PII (nombres, IDs, emails)
- Precio XLM en FIAT (histórico)

### ✅ OFF-CHAIN (Node.js + PostgreSQL)

- Persistencia de histórico
- Búsquedas complejas (SQL)
- Caché offline (QR)
- UI/UX
- Auditoría detallada (logs)
- Autenticación usuario (si no es verificador)
- Pagos FIAT (si aplica)

### ❌ NO OFF-CHAIN

- Estado atómico de boleto (eso es on-chain)
- Tokens (eso es on-chain)

## Ejemplo: Compra de Reventa

```
Usuario A (Vendedor) quiere revender a Usuario B

OFF-CHAIN (Frontend Next.js):
  1. B visualiza "Boletos en reventa"
  2. B clickea "Comprar, $120"
  3. B firma TX con Freighter → XDR

ON-CHAIN (Event Contract):
  4. receiver_author_check -> B
  5. Boleto no está usado y está en venta ✓
  6. Transfer: 240 stroops → wallet_org
  7. Transfer: 120 stroops → wallet_plat
  8. Transfer: 840 stroops → wallet_A
  9. Propietario = B, es_reventa = true
  10. EMIT: TicketResold(...)

OFF-CHAIN (Indexador):
  11. Escucha evento TicketResold
  12. Inserta boletos_version(v2, propietario=B)
  13. Inserta transacciones_reventa(...)
  14. Actualiza listados_reventa(cancelado=true)

OFF-CHAIN (API):
  15. GET /boletos/ID → retorna propietario=B, precio=1200000

OFF-CHAIN (Frontend):
  16. Usuario B ve "Boleto adquirido" ✓
```

## ¿Cuándo viene cada Fase?

| Fase | Qué se hace | Timeline |
|------|------------|----------|
| A | Hardening contrato base (HECHO) | ✅ |
| B | Registro seguro en factory + event estable | ✅/🔄 |
| C | Deploy real + burn/remint versionado | ~5-7 días |
| D | Rol verificador + check-in offline | ~5-7 días |
| E | API endpoints reales + indexador + frontend conectado | ~10-12 días |
| F | Testnet MVP + reproducible | ~3-5 días |

## Preguntas Comunes

### Q: ¿Dónde viven los secretos?
**A:** Never on-chain. En `.env` local, bóveda (Vault), o AWS Secrets Manager. Frontend/API/Indexador pueden acceder; contrato nunca.

### Q: ¿Cómo se sincroniza off-chain si blockchain está abajo?
**A:** Modo offline: verificador escanea QR → guarda en caché local (30 min). Cuando hay conexión, batch-sincroniza.

### Q: ¿Qué pasa si DB y blockchain divergen?
**A:** Cron job cada 24h reconcilia. Si detecta divergencia, avisa y re-sincroniza desde último cursor.

### Q: ¿El indexador es obligatorio?
**A:** Técnicamente no, pero sí necesario para UX. Sin indexador: cada query sería direct RPC (lento). Con indexador: instant SQL queries.

### Q: ¿Cómo verificamos tokens?
**A:** Token contract address se guarda al crear evento. Valida en contrato y off-chain. Importante para Fase C (burn+remint).

## Próximos Tests Reales

```bash
# En factory_contract/
cargo test -p factory_contract

# En event_contract/
cargo test -p event_contract

# Integración futura
# deploy testnet + indexador + web
```

---

**Next Step**: completar deploy real desde factory o empezar integración real de `off_chain/` con testnet.
