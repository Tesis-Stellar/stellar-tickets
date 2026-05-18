extern crate std;

use crate::{ContratoEvento, ContratoEventoClient, ErrorContrato};
use soroban_sdk::{
    testutils::Address as _,
    token::Client as ClienteToken,
    token::StellarAssetClient,
    Address, Env,
};

// HELPERS

/*
  Crea un entorno de prueba completo con:
  - Contrato de evento registrado e inicializado
  - Token de pago simulado
  - Comisiones: 20% organizador, 10% plataforma
  Retorna: (entorno, cliente_contrato, admin_token, organizador, plataforma, cliente_token)
*/
fn configurar_entorno<'a>() -> (
    Env,
    ContratoEventoClient<'a>,
    Address,
    Address,
    Address,
    ClienteToken<'a>,
) {
    let entorno = Env::default();
    entorno.mock_all_auths();

    let admin_token = Address::generate(&entorno);
    let organizador = Address::generate(&entorno);
    let plataforma = Address::generate(&entorno);

    let id_contrato = entorno.register(ContratoEvento, ());
    let cliente = ContratoEventoClient::new(&entorno, &id_contrato);

    let contrato_token = entorno.register_stellar_asset_contract_v2(admin_token.clone());
    let cliente_token = ClienteToken::new(&entorno, &contrato_token.address());

    cliente.inicializar(
        &organizador,
        &plataforma,
        &contrato_token.address(),
        &20_i128,
        &10_i128,
    );

    (entorno, cliente, admin_token, organizador, plataforma, cliente_token)
}

// Mintea tokens de prueba a un usuario
fn mintear_tokens(
    entorno: &Env,
    _admin_token: &Address,
    cliente_token: &ClienteToken,
    usuario: &Address,
    cantidad: i128,
) {
    let cliente_asset = StellarAssetClient::new(entorno, &cliente_token.address);
    cliente_asset.mint(usuario, &cantidad);
}

// Crea un boleto y lo lista para venta en un solo paso
fn crear_y_listar_boleto_primario(
    cliente: &ContratoEventoClient,
    id_evento: u32,
    precio: i128,
) -> u32 {
    let root_id = cliente.crear_boleto(&id_evento, &precio);
    cliente.listar_boleto(&root_id, &precio);
    root_id
}

// Ejecuta el flujo completo de venta primaria: crear, listar, mintear tokens al comprador, comprar
fn vender_boleto_primario(
    entorno: &Env,
    cliente: &ContratoEventoClient,
    admin_token: &Address,
    cliente_token: &ClienteToken,
    comprador: &Address,
    id_evento: u32,
    precio: i128,
) -> u32 {
    let root_id = crear_y_listar_boleto_primario(cliente, id_evento, precio);
    mintear_tokens(entorno, admin_token, cliente_token, comprador, precio);
    cliente.comprar_boleto(&root_id, comprador);
    root_id
}

// TESTS: INICIALIZACIÓN

// Inicializa el contrato con parámetros válidos
// Se espera que no falle
#[test]
fn test_initialize_success() {
    let entorno = Env::default();
    entorno.mock_all_auths();

    let admin = Address::generate(&entorno);
    let organizador = Address::generate(&entorno);
    let plataforma = Address::generate(&entorno);
    let id_contrato = entorno.register(ContratoEvento, ());
    let cliente = ContratoEventoClient::new(&entorno, &id_contrato);
    let contrato_token = entorno.register_stellar_asset_contract_v2(admin.clone());

    cliente.inicializar(&organizador, &plataforma, &contrato_token.address(), &15_i128, &10_i128);
}

// Intenta inicializar un contrato que ya fue inicializado
// Se espera error YaInicializado
#[test]
fn test_initialize_twice_fails() {
    let (_entorno, cliente, _admin, organizador, plataforma, cliente_token) = configurar_entorno();
    let resultado = cliente.try_inicializar(
        &organizador,
        &plataforma,
        &cliente_token.address,
        &10_i128,
        &5_i128,
    );
    assert_eq!(resultado, Err(Ok(ErrorContrato::YaInicializado)));
}

