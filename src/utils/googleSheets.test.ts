import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GOOGLE_SHEET_ID,
  DEFAULT_GOOGLE_SHEET_URL,
  DEFAULT_SHEET_DATASET_ID,
  extractGoogleSheetId,
  isValidGoogleSheetLinkOrId,
  convertSheetsValuesToDataset,
} from './googleSheets.ts';

test('extractGoogleSheetId resolves permanent default URL, Drive query URLs, and custom URLs cleanly', () => {
  assert.equal(extractGoogleSheetId(DEFAULT_GOOGLE_SHEET_URL), DEFAULT_GOOGLE_SHEET_ID);
  assert.equal(extractGoogleSheetId(''), DEFAULT_GOOGLE_SHEET_ID);
  assert.equal(
    extractGoogleSheetId('https://docs.google.com/spreadsheets/d/1AbCDefGhIjKlMnOpQrStUvWxYz123456/edit'),
    '1AbCDefGhIjKlMnOpQrStUvWxYz123456'
  );
  assert.equal(
    extractGoogleSheetId('https://drive.google.com/file/d/1C4h8D0EtwYpWir5o128d_L1tMNMZeDuH/view'),
    DEFAULT_GOOGLE_SHEET_ID
  );
  assert.equal(
    extractGoogleSheetId('https://drive.google.com/open?id=1C4h8D0EtwYpWir5o128d_L1tMNMZeDuH'),
    DEFAULT_GOOGLE_SHEET_ID
  );
});

test('isValidGoogleSheetLinkOrId validates Google Sheet URLs, Drive links, and raw IDs', () => {
  assert.equal(isValidGoogleSheetLinkOrId(DEFAULT_GOOGLE_SHEET_URL), true);
  assert.equal(isValidGoogleSheetLinkOrId(DEFAULT_GOOGLE_SHEET_ID), true);
  assert.equal(
    isValidGoogleSheetLinkOrId('https://docs.google.com/spreadsheets/d/e/2PACX-1vTestPublishedKey/pubhtml'),
    true
  );
  assert.equal(isValidGoogleSheetLinkOrId('not-a-valid-link'), false);
  assert.equal(isValidGoogleSheetLinkOrId(''), false);
});

test('convertSheetsValuesToDataset picks largest tab and infers columns accurately', () => {
  const ds = convertSheetsValuesToDataset(
    'Operations Ledger.xlsx',
    [
      {
        title: 'Summary',
        values: [['Note'], ['Overview only']],
      },
      {
        title: 'Sales',
        values: [
          ['Date', 'Branch', 'GM', 'Amount', 'Discount'],
          ['2026-04-10', 'Porur', 'Rajesh', 500000, 25000],
          ['2026-05-12', 'OMR', 'Rajesh', 750000, 30000],
          ['2026-06-15', 'Velachery', 'Ananya', 900000, 45000],
        ],
      },
    ],
    DEFAULT_GOOGLE_SHEET_ID
  );

  assert.equal(ds.id, DEFAULT_SHEET_DATASET_ID);
  assert.equal(ds.name, 'Operations Ledger');
  assert.equal(ds.activeSheet, 'Sales');
  assert.equal(ds.rows.length, 3);
  assert.equal(ds.defaultMetricCol, 'Amount');
  assert.equal(ds.defaultDimCol, 'Branch');
  assert.equal(ds.defaultDateCol, 'Date');
});
