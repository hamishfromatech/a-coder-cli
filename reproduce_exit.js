
import readline from 'readline';
import { PassThrough } from 'stream';
import process from 'process';

// Simulate Ink's useInput
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.on('data', (data) => {
  const str = data.toString();
  console.log('Ink received:', JSON.stringify(str));
  if (str.includes('\x03')) {
    console.log('Ink: Ctrl+C detected! Exiting...');
    process.exit(0);
  }
});

// Hijack stdin.emit
const originalEmit = process.stdin.emit;
let isPaste = false;
const PASTE_MODE_PREFIX = '\x1B[200~';
const PASTE_MODE_SUFFIX = '\x1B[201~';

process.stdin.emit = function(event, ...args) {
  if (event === 'data') {
    const data = args[0];
    const str = data.toString();
    
    if (str.includes(PASTE_MODE_PREFIX)) {
      isPaste = true;
      console.log('Hijacker: Paste started');
    }
    
    if (isPaste) {
      console.log('Hijacker: Blocking data from other listeners:', JSON.stringify(str));
      if (str.includes(PASTE_MODE_SUFFIX)) {
        isPaste = false;
        console.log('Hijacker: Paste ended');
      }
      
      // We still want to trigger our OWN handler for paste,
      // but we need a way to distinguish it.
      // For this test, we'll just log it.
      return true; 
    }
  }
  return originalEmit.apply(this, [event, ...args]);
};

console.log('Pasting simulation starting in 1 second...');
setTimeout(() => {
  console.log('Simulating paste with embedded Ctrl+C...');
  const pasteData = Buffer.from('\x1B[200~This is a paste\x03containing Ctrl+C\x1B[201~');
  process.stdin.emit('data', pasteData);
  console.log('Simulation finished. If Ink did not receive Ctrl+C, it worked!');
}, 1000);
