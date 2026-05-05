/*
  ticket_nft_contract - Contrato NFT (Soroban) para boletos como coleccionables.

  Cada evento despliega su propio contrato. Cada boleto on-chain del
  event_contract corresponde a un token aquí, identificado por `token_id`
  (= ticket_root_id del event_contract). El admin del contrato es el organizador
  del evento, quien puede mintear, transferir administrativamente (para reventa
  con clawback efectivo) y quemar tokens.

  Este contrato permite que Freighter detecte el boleto bajo "Collectibles"
  (cosa que los assets Stellar Classic no logran), porque Freighter cataloga
  como Collectible cualquier token implementado vía contrato Soroban.

  Funciones principales:
   - inicializar(admin, name, symbol)
   - mint(to, token_id, token_uri)        -- solo admin
   - transfer(from, to, token_id)         -- requiere from.require_auth()
   - admin_transfer(token_id, to)         -- solo admin (reventa)
   - burn(token_id)                       -- owner o admin
   - owner_of, token_uri, balance_of, name, symbol
*/

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, String,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ErrorNft {
    YaInicializado = 1,
    NoInicializado = 2,
    TokenYaExiste = 3,
    TokenNoEncontrado = 4,
    NoAutorizado = 5,
    TransferenciaInvalida = 6,
}

#[contracttype]
#[derive(Clone)]
pub enum ClaveDato {
    Admin,
    Nombre,
    Simbolo,
    Owner(u32),
    TokenUri(u32),
    Balance(Address),
    TotalSupply,
}

#[contractevent]
pub struct TokenMinteado {
    pub to: Address,
    pub token_id: u32,
}

#[contractevent]
pub struct TokenTransferido {
    pub from: Address,
    pub to: Address,
    pub token_id: u32,
}

#[contractevent]
pub struct TokenQuemado {
    pub owner: Address,
    pub token_id: u32,
}

#[contract]
pub struct ContratoTicketNft;

#[contractimpl]
impl ContratoTicketNft {
    pub fn inicializar(
        entorno: Env,
        admin: Address,
        nombre: String,
        simbolo: String,
    ) -> Result<(), ErrorNft> {
        if entorno.storage().instance().has(&ClaveDato::Admin) {
            return Err(ErrorNft::YaInicializado);
        }
        admin.require_auth();
        entorno.storage().instance().set(&ClaveDato::Admin, &admin);
        entorno.storage().instance().set(&ClaveDato::Nombre, &nombre);
        entorno
            .storage()
            .instance()
            .set(&ClaveDato::Simbolo, &simbolo);
        entorno
            .storage()
            .instance()
            .set(&ClaveDato::TotalSupply, &0u32);
        Ok(())
    }

    pub fn mint(
        entorno: Env,
        to: Address,
        token_id: u32,
        token_uri: String,
    ) -> Result<(), ErrorNft> {
        let admin = Self::get_admin(&entorno)?;
        admin.require_auth();

        let clave_owner = ClaveDato::Owner(token_id);
        if entorno.storage().persistent().has(&clave_owner) {
            return Err(ErrorNft::TokenYaExiste);
        }

        entorno.storage().persistent().set(&clave_owner, &to);
        entorno
            .storage()
            .persistent()
            .set(&ClaveDato::TokenUri(token_id), &token_uri);

        let balance: u32 = entorno
            .storage()
            .persistent()
            .get(&ClaveDato::Balance(to.clone()))
            .unwrap_or(0);
        entorno
            .storage()
            .persistent()
            .set(&ClaveDato::Balance(to.clone()), &(balance + 1));

        let total: u32 = entorno
            .storage()
            .instance()
            .get(&ClaveDato::TotalSupply)
            .unwrap_or(0);
        entorno
            .storage()
            .instance()
            .set(&ClaveDato::TotalSupply, &(total + 1));

        TokenMinteado { to, token_id }.publish(&entorno);
        Ok(())
    }

    pub fn transfer(
        entorno: Env,
        from: Address,
        to: Address,
        token_id: u32,
    ) -> Result<(), ErrorNft> {
        from.require_auth();
        let owner = Self::owner_of(entorno.clone(), token_id)?;
        if owner != from {
            return Err(ErrorNft::NoAutorizado);
        }
        if from == to {
            return Err(ErrorNft::TransferenciaInvalida);
        }
        Self::mover(&entorno, &from, &to, token_id);
        TokenTransferido { from, to, token_id }.publish(&entorno);
        Ok(())
    }

