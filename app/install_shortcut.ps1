# Creates "JARVIS" shortcuts in the Start menu and on the Desktop.
# Run once from the repo:   powershell -ExecutionPolicy Bypass -File app\install_shortcut.ps1
# Re-running just refreshes them. Remove by deleting the two .lnk files.

$ErrorActionPreference = 'Stop'
$app   = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo  = Split-Path -Parent $app
$pyw   = Join-Path $repo '.venv\Scripts\pythonw.exe'
$entry = Join-Path $app 'JARVIS.pyw'
$icon  = Join-Path $app 'assets\jarvis.ico'

if (-not (Test-Path $pyw)) { throw "Project interpreter not found: $pyw" }
if (-not (Test-Path $icon)) { & (Join-Path $repo '.venv\Scripts\python.exe') (Join-Path $app 'make_icon.py') }

$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'JARVIS.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Desktop'))  'JARVIS.lnk')
)
foreach ($lnk in $targets) {
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath       = $pyw
  $s.Arguments        = "`"$entry`""
  $s.WorkingDirectory = $app
  $s.IconLocation     = "$icon,0"
  $s.Description      = 'JARVIS - local AI assistant'
  $s.Save()
  Write-Host "Created $lnk"
}