// Intenta inicializar con comisiones que suman 100% (80 + 20)
// Se espera error ComisionesMuyAltas
#[test]
fn test_initialize_fees_too_high_fails() {
    let entorno = Env::default();
    entorno.mock_all_auths();
    let admin = Address::generate(&entorno);
    let organizador = Address::generate(&entorno);
    let plataforma = Address::generate(&entorno);
    let id_contrato = entorno.register(ContratoEvento, ());
    let cliente = ContratoEventoClient::new(&entorno, &id_contrato);
    let contrato_token = entorno.register_stellar_asset_contract_v2(admin.clone());

    let resultado = cliente.try_inicializar(&organizador, &plataforma, &contrato_token.address(), &80_i128, &20_i128);
    assert_eq!(resultado, Err(Ok(ErrorContrato::ComisionesMuyAltas)));
}

// Intenta inicializar con una comisión negativa (-5)
// Se espera error ComisionesNegativas
#[test]
fn test_initialize_negative_fees_fails() {
    let entorno = Env::default();
    entorno.mock_all_auths();
    let admin = Address::generate(&entorno);
    let organizador = Address::generate(&entorno);
    let plataforma = Address::generate(&entorno);
    let id_contrato = entorno.register(ContratoEvento, ());
    let cliente = ContratoEventoClient::new(&entorno, &id_contrato);
    let contrato_token = entorno.register_stellar_asset_contract_v2(admin.clone());

    let resultado = cliente.try_inicializar(&organizador, &plataforma, &contrato_token.address(), &-5_i128, &10_i128);
    assert_eq!(resultado, Err(Ok(ErrorContrato::ComisionesNegativas)));
}

// TESTS: CREACIÓN DE BOLETOS

// Crea dos boletos y verifica que tengan IDs autoincremental (0, 1)
// Se espera que cada boleto tenga version 0, propietario = organizador y los campos correctos
#[test]
fn test_create_ticket_success() {
    let (_entorno, cliente, _admin, organizador, _, _) = configurar_entorno();

    let root_id = cliente.crear_boleto(&1001, &1_000_000);
    assert_eq!(root_id, 0);

    let boleto = cliente.obtener_boleto(&0);
    assert_eq!(boleto.ticket_root_id, 0);
    assert_eq!(boleto.version, 0);
    assert_eq!(boleto.id_evento, 1001);
    assert_eq!(boleto.precio, 1_000_000);
    assert_eq!(boleto.propietario, organizador);
    assert!(!boleto.en_venta);
    assert!(!boleto.es_reventa);
    assert!(!boleto.usado);
    assert!(!boleto.invalidado);

    let root_id_2 = cliente.crear_boleto(&1002, &500_000);
    assert_eq!(root_id_2, 1);

    let boleto_2 = cliente.obtener_boleto(&1);
    assert_eq!(boleto_2.ticket_root_id, 1);
    assert_eq!(boleto_2.id_evento, 1002);
}

// Crea un boleto asignado directamente a la wallet del comprador con es_reventa=true
// Simula el flujo Web2.5: la venta primaria ocurrió off-chain (PSE/tarjeta),
// por lo que on-chain el boleto nace ya marcado como revendible
#[test]
fn test_create_ticket_for_owner_success() {
    let (entorno, cliente, _admin, _organizador, _, _) = configurar_entorno();
    let comprador = Address::generate(&entorno);

    let root_id = cliente.crear_boleto_para(&1001, &comprador, &1_000_000, &true);
    assert_eq!(root_id, 0);

    let boleto = cliente.obtener_boleto(&root_id);
    assert_eq!(boleto.ticket_root_id, root_id);
    assert_eq!(boleto.version, 0);
    assert_eq!(boleto.id_evento, 1001);
    assert_eq!(boleto.precio, 1_000_000);
    assert_eq!(boleto.propietario, comprador);
    assert!(!boleto.en_venta);
    assert!(boleto.es_reventa);  // true: venta primaria ya ocurrió off-chain
    assert!(!boleto.usado);
    assert!(!boleto.invalidado);
}

