# Portainer Webhook Deployment (Node.js Approach)

Cleaner implementation using Node.js script instead of bash-in-YAML.

## Architecture

```
.github/workflows/portainer-deploy.yml  # Minimal YAML
└── scripts/portainer-webhook-deploy.js # All logic here
    ├── Change detection
    ├── Service mapping
    ├── Webhook triggering (with retries)
    └── Error handling & logging
```

## Benefits Over Bash-in-YAML

1. **Maintainable**: Pure JavaScript/Node.js, easier to debug
2. **Testable**: Can write unit tests for the script
3. **Portable**: Runs anywhere Node.js is available
4. **Robust**: Better error handling, promises, async/await
5. **Extensible**: Easy to add features (metrics, logging, etc.)

## Files

- `scripts/portainer-webhook-deploy.js` - Main deployment script
- `scripts/test-portainer-webhook.js` - Test script
- `.github/workflows/portainer-deploy.yml` - GitHub Actions workflow
- `.github/portainer-deploy-README.md` - This documentation

## Setup

### 1. Enable Webhook in Portainer
For each service (e.g., `hello`):
1. Portainer UI → Stacks → Edit → Webhooks
2. Enable webhook, copy URL

### 2. Add GitHub Secret
For each service:
1. GitHub repo → Settings → Secrets → Actions
2. Add secret: `PORTAINER_WEBHOOK_<SERVICE_UPPERCASE>`
   - Example: `hello` → `PORTAINER_WEBHOOK_HELLO`
3. Value: Webhook URL from Portainer

### 3. Test
```bash
# Set test environment variable
export PORTAINER_WEBHOOK_HELLO=https://portainer.diegoa.ca/api/stacks/webhooks/...

# Run locally
cd scripts
npm test  # Run basic tests
node portainer-webhook-deploy.js  # Run deployment
```

## How It Works

### GitHub Actions Workflow
- Triggers on changes to `services/**/compose.yaml`
- Checks out repo with full history (`fetch-depth: 0`) for git diff
- Sets up Node.js 20
- Runs the Node.js script

### Node.js Script
1. **Detects changed files** using `git diff`
2. **Extracts service names** from paths
3. **Gets webhook URLs** from environment variables (GitHub secrets)
4. **Triggers webhooks** with retry logic (3 attempts, 5s delay)
5. **Provides detailed logging** and error reporting

## Adding a New Service

1. Enable webhook in Portainer UI
2. Add GitHub secret: `PORTAINER_WEBHOOK_<SERVICE_UPPERCASE>`
3. Update `.github/workflows/portainer-deploy.yml` to pass the new secret as an environment variable to the script (following the pattern of existing entries, e.g., lines 29–31).
4. With the workflow updated, the script will automatically detect the service from changed `services/**/compose.yaml` files and use the corresponding secret.

## Development

```bash
cd scripts

# Run tests
node test-portainer-webhook.js  # Run basic tests

# Simulate GitHub Actions environment
export PORTAINER_WEBHOOK_HELLO=your_webhook_url
node portainer-webhook-deploy.js
```

## Error Handling

The script includes:
- **Retry logic**: 3 attempts with 5s delays
- **Timeout**: 10s per request
- **Network error recovery**: Auto-retry on timeouts/errors
- **Detailed logging**: Each step is logged
- **Clear error messages**: Tells you exactly what went wrong

## Security

- Webhook URLs stored in GitHub Secrets
- HTTPS required for webhook URLs
- Basic webhook URL format validation (warns if doesn't look like Portainer webhook)
- Reduced logging verbosity (doesn't log full URLs)
- No Portainer API keys needed
- Each service has separate webhook token

## Comparison with Bash Approach

| Aspect | Bash-in-YAML | Node.js Script |
|--------|--------------|----------------|
| Maintainability | ❌ Hard to debug | ✅ Easy to debug |
| Testability | ❌ Difficult | ✅ Unit tests possible |
| Error handling | ⚠️ Basic | ✅ Robust with retries |
| Portability | ⚠️ Bash-specific | ✅ Any Node.js env |
| Lines of code | 121 in YAML | 200 in JS + 50 YAML |
| Dependencies | None | Node.js runtime |

## Current Status

- `hello` service: ✅ Webhook enabled, secret exists
- `cloudflared` service: ⚠️ Secret exists, needs webhook enabled
- Other services: Can be added as needed