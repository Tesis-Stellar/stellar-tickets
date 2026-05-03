/*
  event_contract - Contrato inteligente para gestión de boletos de eventos

  Este contrato corre en la blockchain Stellar usando Soroban (el motor de
  contratos inteligentes de Stellar). Gestiona el ciclo de vida completo de
  boletos digitales: creación, venta primaria, reventa con trazabilidad,
  y verificación de acceso en puerta

  Conceptos clave de Rust y Soroban usados en este archivo:

  - "#![no_std]": Le dice a Rust que NO use la librería estándar. Los contratos
    Soroban corren en un entorno limitado (la blockchain), no en un sistema
    operativo normal, así que no tienen acceso a archivos, red ni consola

  - "Env" (Environment): Es el objeto que Soroban inyecta en cada función del
    contrato. Da acceso al storage (base de datos del contrato), al sistema de
    autenticación, y a la emisión de eventos. Es obligatorio como primer
    parámetro de toda función pública del contrato

  - "Address": Representa una dirección en Stellar (una cuenta o un contrato).
    Es como una ID única que identifica a un usuario o a otro contrato en la red

  - "require_auth()": Verifica que la transacción fue firmada por la dirección
    indicada. Si alguien intenta llamar una función sin tener la firma correcta,
    la transacción falla. Es el mecanismo de seguridad central

  - Storage ("entorno.storage().instance()"): Es la base de datos del contrato.
    Guarda pares clave-valor persistentes en la blockchain. Se usa "set()" para
    guardar, "get()" para leer, "has()" para verificar existencia, y "remove()"
    para borrar. "instance()" significa que los datos viven mientras el contrato
    exista

  - Eventos ("publish()"): Son logs que el contrato emite durante la ejecución.
    Quedan grabados en la blockchain y sirven para que servicios externos
    (como un indexador) sepan qué pasó sin tener que leer todo el storage
*/

#![no_std]

// Importamos lo necesario del SDK de Soroban
// "ClienteToken" permite interactuar con contratos de tokens (como USDC en Stellar)
// para hacer transferencias de dinero dentro del contrato
use soroban_sdk::token::Client as ClienteToken;
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, Vec,
};

// Base para calcular porcentajes. Si la comisión del organizador es 20,
// se interpreta como 20/100 = 20%. Se usa "i128" (entero de 128 bits)
// porque Soroban maneja montos de tokens como "i128"
const BASE_PORCENTAJE: i128 = 100;

// ERRORES TIPADOS
/*
  "#[contracterror]" es una macro de Soroban que convierte este enum en errores
  que el contrato puede retornar de forma controlada. Cada variante tiene un
  número único (= 1, = 2, etc) que identifica el error en la blockchain

  "#[repr(u32)]" le dice a Rust que use enteros de 32 bits para representar
  cada variante. Esto es requerido por Soroban para serializar los errores

  Por qué usar errores tipados en vez de "panic!("texto")":
  - Los errores tipados son más eficientes (un número vs un string)
  - Permiten que el código del lado del cliente (off-chain) identifique
    programáticamente qué falló, sin parsear strings
  - Soroban genera automáticamente métodos "try_*" en el cliente para
    capturar estos errores sin que la transacción aborte
*/

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ErrorContrato {
    // El contrato ya fue inicializado, no se puede inicializar de nuevo
    YaInicializado = 1,
    // La suma de comisiones (organizador + plataforma) es >= 100%
    ComisionesMuyAltas = 2,
    // Se intentó usar una comisión negativa
    ComisionesNegativas = 3,
    // El precio indicado es cero o negativo
    PrecioInvalido = 4,
    // El boleto ya está listado para venta, no se puede listar de nuevo
    YaEnVenta = 5,
    // El boleto ya fue usado (redimido), no se puede operar
    BoletoUsado = 6,
    // El boleto no está en venta, no se puede comprar ni cancelar venta
    NoEnVenta = 7,
    // El propietario no puede comprarse su propio boleto
    AutoCompra = 8,
    // El boleto ya fue redimido, no se puede redimir otra vez
    YaUsado = 9,
    // No se encontró un boleto con ese ID y versión
    BoletoNoEncontrado = 10,
    // La persona que intenta la acción no tiene permisos para hacerla
    NoAutorizado = 11,
    // La versión del boleto especificada no es válida
    VersionInvalida = 12,
    // El boleto fue invalidado (cancelado administrativamente), no se puede operar
    BoletoInvalidado = 13,
    // El contrato no fue inicializado, se necesita llamar "inicializar" primero
    NoInicializado = 14,
    // Esta dirección ya está registrada como verificador
    VerificadorYaExiste = 15,
    // Esta dirección no está registrada como verificador
    VerificadorNoEncontrado = 16,
}

// TIPOS DE DATOS