// Intenta crear un boleto con precio negativo
// Se espera error PrecioInvalido
#[test]
fn test_create_ticket_negative_price_fails() {
    let (_entorno, cliente, _, _, _, _) = configurar_entorno();
    let resultado = cliente.try_crear_boleto(&1001, &-100);
    assert_eq!(resultado, Err(Ok(ErrorContrato::PrecioInvalido)));
}

// Intenta crear un boleto con precio cero
// Se espera error PrecioInvalido
#[test]
fn test_create_ticket_zero_price_fails() {
    let (_entorno, cliente, _, _, _, _) = configurar_entorno();
    let resultado = cliente.try_crear_boleto(&1001, &0);
    assert_eq!(resultado, Err(Ok(ErrorContrato::PrecioInvalido)));
}

// TESTS: LISTAR Y CANCELAR

// Lista un boleto para venta con un nuevo precio
// Se espera que en_venta = true y el precio se actualice
#[test]
fn test_list_ticket_success() {
    let (_entorno, cliente, _, _, _, _) = configurar_entorno();
    let root_id = cliente.crear_boleto(&101, &1000);
    cliente.listar_boleto(&root_id, &1200);

    let boleto = cliente.obtener_boleto(&root_id);
    assert!(boleto.en_venta);
    assert_eq!(boleto.precio, 1200);
}

// Intenta listar un boleto que ya está en venta
// Se espera error YaEnVenta
#[test]
fn test_list_ticket_already_for_sale_fails() {
    let (_entorno, cliente, _, _, _, _) = configurar_entorno();
    let root_id = crear_y_listar_boleto_primario(&cliente, 101, 1000);
    let resultado = cliente.try_listar_boleto(&root_id, &1500);
    assert_eq!(resultado, Err(Ok(ErrorContrato::YaEnVenta)));
}

// Intenta listar un boleto que ya fue redimido (usado)
// Se espera error BoletoUsado
#[test]
fn test_list_ticket_used_fails() {
    let (entorno, cliente, admin_token, _, _, cliente_token) = configurar_entorno();
    let comprador = Address::generate(&entorno);
    let verificador = Address::generate(&entorno);
    let root_id = vender_boleto_primario(
        &entorno, &cliente, &admin_token, &cliente_token, &comprador, 101, 1000,
    );

    cliente.agregar_verificador(&verificador);
    cliente.redimir_boleto(&root_id, &verificador);

    let resultado = cliente.try_listar_boleto(&root_id, &1500);
    assert_eq!(resultado, Err(Ok(ErrorContrato::BoletoUsado)));
}

// Intenta listar un boleto con precio negativo
// Se espera error PrecioInvalido
#[test]
fn test_list_ticket_negative_price_fails() {
    let (_entorno, cliente, _, _, _, _) = configurar_entorno();
    let root_id = cliente.crear_boleto(&101, &1000);
    let resultado = cliente.try_listar_boleto(&root_id, &-500);
    assert_eq!(resultado, Err(Ok(ErrorContrato::PrecioInvalido)));
}

// Intenta listar un boleto con precio cero
// Se espera error PrecioInvalido
#[test]
fn test_list_ticket_zero_price_fails() {
    let (_entorno, cliente, _, _, _, _) = configurar_entorno();
    let root_id = cliente.crear_boleto(&101, &1000);
    let resultado = cliente.try_listar_boleto(&root_id, &0);
    assert_eq!(resultado, Err(Ok(ErrorContrato::PrecioInvalido)));
}

