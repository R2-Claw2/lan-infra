#!/usr/bin/env node

/**
 * Portainer Webhook Deploy Script
 * 
 * Detects changed services and triggers Portainer webhooks.
 * Designed to be called from GitHub Actions with minimal YAML.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

class PortainerWebhookDeploy {
  constructor() {
    this.servicesPath = 'services';
    this.secretPrefix = 'PORTAINER_WEBHOOK_';
  }

  /**
   * Get list of changed files between current and previous commit
   */
  getChangedFiles() {
    try {
      // Try to get diff between current and previous commit
      const diff = execSync('git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only HEAD HEAD~1 2>/dev/null || echo ""', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();

      if (diff) {
        return diff.split('\n').filter(Boolean);
      }

      // Fallback: if no diff (e.g., initial commit), check all compose files
      console.log('No git diff available, checking all compose files...');
      const allComposeFiles = execSync(`find ${this.servicesPath} -name "compose.yaml" -type f 2>/dev/null || echo ""`, {
        encoding: 'utf8'
      }).trim();

      return allComposeFiles ? allComposeFiles.split('\n') : [];
    } catch (error) {
      console.error('Error getting changed files:', error.message);
      return [];
    }
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

  /**
   * Get webhook URL from GitHub secrets (passed as env vars)
   */
  getWebhookUrl(serviceName) {
    const secretName = `${this.secretPrefix}${serviceName.toUpperCase()}`;
    const webhookUrl = process.env[secretName];

    if (!webhookUrl) {
      throw new Error(`Secret ${secretName} not found. Add webhook URL to GitHub secrets.`);
    }

    if (!webhookUrl.startsWith('https://')) {
      throw new Error(`Invalid webhook URL for ${serviceName}. Must be HTTPS.`);
    }

    return webhookUrl;
  }

  /**
   * Trigger webhook with retry logic
   */
  async triggerWebhook(webhookUrl, serviceName, attempt = 1, maxAttempts = 3) {
    return new Promise((resolve, reject) => {
      const url = new URL(webhookUrl);
      url.searchParams.set('action', 'redeploy');

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'User-Agent': 'GitHub Actions (Portainer Deploy)',
        },
        timeout: 10000, // 10 second timeout
      };

      console.log(`[${serviceName}] Attempt ${attempt}/${maxAttempts}: ${url.hostname}${url.pathname}`);

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 204) {
            console.log(`✅ [${serviceName}] Success (HTTP ${res.statusCode})`);
            resolve(true);
          } else if (attempt < maxAttempts) {
            console.log(`⚠️ [${serviceName}] Failed (HTTP ${res.statusCode}), retrying...`);
            console.log(`   Response: ${data || '(empty)'}`);
            setTimeout(() => {
              this.triggerWebhook(webhookUrl, serviceName, attempt + 1, maxAttempts)
                .then(resolve)
                .catch(reject);
            }, 5000); // 5 second delay between retries
          } else {
            console.error(`❌ [${serviceName}] All attempts failed (HTTP ${res.statusCode})`);
            console.error(`   Response: ${data || '(empty)'}`);
            reject(new Error(`Webhook failed for ${serviceName}: HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', (error) => {
        if (attempt < maxAttempts) {
          console.log(`⚠️ [${serviceName}] Network error: ${error.message}, retrying...`);
          setTimeout(() => {
            this.triggerWebhook(webhookUrl, serviceName, attempt + 1, maxAttempts)
              .then(resolve)
              .catch(reject);
          }, 5000);
        } else {
          console.error(`❌ [${serviceName}] Network error after ${maxAttempts} attempts: ${error.message}`);
          reject(error);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        if (attempt < maxAttempts) {
          console.log(`⚠️ [${serviceName}] Timeout, retrying...`);
          setTimeout(() => {
            this.triggerWebhook(webhookUrl, serviceName, attempt + 1, maxAttempts)
              .then(resolve)
              .catch(reject);
          }, 5000);
        } else {
          console.error(`❌ [${serviceName}] Timeout after ${maxAttempts} attempts`);
          reject(new Error(`Timeout for ${serviceName}`));
        }
      });

      req.end();
    });
  }

  /**
   * Main deployment logic
   */
  async deploy() {
    console.log('🚀 Portainer Webhook Deploy Script');
    console.log('====================================\n');

    // Get changed files
    const changedFiles = this.getChangedFiles();
    console.log(`Changed files detected: ${changedFiles.length}`);
    if (changedFiles.length > 0) {
      console.log(changedFiles.map(f => `  - ${f}`).join('\n'));
    }

    // Extract service names
    const serviceNames = this.extractServiceNames(changedFiles);
    console.log(`\nServices to deploy: ${serviceNames.length}`);
    if (serviceNames.length === 0) {
      console.log('No service compose files changed.');
      return { success: true, deployed: [] };
    }
    console.log(serviceNames.map(s => `  - ${s}`).join('\n'));

    // Deploy each service
    const results = [];
    for (const serviceName of serviceNames) {
      try {
        console.log(`\n--- Deploying ${serviceName} ---`);
        const webhookUrl = this.getWebhookUrl(serviceName);
        await this.triggerWebhook(webhookUrl, serviceName);
        results.push({ service: serviceName, success: true });
      } catch (error) {
        console.error(`Failed to deploy ${serviceName}: ${error.message}`);
        results.push({ service: serviceName, success: false, error: error.message });
      }
    }

    // Summary
    console.log('\n📊 Deployment Summary');
    console.log('====================');
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    if (successful.length > 0) {
      console.log(`✅ Successful: ${successful.map(r => r.service).join(', ')}`);
    }
    if (failed.length > 0) {
      console.log(`❌ Failed: ${failed.map(r => r.service).join(', ')}`);
      console.log('\nErrors:');
      failed.forEach(r => console.log(`  - ${r.service}: ${r.error}`));
    }

    const allSuccess = failed.length === 0;
    return {
      success: allSuccess,
      deployed: successful.map(r => r.service),
      failed: failed.map(r => r.service),
      results
    };
  }
}

// CLI entry point
if (require.main === module) {
  const deployer = new PortainerWebhookDeploy();
  
  deployer.deploy()
    .then(result => {
      if (!result.success) {
        console.error('\n❌ Some deployments failed');
        process.exit(1);
      } else if (result.deployed.length > 0) {
        console.log('\n🎉 All deployments successful!');
      } else {
        console.log('\nℹ️ No services needed deployment.');
      }
    })
    .catch(error => {
      console.error('\n💥 Fatal error:', error.message);
      process.exit(1);
    });
}

module.exports = PortainerWebhookDeploy;