/*
  Representa un boleto digital dentro del contrato

  "#[contracttype]" es una macro de Soroban que permite que este struct se pueda
  guardar en el storage de la blockchain y transmitir entre contratos. Genera
  automáticamente la lógica de serialización/deserialización

  "#[derive(Clone, Debug, Eq, PartialEq)]" son macros estándar de Rust que
  habilitan funcionalidades comunes:
  - "Clone": permite crear copias del struct
  - "Debug": permite imprimir el struct para diagnóstico en tests
  - "Eq, PartialEq": permiten comparar dos boletos con "=="

  Campos:
  - "ticket_root_id": Identificador estable del boleto. NO cambia cuando se
    revende. Permite rastrear un boleto lógico a lo largo de toda su vida
  - "version": Se incrementa con cada reventa. La combinación
    (ticket_root_id, version) identifica una instancia única del boleto
  - "id_evento": A qué evento pertenece este boleto
  - "propietario": Dirección Stellar del dueño actual
  - "precio": Precio actual en unidades del token de pago (ej: stroops)
  - "en_venta": Si está listado en el marketplace para comprarse
  - "es_reventa": Después de la primera venta primaria, pasa a true. Esto
    determina si la próxima compra es primaria (sin comisión de plataforma)
    o reventa (con comisiones distribuidas y burn/remint)
  - "usado": Si el boleto ya fue presentado en la puerta del evento (redimido)
  - "invalidado": Si fue cancelado administrativamente o si fue "quemado"
    (burned) durante una reventa para crear la nueva versión
*/
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Boleto {
    pub ticket_root_id: u32,
    pub version: u32,
    pub id_evento: u32,
    pub propietario: Address,
    pub precio: i128,
    pub en_venta: bool,
    pub es_reventa: bool,
    pub usado: bool,
    pub invalidado: bool,
}

/*
  Claves para el storage del contrato

  En Soroban, el storage funciona como un diccionario (clave -> valor)
  Este enum define todas las claves posibles que usa este contrato
  "#[contracttype]" permite usar estos valores como claves serializables

  Ejemplo conceptual:
    storage[Boleto(3, 1)] = Boleto { ticket_root_id: 3, version: 1, ... }
    storage[VersionActual(3)] = 1
    storage[Organizador] = "GABCD..."

  Variantes:
  - Boleto(root_id, version): Guarda un struct "Boleto" completo
  - VersionActual(root_id): Apunta a la versión vigente de ese boleto.
    Cuando se hace una reventa y se crea la versión 2, esta clave se
    actualiza de 1 a 2
  - ContadorBoletos: Un contador autoincremental que asigna el próximo
    "ticket_root_id" disponible
  - Organizador, Plataforma, TokenPago: Configuración fijada al
    inicializar el contrato
  - ComisionOrganizador, ComisionPlataforma: Porcentajes de comisión
  - Verificador(address): Registra si una dirección tiene permiso para
    redimir boletos en la puerta del evento
*/
#[derive(Clone)]
#[contracttype]
pub enum ClaveDato {
    Boleto(u32, u32),
    VersionActual(u32),
    ContadorBoletos,
    Organizador,
    Plataforma,
    TokenPago,
    ComisionOrganizador,
    ComisionPlataforma,
    Verificador(Address),
}

// EVENTOS ON-CHAIN
/*
  Los eventos son registros inmutables que el contrato emite cuando algo
  importante sucede. Quedan grabados en la blockchain y cualquier servicio
  externo puede leerlos

  "#[contractevent]" convierte un struct en un evento que se puede emitir
  con ".publish(&entorno)"

  "#[topic]" marca un campo como "topic" (tema) del evento. Los topics son
  campos indexados que permiten buscar eventos eficientemente. En Stellar,
  son los campos por los cuales un indexador puede filtrar. Solo se permiten
  hasta 4 topics por evento

  Por qué usamos eventos: para que el indexador off-chain detecte
  cambios sin tener que escanear todo el storage del contrato. El
  indexador se suscribe a los eventos del contrato y actualiza la base
  de datos PostgreSQL con cada transacción
*/

// Se emite cuando el organizador crea un nuevo boleto
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BoletoCreado {
    #[topic]
    pub ticket_root_id: u32,
    #[topic]
    pub id_evento: u32,
    pub propietario: Address,
    pub precio: i128,
}

// Se emite cuando un propietario lista su boleto para venta
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BoletoListado {
    #[topic]
    pub ticket_root_id: u32,
    #[topic]
    pub id_evento: u32,
    pub propietario: Address,
    pub precio: i128,
    pub version: u32,
    pub es_reventa: bool,
}

// Se emite cuando un propietario cancela la venta de su boleto
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VentaCancelada {
    #[topic]
    pub ticket_root_id: u32,
    #[topic]
    pub id_evento: u32,
    pub propietario: Address,
    pub version: u32,
}

