# Keep Alerts → Paperclip issues (GOL-91)

Taps **Keep** (which already owns alert dedup/fingerprints/severity) and mints a
Paperclip issue per alert **fingerprint**. Re-fires comment on the existing issue
(never duplicate); a Keep resolution posts a closing comment and closes the issue.

This is the [`github-sync-plugin`](../github-sync-plugin) inbound contract with an
alert payload: an HMAC-verified public webhook + agent-free `ctx.issues.create`.
We tap Keep rather than the Discord channel, and add a **severity gate** and
**fingerprint keying** on top.

## Behaviour

| Keep event | Fingerprint state | Action |
|---|---|---|
| firing, severity in gate | no mapping | **mint** issue (routed + assigned), record mapping `open` |
| firing, severity in gate | `open` | **comment** "re-fired #N", bump fire count |
| firing, severity in gate | `resolved` | **reopen** issue + comment "recurred after resolution" |
| firing, severity below gate | any | **skip** (Discord-only); optional ops ping |
| resolved | `open` | **comment** "resolved" + close issue (`done`), mark `resolved` |
| resolved | none / already `resolved` | no-op |

- **Severity gate** (`mintSeverities`, default `["critical","high","warning"]`):
  info/low stay Discord-only. `high` is included because Keep ranks it above
  `warning`; drop it from the config if you want strictly critical/warning.
- **Routing** (`ownership`): ordered rules; the first whose `match` token appears
  (case-insensitive substring) in the alert's source/service/environment/name/labels
  wins → its `assigneeAgentId` (and optional `projectId`). Infra alerts → DevOps
  agent queue (D2 of the 2026-07-07 grill). No match → `defaultAssigneeAgentId` +
  default `projectId`. An unassigned issue is logged loudly (agents never pick up
  unassigned work).

## Config (`instanceConfigSchema`)

Required: `companyId`, `projectId`, `keepWebhookSecret`. Recommended:
`defaultAssigneeAgentId`, `ownership`, `opsWebhookUrl`. Optional: `mintSeverities`.

```json
{
  "companyId": "<company-uuid>",
  "projectId": "<ops-project-uuid>",
  "keepWebhookSecret": "<secret-ref>",
  "defaultAssigneeAgentId": "<ops-agent-uuid>",
  "mintSeverities": ["critical", "high", "warning"],
  "ownership": [
    { "match": "infra", "assigneeAgentId": "<devops-agent-uuid>", "projectId": "<infra-project-uuid>" },
    { "match": "odoocker", "assigneeAgentId": "<devops-agent-uuid>" }
  ],
  "opsWebhookUrl": "https://discord.com/api/webhooks/..."
}
```

## Keep workflow action

Add a Keep **workflow** that POSTs to the plugin's public webhook on alert
firing and resolution. The payload is HMAC-signed with `keepWebhookSecret` (same
`X-Hub-Signature-256: sha256=<hex>` scheme the github-sync plugin uses) and rides
the existing **Cloudflare Access service-token** path (send the CF Access
service-token headers so CF admits the request to the public endpoint). CF Access
is transport admission only — the plugin still verifies the HMAC.

```yaml
workflow:
  id: alerts-to-paperclip
  triggers:
    - type: alert
      # fire on both firing and resolved so the plugin can close issues
      filters:
        - key: severity
          value: r"(critical|high|warning)"
  actions:
    - name: post-to-paperclip
      provider:
        type: webhook
        with:
          url: "https://<plugin-host>/api/plugins/agenticos.keep-alerts-plugin/webhooks/keep-alert"
          method: POST
          headers:
            Content-Type: application/json
            # CF Access service token (transport admission)
            CF-Access-Client-Id: "{{ secrets.cf_access_client_id }}"
            CF-Access-Client-Secret: "{{ secrets.cf_access_client_secret }}"
            # HMAC over the raw JSON body (application authenticity)
            X-Hub-Signature-256: "sha256={{ keep.hmac(body, secrets.paperclip_keep_secret) }}"
          body: |
            {
              "fingerprint": "{{ alert.fingerprint }}",
              "name": "{{ alert.name }}",
              "severity": "{{ alert.severity }}",
              "status": "{{ alert.status }}",
              "description": "{{ alert.description }}",
              "source": {{ alert.source | tojson }},
              "service": "{{ alert.service }}",
              "environment": "{{ alert.environment }}",
              "url": "{{ alert.url }}",
              "labels": {{ alert.labels | tojson }}
            }
```

> The HMAC must be computed over the **exact** bytes POSTed. If Keep's templating
> can't emit a raw-body HMAC directly, sign a canonical field set on the Keep side
> and mirror that canonicalisation here (adjust `verifyKeepSignature`'s input).
> The current implementation verifies the signature over the raw request body.

Accepted payload fields (lenient): `fingerprint` + `name` (or `title`) are
required; `severity`, `status` (`firing`/`resolved`/…), `description`, `source`
(string or array), `service`, `environment`, `url` (or `generatorURL`), `labels`.

## DB

`keep_alert_mapping` (fingerprint PK → issue id + lifecycle) lives in the plugin
namespace `plugin_keep_alerts_ca083f9ab4`, created by `migrations/001_init.sql`.
The namespace is `plugin_<slug>_<sha256(pluginId)[:10]>`; regenerate the migration
table name if the plugin id or slug changes.

## Related

- Prior art / contract reused: `packages/github-sync-plugin` (inbound HMAC leg).
- Follow-up from the same grill (D3, separate issue): grove-sites and
  grove-odoo-modules still have **no** github-sync bridges — needed for the
  PR-failure feedback-to-owner loop.
