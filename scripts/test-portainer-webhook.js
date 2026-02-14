#!/usr/bin/env node

/**
 * Test script for PortainerWebhookDeploy
 * Run with: node test-portainer-webhook.js
 * Or make executable: chmod +x test-portainer-webhook.js && ./test-portainer-webhook.js
 */

// Simple test without npm dependencies

// Mock the PortainerWebhookDeploy class for testing
// NOTE: This duplicates some logic from the main script for unit testing purposes.
// In a real test suite, we would import and test the actual implementation.
class MockPortainerWebhookDeploy {
  constructor() {
    this.servicesPath = 'services';
    this.secretPrefix = 'PORTAINER_WEBHOOK_';
  }

  /**
   * Extract service names from file paths
   */
  extractServiceNames(filePaths) {
    const serviceNames = new Set();

    for (const filePath of filePaths) {
      // Match pattern: services/<service-name>/compose.yaml
      const match = filePath.match(new RegExp(`^${this.servicesPath}/([^/]+)/compose\\.yaml$`));
      if (match) {
        serviceNames.add(match[1]);
      }
    }

    return Array.from(serviceNames);
  }
}

// Mock test - doesn't actually call webhooks
async function runTests() {
  console.log('🧪 Testing PortainerWebhookDeploy class\n');

  const deployer = new MockPortainerWebhookDeploy();
  let testFailures = 0;

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
  const expectedServices = ['hello', 'adguard', 'home-assistant'];
  const servicesSorted = services.sort();
  const expectedSorted = expectedServices.sort();
  
  console.log(`  Input: ${testFiles.length} files`);
  console.log(`  Output: ${services.length} services`);
  console.log(`  Services: ${services.join(', ')}`);
  
  if (JSON.stringify(servicesSorted) === JSON.stringify(expectedSorted)) {
    console.log(`  ✅ Correct - Expected: ${expectedServices.join(', ')}`);
  } else {
    console.log(`  ❌ Incorrect - Expected: ${expectedServices.join(', ')}`);
    testFailures++;
  }
  console.log();

  // Test 2: Secret name generation
  console.log('Test 2: Secret name convention');
  const testCases = [
    { input: 'hello', expected: 'PORTAINER_WEBHOOK_HELLO' },
    { input: 'home-assistant', expected: 'PORTAINER_WEBHOOK_HOME_ASSISTANT' },
    { input: 'adguard', expected: 'PORTAINER_WEBHOOK_ADGUARD' },
  ];

  for (const test of testCases) {
    const secretName = `PORTAINER_WEBHOOK_${test.input.replace(/-/g, '_').toUpperCase()}`;
    console.log(`  ${test.input} -> ${secretName}`);
    if (secretName === test.expected) {
      console.log(`    ✅ Correct`);
    } else {
      console.log(`    ❌ Expected: ${test.expected}`);
      testFailures++;
    }
  }

  // Test 3: Extract service names edge cases
  console.log('\nTest 3: Edge cases for extractServiceNames');
  const edgeCases = [
    {
      input: [
        'services/hello/compose.yaml',
        'services/hello/other-file.txt', // Should be ignored
        'not-services/hello/compose.yaml', // Wrong prefix
        'services/hello/subdir/compose.yaml', // Too deep
      ],
      expected: ['hello']
    },
    {
      input: [],
      expected: []
    },
    {
      input: ['README.md', 'Dockerfile', '.gitignore'],
      expected: []
    }
  ];

  for (const [i, test] of edgeCases.entries()) {
    const result = deployer.extractServiceNames(test.input);
    const resultSorted = result.sort();
    const expectedSorted = test.expected.sort();
    const passed = JSON.stringify(resultSorted) === JSON.stringify(expectedSorted);
    
    console.log(`  Case ${i + 1}: ${passed ? '✅' : '❌'}`);
    if (!passed) {
      console.log(`    Got: ${JSON.stringify(result)}`);
      console.log(`    Expected: ${JSON.stringify(test.expected)}`);
      testFailures++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  if (testFailures > 0) {
    console.error(`❌ ${testFailures} test(s) failed!`);
    process.exit(1);
  } else {
    console.log('✅ All tests passed');
  }
  
  console.log('\nNote: For full integration testing, set environment variables:');
  console.log('  PORTAINER_WEBHOOK_HELLO=https://portainer.diegoa.ca/api/stacks/webhooks/...');
  console.log('\nThen run: node portainer-webhook-deploy.js');
}

if (require.main === module) {
  runTests().catch(error => {
    console.error('💥 Test runner error:', error);
    process.exit(1);
  });
}