/*
  Se emite en una reventa exitosa. Incluye la versión antigua (burned)
  y la versión nueva (minted) para que el indexador pueda reconstruir
  el historial completo de propiedad
*/
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BoletoRevendido {
    #[topic]
    pub ticket_root_id: u32,
    #[topic]
    pub id_evento: u32,
    pub vendedor: Address,
    pub comprador: Address,
    pub precio: i128,
    pub version_anterior: u32,
    pub version_nueva: u32,
}

/*
  Se emite cuando se realiza la primera venta del boleto (venta primaria)
  En la venta primaria no hay burn/remint porque el boleto pasa de
  organizador a primer comprador sin necesidad de trazabilidad de reventa
*/
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BoletoCompradoPrimario {
    #[topic]
    pub ticket_root_id: u32,
    #[topic]
    pub id_evento: u32,
    pub vendedor: Address,
    pub comprador: Address,
    pub precio: i128,
}

// Se emite cuando un verificador autorizado marca un boleto como usado en la puerta del evento
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BoletoRedimido {
    #[topic]
    pub ticket_root_id: u32,
    #[topic]
    pub id_evento: u32,
    pub propietario: Address,
    pub verificador: Address,
    pub version: u32,
}

// Se emite cuando el organizador invalida un boleto manualmente
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BoletoInvalidadoEvt {
    #[topic]
    pub ticket_root_id: u32,
    #[topic]
    pub id_evento: u32,
    pub version: u32,
}

// Se emite cuando el organizador agrega una nueva dirección como verificador
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerificadorAgregado {
    #[topic]
    pub verificador: Address,
}

// Se emite cuando el organizador remueve un verificador
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerificadorRemovido {
    #[topic]
    pub verificador: Address,
}

// CONTRATO
/*
  "#[contract]" marca este struct como un contrato inteligente de Soroban
  El struct en sí está vacío porque todo el estado se guarda en el storage
  En Soroban los contratos no tienen campos internos; usan el storage como
  su base de datos

  "#[contractimpl]" marca el bloque "impl" como la implementación del
  contrato. Todas las funciones "pub fn" dentro de este bloque se convierten
  en funciones invocables desde fuera del contrato (por otros contratos o
  por transacciones de usuarios)

  Nota sobre el primer parámetro "entorno: Env":
  Soroban inyecta automáticamente el "Env" al invocar el contrato. Este
  objeto da acceso a todo lo que el contrato necesita: storage, auth,
  eventos, etc. Es como el "contexto de ejecución"
*/

#[contract]
pub struct ContratoEvento;

#[contractimpl]
impl ContratoEvento {

    // INICIALIZACIÓN

    /*
      Inicializa el contrato con la configuración del evento
      Se llama una sola vez después del deploy del contrato
      Configura quién es el organizador, la plataforma, qué token se usa
      para pagos (ej: USDC), y los porcentajes de comisión

      Entradas:
      - "organizador": Dirección del organizador del evento. Solo esta
        dirección puede crear boletos y gestionar verificadores
      - "plataforma": Dirección que recibe la comisión de la plataforma
        en cada reventa
      - "token_pago": Dirección del contrato del token que se usa para
        pagos (ej: la dirección del contrato USDC en Stellar)
      - "comision_organizador": Porcentaje (0-99) que el organizador
        recibe de cada reventa. Ejemplo: 20 = 20%
      - "comision_plataforma": Porcentaje (0-99) que la plataforma
        recibe de cada reventa. Ejemplo: 10 = 10%

      Salida: Ok(()) si se inicializó correctamente

      Errores posibles:
      - YaInicializado: Si ya se llamó a esta función antes
      - ComisionesMuyAltas: Si la suma de comisiones >= 100%
      - ComisionesNegativas: Si alguna comisión es menor a 0

      Seguridad:
      - "organizador.require_auth()" verifica que el organizador firmó
        la transacción. Nadie más puede inicializar el contrato
    */
    pub fn inicializar(
        entorno: Env,
        organizador: Address,
        plataforma: Address,
        token_pago: Address,
        comision_organizador: i128,
        comision_plataforma: i128,
    ) -> Result<(), ErrorContrato> {
        if entorno.storage().instance().has(&ClaveDato::Organizador) {
            return Err(ErrorContrato::YaInicializado);
        }
        if comision_organizador + comision_plataforma >= BASE_PORCENTAJE {
            return Err(ErrorContrato::ComisionesMuyAltas);
        }
        if comision_organizador < 0 || comision_plataforma < 0 {
            return Err(ErrorContrato::ComisionesNegativas);
        }

        organizador.require_auth();

        entorno
            .storage()
            .instance()
            .set(&ClaveDato::Organizador, &organizador);
        entorno
            .storage()
            .instance()
            .set(&ClaveDato::Plataforma, &plataforma);
        entorno
            .storage()
            .instance()
            .set(&ClaveDato::TokenPago, &token_pago);
        entorno
            .storage()
            .instance()
            .set(&ClaveDato::ComisionOrganizador, &comision_organizador);
        entorno
            .storage()
            .instance()
            .set(&ClaveDato::ComisionPlataforma, &comision_plataforma);
        entorno
            .storage()
            .instance()
            .set(&ClaveDato::ContadorBoletos, &0u32);

        Ok(())
    }