// CONTRACT-RESALE-CANCEL-01: cancela una venta activa.
// Se espera que en_venta pase de true a false.
#[test]
fn test_contract_resale_cancel_01_cancel_sale_success() {
    let (_entorno, cliente, _, _, _, _) = configurar_entorno();
    let root_id = crear_y_listar_boleto_primario(&cliente, 101, 1000);

    let boleto_antes = cliente.obtener_boleto(&root_id);
    assert!(boleto_antes.en_venta);

    cliente.cancelar_venta(&root_id);

    let boleto_despues = cliente.obtener_boleto(&root_id);
    assert!(!boleto_despues.en_venta);
}

// Intenta cancelar la venta de un boleto que no está en venta
// Se espera error NoEnVenta
#[test]
fn test_cancel_sale_not_for_sale_fails() {
    let (_entorno, cliente, _, _, _, _) = configurar_entorno();
    let root_id = cliente.crear_boleto(&101, &1000);
    let resultado = cliente.try_cancelar_venta(&root_id);
    assert_eq!(resultado, Err(Ok(ErrorContrato::NoEnVenta)));
}

// TESTS: VENTA PRIMARIA

/*
  Ejecuta una venta primaria completa y verifica:
  - El comprador paga y recibe el boleto
  - La versión sigue siendo 0 (no hay burn/remint en primaria)
  - es_reventa cambia a true para futuras ventas
  - Todo el pago va al organizador (la plataforma no recibe nada en primaria)
*/
#[test]
fn test_primary_sale_flow() {
    let (entorno, cliente, admin_token, organizador, plataforma, cliente_token) = configurar_entorno();
    let comprador_1 = Address::generate(&entorno);
    mintear_tokens(&entorno, &admin_token, &cliente_token, &comprador_1, 5_000_000);

    let precio = 1_000_000;
    let root_id = crear_y_listar_boleto_primario(&cliente, 1001, precio);

    let saldo_org_antes = cliente_token.balance(&organizador);
    let saldo_plat_antes = cliente_token.balance(&plataforma);
    let saldo_comprador_antes = cliente_token.balance(&comprador_1);

    let version_resultante = cliente.comprar_boleto(&root_id, &comprador_1);
    assert_eq!(version_resultante, 0);

    let boleto_vendido = cliente.obtener_boleto(&root_id);
    assert_eq!(boleto_vendido.propietario, comprador_1);
    assert!(!boleto_vendido.en_venta);
    assert!(boleto_vendido.es_reventa);
    assert!(!boleto_vendido.usado);
    assert!(!boleto_vendido.invalidado);
    assert_eq!(boleto_vendido.version, 0);

    assert_eq!(cliente_token.balance(&comprador_1), saldo_comprador_antes - precio);
    assert_eq!(cliente_token.balance(&organizador), saldo_org_antes + precio);
    assert_eq!(cliente_token.balance(&plataforma), saldo_plat_antes);
}

// TESTS: REVENTA CON BURN/REMINT

