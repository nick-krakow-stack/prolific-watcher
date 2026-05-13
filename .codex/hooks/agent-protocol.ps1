param(
  [string]$Mode = ""
)

$ErrorActionPreference = "SilentlyContinue"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$memoryDir = Join-Path $repoRoot ".agent-memory"
$feedbackPath = Join-Path $memoryDir "feedback.md"
$currentTaskPath = Join-Path $memoryDir "current-task.md"
$handoffPath = Join-Path $memoryDir "handoff.md"
$currentStatePath = Join-Path $memoryDir "current-state.md"
$nextStepsPath = Join-Path $memoryDir "next-steps.md"
$progressPath = Join-Path $memoryDir "progress.md"

function Format-Entry([string]$text) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
  return "$timestamp - $text"
}

function Ensure-MemoryDir {
  if (-not (Test-Path $memoryDir)) {
    New-Item -ItemType Directory -Path $memoryDir | Out-Null
  }
}

function Append-Line([string]$path, [string]$line) {
  Ensure-MemoryDir
  Add-Content -Path $path -Value $line -Encoding UTF8
}

function Ensure-TaskFileExists {
  Ensure-MemoryDir
  if (Test-Path $currentTaskPath) {
    return
  }

  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
  $content = @"
# Current Task Checklist

Last updated: $stamp

## Active Task Checklist

- [ ] Define the next task.

## Completed Task Steps

- [x] Baseline checklist file created.
"@
  Set-Content -Path $currentTaskPath -Value $content -Encoding UTF8
}

function Update-ProgressBlock([string]$entry) {
  $line = "- " + (Format-Entry $entry)

  if (-not (Test-Path $progressPath)) {
    Ensure-MemoryDir
    Set-Content -Path $progressPath -Value "# Progress`r`n`r`n$line" -Encoding UTF8
    return
  }

  Add-Content -Path $progressPath -Value $line -Encoding UTF8
}

function Ensure-SectionInFile([string]$raw, [string]$sectionTitle, [string]$defaultContent) {
  if ($raw -match "(?ms)^##\s+$([regex]::Escape($sectionTitle))") {
    return $raw
  }

  return $raw.TrimEnd() + "`r`n`r`n## $sectionTitle`r`n`r`n$defaultContent`r`n"
}

function Normalize-TaskText([string]$text) {
  if ([string]::IsNullOrWhiteSpace($text)) {
    return ""
  }
  return [regex]::Replace([string]$text, "\s+", " ").Trim().ToLowerInvariant()
}

function Update-CurrentTaskFromPrompt([string]$content) {
  if ([string]::IsNullOrWhiteSpace($content)) {
    return
  }

  Ensure-TaskFileExists
  $raw = Get-Content -Raw -Path $currentTaskPath -ErrorAction SilentlyContinue
  if ([string]::IsNullOrWhiteSpace($raw)) {
    $raw = "# Current Task Checklist`r`nLast updated: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz") + "`r`n"
  }

  $raw = Ensure-SectionInFile $raw "Active Task Checklist" "- [ ] Add an item."
  $raw = Ensure-SectionInFile $raw "Completed Task Steps" "- [x] Baseline step."

  $existing = Get-Content -Path $currentTaskPath -ErrorAction SilentlyContinue
  foreach ($line in ($content -split "`r?`n")) {
    $match = $line | Select-String -Pattern '^\s*-\s*\[([ xX])\]\s*(.+)\s*$'
    if (-not $match) {
      continue
    }

    $mark = $match.Matches[0].Groups[1].Value
    $item = [regex]::Replace([string]$match.Matches[0].Groups[2].Value, "\s+", " ").Trim()
    if ([string]::IsNullOrWhiteSpace($item)) {
      continue
    }

    $target = Normalize-TaskText $item
    $already = $existing | Where-Object {
      $_ -match '^\s*-\s*\[[ xX]\]\s*(.+)\s*$' -and (Normalize-TaskText $Matches[1]) -eq $target
    }
    if ($already.Count -gt 0) {
      continue
    }

    if ($mark.ToLower() -eq "x") {
      $raw = [regex]::Replace($raw, "(?ms)(^##\s+Completed Task Steps.*?)(?=^\s*##\s+|\z)", "`$1`r`n- [x] $item")
    } else {
      $raw = [regex]::Replace($raw, "(?ms)(^##\s+Active Task Checklist.*?)(?=^\s*##\s+|\z)", "`$1`r`n- [ ] $item")
    }
  }

  $raw = [regex]::Replace($raw, "(?m)^Last updated:.*$", "Last updated: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"))
  Set-Content -Path $currentTaskPath -Value $raw -Encoding UTF8
}

function Get-PayloadText([pscustomobject]$payload) {
  foreach ($property in @("prompt", "message", "input", "text", "comment", "feedback", "body")) {
    $candidate = $payload.$property
    if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) {
      return [string]$candidate
    }
  }
  return ""
}

