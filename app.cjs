// Passenger-compatible entry point; package runtime remains ESM.
import('./app.mjs').catch(error => { console.error('ContentOS startup failed:', error.message); process.exit(1); });
