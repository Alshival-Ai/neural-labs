$ErrorActionPreference = 'Stop'

function Show-Usage {
  @"
Usage: .\start.ps1 [options] [-- <extra docker compose up args>]

Options:
  --compose-restart       Run "docker compose down --remove-orphans" before starting
  --compose-file, -f      Compose file path (default: compose.yml)
  --detach, -d            Run in detached mode
  --no-build              Skip --build
  --logs                  Follow service logs after startup
  --service               Service name for logs (default: neural-labs)
  --help, -h              Show this help

Examples:
  .\start.ps1
  .\start.ps1 --compose-restart
  .\start.ps1 --compose-restart --detach --logs
  .\start.ps1 -f docker-compose.yml --compose-restart
  .\start.ps1 -- --pull always
"@
}

# Manual arg parsing to support GNU-style long options.
$composeRestart = $false
$composeFile = 'compose.yml'
$detach = $false
$build = $true
$logs = $false
$serviceName = 'neural-labs'
$extraArgs = @()

for ($i = 0; $i -lt $args.Count; $i++) {
  $arg = $args[$i]

  switch ($arg) {
    '--compose-restart' {
      $composeRestart = $true
      continue
    }
    '--compose-file' {
      if ($i + 1 -ge $args.Count) {
        throw "Missing value for $arg"
      }
      $i++
      $composeFile = $args[$i]
      continue
    }
    '-f' {
      if ($i + 1 -ge $args.Count) {
        throw "Missing value for $arg"
      }
      $i++
      $composeFile = $args[$i]
      continue
    }
    '--detach' {
      $detach = $true
      continue
    }
    '-d' {
      $detach = $true
      continue
    }
    '--no-build' {
      $build = $false
      continue
    }
    '--logs' {
      $logs = $true
      continue
    }
    '--service' {
      if ($i + 1 -ge $args.Count) {
        throw "Missing value for $arg"
      }
      $i++
      $serviceName = $args[$i]
      continue
    }
    '--help' {
      Show-Usage
      exit 0
    }
    '-h' {
      Show-Usage
      exit 0
    }
    '--' {
      if ($i + 1 -lt $args.Count) {
        $extraArgs += $args[($i + 1)..($args.Count - 1)]
      }
      break
    }
    default {
      $extraArgs += $arg
      continue
    }
  }
}

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$composePath = Join-Path $rootDir $composeFile

if (-not (Test-Path -LiteralPath $composePath -PathType Leaf)) {
  throw "Compose file not found: $composePath"
}

$composeCmd = @('compose', '-f', $composePath)

if ($composeRestart) {
  Write-Host 'Restart requested: tearing down existing compose services...'
  & docker @composeCmd down --remove-orphans
}

$upArgs = @('up', '--remove-orphans')
if ($build) {
  $upArgs += '--build'
}
if ($detach) {
  $upArgs += '-d'
}
if ($extraArgs.Count -gt 0) {
  $upArgs += $extraArgs
}

Write-Host "Starting services with $composeFile..."
& docker @composeCmd @upArgs

if ($logs) {
  Write-Host "Following logs for service: $serviceName"
  & docker @composeCmd logs -f $serviceName
}
