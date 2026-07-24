import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceiptLibraryEntry, findDuplicateReceipt, buildPhoneCompanionUrl } from './phoneCapture.js';

test('creates a receipt library entry with a stable deduplication key', () => {
  const payload = {
    id: 'phone-1',
    type: 'receipt',
    fileName: 'receipt.png',
    note: 'Nike pack',
    files: ['data:image/png;base64,abc123'],
  };

  const entry = createReceiptLibraryEntry(payload);

  assert.equal(entry.merchant, 'Nike pack');
  assert.equal(entry.type, 'uploaded');
  assert.ok(entry.dedupeKey);
  assert.equal(entry.fileName, 'receipt.png');
});

test('detects duplicate phone receipts using the same fingerprint', () => {
  const payload = {
    id: 'phone-2',
    type: 'receipt',
    fileName: 'receipt.png',
    note: 'Nike pack',
    files: ['data:image/png;base64,abc123'],
  };

  const existing = [createReceiptLibraryEntry(payload)];
  const duplicate = findDuplicateReceipt(payload, existing);

  assert.ok(duplicate);
  assert.equal(duplicate.id, existing[0].id);
});

test('builds a companion URL that preserves existing query parameters', () => {
  const url = buildPhoneCompanionUrl({
    origin: 'https://example.com',
    pathname: '/app',
    search: '?tab=inventory',
  });

  assert.equal(url, 'https://example.com/app?tab=inventory&phone=1');
});

test('falls back to a safe URL when the browser reports a null origin', () => {
  const url = buildPhoneCompanionUrl({
    origin: 'null',
    pathname: '/index.html',
    search: '?phone=1',
  });

  assert.equal(url, 'https://example.com/index.html?phone=1');
});

test('prefers a LAN origin over localhost for phone access', () => {
  const url = buildPhoneCompanionUrl({
    origin: 'http://localhost:5173',
    pathname: '/',
    search: '',
    lanOrigin: 'http://192.168.1.50:5173',
  });

  assert.equal(url, 'http://192.168.1.50:5173/?phone=1');
});
