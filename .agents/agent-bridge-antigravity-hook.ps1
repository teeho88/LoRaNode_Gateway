# agent-bridge-hook-version: 2026-08-09.agy-lifecycle.v1
$ErrorActionPreference = "SilentlyContinue"
try {
  # Read stdin as raw bytes: agy sends UTF-8 JSON, and decoding through
  # [Console]::In would apply the console code page and corrupt it.
  $stdin = [Console]::OpenStandardInput()
  $buffer = New-Object System.IO.MemoryStream
  $stdin.CopyTo($buffer)
  $bytes = $buffer.ToArray()
  $env:AGENT_BRIDGE_HOOK_JSON_B64 = [Convert]::ToBase64String($bytes)
  node "D:\TAILIEU\MyProject\AI_Tool\Optimize_token_and_memory_pool\packages\cli\dist\index.js" antigravity hook --event $args[0]
  $code = $LASTEXITCODE
  Remove-Item Env:\AGENT_BRIDGE_HOOK_JSON_B64 -ErrorAction SilentlyContinue
  exit $code
} catch {
  # A hook that fails must never take the agent down with it.
  Write-Output "{}"
  exit 0
}