function Get-FeedbackCategory([pscustomobject]$payload, [string]$content) {
  foreach ($property in @("category", "kind", "feedback_type", "feedbackType", "source", "channel")) {
    $value = $payload.$property
    if ($value -match "(?i)browser") {
      return "Browser-Feedback"
    }
    if ($value -match "(?i)diff|review|comment") {
      return "Review-Feedback"
    }
  }

  if ($content -match "(?i)browser|chrome|extension test") {
    return "Browser-Feedback"
  }
  if ($content -match "(?i)review|diff|pr comment") {
    return "Review-Feedback"
  }

  return "Owner-Feedback"
}

function Test-IsInternalSignal([string]$content) {
  if ([string]::IsNullOrWhiteSpace($content)) {
    return $false
  }

  $internalPatterns = @(
    "subagent_notification",
    "agent_path",
    "Du bist nicht allein im Codebase",
    "Rolle:\s*(Dev-Agent|QA-Agent|Critic-Agent|Orchestrator)",
    "Nicht committen\.",
    "Antworte mit ge[aä]nderten Dateien"
  )

  foreach ($pattern in $internalPatterns) {
    if ($content -match $pattern) {
      return $true
    }
  }
  return $false
}

function Capture-OwnerFeedback([string]$rawPayload) {
  if ([string]::IsNullOrWhiteSpace($rawPayload)) {
    return $false
  }

  try {
    $payload = $rawPayload | ConvertFrom-Json
    $content = Get-PayloadText $payload
    if ([string]::IsNullOrWhiteSpace($content)) {
      return $false
    }

    $safe = [System.Text.RegularExpressions.Regex]::Replace([string]$content, "\s+", " ")
    if (Test-IsInternalSignal -content $safe) {
      return $false
    }

    $category = Get-FeedbackCategory $payload $safe
    Append-Line -path $feedbackPath -line (Format-Entry "${category}: $safe")
    Update-CurrentTaskFromPrompt -content $content
    return $true
  } catch {
    return $false
  }
}

function Update-HandoffFile {
  Ensure-MemoryDir

  Push-Location $repoRoot
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
  $branch = git rev-parse --abbrev-ref HEAD 2>$null
  $commit = git log -1 --oneline 2>$null
  $statusLines = @(git status --short 2>$null)
  Pop-Location

  $statusBlock = if ($statusLines.Count -gt 0) {
    ($statusLines | Select-Object -First 80) -join "`n"
  } else {
    "Clean working tree."
  }

  $content = @"
# Handoff

Last updated: $timestamp
Update mode: Stop

## Latest Notes

Automatic handoff snapshot written by `.codex/hooks/agent-protocol.ps1`.
Current task status is tracked in `.agent-memory/current-task.md`.
Owner, browser, and review feedback are persisted in `.agent-memory/feedback.md`.

## Git Snapshot

- Branch: $branch
- Last commit: $commit

## Working Tree

~~~text
$statusBlock
~~~

## Current State Summary

See `.agent-memory/current-state.md`.

## Next Planned Work

See `.agent-memory/next-steps.md`.

## Required Startup For Next Agent

1. Read `AGENTS.md`.
2. Read `.agent-memory/current-state.md`.
3. Read this handoff.
4. Read `.agent-memory/next-steps.md`.
5. Run `git status --short`.

## Operating Constraints

- Codex acts as Orchestrator only.
- Delegate implementation to Sub-Agents whenever tooling supports it.
- No Cloudflare deployment workflow applies to this repository.
- Do not write secrets, tokens, passwords, raw bearer tokens, or personal Prolific data into memory files.
- Keep Chrome extension release ZIPs limited to runtime extension files only.
"@

  Set-Content -Path $handoffPath -Value $content -Encoding UTF8
}

function Get-HookEvent {
  param([string[]]$ArgsInput, [string]$Stdin)

  foreach ($value in @($env:CODEX_HOOK_EVENT, $env:HOOK_EVENT, $env:AGENT_HOOK_EVENT, $ArgsInput[0])) {
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($Stdin)) {
    try {
      $payload = $Stdin | ConvertFrom-Json -ErrorAction Stop
      foreach ($prop in @("event", "type", "hook", "name")) {
        $candidate = $payload.$prop
        if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) {
          return [string]$candidate
        }
      }
    } catch {}
  }

  return $Mode
}

try {
  $stdin = [Console]::In.ReadToEnd()
} catch {
  $stdin = ""
}

$event = Get-HookEvent -ArgsInput $args -Stdin $stdin

switch ($event) {
  "UserPromptSubmit" {
    if (Capture-OwnerFeedback -rawPayload $stdin) {
      Update-ProgressBlock "Captured owner feedback on UserPromptSubmit."
    }
  }
  "Stop" {
    Ensure-TaskFileExists
    Update-ProgressBlock "Stop hook ran and refreshed central memory snapshot."
    Update-HandoffFile
  }
  default {
    # no-op for non-configured events
  }
}
