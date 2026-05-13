param(
  [string]$OutputDirectory = "releases",
  [string]$Suffix = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repoRoot "manifest.json"

if (-not (Test-Path $manifestPath)) {
  throw "manifest.json not found at $manifestPath"
}

$manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
$version = [string]$manifest.version
if ([string]::IsNullOrWhiteSpace($version)) {
  throw "manifest.json does not contain a version"
}

$safeSuffix = ""
if (-not [string]::IsNullOrWhiteSpace($Suffix)) {
  $safeSuffix = "-" + ($Suffix -replace "[^a-zA-Z0-9._-]", "-")
}

$outputRoot = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
  $OutputDirectory
} else {
  Join-Path $repoRoot $OutputDirectory
}

$zipName = "prolific-watcher-v$version$safeSuffix.zip"
$zipPath = Join-Path $outputRoot $zipName
$tmpRoot = Join-Path $repoRoot ".tmp"
$staging = Join-Path $tmpRoot ("extension-package-" + [guid]::NewGuid().ToString("N"))

$runtimeFiles = @(
  "manifest.json",
  "background.js",
  "content.js",
  "popup.html",
  "popup.css",
  "popup.js"
)

$runtimeDirs = @(
  "icons"
)

try {
  New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $staging | Out-Null

  foreach ($file in $runtimeFiles) {
    $source = Join-Path $repoRoot $file
    if (-not (Test-Path $source)) {
      throw "Required runtime file missing: $file"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $staging $file)
  }

  foreach ($dir in $runtimeDirs) {
    $source = Join-Path $repoRoot $dir
    if (-not (Test-Path $source)) {
      throw "Required runtime directory missing: $dir"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $staging $dir) -Recurse
  }

  if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }

  Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath -CompressionLevel Optimal

  $entries = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $forbidden = $entries.Entries | Where-Object {
      $_.FullName -match '(^|/)(\.git|\.codex|\.agent-memory|scripts|releases|\.tmp)(/|$)' -or
      $_.FullName -match '\.(md|ps1|toml|jsonl)$'
    }
    if ($forbidden.Count -gt 0) {
      $names = ($forbidden | Select-Object -ExpandProperty FullName) -join ", "
      throw "ZIP contains forbidden repository files: $names"
    }
  } finally {
    $entries.Dispose()
  }

  Write-Output "Created $zipPath"
} finally {
  if (Test-Path $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
}
