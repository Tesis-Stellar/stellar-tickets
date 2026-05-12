import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repoRoot = join(__dirname, '../..');
const gitignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');
const backendEnvExample = readFileSync(join(repoRoot, 'backend/.env.example'), 'utf8');
const custodyDoc = readFileSync(join(repoRoot, 'docs/operations/SECRETS_AND_CUSTODY.md'), 'utf8');

test('gitignore blocks local env and deployment secret files', () => {
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^\.env\.\*$/m);
  assert.match(gitignore, /^\.env\.deploy$/m);
  assert.match(gitignore, /^backend\/CONTRATOS\.txt$/m);
});

test('env example documents secret placeholders without real Stellar secret keys', () => {
  assert.match(backendEnvExample, /JWT_SECRET="replace-with-a-long-random-secret"/);
  assert.match(backendEnvExample, /QR_SIGNING_SECRET="replace-with-a-different-long-random-secret"/);
  assert.match(backendEnvExample, /ORGANIZER_SECRET=""/);
  assert.doesNotMatch(backendEnvExample, /\bS[A-Z0-9]{55}\b/);
});

test('custody documentation declares ORGANIZER_SECRET as a custodial backend role', () => {
  assert.match(custodyDoc, /ORGANIZER_SECRET/);
  assert.match(custodyDoc, /rol custodial/i);
  assert.match(custodyDoc, /nunca frontend/i);
  assert.match(custodyDoc, /demo Web2\.5/);
});
