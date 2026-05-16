import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReconciliationReport } from './reconciliationPolicy';

test('reconciliation passes when processed events and ticket versions match', () => {
  const report = buildReconciliationReport({
    tickets: [{ id: 'ticket-1', contract_address: 'C1', ticket_root_id: 10, version: 1, status: 'ACTIVE' }],
    events: [{ contract_address: 'C1', ticket_root_id: 10, version: 1, event_name: 'boleto_revendido', status: 'PROCESSED' }],
  });

  assert.equal(report.ok, true);
  assert.equal(report.summary.errors, 0);
  assert.equal(report.summary.warnings, 0);
});

test('reconciliation detects processed events without ticket projection', () => {
  const report = buildReconciliationReport({
    tickets: [],
    events: [{ contract_address: 'C1', ticket_root_id: 10, version: 2, event_name: 'boleto_revendido', status: 'PROCESSED' }],
  });

  assert.equal(report.ok, false);
  assert.equal(report.issues[0].code, 'PROCESSED_EVENT_WITHOUT_TICKET');
});

test('reconciliation warns for versioned tickets without processed event', () => {
  const report = buildReconciliationReport({
    tickets: [{ id: 'ticket-1', contract_address: 'C1', ticket_root_id: 10, version: 1, status: 'ACTIVE' }],
    events: [],
  });

  assert.equal(report.ok, true);
  assert.equal(report.issues[0].code, 'TICKET_WITHOUT_PROCESSED_EVENT');
});
