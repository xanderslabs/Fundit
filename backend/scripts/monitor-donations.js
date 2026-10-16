// scripts/monitor-donations.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { monitorDirectDonations } = require('../src/services/directDonationMonitor');
const { initialize } = require('../src/services/blockchain');

const LOCK_FILE = path.join(__dirname, '..', 'monitor-donations.lock');

async function main() {
  console.log('Starting direct donation monitor');
  
  // Check if already running
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'));
      // Check if process is still running
      process.kill(pid, 0);
      console.log(`Monitor already running with PID ${pid}, exiting`);
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
    
    // Start monitoring for direct donations
    const success = await monitorDirectDonations();
    
    if (success) {
      console.log('Direct donation monitor running. Press Ctrl+C to exit.');
      
      // Keep the process running
      process.on('SIGINT', () => {
        console.log('Direct donation monitor stopping...');
        fs.unlinkSync(LOCK_FILE);
        process.exit(0);
      });
      
      process.on('SIGTERM', () => {
        console.log('Direct donation monitor stopping...');
        fs.unlinkSync(LOCK_FILE);
        process.exit(0);
      });
    } else {
      console.error('Failed to start direct donation monitor');
      fs.unlinkSync(LOCK_FILE);
      process.exit(1);
    }
  } catch (error) {
    console.error('Error starting direct donation monitor:', error);
    console.error(error.stack);
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
    process.exit(1);
  }
}

// Run the script
main();