#!/usr/bin/env node

const https = require('https');

class PortainerWebhookDeploy {
  constructor() {
    this.servicesPath = 'services';
    this.secretPrefix = 'PORTAINER_WEBHOOK_';
  }

  extractServiceNames(filePaths) {
    const serviceNames = new Set();

    for (const filePath of filePaths) {
      const match = filePath.match(new RegExp(`^${this.servicesPath}/([^/]+)/compose\\.yaml$`));
      if (match) {
        serviceNames.add(match[1]);
      }
    }

    return Array.from(serviceNames);
  }

  getWebhookUrl(serviceName) {
    const normalizedServiceName = serviceName.replace(/-/g, '_').toUpperCase();
    const secretName = `${this.secretPrefix}${normalizedServiceName}`;
    const webhookUrl = process.env[secretName];

    if (!webhookUrl) {
      throw new Error(
        `Secret ${secretName} not found for service '${serviceName}'.\n` +
        `1. Enable webhook in Portainer UI for '${serviceName}' service\n` +
        `2. Copy webhook URL from Portainer\n` +
        `3. Add to GitHub secrets with name: ${secretName}\n` +
        `4. Update .github/workflows/portainer-deploy.yml to pass the secret as environment variable`
      );
    }

    return webhookUrl;
  }

  async triggerWebhook(webhookUrl, serviceName, attempt = 1, maxAttempts = 3) {
    return new Promise((resolve, reject) => {
      const url = new URL(webhookUrl);

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'User-Agent': 'GitHub Actions (Portainer Deploy)',
          'CF-Access-Client-Id': process.env.CF_SERVICE_TOKEN_CLIENT_ID || '',
          'CF-Access-Client-Secret': process.env.CF_SERVICE_TOKEN_CLIENT_SECRET || '',
        },
        timeout: 10000,
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
            console.log(`🔄 [${serviceName}] Retrying (HTTP ${res.statusCode})...`);
            setTimeout(() => {
              this.triggerWebhook(webhookUrl, serviceName, attempt + 1, maxAttempts)
                .then(resolve)
                .catch(reject);
            }, 2000);
          } else {
            console.error(`❌ [${serviceName}] Failed after ${maxAttempts} attempts (HTTP ${res.statusCode})`);
            // Don't include response body in error to avoid leaking sensitive info
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', (error) => {
        if (attempt < maxAttempts) {
          console.log(`🔄 [${serviceName}] Network error, retrying...`);
          setTimeout(() => {
            this.triggerWebhook(webhookUrl, serviceName, attempt + 1, maxAttempts)
              .then(resolve)
              .catch(reject);
          }, 2000);
        } else {
          console.error(`❌ [${serviceName}] Network error after ${maxAttempts} attempts`);
          // Don't include error details to avoid leaking hostname/URL
          reject(new Error('Network error'));
        }
      });

      req.on('timeout', () => {
        req.destroy();
        if (attempt < maxAttempts) {
          console.log(`🔄 [${serviceName}] Timeout, retrying...`);
          setTimeout(() => {
            this.triggerWebhook(webhookUrl, serviceName, attempt + 1, maxAttempts)
              .then(resolve)
              .catch(reject);
          }, 2000);
        } else {
          console.error(`❌ [${serviceName}] Timeout after ${maxAttempts} attempts`);
          reject(new Error('Request timeout'));
        }
      });

      req.end();
    });
  }

  async run() {
    console.log('🚀 Portainer Webhook Deploy\n');

    const allChangedFiles = process.env.ALL_CHANGED_FILES || '';
    
    if (!allChangedFiles) {
      console.log('📝 No changed files detected');
      return { deployed: [], skipped: [], success: true };
    }

    const changedFiles = allChangedFiles.split(' ');
    console.log(`📁 Changed files: ${changedFiles.length} file(s)`);
    
    const serviceNames = this.extractServiceNames(changedFiles);
    
    if (serviceNames.length === 0) {
      console.log('📝 No compose.yaml files changed');
      return { deployed: [], skipped: [], success: true };
    }

    console.log(`🎯 Services to deploy: ${serviceNames.join(', ')}\n`);

    const results = [];
    for (const serviceName of serviceNames) {
      try {
        const webhookUrl = this.getWebhookUrl(serviceName);
        console.log(`⚡ Deploying ${serviceName}...`);
        await this.triggerWebhook(webhookUrl, serviceName);
        results.push({ serviceName, success: true });
      } catch (error) {
        console.error(`💥 Failed to deploy ${serviceName}: ${error.message}`);
        results.push({ serviceName, success: false, error: error.message });
      }
    }

    const deployed = results.filter(r => r.success).map(r => r.serviceName);
    const failed = results.filter(r => !r.success);
    
    console.log('\n📊 Deployment Summary:');
    console.log(`✅ Success: ${deployed.length} service(s)`);
    console.log(`❌ Failed: ${failed.length} service(s)`);
    
    if (deployed.length > 0) {
      console.log(`   ${deployed.join(', ')}`);
    }
    
    if (failed.length > 0) {
      console.log('Failed services:');
      failed.forEach(f => console.log(`   ${f.serviceName}: ${f.error}`));
    }

    return {
      deployed,
      failed: failed.map(f => f.serviceName),
      success: failed.length === 0
    };
  }
}

module.exports = PortainerWebhookDeploy;

if (require.main === module) {
  const deployer = new PortainerWebhookDeploy();
  deployer.run().then(result => {
    if (!result.success) {
      console.error('\n❌ Some deployments failed');
      process.exit(1);
    } else if (result.deployed.length > 0) {
      console.log('\n🎉 All deployments successful!');
      process.exit(0);
    } else {
      console.log('\nℹ️ No services needed deployment.');
      process.exit(0);
    }
  }).catch(error => {
    console.error('\n💥 Fatal error:', error.message);
    process.exit(1);
  });
}