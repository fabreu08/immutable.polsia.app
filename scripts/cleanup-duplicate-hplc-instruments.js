#!/usr/bin/env node
/**
 * One-time cleanup script for duplicate auto-created HPLC instruments.
 *
 * Usage:
 *   node scripts/cleanup-duplicate-hplc-instruments.js          # Dry run (lists candidates)
 *   node scripts/cleanup-duplicate-hplc-instruments.js --deactivate   # Actually deactivates them
 *
 * It targets instruments whose serialNumber starts with "HPLC-" (the timestamp-based ones
 * created when no instrumentSerial was provided during CSV uploads).
 */

const { pool } = require('../db/index');
const dbInstruments = require('../db/instruments');
const dbReadings = require('../db/readings');

async function main() {
  const shouldDeactivate = process.argv.includes('--deactivate');

  console.log('=== HPLC Duplicate Instrument Cleanup ===\n');

  const instruments = await dbInstruments.getAllInstruments(false);

  const hplcDuplicates = instruments.filter(inst =>
    inst.serial_number && inst.serial_number.startsWith('HPLC-')
  );

  if (hplcDuplicates.length === 0) {
    console.log('No instruments with serial starting "HPLC-" found. Nothing to do.');
    process.exit(0);
  }

  console.log(`Found ${hplcDuplicates.length} candidate duplicate HPLC instruments:\n`);

  for (const inst of hplcDuplicates) {
    // Count readings for this instrument
    const { rows } = await pool.query(
      'SELECT COUNT(*) as count FROM readings WHERE instrument_id = $1',
      [inst.id]
    );
    const readingCount = parseInt(rows[0].count, 10);

    console.log(`- ID: ${inst.id}`);
    console.log(`  Serial: ${inst.serial_number}`);
    console.log(`  Name:   ${inst.name}`);
    console.log(`  Created: ${inst.created_at}`);
    console.log(`  Readings: ${readingCount}`);
    console.log(`  Active: ${inst.active}`);
    console.log('');

    if (shouldDeactivate) {
      if (readingCount > 0) {
        console.log(`  → SKIPPING deactivation (has ${readingCount} readings attached)\n`);
      } else {
        await dbInstruments.deactivateInstrument(inst.id);
        console.log(`  → DEACTIVATED\n`);
      }
    }
  }

  if (!shouldDeactivate) {
    console.log('\nThis was a DRY RUN. No changes were made.');
    console.log('Run with --deactivate to actually set active=false on instruments with 0 readings.');
  } else {
    console.log('\nCleanup complete.');
  }

  await pool.end();
}

main().catch(err => {
  console.error('Cleanup script failed:', err);
  process.exit(1);
});