    // GESTIÓN DE VERIFICADORES

    /*
      Agrega una dirección como verificador autorizado
      Los verificadores son personas/dispositivos autorizados a marcar
      boletos como usados en la puerta del evento. Solo el organizador
      puede agregar verificadores

      Entrada: "verificador" - Dirección Stellar que se quiere autorizar
      Salida: Ok(()) si se agregó correctamente
      Errores: NoInicializado, VerificadorYaExiste
    */
    pub fn agregar_verificador(
        entorno: Env,
        verificador: Address,
    ) -> Result<(), ErrorContrato> {
        let organizador = Self::obtener_organizador(&entorno)?;
        organizador.require_auth();

        if entorno
            .storage()
            .instance()
            .has(&ClaveDato::Verificador(verificador.clone()))
        {
            return Err(ErrorContrato::VerificadorYaExiste);
        }

        entorno
            .storage()
            .instance()
            .set(&ClaveDato::Verificador(verificador.clone()), &true);

        VerificadorAgregado {
            verificador,
        }
        .publish(&entorno);

        Ok(())
    }

    /*
      Remueve un verificador autorizado

      Entrada: "verificador" - Dirección Stellar que se quiere desautorizar
      Salida: Ok(()) si se removió correctamente
      Errores: NoInicializado, VerificadorNoEncontrado
    */
    pub fn remover_verificador(
        entorno: Env,
        verificador: Address,
    ) -> Result<(), ErrorContrato> {
        let organizador = Self::obtener_organizador(&entorno)?;
        organizador.require_auth();

        if !entorno
            .storage()
            .instance()
            .has(&ClaveDato::Verificador(verificador.clone()))
        {
            return Err(ErrorContrato::VerificadorNoEncontrado);
        }

        entorno
            .storage()
            .instance()
            .remove(&ClaveDato::Verificador(verificador.clone()));

        VerificadorRemovido {
            verificador,
        }
        .publish(&entorno);

        Ok(())
    }

    /*
      Consulta si una dirección es verificador autorizado
      Entrada: "verificador" - Dirección a consultar
      Salida: true si es verificador, false si no lo es
      No requiere autenticación porque es solo lectura
    */
    pub fn es_verificador(entorno: Env, verificador: Address) -> bool {
        entorno
            .storage()
            .instance()
            .has(&ClaveDato::Verificador(verificador))
    }

    // CREACIÓN DE BOLETOS

    /*
      Crea un nuevo boleto asignado al organizador
      El organizador del evento llama esta función para "mintear" (crear)
      un boleto nuevo. El boleto nace con version = 0 y el organizador
      como propietario. Para que el boleto pueda venderse, después se debe
      llamar "listar_boleto"

      Entradas:
      - "id_evento": Identificador del evento que este boleto representa
      - "precio": Precio base del boleto en unidades del token de pago

      Salida: Ok(ticket_root_id) - El ID asignado al nuevo boleto
      Errores: PrecioInvalido, NoInicializado
    */
    pub fn crear_boleto(
        entorno: Env,
        id_evento: u32,
        precio: i128,
    ) -> Result<u32, ErrorContrato> {
        if precio <= 0 {
            return Err(ErrorContrato::PrecioInvalido);
        }

        let organizador = Self::obtener_organizador(&entorno)?;
        organizador.require_auth();

        Self::crear_boleto_con_propietario(&entorno, id_evento, organizador, precio, false)
    }

    /*
      Crea un nuevo boleto asignándolo directamente a una dirección concreta.
      Este flujo se usa cuando el backend ya validó el checkout off-chain y el
      organizador emite el boleto on-chain a la wallet vinculada del comprador.

      Seguridad:
      - Solo el organizador puede emitir el boleto.
      - El propietario guardado en Soroban es el mismo que PostgreSQL debe
        proyectar después de la confirmación.
    */
    pub fn crear_boleto_para(
        entorno: Env,
        id_evento: u32,
        propietario: Address,
        precio: i128,
        es_reventa: bool,
    ) -> Result<u32, ErrorContrato> {
        if precio <= 0 {
            return Err(ErrorContrato::PrecioInvalido);
        }

        let organizador = Self::obtener_organizador(&entorno)?;
        organizador.require_auth();

        Self::crear_boleto_con_propietario(&entorno, id_evento, propietario, precio, es_reventa)
    }

