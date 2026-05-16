import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeSingleEventDeploy } from './deployEventPolicy';

test('allows deploy only for an event without contract and without sold tickets', () => {
  assert.deepEqual(authorizeSingleEventDeploy({
    event: { id: 'event-1', contract_address: null },
    soldTicketsCount: 0,
  }), { ok: true });
});

test('rejects deploy for unknown events', () => {
  assert.deepEqual(authorizeSingleEventDeploy({
    event: null,
    soldTicketsCount: 0,
  }), { ok: false, status: 404, error: 'Evento no encontrado' });
});

test('rejects deploy for events that already have a contract', () => {
  assert.deepEqual(authorizeSingleEventDeploy({
    event: { id: 'event-1', contract_address: 'CCONTRACT' },
    soldTicketsCount: 0,
  }), { ok: false, status: 409, error: 'El evento ya tiene contrato' });
});

test('rejects deploy for events with issued tickets', () => {
  assert.deepEqual(authorizeSingleEventDeploy({
    event: { id: 'event-1', contract_address: null },
    soldTicketsCount: 1,
  }), { ok: false, status: 409, error: 'No se puede desplegar contrato para un evento con tickets emitidos' });
});
