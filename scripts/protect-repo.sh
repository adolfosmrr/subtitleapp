#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-adolfosmrr/subtitulador}"
BRANCH="${2:-main}"

command -v gh >/dev/null || { echo "Necesitás GitHub CLI (gh)"; exit 1; }
gh auth status >/dev/null

echo "Configurando $REPO…"
gh api -X PATCH "repos/$REPO" \
  -F has_wiki=false \
  -F has_projects=false \
  -F allow_merge_commit=false \
  -F allow_squash_merge=true \
  -F allow_rebase_merge=true \
  -F allow_auto_merge=false \
  -F delete_branch_on_merge=true \
  -F allow_forking=true \
  -F web_commit_signoff_required=false >/dev/null

gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" --input - >/dev/null <<JSON
{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON

gh api -X PUT "repos/$REPO/vulnerability-alerts" >/dev/null || echo "Aviso: no se pudieron activar las alertas de Dependabot"
gh api -X PUT "repos/$REPO/automated-security-fixes" >/dev/null || echo "Aviso: no se pudieron activar los arreglos automáticos de Dependabot"
gh api -X PUT "repos/$REPO/private-vulnerability-reporting" >/dev/null || echo "Aviso: no se pudo activar el reporte privado de vulnerabilidades"
gh api -X PATCH "repos/$REPO" --input - >/dev/null <<JSON || echo "Aviso: secret scanning no disponible para este repo"
{ "security_and_analysis": { "secret_scanning": { "status": "enabled" }, "secret_scanning_push_protection": { "status": "enabled" } } }
JSON
gh api -X PUT "repos/$REPO/actions/permissions/workflow" -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false >/dev/null || true

echo "Listo. Protección de $BRANCH:"
gh api "repos/$REPO/branches/$BRANCH/protection" --jq '{linear: .required_linear_history.enabled, force_push: .allow_force_pushes.enabled, deletions: .allow_deletions.enabled}'