    fn crear_boleto_con_propietario(
        entorno: &Env,
        id_evento: u32,
        propietario: Address,
        precio: i128,
        es_reventa: bool,
    ) -> Result<u32, ErrorContrato> {
        if precio <= 0 {
            return Err(ErrorContrato::PrecioInvalido);
        }

        let mut contador_boletos: u32 = entorno
            .storage()
            .instance()
            .get(&ClaveDato::ContadorBoletos)
            .unwrap_or(0);
        let ticket_root_id = contador_boletos;
        let version: u32 = 0;

        let boleto = Boleto {
            ticket_root_id,
            version,
            id_evento,
            propietario: propietario.clone(),
            precio,
            en_venta: false,
            es_reventa,
            usado: false,
            invalidado: false,
        };

        entorno
            .storage()
            .instance()
            .set(&ClaveDato::Boleto(ticket_root_id, version), &boleto);
        entorno
            .storage()
            .instance()
            .set(&ClaveDato::VersionActual(ticket_root_id), &version);

        contador_boletos += 1;
        entorno
            .storage()
            .instance()
            .set(&ClaveDato::ContadorBoletos, &contador_boletos);

        BoletoCreado {
            ticket_root_id,
            id_evento,
            propietario,
            precio,
        }
        .publish(entorno);

        Ok(ticket_root_id)
    }

    // LISTADO Y CANCELACIÓN

    /*
      Pone un boleto en venta en el marketplace
      El propietario actual del boleto decide a qué precio quiere venderlo
      y lo lista para que otros usuarios puedan verlo y comprarlo

      Entradas:
      - "ticket_root_id": ID del boleto a listar
      - "nuevo_precio": Precio al que se quiere vender

      Salida: Ok(()) si se listó correctamente
      Errores: BoletoNoEncontrado, YaEnVenta, BoletoUsado, BoletoInvalidado, PrecioInvalido
      Seguridad: Solo el propietario actual puede listar su boleto
    */
    pub fn listar_boleto(
        entorno: Env,
        ticket_root_id: u32,
        nuevo_precio: i128,
    ) -> Result<(), ErrorContrato> {
        // Siempre operamos sobre la versión vigente del boleto
        let version = Self::obtener_version_actual(&entorno, ticket_root_id)?;
        let mut boleto = Self::obtener_boleto_interno(&entorno, ticket_root_id, version)?;

        boleto.propietario.require_auth();

        if boleto.en_venta {
            return Err(ErrorContrato::YaEnVenta);
        }
        if boleto.usado {
            return Err(ErrorContrato::BoletoUsado);
        }
        if boleto.invalidado {
            return Err(ErrorContrato::BoletoInvalidado);
        }
        if nuevo_precio <= 0 {
            return Err(ErrorContrato::PrecioInvalido);
        }

        boleto.precio = nuevo_precio;
        boleto.en_venta = true;

        entorno
            .storage()
            .instance()
            .set(&ClaveDato::Boleto(ticket_root_id, version), &boleto);

        BoletoListado {
            ticket_root_id,
            id_evento: boleto.id_evento,
            propietario: boleto.propietario,
            precio: boleto.precio,
            version,
            es_reventa: boleto.es_reventa,
        }
        .publish(&entorno);

        Ok(())
    }

    /*
      Cancela la venta de un boleto que estaba listado
      El propietario puede arrepentirse y sacar su boleto del marketplace

      Entrada: "ticket_root_id" - ID del boleto cuya venta se cancela
      Salida: Ok(()) si se canceló correctamente
      Error: NoEnVenta
    */
    pub fn cancelar_venta(
        entorno: Env,
        ticket_root_id: u32,
    ) -> Result<(), ErrorContrato> {
        let version = Self::obtener_version_actual(&entorno, ticket_root_id)?;
        let mut boleto = Self::obtener_boleto_interno(&entorno, ticket_root_id, version)?;

        boleto.propietario.require_auth();

        if !boleto.en_venta {
            return Err(ErrorContrato::NoEnVenta);
        }

        boleto.en_venta = false;
        entorno
            .storage()
            .instance()
            .set(&ClaveDato::Boleto(ticket_root_id, version), &boleto);

        VentaCancelada {
            ticket_root_id,
            id_evento: boleto.id_evento,
            propietario: boleto.propietario,
            version,
        }
        .publish(&entorno);

        Ok(())
    }

    // COMPRA (VENTA PRIMARIA + REVENTA ATÓMICA CON BURN/REMINT)

