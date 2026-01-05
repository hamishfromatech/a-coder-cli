/**
 * Diagnostic script to check if SkillsTool registers correctly on Windows
 */

import { SkillsTool } from './packages/core/dist/tools/skills.js';
import path from 'path';
import os from 'os';

console.log('=== SkillsTool Diagnostic ===\n');

// Test 1: Check if class exists
console.log('Test 1: Class Import');
console.log('SkillsTool class exists:', SkillsTool !== undefined);

// Test 2: Check class name
console.log('\nTest 2: Class Name');
console.log('SkillsTool.name:', SkillsTool.name);

// Test 3: Check static Name property
console.log('\nTest 3: Static Name Property');
console.log('SkillsTool.Name:', SkillsTool.Name);

// Test 4: Try to instantiate
console.log('\nTest 4: Instantiation');
try {
  const tool = new SkillsTool();
  console.log('Successfully instantiated SkillsTool');
  console.log('tool.name:', tool.name);
  console.log('tool.displayName:', tool.displayName);
  console.log('skillsDir path:', (tool as any).skillsDir);

  // Test 5: Check schema
  console.log('\nTest 5: Tool Schema');
  const schema = tool.schema;
  console.log('schema.name:', schema.name);
  console.log('schema.description:', schema.description);
} catch (error) {
  console.error('Failed to instantiate SkillsTool:', error);
}

// Test 6: Check OS and path
console.log('\nTest 6: OS and Path Info');
console.log('Platform:', process.platform);
console.log('Home dir:', os.homedir());
console.log('Expected skills dir:', path.join(os.homedir(), '.a-coder-cli', 'skills'));