/*
  Ejecuta una reventa completa y verifica:
  - Se crea nueva versión (version = 1)
  - La versión anterior queda invalidada (burned)
  - Las comisiones se distribuyen correctamente:
    20% organizador (400_000), 10% plataforma (200_000), 70% vendedor (1_400_000)
*/
#[test]
fn test_resale_burn_remint_flow() {
    let (entorno, cliente, admin_token, organizador, plataforma, cliente_token) = configurar_entorno();

    let comprador_1 = Address::generate(&entorno);
    let comprador_2 = Address::generate(&entorno);

    let precio_primario = 1_000_000;
    let precio_reventa = 2_000_000;

    mintear_tokens(&entorno, &admin_token, &cliente_token, &comprador_1, 5_000_000);
    mintear_tokens(&entorno, &admin_token, &cliente_token, &comprador_2, 5_000_000);

    let root_id = vender_boleto_primario(
        &entorno, &cliente, &admin_token, &cliente_token, &comprador_1, 101, precio_primario,
    );

    let saldo_org_post_primaria = cliente_token.balance(&organizador);
    let saldo_plat_post_primaria = cliente_token.balance(&plataforma);
    let saldo_c1_post_primaria = cliente_token.balance(&comprador_1);
    let saldo_c2_post_primaria = cliente_token.balance(&comprador_2);

    cliente.listar_boleto(&root_id, &precio_reventa);
    let nueva_version = cliente.comprar_boleto(&root_id, &comprador_2);

    assert_eq!(nueva_version, 1);

    let version_vigente = cliente.obtener_version_vigente(&root_id);
    assert_eq!(version_vigente, 1);

    let boleto_nuevo = cliente.obtener_boleto(&root_id);
    assert_eq!(boleto_nuevo.propietario, comprador_2);
    assert_eq!(boleto_nuevo.version, 1);
    assert!(boleto_nuevo.es_reventa);
    assert!(!boleto_nuevo.en_venta);
    assert!(!boleto_nuevo.usado);
    assert!(!boleto_nuevo.invalidado);

    let boleto_viejo = cliente.obtener_boleto_version(&root_id, &0);
    assert!(boleto_viejo.invalidado);
    assert!(!boleto_viejo.en_venta);

    assert_eq!(cliente_token.balance(&comprador_2), saldo_c2_post_primaria - precio_reventa);
    assert_eq!(cliente_token.balance(&organizador), saldo_org_post_primaria + 400_000);
    assert_eq!(cliente_token.balance(&plataforma), saldo_plat_post_primaria + 200_000);
    assert_eq!(cliente_token.balance(&comprador_1), saldo_c1_post_primaria + 1_400_000);
}

/*
  Ejecuta dos reventas consecutivas del mismo boleto
  Se espera que las versiones se incrementen (0 -> 1 -> 2)
  y que las versiones anteriores queden invalidadas
*/
#[test]
fn test_multiple_resales_version_increments() {
    let (entorno, cliente, admin_token, _org, _plat, cliente_token) = configurar_entorno();

    let comprador_1 = Address::generate(&entorno);
    let comprador_2 = Address::generate(&entorno);
    let comprador_3 = Address::generate(&entorno);

    mintear_tokens(&entorno, &admin_token, &cliente_token, &comprador_1, 10_000_000);
    mintear_tokens(&entorno, &admin_token, &cliente_token, &comprador_2, 10_000_000);
    mintear_tokens(&entorno, &admin_token, &cliente_token, &comprador_3, 10_000_000);

    let root_id = vender_boleto_primario(
        &entorno, &cliente, &admin_token, &cliente_token, &comprador_1, 101, 1_000_000,
    );

    cliente.listar_boleto(&root_id, &1_500_000);
    let v1 = cliente.comprar_boleto(&root_id, &comprador_2);
    assert_eq!(v1, 1);

    cliente.listar_boleto(&root_id, &2_000_000);
    let v2 = cliente.comprar_boleto(&root_id, &comprador_3);
    assert_eq!(v2, 2);

    assert_eq!(cliente.obtener_version_vigente(&root_id), 2);
    assert_eq!(cliente.obtener_boleto(&root_id).propietario, comprador_3);

    // v0 se invalida en la primera reventa, v1 en la segunda
    assert!(cliente.obtener_boleto_version(&root_id, &0).invalidado);
    assert!(cliente.obtener_boleto_version(&root_id, &1).invalidado);
}

// Intenta comprar un boleto que no está en venta
// Se espera error NoEnVenta
#[test]
fn test_buy_ticket_not_for_sale_fails() {
    let (entorno, cliente, admin_token, _, _, cliente_token) = configurar_entorno();
    let comprador = Address::generate(&entorno);
    mintear_tokens(&entorno, &admin_token, &cliente_token, &comprador, 1000);

    let root_id = cliente.crear_boleto(&101, &1000);
    let resultado = cliente.try_comprar_boleto(&root_id, &comprador);
    assert_eq!(resultado, Err(Ok(ErrorContrato::NoEnVenta)));
}