    /*
      Compra un boleto que está en venta
      Esta función maneja dos flujos distintos dependiendo de si es la
      primera venta o una reventa:

      FLUJO 1 - Venta primaria (es_reventa == false):
        El comprador paga el precio completo al organizador
        No hay comisiones de plataforma. No hay burn/remint
        El boleto se actualiza in-place (mismo version, nuevo propietario)

      FLUJO 2 - Reventa (es_reventa == true):
        El comprador paga el precio y se distribuyen comisiones:
        - X% al organizador (comision_organizador)
        - Y% a la plataforma (comision_plataforma)
        - El resto al vendedor
        Luego se hace BURN/REMINT:
        - BURN: La versión actual se marca como invalidado = true
        - REMINT: Se crea una nueva versión (version + 1) con el
          comprador como propietario
        Esto garantiza trazabilidad: la versión vieja sigue existiendo
        en la blockchain como registro histórico, pero no se puede usar

      Por qué burn/remint en vez de solo cambiar el propietario:
      - Trazabilidad: cada versión queda como evidencia inmutable de
        quién tuvo el boleto y a qué precio
      - Antifraude: una versión invalidada no puede ser vendida ni
        usada, previniendo doble uso
      - Auditabilidad: el historial completo se puede reconstruir
        consultando todas las versiones de un ticket_root_id

      Por qué la transacción es "atómica":
      Porque todos los pasos (pagos + burn + remint) ocurren dentro
      de la misma invocación de contrato. Si cualquier paso falla
      (ej: el comprador no tiene fondos), NADA se ejecuta. Esto
      previene estados inconsistentes como "se pagó pero no se
      transfirió el boleto"

      Entradas:
      - "ticket_root_id": ID del boleto a comprar
      - "comprador": Dirección del comprador (debe firmar la transacción)

      Salida: Ok(version) - La versión resultante del boleto
        En venta primaria retorna la versión actual (0)
        En reventa retorna la nueva versión creada

      Errores: NoEnVenta, BoletoUsado, BoletoInvalidado, AutoCompra, NoInicializado
    */
    pub fn comprar_boleto(
        entorno: Env,
        ticket_root_id: u32,
        comprador: Address,
    ) -> Result<u32, ErrorContrato> {
        let version = Self::obtener_version_actual(&entorno, ticket_root_id)?;
        let mut boleto = Self::obtener_boleto_interno(&entorno, ticket_root_id, version)?;

        comprador.require_auth();

        if !boleto.en_venta {
            return Err(ErrorContrato::NoEnVenta);
        }
        if boleto.usado {
            return Err(ErrorContrato::BoletoUsado);
        }
        if boleto.invalidado {
            return Err(ErrorContrato::BoletoInvalidado);
        }
        if boleto.propietario == comprador {
            return Err(ErrorContrato::AutoCompra);
        }

        let organizador = Self::obtener_organizador(&entorno)?;
        let token_pago: Address = entorno
            .storage()
            .instance()
            .get(&ClaveDato::TokenPago)
            .ok_or(ErrorContrato::NoInicializado)?;
        // ClienteToken nos permite llamar funciones del contrato del token
        // (transfer, balance, etc) desde dentro de nuestro contrato
        let cliente_token = ClienteToken::new(&entorno, &token_pago);
        let precio = boleto.precio;
        let vendedor = boleto.propietario.clone();

        if !boleto.es_reventa {
            // VENTA PRIMARIA
            // Todo el pago va al organizador. Sin comisiones extra
            cliente_token.transfer(&comprador, &organizador, &precio);

            boleto.propietario = comprador.clone();
            boleto.en_venta = false;
            // Marcamos es_reventa = true para que la próxima venta
            // sea tratada como reventa con comisiones y burn/remint
            boleto.es_reventa = true;

            entorno
                .storage()
                .instance()
                .set(&ClaveDato::Boleto(ticket_root_id, version), &boleto);

            BoletoCompradoPrimario {
                ticket_root_id,
                id_evento: boleto.id_evento,
                vendedor,
                comprador,
                precio,
            }
            .publish(&entorno);

            Ok(version)
        } else {
            // REVENTA ATÓMICA CON BURN/REMINT

            // 1. Calcular comisiones
            let plataforma: Address = entorno
                .storage()
                .instance()
                .get(&ClaveDato::Plataforma)
                .ok_or(ErrorContrato::NoInicializado)?;
            let porcentaje_comision_organizador: i128 = entorno
                .storage()
                .instance()
                .get(&ClaveDato::ComisionOrganizador)
                .ok_or(ErrorContrato::NoInicializado)?;
            let porcentaje_comision_plataforma: i128 = entorno
                .storage()
                .instance()
                .get(&ClaveDato::ComisionPlataforma)
                .ok_or(ErrorContrato::NoInicializado)?;

            let comision_organizador =
                precio * porcentaje_comision_organizador / BASE_PORCENTAJE;
            let comision_plataforma =
                precio * porcentaje_comision_plataforma / BASE_PORCENTAJE;
            let monto_vendedor = precio - comision_organizador - comision_plataforma;

            // 2. Ejecutar pagos (3 transferencias atómicas)
            cliente_token.transfer(&comprador, &organizador, &comision_organizador);
            cliente_token.transfer(&comprador, &plataforma, &comision_plataforma);
            cliente_token.transfer(&comprador, &vendedor, &monto_vendedor);

            // 3. BURN: Invalidar la versión anterior
            boleto.invalidado = true;
            boleto.en_venta = false;
            entorno
                .storage()
                .instance()
                .set(&ClaveDato::Boleto(ticket_root_id, version), &boleto);

            // 4. REMINT: Crear nueva versión del boleto
            let nueva_version = version + 1;
            let nuevo_boleto = Boleto {
                ticket_root_id,
                version: nueva_version,
                id_evento: boleto.id_evento,
                propietario: comprador.clone(),
                precio,
                en_venta: false,
                es_reventa: true,
                usado: false,
                invalidado: false,
            };

            entorno.storage().instance().set(
                &ClaveDato::Boleto(ticket_root_id, nueva_version),
                &nuevo_boleto,
            );
            // Actualizar puntero de versión actual
            entorno
                .storage()
                .instance()
                .set(&ClaveDato::VersionActual(ticket_root_id), &nueva_version);

            BoletoRevendido {
                ticket_root_id,
                id_evento: boleto.id_evento,
                vendedor,
                comprador,
                precio,
                version_anterior: version,
                version_nueva: nueva_version,
            }
            .publish(&entorno);

            Ok(nueva_version)
        }
    }

