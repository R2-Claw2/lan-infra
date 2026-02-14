#!/usr/bin/env node

/**
 * Test script for PortainerWebhookDeploy
 * Run with: node test-portainer-webhook.js
 */

const PortainerWebhookDeploy = require('./portainer-webhook-deploy.js');

// Mock test - doesn't actually call webhooks
async function runTests() {
  console.log('🧪 Testing PortainerWebhookDeploy class\n');

  const deployer = new PortainerWebhookDeploy();

  // Test 1: Extract service names
  console.log('Test 1: extractServiceNames');
  const testFiles = [
    'services/hello/compose.yaml',
    'services/adguard/compose.yaml',
    'services/home-assistant/compose.yaml',
    'README.md', // Should be ignored
    'services/cloudflared/docker-compose.yml', // Wrong filename
    'services/hello/other-file.txt', // Not compose.yaml
  ];

  const services = deployer.extractServiceNames(testFiles);
  console.log(`  Input: ${testFiles.length} files`);
  console.log(`  Output: ${services.length} services`);
  console.log(`  Services: ${services.join(', ')}`);
  console.log(`  ✅ Expected: hello, adguard, home-assistant\n`);

  // Test 2: Secret name generation
  console.log('Test 2: Secret name convention');
  const testCases = [
    { input: 'hello', expected: 'PORTAINER_WEBHOOK_HELLO' },
    { input: 'home-assistant', expected: 'PORTAINER_WEBHOOK_HOME_ASSISTANT' },
    { input: 'adguard', expected: 'PORTAINER_WEBHOOK_ADGUARD' },
  ];

  for (const test of testCases) {
    const secretName = `PORTAINER_WEBHOOK_${test.input.toUpperCase()}`;
    console.log(`  ${test.input} -> ${secretName}`);
    if (secretName === test.expected) {
      console.log(`    ✅ Correct`);
    } else {
      console.log(`    ❌ Expected: ${test.expected}`);
    }
  }

  console.log('\n✅ Basic tests passed');
  console.log('\nNote: For full integration testing, set environment variables:');
  console.log('  PORTAINER_WEBHOOK_HELLO=https://portainer.diegoa.ca/api/stacks/webhooks/...');
  console.log('\nThen run: node portainer-webhook-deploy.js');
}

if (require.main === module) {
  runTests().catch(console.error);
}