// Intenta que el organizador compre su propio boleto
// Se espera error AutoCompra
#[test]
fn test_buy_ticket_self_buy_fails() {
    let (entorno, cliente, admin_token, organizador, _, cliente_token) = configurar_entorno();
    mintear_tokens(&entorno, &admin_token, &cliente_token, &organizador, 2000);

    let root_id = crear_y_listar_boleto_primario(&cliente, 101, 1000);
    let resultado = cliente.try_comprar_boleto(&root_id, &organizador);
    assert_eq!(resultado, Err(Ok(ErrorContrato::AutoCompra)));
}

// Intenta listar un boleto que fue invalidado por el organizador
// Se espera error BoletoInvalidado
#[test]
fn test_buy_invalidated_ticket_fails() {
    let (entorno, cliente, admin_token, _, _, cliente_token) = configurar_entorno();
    let comprador = Address::generate(&entorno);
    mintear_tokens(&entorno, &admin_token, &cliente_token, &comprador, 5_000_000);

    let root_id = crear_y_listar_boleto_primario(&cliente, 101, 1000);
    cliente.cancelar_venta(&root_id);
    cliente.invalidar_boleto(&root_id);

    let resultado = cliente.try_listar_boleto(&root_id, &1500);
    assert_eq!(resultado, Err(Ok(ErrorContrato::BoletoInvalidado)));
}

// TESTS: VERIFICADOR Y REDENCIÓN

// Agrega un verificador y confirma que está registrado
// Se espera que "es_verificador" retorne true
#[test]
fn test_agregar_verificador_success() {
    let (entorno, cliente, _, _, _, _) = configurar_entorno();
    let verificador = Address::generate(&entorno);

    cliente.agregar_verificador(&verificador);
    assert!(cliente.es_verificador(&verificador));
}

// Intenta agregar un verificador que ya fue agregado
// Se espera error VerificadorYaExiste
#[test]
fn test_agregar_verificador_duplicado_fails() {
    let (entorno, cliente, _, _, _, _) = configurar_entorno();
    let verificador = Address::generate(&entorno);

    cliente.agregar_verificador(&verificador);
    let resultado = cliente.try_agregar_verificador(&verificador);
    assert_eq!(resultado, Err(Ok(ErrorContrato::VerificadorYaExiste)));
}

// Agrega y luego remueve un verificador
// Se espera que "es_verificador" retorne false después de removerlo
#[test]
fn test_remover_verificador_success() {
    let (entorno, cliente, _, _, _, _) = configurar_entorno();
    let verificador = Address::generate(&entorno);

    cliente.agregar_verificador(&verificador);
    assert!(cliente.es_verificador(&verificador));

    cliente.remover_verificador(&verificador);
    assert!(!cliente.es_verificador(&verificador));
}

// Intenta remover un verificador que no existe
// Se espera error VerificadorNoEncontrado
#[test]
fn test_remover_verificador_no_existente_fails() {
    let (entorno, cliente, _, _, _, _) = configurar_entorno();
    let verificador = Address::generate(&entorno);

    let resultado = cliente.try_remover_verificador(&verificador);
    assert_eq!(resultado, Err(Ok(ErrorContrato::VerificadorNoEncontrado)));
}

// Un verificador autorizado redime un boleto vendido
// Se espera que "usado" pase a true y el propietario no cambie
#[test]
fn test_redeem_ticket_by_verificador_success() {
    let (entorno, cliente, admin_token, _, _, cliente_token) = configurar_entorno();
    let comprador = Address::generate(&entorno);
    let verificador = Address::generate(&entorno);

    let root_id = vender_boleto_primario(
        &entorno, &cliente, &admin_token, &cliente_token, &comprador, 101, 1000,
    );

    cliente.agregar_verificador(&verificador);

    let boleto_antes = cliente.obtener_boleto(&root_id);
    assert!(!boleto_antes.usado);

    cliente.redimir_boleto(&root_id, &verificador);

    let boleto_despues = cliente.obtener_boleto(&root_id);
    assert!(boleto_despues.usado);
    assert_eq!(boleto_despues.propietario, comprador);
}

