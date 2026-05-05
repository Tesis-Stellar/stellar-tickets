#![cfg(test)]

use super::{ContratoTicketNft, ContratoTicketNftClient, ErrorNft};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup<'a>() -> (Env, ContratoTicketNftClient<'a>, Address) {
    let entorno = Env::default();
    entorno.mock_all_auths();
    let admin = Address::generate(&entorno);
    let id = entorno.register(ContratoTicketNft, ());
    let cliente = ContratoTicketNftClient::new(&entorno, &id);
    cliente.inicializar(
        &admin,
        &String::from_str(&entorno, "Boletos Test"),
        &String::from_str(&entorno, "TT"),
    );
    (entorno, cliente, admin)
}

#[test]
fn test_inicializar_y_metadata() {
    let (entorno, cliente, admin) = setup();
    assert_eq!(cliente.admin(), admin);
    assert_eq!(cliente.name(), String::from_str(&entorno, "Boletos Test"));
    assert_eq!(cliente.symbol(), String::from_str(&entorno, "TT"));
    assert_eq!(cliente.total_supply(), 0);
}

#[test]
fn test_inicializar_dos_veces_falla() {
    let (entorno, cliente, admin) = setup();
    let resultado = cliente.try_inicializar(
        &admin,
        &String::from_str(&entorno, "X"),
        &String::from_str(&entorno, "X"),
    );
    assert_eq!(resultado, Err(Ok(ErrorNft::YaInicializado)));
}

#[test]
fn test_mint() {
    let (entorno, cliente, _admin) = setup();
    let user = Address::generate(&entorno);
    cliente.mint(&user, &1, &String::from_str(&entorno, "https://x/1"));
    assert_eq!(cliente.owner_of(&1), user);
    assert_eq!(cliente.balance_of(&user), 1);
    assert_eq!(cliente.total_supply(), 1);
    assert_eq!(cliente.token_uri(&1), String::from_str(&entorno, "https://x/1"));
}

#[test]
fn test_mint_token_duplicado_falla() {
    let (entorno, cliente, _admin) = setup();
    let user = Address::generate(&entorno);
    cliente.mint(&user, &1, &String::from_str(&entorno, "u"));
    let resultado = cliente.try_mint(&user, &1, &String::from_str(&entorno, "u2"));
    assert_eq!(resultado, Err(Ok(ErrorNft::TokenYaExiste)));
}

#[test]
fn test_transfer_owner() {
    let (entorno, cliente, _admin) = setup();
    let alice = Address::generate(&entorno);
    let bob = Address::generate(&entorno);
    cliente.mint(&alice, &7, &String::from_str(&entorno, "u"));
    cliente.transfer(&alice, &bob, &7);
    assert_eq!(cliente.owner_of(&7), bob);
    assert_eq!(cliente.balance_of(&alice), 0);
    assert_eq!(cliente.balance_of(&bob), 1);
}

#[test]
fn test_admin_transfer() {
    let (entorno, cliente, _admin) = setup();
    let alice = Address::generate(&entorno);
    let bob = Address::generate(&entorno);
    cliente.mint(&alice, &3, &String::from_str(&entorno, "u"));
    cliente.admin_transfer(&3, &bob);
    assert_eq!(cliente.owner_of(&3), bob);
    assert_eq!(cliente.balance_of(&alice), 0);
    assert_eq!(cliente.balance_of(&bob), 1);
}

#[test]
fn test_transfer_no_owner_falla() {
    let (entorno, cliente, _admin) = setup();
    let alice = Address::generate(&entorno);
    let bob = Address::generate(&entorno);
    let mallory = Address::generate(&entorno);
    cliente.mint(&alice, &5, &String::from_str(&entorno, "u"));
    let resultado = cliente.try_transfer(&mallory, &bob, &5);
    assert_eq!(resultado, Err(Ok(ErrorNft::NoAutorizado)));
}

#[test]
fn test_burn_owner() {
    let (entorno, cliente, _admin) = setup();
    let alice = Address::generate(&entorno);
    cliente.mint(&alice, &9, &String::from_str(&entorno, "u"));
    cliente.burn(&alice, &9);
    let resultado = cliente.try_owner_of(&9);
    assert_eq!(resultado, Err(Ok(ErrorNft::TokenNoEncontrado)));
    assert_eq!(cliente.balance_of(&alice), 0);
    assert_eq!(cliente.total_supply(), 0);
}

#[test]
fn test_burn_admin() {
    let (entorno, cliente, admin) = setup();
    let alice = Address::generate(&entorno);
    cliente.mint(&alice, &10, &String::from_str(&entorno, "u"));
    cliente.burn(&admin, &10);
    let resultado = cliente.try_owner_of(&10);
    assert_eq!(resultado, Err(Ok(ErrorNft::TokenNoEncontrado)));
}

#[test]
fn test_token_no_existente() {
    let (_, cliente, _admin) = setup();
    let resultado = cliente.try_owner_of(&999);
    assert_eq!(resultado, Err(Ok(ErrorNft::TokenNoEncontrado)));
}