    // REDENCIÓN (SOLO VERIFICADORES AUTORIZADOS)

    /*
      Marca un boleto como usado (verificación de acceso al evento)
      Se llama cuando la persona presenta su boleto en la puerta del evento
      Solo un verificador autorizado puede llamarla, NO el propietario

      Por qué el propietario no puede auto-redimir:
      Porque la redención representa un hecho físico (entrar al evento)
      que debe ser verificado por un agente de confianza del organizador
      Si el propietario pudiera auto-redimir, podría marcar el boleto
      como usado remotamente sin haber asistido

      Entradas:
      - "ticket_root_id": ID del boleto a redimir
      - "verificador": Dirección del verificador que ejecuta la redención

      Salida: Ok(()) si se redimió correctamente
      Errores: NoAutorizado, YaUsado, BoletoInvalidado
    */
    pub fn redimir_boleto(
        entorno: Env,
        ticket_root_id: u32,
        verificador: Address,
    ) -> Result<(), ErrorContrato> {
        verificador.require_auth();

        // Verificar que es un verificador autorizado
        if !entorno
            .storage()
            .instance()
            .has(&ClaveDato::Verificador(verificador.clone()))
        {
            return Err(ErrorContrato::NoAutorizado);
        }

        let version = Self::obtener_version_actual(&entorno, ticket_root_id)?;
        let mut boleto = Self::obtener_boleto_interno(&entorno, ticket_root_id, version)?;

        if boleto.usado {
            return Err(ErrorContrato::YaUsado);
        }
        if boleto.invalidado {
            return Err(ErrorContrato::BoletoInvalidado);
        }

        boleto.usado = true;
        boleto.en_venta = false;
        entorno
            .storage()
            .instance()
            .set(&ClaveDato::Boleto(ticket_root_id, version), &boleto);

        BoletoRedimido {
            ticket_root_id,
            id_evento: boleto.id_evento,
            propietario: boleto.propietario,
            verificador,
            version,
        }
        .publish(&entorno);

        Ok(())
    }

    // INVALIDACIÓN

    /*
      Invalida un boleto administrativamente
      El organizador puede cancelar un boleto si hay algún problema
      (ej: evento cancelado, boleto emitido por error, etc)
      Un boleto invalidado no se puede vender, comprar ni redimir

      Entrada: "ticket_root_id" - ID del boleto a invalidar
      Salida: Ok(()) si se invalidó correctamente
      Error: BoletoInvalidado (si ya estaba invalidado)
    */
    pub fn invalidar_boleto(
        entorno: Env,
        ticket_root_id: u32,
    ) -> Result<(), ErrorContrato> {
        let organizador = Self::obtener_organizador(&entorno)?;
        organizador.require_auth();

        let version = Self::obtener_version_actual(&entorno, ticket_root_id)?;
        let mut boleto = Self::obtener_boleto_interno(&entorno, ticket_root_id, version)?;

        if boleto.invalidado {
            return Err(ErrorContrato::BoletoInvalidado);
        }

        boleto.invalidado = true;
        boleto.en_venta = false;
        entorno
            .storage()
            .instance()
            .set(&ClaveDato::Boleto(ticket_root_id, version), &boleto);

        BoletoInvalidadoEvt {
            ticket_root_id,
            id_evento: boleto.id_evento,
            version,
        }
        .publish(&entorno);

        Ok(())
    }

    // CONSULTAS
    /*
      Funciones de solo lectura. No modifican el storage ni requieren
      autenticación. Se usan para consultar el estado actual de los boletos

      NOTA: "obtener_boletos_reventa" y "obtener_boletos_evento" recorren
      TODOS los boletos del contrato (O(n)). Esto es ineficiente para
      cantidades grandes. En producción, estas consultas se hacen a través
      del indexador off-chain que las resuelve desde PostgreSQL
    */

    // Obtiene el boleto en su versión más reciente (la versión vigente)
    // Entrada: "ticket_root_id" - ID del boleto
    // Salida: El struct "Boleto" completo de la versión actual
    pub fn obtener_boleto(entorno: Env, ticket_root_id: u32) -> Result<Boleto, ErrorContrato> {
        let version = Self::obtener_version_actual(&entorno, ticket_root_id)?;
        Self::obtener_boleto_interno(&entorno, ticket_root_id, version)
    }

