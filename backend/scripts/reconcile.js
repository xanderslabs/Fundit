// scripts/reconcile.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ensureReconciliationTable, reconcileCampaigns } = require('../src/services/reconciliation');
const { initialize } = require('../src/services/blockchain');

const LOCK_FILE = path.join(__dirname, '..', 'reconcile.lock');

async function main() {
  console.log('Starting campaign reconciliation');
  
  // Check if already running
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'));
      // Check if process is still running
      process.kill(pid, 0);
      console.log(`Reconciliation already running with PID ${pid}, exiting`);
      process.exit(0);
    } catch (error) {
      // Process not running, remove stale lock file
      fs.unlinkSync(LOCK_FILE);
    }
  }
  
  // Create lock file
  fs.writeFileSync(LOCK_FILE, process.pid.toString());
  
  try {
    // Initialize blockchain service
    initialize();
    
    // Ensure reconciliation table exists
    await ensureReconciliationTable();
    
    // Run reconciliation
    const results = await reconcileCampaigns();
    
    console.log(`Reconciliation summary:`);
    console.log(`- Total campaigns: ${results.total}`);
    console.log(`- Updated: ${results.updated}`);
    console.log(`- Matched: ${results.matched}`);
    console.log(`- Errors: ${results.errors}`);
    
    fs.unlinkSync(LOCK_FILE);
    process.exit(0);
  } catch (error) {
    console.error(`Reconciliation failed: ${error.message}`);
    console.error(error.stack);
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
    process.exit(1);
  }
}

// Run the script
main();