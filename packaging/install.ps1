# RawJobs installer for Windows. In PowerShell:
#
#   irm https://github.com/Tanmay-Mhatre/rawjobs/releases/latest/download/install.ps1 | iex
#
# What it does, without admin rights:
#   1. Downloads the latest RawJobs and the Node it runs on (from nodejs.org) into your user folder,
#      %LOCALAPPDATA%\RawJobs, and checks both against the release's signed checksums.
#   2. Starts RawJobs now and every time you log in, hidden, and restarts it if it stops.
#   3. Adds RawJobs to the Start menu and opens the dashboard: http://127.0.0.1:4317
# Running it again updates or repairs RawJobs. Your profile, tracking and scan data are never touched.
# Uninstall: & "$env:LOCALAPPDATA\RawJobs\bin\rawjobs.cmd" uninstall
#
# Settings (environment variables, all optional):
#   RAWJOBS_HOME          install somewhere else
#   RAWJOBS_RELEASE_URL   download from somewhere else (a folder with latest.json and the bundle)
#   RAWJOBS_NO_OPEN=1     don't open the browser at the end

& {
  $ErrorActionPreference = 'Stop'
  # The progress bar makes Invoke-WebRequest many times slower in Windows PowerShell.
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  # The release signing key's public half (packages/core/src/release.ts has the same).
  $PublicKey = 'MCowBQYDK2VwAyEAJFEm6OjkG2omc8RkYCVBBvcuGeIjl6MVvRy4eFX8Jtc='
  # Tests sign their own releases with a throwaway key.
  if ($env:RAWJOBS_PUBLIC_KEY) { $PublicKey = $env:RAWJOBS_PUBLIC_KEY }
  $Release = 'https://github.com/Tanmay-Mhatre/rawjobs/releases/latest/download'
  if ($env:RAWJOBS_RELEASE_URL) { $Release = $env:RAWJOBS_RELEASE_URL.TrimEnd('/') }
  $Dir = Join-Path $env:LOCALAPPDATA 'RawJobs'
  if ($env:RAWJOBS_HOME) { $Dir = $env:RAWJOBS_HOME }
  $Dir = [IO.Path]::GetFullPath($Dir)
  $TaskName = 'RawJobs Server'

  function Say([string]$Message) { Write-Host "  $Message" }
  function Fail([string]$Message) { throw "RawJobs couldn't be installed: $Message" }
  function Download([string]$Url, [string]$File) {
    try { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $File }
    catch { Fail "couldn't download $Url ($($_.Exception.Message))" }
  }
  function Sha256([string]$File) { (Get-FileHash -Algorithm SHA256 -LiteralPath $File).Hash.ToLowerInvariant() }
  function Unpack([string]$Archive, [string]$Into, [int]$Strip) {
    New-Item -ItemType Directory -Force -Path $Into | Out-Null
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path $tar)) { Fail 'this Windows has no tar.exe (Windows 10 version 1803 or newer is needed).' }
    $tarArgs = @('-xf', $Archive, '-C', $Into)
    if ($Strip -gt 0) { $tarArgs += "--strip-components=$Strip" }
    & $tar @tarArgs
    if ($LASTEXITCODE -ne 0) { Fail "couldn't unpack $Archive." }
  }

  Write-Host ''
  Write-Host 'Installing RawJobs' -ForegroundColor Cyan

  $arch = $env:PROCESSOR_ARCHITECTURE
  if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
  switch ($arch) {
    'AMD64' { $Platform = 'win-x64' }
    'ARM64' { $Platform = 'win-arm64' }
    default { Fail "RawJobs runs on 64-bit Windows (x64 or ARM64); this computer is $arch." }
  }

  $Temp = Join-Path ([IO.Path]::GetTempPath()) ("rawjobs-install-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $Temp | Out-Null
  try {
    # 1. What the latest release is, and its signature.
    $ManifestFile = Join-Path $Temp 'latest.json'
    $SigFile = Join-Path $Temp 'latest.json.sig'
    Download "$Release/latest.json" $ManifestFile
    Download "$Release/latest.json.sig" $SigFile
    $M = Get-Content -Raw -LiteralPath $ManifestFile | ConvertFrom-Json
    if ($M.app -ne 'rawjobs') { Fail "$Release/latest.json isn't a RawJobs release." }
    $Version = [string]$M.version
    $NodeVersion = [string]$M.nodeVersion
    # Checked before they name any path: the signature is checked only once Node is here (step 3).
    if ($NodeVersion -notmatch '^v\d+\.\d+\.\d+$') { Fail "$Release/latest.json names an unexpected Node version." }
    if ([string]$M.bundleFile -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { Fail "$Release/latest.json names an unexpected file." }
    $NodeName = "node-$NodeVersion-$Platform"
    Say "Version $Version, for $Platform"

    # 2. Node, from nodejs.org, checked against the release's checksum (kept when already there).
    $NodeDir = Join-Path $Dir "runtime\$NodeName"
    $Node = Join-Path $NodeDir 'node.exe'
    if (-not (Test-Path $Node)) {
      Say "Downloading Node $NodeVersion"
      $NodeZip = Join-Path $Temp "$NodeName.zip"
      Download "https://nodejs.org/dist/$NodeVersion/$NodeName.zip" $NodeZip
      if ((Sha256 $NodeZip) -ne [string]$M.nodeSha256.$Platform) { Fail "the Node download doesn't match the release's checksum." }
      $Unpacked = Join-Path $Temp 'node'
      Unpack $NodeZip $Unpacked 0
      New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'runtime') | Out-Null
      if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
      Move-Item (Join-Path $Unpacked $NodeName) $NodeDir
    }

    # 3. The release's signature, checked with that Node, before anything from the release runs.
    $Check = "const c=require('crypto'),f=require('fs');const k=c.createPublicKey({key:Buffer.from(process.argv[1],'base64'),format:'der',type:'spki'});process.exit(c.verify(null,f.readFileSync(process.argv[2]),k,Buffer.from(f.readFileSync(process.argv[3],'utf8').trim(),'base64'))?0:1)"
    & $Node -e $Check $PublicKey $ManifestFile $SigFile
    if ($LASTEXITCODE -ne 0) { Fail "the release's signature is not valid, so it wasn't installed." }

    # 4. RawJobs itself.
    Say 'Downloading RawJobs'
    $BundleFile = Join-Path $Temp ([string]$M.bundleFile)
    Download "$Release/$($M.bundleFile)" $BundleFile
    if ((Sha256 $BundleFile) -ne [string]$M.bundleSha256) { Fail "the download doesn't match the release's checksum." }
    $NewApp = Join-Path $Temp 'app'
    Unpack $BundleFile $NewApp 1

    # 5. Stop the running copy (if any), then put the new one in place.
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    $prefix = (Join-Path $Dir 'runtime') + '\'
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

    $Versions = Join-Path $Dir 'app\versions'
    New-Item -ItemType Directory -Force -Path $Versions | Out-Null
    $Target = Join-Path $Versions $Version
    if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
    Move-Item $NewApp $Target

    $CurrentFile = Join-Path $Dir 'app\current.txt'
    $Previous = $null
    if (Test-Path $CurrentFile) { $Previous = (Get-Content -Raw $CurrentFile).Trim() }
    if ($Previous -and $Previous -ne $Version -and (Test-Path (Join-Path $Versions $Previous))) {
      Set-Content -NoNewline -Encoding ascii -Path (Join-Path $Dir 'app\previous.txt') -Value $Previous
    }
    Set-Content -NoNewline -Encoding ascii -Path $CurrentFile -Value $Version
    Set-Content -NoNewline -Encoding ascii -Path (Join-Path $Dir 'runtime\current.txt') -Value $NodeName
    # Keep this version and the one before it (to go back to).
    Get-ChildItem $Versions -Directory | Where-Object { $_.Name -ne $Version -and $_.Name -ne $Previous } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

    $Bin = Join-Path $Dir 'bin'
    New-Item -ItemType Directory -Force -Path $Bin, (Join-Path $Dir 'logs') | Out-Null
    Copy-Item (Join-Path $Target 'bin\rawjobs.cmd') $Bin -Force
    Copy-Item (Join-Path $Target 'bin\rawjobs') $Bin -Force
    $Launcher = Join-Path $Bin 'rawjobs.cmd'
    $Log = Join-Path $Dir 'logs\server.log'

    # 6. Start now and at every log in, hidden; restart if it stops.
    Say 'Starting RawJobs (and at every log in)'
    $Hidden = "--headless `"$Launcher`" serve --log `"$Log`""
    $Me = "$env:USERDOMAIN\$env:USERNAME"
    try {
      $a = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument $Hidden -WorkingDirectory $Dir
      # At log in; and, because Task Scheduler only restarts a task that fails to start (not one whose
      # program stops later), also every minute from now on: ignored while RawJobs runs (IgnoreNew),
      # and it starts again within a minute if it ever stopped.
      $t = @(
        (New-ScheduledTaskTrigger -AtLogOn -User $Me),
        (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1))
      )
      $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
      $p = New-ScheduledTaskPrincipal -UserId $Me -LogonType Interactive -RunLevel Limited
      Register-ScheduledTask -TaskName $TaskName -Action $a -Trigger $t -Settings $s -Principal $p -Description 'RawJobs: the dashboard on http://127.0.0.1:4317, on this computer only.' -Force | Out-Null
      Start-ScheduledTask -TaskName $TaskName
    } catch {
      # Some managed computers don't allow scheduled tasks: start it from the Startup folder instead.
      Say "(Couldn't add a scheduled task: $($_.Exception.Message). Using the Startup folder instead.)"
      $ws = New-Object -ComObject WScript.Shell
      $startup = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'RawJobs.lnk'))
      $startup.TargetPath = Join-Path $env:SystemRoot 'System32\conhost.exe'
      $startup.Arguments = $Hidden
      $startup.WorkingDirectory = $Dir
      $startup.Save()
      Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\conhost.exe') -ArgumentList $Hidden -WorkingDirectory $Dir -WindowStyle Hidden
    }

    # 7. The Start menu shortcut: opens the dashboard (and starts RawJobs if it isn't running).
    $ws = New-Object -ComObject WScript.Shell
    $lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'RawJobs.lnk'))
    $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\conhost.exe'
    $lnk.Arguments = "--headless `"$Launcher`" open"
    $lnk.WorkingDirectory = $Dir
    $lnk.Description = 'Open the RawJobs dashboard'
    $lnk.Save()

    # 8. Wait for it to answer, then open the dashboard.
    $Url = $null
    for ($i = 0; $i -lt 60 -and -not $Url; $i++) {
      Start-Sleep -Milliseconds 500
      $port = 4317
      $state = Join-Path $Dir 'state.json'
      if (Test-Path $state) { try { $port = (Get-Content -Raw $state | ConvertFrom-Json).port } catch { } }
      try {
        $h = Invoke-RestMethod -UseBasicParsing -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2
        if ($h.ok -and $h.version -eq $Version) { $Url = "http://127.0.0.1:$port" }
      } catch { }
    }
    if (-not $Url) { Fail "RawJobs was installed but didn't start. See $Log." }

    Write-Host ''
    Write-Host "RawJobs $Version is running at $Url" -ForegroundColor Green
    Say "Installed in $Dir"
    Say 'It starts by itself when you log in. Open it any time from the Start menu: RawJobs.'
    Say 'To update or repair it, run the same line again.'
    Say "To uninstall: & `"$Launcher`" uninstall"
    Write-Host ''
    if (-not $env:RAWJOBS_NO_OPEN) { Start-Process $Url }
  } finally {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Temp
  }
}