    // Obtiene un boleto en una versión específica (para historial)
    // Permite consultar versiones anteriores que ya fueron invalidadas
    // por reventas. Útil para reconstruir el historial de propiedad
    // Entradas: "ticket_root_id", "version" (0, 1, 2, ...)
    pub fn obtener_boleto_version(
        entorno: Env,
        ticket_root_id: u32,
        version: u32,
    ) -> Result<Boleto, ErrorContrato> {
        Self::obtener_boleto_interno(&entorno, ticket_root_id, version)
    }

    // Obtiene el número de versión actual de un boleto
    // Salida: Número de versión vigente (0 = nunca revendido, 1 = una reventa, etc)
    pub fn obtener_version_vigente(
        entorno: Env,
        ticket_root_id: u32,
    ) -> Result<u32, ErrorContrato> {
        Self::obtener_version_actual(&entorno, ticket_root_id)
    }

    // Obtiene la dirección del propietario actual de un boleto
    pub fn obtener_propietario(
        entorno: Env,
        ticket_root_id: u32,
    ) -> Result<Address, ErrorContrato> {
        let boleto = Self::obtener_boleto(entorno, ticket_root_id)?;
        Ok(boleto.propietario)
    }

    // Lista todos los boletos que están en reventa actualmente
    // Filtra: en_venta && es_reventa && !invalidado && !usado
    // ADVERTENCIA: O(n), usar indexador off-chain en producción
    pub fn obtener_boletos_reventa(entorno: Env) -> Vec<Boleto> {
        let contador_boletos: u32 = entorno
            .storage()
            .instance()
            .get(&ClaveDato::ContadorBoletos)
            .unwrap_or(0);
        let mut boletos_reventa = Vec::new(&entorno);

        for root_id in 0..contador_boletos {
            if let Some(version) = entorno
                .storage()
                .instance()
                .get::<_, u32>(&ClaveDato::VersionActual(root_id))
            {
                if let Some(boleto) = entorno
                    .storage()
                    .instance()
                    .get::<_, Boleto>(&ClaveDato::Boleto(root_id, version))
                {
                    if boleto.en_venta && boleto.es_reventa && !boleto.invalidado && !boleto.usado {
                        boletos_reventa.push_back(boleto);
                    }
                }
            }
        }
        boletos_reventa
    }

    // Lista todos los boletos (versión vigente) de un evento específico
    // Entrada: "id_evento" - ID del evento a filtrar
    // ADVERTENCIA: O(n), usar indexador off-chain en producción
    pub fn obtener_boletos_evento(entorno: Env, id_evento: u32) -> Vec<Boleto> {
        let contador_boletos: u32 = entorno
            .storage()
            .instance()
            .get(&ClaveDato::ContadorBoletos)
            .unwrap_or(0);
        let mut boletos_evento = Vec::new(&entorno);

        for root_id in 0..contador_boletos {
            if let Some(version) = entorno
                .storage()
                .instance()
                .get::<_, u32>(&ClaveDato::VersionActual(root_id))
            {
                if let Some(boleto) = entorno
                    .storage()
                    .instance()
                    .get::<_, Boleto>(&ClaveDato::Boleto(root_id, version))
                {
                    if boleto.id_evento == id_evento {
                        boletos_evento.push_back(boleto);
                    }
                }
            }
        }
        boletos_evento
    }

    // FUNCIONES INTERNAS
    // Estas funciones son "fn" (sin "pub"), lo que significa que solo se
    // pueden llamar desde dentro del contrato. No son invocables desde
    // transacciones externas. Su propósito es evitar repetir código

    // Lee la dirección del organizador desde el storage
    // Retorna error si el contrato no fue inicializado
    fn obtener_organizador(entorno: &Env) -> Result<Address, ErrorContrato> {
        entorno
            .storage()
            .instance()
            .get(&ClaveDato::Organizador)
            .ok_or(ErrorContrato::NoInicializado)
    }

    // Lee la versión vigente de un boleto desde el storage
    // Retorna error si no existe un boleto con ese ticket_root_id
    fn obtener_version_actual(entorno: &Env, ticket_root_id: u32) -> Result<u32, ErrorContrato> {
        entorno
            .storage()
            .instance()
            .get(&ClaveDato::VersionActual(ticket_root_id))
            .ok_or(ErrorContrato::BoletoNoEncontrado)
    }

    // Lee un boleto específico del storage por (ticket_root_id, version)
    // Retorna error si esa combinación no existe
    fn obtener_boleto_interno(
        entorno: &Env,
        ticket_root_id: u32,
        version: u32,
    ) -> Result<Boleto, ErrorContrato> {
        entorno
            .storage()
            .instance()
            .get(&ClaveDato::Boleto(ticket_root_id, version))
            .ok_or(ErrorContrato::BoletoNoEncontrado)
    }
}

#[cfg(test)]
mod test;
