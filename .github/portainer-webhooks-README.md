# Portainer Webhook Deployment

This directory contains the unified GitHub Actions workflow for triggering Portainer redeploys via webhooks.

## Workflow File
- `.github/workflows/portainer-webhook-deploy.yml` - Main workflow

## How It Works

### 1. Change Detection
When code is pushed to `main`, the workflow:
- Checks which files changed
- Filters for `services/*/compose.yaml` files
- Extracts service names from paths

### 2. Service → Secret Mapping
For each changed service (e.g., `hello`):
- Looks for GitHub secret: `PORTAINER_WEBHOOK_HELLO`
- Secret should contain the webhook URL from Portainer

### 3. Webhook Trigger
- Sends POST request to webhook URL
- Includes `?action=redeploy` parameter
- Retries up to 3 times on failure

## Setting Up a New Service

### Step 1: Enable Webhook in Portainer
1. Go to Portainer UI → Stacks
2. Find your service stack (e.g., `services-hello`)
3. Click Edit → Webhooks section
4. Toggle "Create a stack webhook" ON
5. **Copy the generated webhook URL**

### Step 2: Add GitHub Secret
1. Go to GitHub repo → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `PORTAINER_WEBHOOK_<SERVICE_NAME>`
   - Uppercase service name
   - Replace hyphens with underscores if needed
   - Examples:
     - `hello` → `PORTAINER_WEBHOOK_HELLO`
     - `home-assistant` → `PORTAINER_WEBHOOK_HOME_ASSISTANT`
     - `adguard` → `PORTAINER_WEBHOOK_ADGUARD`
4. Value: Paste the webhook URL from Portainer
5. Click "Add secret"

### Step 3: (Optional) Disable GitOps Polling
For webhook-enabled services, you may want to disable GitOps polling:
1. In Portainer, edit the stack
2. Set AutoUpdate Interval to empty ("")
3. Save (webhook token should remain)

## Current Service Status

| Service | Webhook Enabled | GitHub Secret | Notes |
|---------|----------------|---------------|-------|
| `hello` | ✅ Yes | `PORTAINER_WEBHOOK_HELLO` | Tested and working |
| `cloudflared` | ❌ No | `PORTAINER_WEBHOOK_CLOUDFLARED` | Secret exists, needs webhook enabled |
| Other services | ❌ No | Not created | Add as needed |

## Testing

To test a service:
1. Make a small change to its `compose.yaml` file
2. Commit and push to `main`
3. Check GitHub Actions run
4. Verify service redeploys in Portainer

Example test change for `hello` service:
```yaml
# services/hello/compose.yaml
environment:
  - MESSAGE=hello from lan-infra vX  # Change version number
```

## Troubleshooting

### Webhook returns error
1. Check if webhook is enabled in Portainer UI
2. Verify webhook URL in GitHub secret is correct
3. Ensure Portainer is accessible from GitHub Actions
4. Check Portainer logs for webhook errors

### Service not detected as changed
1. Verify the `compose.yaml` file is in `services/<name>/compose.yaml`
2. Check git diff is working (force pushes may affect detection)
3. Workflow includes fallback to check all compose files

### Secret not found
1. Verify secret name follows convention: `PORTAINER_WEBHOOK_<UPPERCASE_SERVICE>`
2. Check secret exists in GitHub repo settings
3. Ensure secret has a value (not empty)

## Security Notes
- Webhook URLs should be kept secret (they're in GitHub Secrets)
- Webhook tokens provide limited access (redeploy only)
- No Portainer admin API keys are stored or used
- Each service has its own webhook token (compartmentalized)