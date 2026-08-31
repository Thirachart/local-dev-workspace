$ErrorActionPreference = 'Stop'
$rootDir = (Get-Item "$PSScriptRoot\..").FullName
Set-Location $rootDir

Write-Host 'Compiling standalone native Windows Local Dev Tool MCP App Bundle...' -ForegroundColor Green

Write-Host 'Building TypeScript ESM bundle...' -ForegroundColor Cyan
npm run build

$cargoPath = Get-Command cargo -ErrorAction SilentlyContinue
if ($cargoPath) {
    Write-Host 'Compiling Rust native platform bridge (chat-dev-platform-bridge.exe)...' -ForegroundColor Cyan
    cargo build --release --manifest-path (Join-Path $rootDir 'native\platform-bridge\Cargo.toml')
}

$distAppDir = Join-Path $rootDir 'dist-app-win\LocalDevToolMCP'
if (Test-Path $distAppDir) {
    Get-Process -Name "tunnel-client", "LocalDevToolMCP", "chat-dev-platform-bridge" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
    Remove-Item -Recurse -Force $distAppDir -ErrorAction SilentlyContinue
}
$scriptsDir = Join-Path $distAppDir 'scripts'
New-Item -ItemType Directory -Path $scriptsDir -Force | Out-Null

Write-Host "Bundling files into $distAppDir..." -ForegroundColor Cyan

Copy-Item -Recurse -Force (Join-Path $rootDir 'dist') "$distAppDir\"
Copy-Item -Force (Join-Path $rootDir 'package.json') "$distAppDir\"

$configDir = Join-Path $rootDir 'config'
if (Test-Path $configDir) {
    Copy-Item -Recurse -Force $configDir "$distAppDir\"
}

$rustBinary = Join-Path $rootDir 'native\platform-bridge\target\release\chat-dev-platform-bridge.exe'
if (Test-Path $rustBinary) {
    $rustTargetDir = Join-Path $distAppDir 'native\platform-bridge\target\release'
    New-Item -ItemType Directory -Path $rustTargetDir -Force | Out-Null
    Copy-Item -Force $rustBinary "$rustTargetDir\"
    Copy-Item -Force $rustBinary (Join-Path $distAppDir 'LocalDevToolMCP.exe')
}

$launchBat = Join-Path $rootDir 'scripts\launch.bat'
Copy-Item -Force $launchBat "$distAppDir\scripts\"
Copy-Item -Force $launchBat (Join-Path $distAppDir 'LocalDevToolMCP.bat')

$nodeModulesDir = Join-Path $rootDir 'node_modules'
if (Test-Path $nodeModulesDir) {
    Write-Host 'Copying node_modules dependencies...' -ForegroundColor Cyan
    Copy-Item -Recurse -Force $nodeModulesDir "$distAppDir\"
}

$assetsIcon = Join-Path $rootDir 'assets\icon.ico'
if (Test-Path $assetsIcon) {
    Copy-Item -Force $assetsIcon (Join-Path $distAppDir 'app.ico')
}

$desktopPath = [Environment]::GetFolderPath('Desktop')
if (Test-Path $desktopPath) {
    $shortcutPath = Join-Path $desktopPath 'Local Dev Tool MCP.lnk'
    $targetExe = Join-Path $distAppDir 'LocalDevToolMCP.exe'
    $targetBat = Join-Path $distAppDir 'LocalDevToolMCP.bat'
    $targetPath = if (Test-Path $targetExe) { $targetExe } else { $targetBat }
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($shortcutPath)
    $Shortcut.TargetPath = $targetPath
    $Shortcut.WorkingDirectory = $distAppDir
    $icoPath = Join-Path $distAppDir 'app.ico'
    if (Test-Path $icoPath) {
        $Shortcut.IconLocation = "$icoPath,0"
    }
    $Shortcut.Description = 'Local Dev Tool MCP - Native Taskbar & System Tray Workspace Server'
    $Shortcut.Save()
    Write-Host "Created Desktop Shortcut at $shortcutPath" -ForegroundColor Green
}

Write-Host "Standalone Windows Application Bundle compiled successfully at $distAppDir" -ForegroundColor Green