// Intenta redimir un boleto con una dirección que no es verificador
// Se espera error NoAutorizado
#[test]
fn test_redeem_not_verificador_fails() {
    let (entorno, cliente, admin_token, _, _, cliente_token) = configurar_entorno();
    let comprador = Address::generate(&entorno);
    let no_verificador = Address::generate(&entorno);

    let root_id = vender_boleto_primario(
        &entorno, &cliente, &admin_token, &cliente_token, &comprador, 101, 1000,
    );

    let resultado = cliente.try_redimir_boleto(&root_id, &no_verificador);
    assert_eq!(resultado, Err(Ok(ErrorContrato::NoAutorizado)));
}

// Intenta redimir un boleto que ya fue redimido
// Se espera error YaUsado
#[test]
fn test_redeem_ticket_already_used_fails() {
    let (entorno, cliente, admin_token, _, _, cliente_token) = configurar_entorno();
    let comprador = Address::generate(&entorno);
    let verificador = Address::generate(&entorno);

    let root_id = vender_boleto_primario(
        &entorno, &cliente, &admin_token, &cliente_token, &comprador, 101, 1000,
    );

    cliente.agregar_verificador(&verificador);
    cliente.redimir_boleto(&root_id, &verificador);

    let resultado = cliente.try_redimir_boleto(&root_id, &verificador);
    assert_eq!(resultado, Err(Ok(ErrorContrato::YaUsado)));
}

// CONTRACT-REDEEM-01 cubre los negativos restantes de redención on-chain:
// un boleto invalidado y un boleto inexistente no pueden redimirse.
#[test]
fn test_contract_redeem_01_rejects_invalidated_and_missing_tickets() {
    let (_entorno, cliente, _, _, _, _) = configurar_entorno();
    let verificador = Address::generate(&_entorno);

    let root_id = cliente.crear_boleto(&101, &1000);
    cliente.agregar_verificador(&verificador);
    cliente.invalidar_boleto(&root_id);

    let invalidado = cliente.try_redimir_boleto(&root_id, &verificador);
    assert_eq!(invalidado, Err(Ok(ErrorContrato::BoletoInvalidado)));

    let inexistente = cliente.try_redimir_boleto(&999, &verificador);
    assert_eq!(inexistente, Err(Ok(ErrorContrato::BoletoNoEncontrado)));
}

// TESTS: INVALIDACIÓN

// CONTRACT-INVALIDATE-01: El organizador invalida un boleto
// Se espera que "invalidado" sea true y "en_venta" sea false
#[test]
fn test_contract_invalidate_01_invalidar_boleto_success() {
    let (_entorno, cliente, _, _, _, _) = configurar_entorno();
    let root_id = cliente.crear_boleto(&101, &1000);

    cliente.invalidar_boleto(&root_id);

    let boleto = cliente.obtener_boleto(&root_id);
    assert!(boleto.invalidado);
    assert!(!boleto.en_venta);
}

// Intenta invalidar un boleto que ya está invalidado
// Se espera error BoletoInvalidado
#[test]
fn test_invalidar_boleto_ya_invalidado_fails() {
    let (_entorno, cliente, _, _, _, _) = configurar_entorno();
    let root_id = cliente.crear_boleto(&101, &1000);

    cliente.invalidar_boleto(&root_id);
    let resultado = cliente.try_invalidar_boleto(&root_id);
    assert_eq!(resultado, Err(Ok(ErrorContrato::BoletoInvalidado)));
}

// TESTS: CONSULTAS

// Intenta obtener un boleto con un ID que no existe
// Se espera error BoletoNoEncontrado
#[test]
fn test_get_ticket_not_found_fails() {
    let (_entorno, cliente, _, _, _, _) = configurar_entorno();
    let resultado = cliente.try_obtener_boleto(&999);
    assert_eq!(resultado, Err(Ok(ErrorContrato::BoletoNoEncontrado)));
}

