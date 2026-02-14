#!/usr/bin/env node

/**
 * Portainer Webhook Deploy Script
 * 
 * Detects changed services and triggers Portainer webhooks.
 * Designed to be called from GitHub Actions with minimal YAML.
 */

const { execSync } = require('child_process');
const https = require('https');

class PortainerWebhookDeploy {
  constructor() {
    this.servicesPath = 'services';
    this.secretPrefix = 'PORTAINER_WEBHOOK_';
  }

  /**
   * Get list of changed files between current and previous commit
   * Returns null if diff cannot be determined (e.g., force push, initial commit)
   */
  getChangedFiles() {
    try {
      // First, check if we have a previous commit to diff against
      const hasPreviousCommit = execSync('git rev-parse HEAD~1 2>/dev/null || echo ""', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();

      if (!hasPreviousCommit) {
        console.log('⚠️ No previous commit found (might be initial commit)');
        return null; // Cannot determine what changed
      }

      // Try to get diff between current and previous commit
      const diff = execSync('git diff --name-only HEAD~1 HEAD', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();

      if (diff) {
        return diff.split('\n').filter(Boolean);
      }

      // Empty diff means no files changed (but we know what changed: nothing)
      console.log('📝 No files changed between commits');
      return [];
    } catch (error) {
      console.error('⚠️ Cannot determine changed files:', error.message);
      console.log('This can happen with force pushes, squash merges, or other non-linear history.');
      return null; // Cannot determine what changed
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
    const normalizedServiceName = serviceName.replace(/-/g, '_').toUpperCase();
    const secretName = `${this.secretPrefix}${normalizedServiceName}`;
    const webhookUrl = process.env[secretName];

    if (!webhookUrl) {
      throw new Error(`Secret ${secretName} not found for service '${serviceName}'. 
1. Enable webhook in Portainer UI for '${serviceName}' service
2. Copy webhook URL from Portainer
3. Add to GitHub secrets with name: ${secretName}
4. Update .github/workflows/portainer-deploy.yml to pass the secret as environment variable`);
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

      console.log(`[${serviceName}] Attempt ${attempt}/${maxAttempts}: triggering Portainer webhook`);

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
    try {
      console.log('🚀 Portainer Webhook Deploy Script');
      console.log('====================================\n');

      // Get changed files
      const changedFiles = this.getChangedFiles();
    
      if (changedFiles === null) {
        console.log('❓ Cannot determine what changed (force push, squash merge, or initial commit)');
        console.log('⚠️ Skipping deployment to avoid redeploying all services unnecessarily.');
        console.log('ℹ️ Normal pushes with linear history will work correctly.');
        return { 
          success: true, 
          deployed: [],
          skipped: true,
          reason: 'Cannot determine changed files (non-linear git history)'
        };
      }

      console.log(`Changed files detected: ${changedFiles.length}`);
      if (changedFiles.length > 0) {
        console.log(changedFiles.map(f => `  - ${f}`).join('\n'));
      }

      // Extract service names
      const serviceNames = this.extractServiceNames(changedFiles);
      console.log(`\nServices to deploy: ${serviceNames.length}`);
      if (serviceNames.length === 0) {
        console.log('No service compose files changed.');
        return { success: true, deployed: [], skipped: false };
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
        results,
        skipped: false
      };
    } catch (error) {
      console.error('💥 Unhandled error in deploy():', error.message);
      console.error('Stack:', error.stack);
      return {
        success: false,
        deployed: [],
        failed: [],
        results: [],
        skipped: false,
        error: error.message
      };
    }
  }
}

// CLI entry point
if (require.main === module) {
  const deployer = new PortainerWebhookDeploy();
  
  deployer.deploy()
    .then(result => {
      if (result.skipped) {
        console.log(`\n⚠️ ${result.reason}`);
        process.exit(0); // Exit with success but skipped
      } else if (!result.success) {
        console.error('\n❌ Some deployments failed');
        process.exit(1);
      } else if (result.deployed.length > 0) {
        console.log('\n🎉 All deployments successful!');
        process.exit(0);
      } else {
        console.log('\nℹ️ No services needed deployment.');
        process.exit(0);
      }
    })
    .catch(error => {
      console.error('\n💥 Fatal error:', error.message);
      console.error('Stack:', error.stack);
      process.exit(1);
    });
}

module.exports = PortainerWebhookDeploy;