    pub fn admin_transfer(entorno: Env, token_id: u32, to: Address) -> Result<(), ErrorNft> {
        let admin = Self::get_admin(&entorno)?;
        admin.require_auth();
        let from = Self::owner_of(entorno.clone(), token_id)?;
        if from == to {
            return Err(ErrorNft::TransferenciaInvalida);
        }
        Self::mover(&entorno, &from, &to, token_id);
        TokenTransferido { from, to, token_id }.publish(&entorno);
        Ok(())
    }

    pub fn burn(entorno: Env, invocador: Address, token_id: u32) -> Result<(), ErrorNft> {
        invocador.require_auth();
        let owner = Self::owner_of(entorno.clone(), token_id)?;
        let admin = Self::get_admin(&entorno)?;
        if invocador != owner && invocador != admin {
            return Err(ErrorNft::NoAutorizado);
        }

        entorno
            .storage()
            .persistent()
            .remove(&ClaveDato::Owner(token_id));
        entorno
            .storage()
            .persistent()
            .remove(&ClaveDato::TokenUri(token_id));

        let balance: u32 = entorno
            .storage()
            .persistent()
            .get(&ClaveDato::Balance(owner.clone()))
            .unwrap_or(0);
        if balance > 0 {
            entorno
                .storage()
                .persistent()
                .set(&ClaveDato::Balance(owner.clone()), &(balance - 1));
        }

        let total: u32 = entorno
            .storage()
            .instance()
            .get(&ClaveDato::TotalSupply)
            .unwrap_or(0);
        if total > 0 {
            entorno
                .storage()
                .instance()
                .set(&ClaveDato::TotalSupply, &(total - 1));
        }

        TokenQuemado { owner, token_id }.publish(&entorno);
        Ok(())
    }

    pub fn owner_of(entorno: Env, token_id: u32) -> Result<Address, ErrorNft> {
        entorno
            .storage()
            .persistent()
            .get(&ClaveDato::Owner(token_id))
            .ok_or(ErrorNft::TokenNoEncontrado)
    }

    pub fn token_uri(entorno: Env, token_id: u32) -> Result<String, ErrorNft> {
        entorno
            .storage()
            .persistent()
            .get(&ClaveDato::TokenUri(token_id))
            .ok_or(ErrorNft::TokenNoEncontrado)
    }

    pub fn balance_of(entorno: Env, addr: Address) -> u32 {
        entorno
            .storage()
            .persistent()
            .get(&ClaveDato::Balance(addr))
            .unwrap_or(0)
    }

    pub fn name(entorno: Env) -> String {
        entorno
            .storage()
            .instance()
            .get(&ClaveDato::Nombre)
            .unwrap_or(String::from_str(&entorno, ""))
    }

    pub fn symbol(entorno: Env) -> String {
        entorno
            .storage()
            .instance()
            .get(&ClaveDato::Simbolo)
            .unwrap_or(String::from_str(&entorno, ""))
    }

    pub fn total_supply(entorno: Env) -> u32 {
        entorno
            .storage()
            .instance()
            .get(&ClaveDato::TotalSupply)
            .unwrap_or(0)
    }

    pub fn admin(entorno: Env) -> Result<Address, ErrorNft> {
        Self::get_admin(&entorno)
    }
}

impl ContratoTicketNft {
    fn get_admin(entorno: &Env) -> Result<Address, ErrorNft> {
        entorno
            .storage()
            .instance()
            .get(&ClaveDato::Admin)
            .ok_or(ErrorNft::NoInicializado)
    }

    fn mover(entorno: &Env, from: &Address, to: &Address, token_id: u32) {
        entorno
            .storage()
            .persistent()
            .set(&ClaveDato::Owner(token_id), to);

        let bal_from: u32 = entorno
            .storage()
            .persistent()
            .get(&ClaveDato::Balance(from.clone()))
            .unwrap_or(0);
        if bal_from > 0 {
            entorno
                .storage()
                .persistent()
                .set(&ClaveDato::Balance(from.clone()), &(bal_from - 1));
        }
        let bal_to: u32 = entorno
            .storage()
            .persistent()
            .get(&ClaveDato::Balance(to.clone()))
            .unwrap_or(0);
        entorno
            .storage()
            .persistent()
            .set(&ClaveDato::Balance(to.clone()), &(bal_to + 1));
    }
}

#[cfg(test)]
mod test;