// Obtiene el propietario de un boleto recién creado
// Se espera que sea el organizador
#[test]
fn test_get_owner_success() {
    let (_entorno, cliente, _, organizador, _, _) = configurar_entorno();
    let root_id = cliente.crear_boleto(&101, &1000);
    let propietario = cliente.obtener_propietario(&root_id);
    assert_eq!(propietario, organizador);
}

// Crea boletos en 2 eventos distintos y filtra por evento
// Se espera que retorne solo los boletos del evento solicitado
#[test]
fn test_get_event_tickets() {
    let (_entorno, cliente, _, _, _, _) = configurar_entorno();

    cliente.crear_boleto(&101, &1000);
    cliente.crear_boleto(&101, &1000);
    cliente.crear_boleto(&202, &500);

    let boletos_101 = cliente.obtener_boletos_evento(&101);
    assert_eq!(boletos_101.len(), 2);
    assert_eq!(boletos_101.get(0).unwrap().id_evento, 101);

    let boletos_202 = cliente.obtener_boletos_evento(&202);
    assert_eq!(boletos_202.len(), 1);

    let boletos_303 = cliente.obtener_boletos_evento(&303);
    assert_eq!(boletos_303.len(), 0);
}

/*
  Verifica que "obtener_boletos_reventa" filtra correctamente:
  - Un boleto en venta primaria NO aparece (no es reventa)
  - Un boleto vendido y re-listado SÍ aparece
  - Un boleto vendido pero no re-listado NO aparece
  Se espera solo 1 boleto en el resultado
*/
#[test]
fn test_get_resale_tickets() {
    let (entorno, cliente, admin_token, _, _, cliente_token) = configurar_entorno();

    crear_y_listar_boleto_primario(&cliente, 101, 1000);

    let comprador_1 = Address::generate(&entorno);
    let root_id_1 = vender_boleto_primario(
        &entorno, &cliente, &admin_token, &cliente_token, &comprador_1, 102, 1000,
    );
    cliente.listar_boleto(&root_id_1, &1500);

    let comprador_2 = Address::generate(&entorno);
    vender_boleto_primario(
        &entorno, &cliente, &admin_token, &cliente_token, &comprador_2, 103, 1000,
    );

    let boletos_reventa = cliente.obtener_boletos_reventa();

    assert_eq!(boletos_reventa.len(), 1);
    assert_eq!(boletos_reventa.get(0).unwrap().ticket_root_id, root_id_1);
    assert!(boletos_reventa.get(0).unwrap().es_reventa);
    assert!(boletos_reventa.get(0).unwrap().en_venta);
}

/*
  Después de una reventa, consulta versiones específicas del mismo boleto
  Se espera que la versión 0 tenga al comprador_1 como propietario
  y la versión 1 tenga al comprador_2
*/
#[test]
fn test_obtener_boleto_version_especifica() {
    let (entorno, cliente, admin_token, _, _, cliente_token) = configurar_entorno();

    let comprador_1 = Address::generate(&entorno);
    let comprador_2 = Address::generate(&entorno);

    mintear_tokens(&entorno, &admin_token, &cliente_token, &comprador_1, 10_000_000);
    mintear_tokens(&entorno, &admin_token, &cliente_token, &comprador_2, 10_000_000);

    let root_id = vender_boleto_primario(
        &entorno, &cliente, &admin_token, &cliente_token, &comprador_1, 101, 1_000_000,
    );

    cliente.listar_boleto(&root_id, &1_500_000);
    cliente.comprar_boleto(&root_id, &comprador_2);

    let v0 = cliente.obtener_boleto_version(&root_id, &0);
    assert_eq!(v0.version, 0);
    assert_eq!(v0.propietario, comprador_1);

    let v1 = cliente.obtener_boleto_version(&root_id, &1);
    assert_eq!(v1.version, 1);
    assert_eq!(v1.propietario, comprador_2);
}
