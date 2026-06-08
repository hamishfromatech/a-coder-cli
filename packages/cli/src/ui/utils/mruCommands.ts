import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { SETTINGS_DIRECTORY_NAME } from '../../config/settings.js';

const MRU_FILE = path.join(homedir(), SETTINGS_DIRECTORY_NAME, 'mru-commands.json');
const MAX_MRU = 10;

function ensureDir(): void {
  const dir = path.dirname(MRU_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getStored(): string[] {
  try {
    if (fs.existsSync(MRU_FILE)) {
      const raw = fs.readFileSync(MRU_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {
    // Silently ignore
  }
  return [];
}

function store(names: string[]): void {
  try {
    ensureDir();
    fs.writeFileSync(MRU_FILE, JSON.stringify(names.slice(0, MAX_MRU)), 'utf-8');
  } catch {
    // Silently ignore
  }
}

export function recordMruCommand(name: string): void {
  const mru = getStored().filter((n) => n !== name);
  mru.unshift(name);
  store(mru);
}

export function getMruCommands(): string[] {
  return getStored();
}