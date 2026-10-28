param([switch]$Stop, [switch]$NoBrowser, [switch]$NoDialogs)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$entryPath = Join-Path $PSScriptRoot 'local.mjs'
$stateDir = Join-Path $projectRoot '.local-data\launcher'
$stateFile = Join-Path $stateDir 'process.json'
$pageUrl = 'http://localhost:3000/'

function Show-Notice([string]$message, [bool]$failure = $false) {
    if ($NoDialogs) { Write-Output $message; return }
    Add-Type -AssemblyName System.Windows.Forms
    $icon = if ($failure) { 'Error' } else { 'Information' }
    [void][Windows.Forms.MessageBox]::Show($message, 'Tagengo', 'OK', $icon)
}

function Test-Ready {
    try {
        $state = Invoke-RestMethod -Uri ($pageUrl + 'api/git/state') -TimeoutSec 3
        return ($state.repository -eq 'LL-MJ/Tagengo-data' -and $state.token -is [string] -and $state.token.Length -gt 0)
    } catch { return $false }
}

function Open-Library {
    if (-not $NoBrowser) { Start-Process $pageUrl }
    Write-Output 'Tagengo is ready: http://localhost:3000/'
}

# A per-checkout mutex prevents rapid double-clicks from starting multiple servers.
$hash = [Security.Cryptography.SHA256]::Create()
$key = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot))).Replace('-', '')
$hash.Dispose()
$mutex = New-Object Threading.Mutex($false, ('Local\Tagengo-' + $key))
$ownsMutex = $false
try {
    try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { Show-Notice '学习库正在启动，请稍等片刻。'; exit 0 }
    if ($Stop) {
        if (-not (Test-Path -LiteralPath $stateFile)) {
            Show-Notice '没有找到此启动器启动的后台服务。如果是从终端启动的，请在原终端按 Ctrl+C。'
            exit 0
        }
        $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        $process = Get-Process -Id $saved.processId -ErrorAction SilentlyContinue
        if ($process) {
            $info = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$saved.processId)
            if ($process.StartTime.ToUniversalTime().ToString('o') -ne $saved.startedAt -or
                $process.ProcessName -ne 'node' -or
                $saved.entryPath -ne $entryPath -or
                -not $info.CommandLine.Contains('"' + $entryPath + '"')) {
                throw '后台进程身份不匹配，未停止任何程序。'
            }
            # Stop only the verified launcher's node process and its own descendants.
            & taskkill.exe /PID $saved.processId /T /F | Out-Null
            if ($LASTEXITCODE -ne 0) { throw '停止失败，请查看原进程是否仍在运行。' }
        }
        Remove-Item -LiteralPath $stateFile
        Show-Notice '学习库已停止。尚未同步的学习记录仍保存在本机。'
        exit 0
    }
    if (Test-Ready) { Open-Library; exit 0 }
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { throw '没有找到 Node.js。请先安装 Node.js 24，再双击启动。' }
    $nodeVersion = (& $node.Source --version).Trim()
    if ([version]$nodeVersion.TrimStart('v') -lt [version]'22.13.0') { throw 'Node.js 版本过旧，请安装 Node.js 24。' }
    if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { throw '没有找到 Git。请先安装 Git 并登录 GitHub。' }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\vinext\dist\cli.js'))) {
        throw '首次使用需要安装依赖：请在项目目录执行一次 npm install，然后再次双击启动。'
    }
    # Refuse to start over unrelated listeners rather than terminating them.
    foreach ($port in @(3000, 4319)) {
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
            throw "端口 $port 已被占用，但学习库没有就绪。请检查之前的启动窗口，或稍后重试。"
        }
    }
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    $stdout = Join-Path $stateDir 'stdout.log'
    $stderr = Join-Path $stateDir 'stderr.log'
    $child = Start-Process -FilePath $node.Source -ArgumentList @('--experimental-strip-types', ('"' + $entryPath + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    @{processId=$child.Id;startedAt=$child.StartTime.ToUniversalTime().ToString('o');entryPath=$entryPath} | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
    $deadline = [DateTime]::UtcNow.AddSeconds(180)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Ready) { Open-Library; exit 0 }
        $child.Refresh()
        if ($child.HasExited) { throw "启动失败。请查看日志：`n$stderr`n$stdout" }
        Start-Sleep -Milliseconds 1000
    }
    throw "启动尚未完成。请稍后重试，或查看日志：`n$stderr`n$stdout"
} catch {
    Show-Notice $_.Exception.Message $true
    exit 1
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
