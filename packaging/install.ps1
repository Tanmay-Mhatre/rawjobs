# RawJobs installer for Windows. In PowerShell:
#
#   irm https://github.com/Tanmay-Mhatre/rawjobs/releases/latest/download/install.ps1 | iex
#
# What it does, without admin rights:
#   1. Downloads the latest RawJobs and the Node it runs on (from nodejs.org) into your user folder,
#      %LOCALAPPDATA%\RawJobs, and checks both against the release's signed checksums.
#   2. Starts RawJobs now and every time you log in, hidden, and restarts it if it stops.
#   3. Adds RawJobs to the Start menu and the Desktop, and opens the dashboard: http://127.0.0.1:4317
# Running it again updates or repairs RawJobs. Your profile, tracking and scan data are never touched
# (and are backed up first, to backups\); a scan that's running gets time to finish.
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

  # How it looks: RawJobs' wordmark and live steps in a console that can show them, plain lines
  # everywhere else (a log, a pipe, NO_COLOR, an old console). This file stays ASCII, because
  # `irm | iex` can misread UTF-8 in Windows PowerShell, so the symbols are built from code points.
  $Fancy = $false
  try { $Fancy = $Host.UI.SupportsVirtualTerminal -and -not [Console]::IsOutputRedirected -and -not $env:NO_COLOR -and $env:TERM -ne 'dumb' } catch { }
  $UI = @{ Step = $null; Frame = 0; Width = 80 }
  if ($Fancy) {
    try { $UI.Width = [Console]::WindowWidth } catch { }
    $E = [char]27
    # brand-signal (#ff5a1f) for the logo's cursor and live progress only. Text keeps the console's
    # own colours, so it reads on light and dark themes alike.
    $Signal = "$E[38;2;255;90;31m"
    $Green = "$E[32m"; $Yellow = "$E[33m"; $Red = "$E[31m"; $Dim = "$E[90m"; $Bold = "$E[1m"; $Under = "$E[4m"; $Off = "$E[0m"
    $Block = [string][char]0x2588; $Shade = [string][char]0x2591; $Dot = [string][char]0x25CF
    if ($env:WT_SESSION) {
      # Windows Terminal's fonts have these; the classic console's Consolas doesn't.
      $Tick = [string][char]0x2713; $Cross = [string][char]0x2717
      $Spin = 0x280B, 0x2819, 0x2839, 0x2838, 0x283C, 0x2834, 0x2826, 0x2827, 0x2807, 0x280F | ForEach-Object { [string][char]$_ }
      $Corners = 0x256D, 0x256E, 0x2570, 0x256F | ForEach-Object { [string][char]$_ }
    } else {
      $Tick = [string][char]0x221A; $Cross = 'x'
      $Spin = '|', '/', '-', '\'
      $Corners = 0x250C, 0x2510, 0x2514, 0x2518 | ForEach-Object { [string][char]$_ }
    }
  }

  function Say([string]$Message) { Write-Host "  $Message" }
  function Line([string]$Text) { Write-Host -NoNewline "`r$E[2K$Text" }
  # The step on screen, with the next spinner frame (and how much of a download is here).
  function Draw([long]$Got = -1, [long]$Total = 0) {
    if (-not $UI.Step) { return }
    $UI.Frame++
    $s = "  $Signal$($Spin[$UI.Frame % $Spin.Count])$Off $($UI.Step)"
    if ($Total -gt 0) {
      $n = [Math]::Min(20, [int][Math]::Floor(20 * $Got / $Total))
      $s += "  $Signal$($Block * $n)$Dim$($Shade * (20 - $n))$Off $([int][Math]::Floor(100 * $Got / $Total))%  $($Dim){0:N1} / {1:N1} MB$Off" -f ($Got / 1MB), ($Total / 1MB)
    } elseif ($Got -ge 0) {
      $s += "  $($Dim){0:N1} MB$Off" -f ($Got / 1MB)
    }
    Line $s
  }
  # A step starts: a spinner line (a plain line without colours, or nothing with -Quiet).
  function Step([string]$Doing, [switch]$Quiet) {
    if (-not $Fancy) { if (-not $Quiet) { Say $Doing }; return }
    $UI.Step = $Doing
    Write-Host -NoNewline "$E[?25l"
    Draw
  }
  function Ok([string]$Did) {
    if (-not $Fancy) { return }
    Line "  $Green$Tick$Off $Did`n"
    Draw
  }
  # The step is finished: its line becomes a ticked one, or goes without $Did.
  function Finish([string]$Did) {
    if (-not $Fancy) { return }
    $UI.Step = $null
    if ($Did) { Ok $Did } else { Line '' }
    Write-Host -NoNewline "$E[?25h"
  }
  function Warn([string]$Message) {
    if (-not $Fancy) { Say "($Message)"; return }
    Line "  $Yellow! $Message$Off`n"
    Draw
  }
  function Fail([string]$Message) {
    if ($Fancy -and $UI.Step) { Line "  $Red$Cross $($UI.Step)$Off`n"; $UI.Step = $null }
    throw "RawJobs couldn't be installed: $Message"
  }
  function Banner {
    Write-Host ''
    if (-not $Fancy) { Write-Host 'Installing RawJobs' -ForegroundColor Cyan; return }
    if ($UI.Width -ge 60) {
      # The wordmark: lowercase rawjobs in the console's own colour, then the signal cursor.
      # # is a full block, ^ its top half, _ its bottom half.
      $rows = @(
        '                         ^^        ##',
        '##_#^ _####_ ##    ##    ## _####_ ##_##_ _#^^^^',
        '##^   ____## ## ## ##    ## ##  ## ##  ## ^####_',
        '##    ##  ## ## ## ##    ## ##  ## ##  ##     ##',
        '##    ^###^# ^##^^##^    ## ^####^ ##__#^ ^####^',
        '                      ^###^'
      )
      for ($i = 0; $i -lt $rows.Count; $i++) {
        $row = $rows[$i].Replace('#', $Block).Replace('^', [string][char]0x2580).Replace('_', [string][char]0x2584)
        $cursor = if ($i -ge 1 -and $i -le 4) { " $Signal$($Block * 3)$Off" } else { '' }
        Write-Host "  $Bold$row$Off$cursor"
      }
    } else {
      Write-Host "  ${Bold}rawjobs$Off$Signal$Block$Off"
    }
    Write-Host '  Jobs, straight from the source.'
  }
  # The last words, in a box when it fits. Each row: a one-character lead, a style, the text.
  function Box([object[]]$Rows) {
    $w = ($Rows | ForEach-Object { $_[2].Length } | Measure-Object -Maximum).Maximum
    if ($w + 10 -gt $UI.Width) {
      foreach ($r in $Rows) { Write-Host "  $($r[0]) $($r[1])$($r[2])$Off" }
      return
    }
    $h = [string][char]0x2500; $v = [string][char]0x2502
    Write-Host "  $Dim$($Corners[0])$($h * ($w + 6))$($Corners[1])$Off"
    foreach ($r in $Rows) { Write-Host "  $Dim$v$Off  $($r[0]) $($r[1])$($r[2])$Off$(' ' * ($w - $r[2].Length))  $Dim$v$Off" }
    Write-Host "  $Dim$($Corners[2])$($h * ($w + 6))$($Corners[3])$Off"
  }
  function Download([string]$Url, [string]$File) {
    try {
      if (-not ($Fancy -and $UI.Step)) { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $File; return }
      # Read it in chunks, to show how much is here.
      $res = [Net.WebRequest]::Create($Url).GetResponse()
      try {
        $in = $res.GetResponseStream()
        $out = [IO.File]::Create($File)
        try {
          $buf = New-Object byte[] 65536
          $got = 0
          $clock = [Diagnostics.Stopwatch]::StartNew()
          while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
            $out.Write($buf, 0, $n)
            $got += $n
            if ($clock.ElapsedMilliseconds -ge 80) { $clock.Restart(); Draw $got $res.ContentLength }
          }
        } finally { $out.Dispose(); $in.Dispose() }
      } finally { $res.Dispose() }
    } catch {
      $err = $_.Exception
      if ($err.InnerException) { $err = $err.InnerException }
      Fail "couldn't download $Url ($($err.Message))"
    }
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

  Banner

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
    if ($Fancy) { Write-Host "  $($Dim)Version $Version, for $Platform$Off"; Write-Host '' } else { Say "Version $Version, for $Platform" }

    # 2. Node, from nodejs.org, checked against the release's checksum (kept when already there).
    $NodeDir = Join-Path $Dir "runtime\$NodeName"
    $Node = Join-Path $NodeDir 'node.exe'
    if (-not (Test-Path $Node)) {
      Step "Downloading Node $NodeVersion"
      $NodeZip = Join-Path $Temp "$NodeName.zip"
      Download "https://nodejs.org/dist/$NodeVersion/$NodeName.zip" $NodeZip
      if ((Sha256 $NodeZip) -ne [string]$M.nodeSha256.$Platform) { Fail "the Node download doesn't match the release's checksum." }
      $Unpacked = Join-Path $Temp 'node'
      Unpack $NodeZip $Unpacked 0
      New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'runtime') | Out-Null
      if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
      Move-Item (Join-Path $Unpacked $NodeName) $NodeDir
      Finish "Downloaded Node $NodeVersion"
    }

    # 3. The release's signature, checked with that Node, before anything from the release runs.
    $Check = "const c=require('crypto'),f=require('fs');const k=c.createPublicKey({key:Buffer.from(process.argv[1],'base64'),format:'der',type:'spki'});process.exit(c.verify(null,f.readFileSync(process.argv[2]),k,Buffer.from(f.readFileSync(process.argv[3],'utf8').trim(),'base64'))?0:1)"
    & $Node -e $Check $PublicKey $ManifestFile $SigFile
    if ($LASTEXITCODE -ne 0) { Fail "the release's signature is not valid, so it wasn't installed." }
    Ok "Checked the release's signature"

    # 4. RawJobs itself.
    Step 'Downloading RawJobs'
    $BundleFile = Join-Path $Temp ([string]$M.bundleFile)
    Download "$Release/$($M.bundleFile)" $BundleFile
    if ((Sha256 $BundleFile) -ne [string]$M.bundleSha256) { Fail "the download doesn't match the release's checksum." }
    $NewApp = Join-Path $Temp 'app'
    Unpack $BundleFile $NewApp 1
    Finish "Downloaded RawJobs $Version"

    # 5. Let a running scan finish (or stop it so it can carry on later), back up your data, stop the
    #    running copy (if any), then put the new one in place.
    $DataDir = Join-Path $Dir 'data'
    $Lock = Join-Path $DataDir 'scan.lock'
    $LockPid = 0
    if ((Test-Path $Lock) -and [int]::TryParse((Get-Content -Raw $Lock).Trim(), [ref]$LockPid) -and (Get-Process -Id $LockPid -ErrorAction SilentlyContinue)) {
      Step 'A scan is running: waiting up to 10 minutes for it to finish'
      for ($i = 0; $i -lt 120 -and (Get-Process -Id $LockPid -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Seconds 5; Draw }
      if (Get-Process -Id $LockPid -ErrorAction SilentlyContinue) {
        # It saves its progress and stops; the next scan carries on from there.
        Finish
        Step 'Stopping the scan (the next scan carries on where it stopped)'
        New-Item -ItemType File -Force -Path (Join-Path $DataDir 'scan-stop') | Out-Null
        for ($i = 0; $i -lt 12 -and (Get-Process -Id $LockPid -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Seconds 5; Draw }
        Finish 'Stopped the scan (the next scan carries on where it stopped)'
      } else {
        Finish 'The scan finished'
      }
    }
    if (Test-Path (Join-Path $Dir 'app\current.txt')) {
      Step 'Backing up your data'
      $Backups = Join-Path $Dir 'backups'
      $B = Join-Path $Backups ((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ss-fffZ') + "-before-$Version")
      New-Item -ItemType Directory -Force -Path $B | Out-Null
      foreach ($f in 'rawjobs.config.local.yaml', 'rawjobs.config.local.backup.yaml', 'profile') {
        $p = Join-Path $Dir $f
        if (Test-Path $p) { Copy-Item -Recurse -Force $p $B }
      }
      if (Test-Path $DataDir) {
        # Not what downloads again (caches, the company directory), nor a scan's own flags.
        New-Item -ItemType Directory -Force -Path (Join-Path $B 'data') | Out-Null
        Get-ChildItem $DataDir | Where-Object { $_.Name -notin 'cache', 'catalog', 'scan.lock', 'scan-stop', 'scan-notify' } | Copy-Item -Recurse -Force -Destination (Join-Path $B 'data')
        $Additions = Join-Path $DataDir 'catalog\additions.json'
        if (Test-Path $Additions) { New-Item -ItemType Directory -Force -Path (Join-Path $B 'data\catalog') | Out-Null; Copy-Item $Additions (Join-Path $B 'data\catalog') }
      }
      # The last three backups are kept.
      Get-ChildItem $Backups -Directory | Sort-Object Name | Select-Object -SkipLast 3 | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
      Finish 'Backed up your data'
    }

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
    Step 'Starting RawJobs (and at every log in)'
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
      # Priority 5: normal, so the dashboard stays quick (Task Scheduler's default, 7, is below normal).
      $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -Priority 5
      $p = New-ScheduledTaskPrincipal -UserId $Me -LogonType Interactive -RunLevel Limited
      Register-ScheduledTask -TaskName $TaskName -Action $a -Trigger $t -Settings $s -Principal $p -Description 'RawJobs: the dashboard on http://127.0.0.1:4317, on this computer only.' -Force | Out-Null
      Start-ScheduledTask -TaskName $TaskName
    } catch {
      # Some managed computers don't allow scheduled tasks: start it from the Startup folder instead.
      Warn "Couldn't add a scheduled task: $($_.Exception.Message). Using the Startup folder instead."
      $ws = New-Object -ComObject WScript.Shell
      $startup = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'RawJobs.lnk'))
      $startup.TargetPath = Join-Path $env:SystemRoot 'System32\conhost.exe'
      $startup.Arguments = $Hidden
      $startup.WorkingDirectory = $Dir
      $startup.Save()
      Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\conhost.exe') -ArgumentList $Hidden -WorkingDirectory $Dir -WindowStyle Hidden
    }

    # 7. The shortcuts, in the Start menu and on the Desktop, with RawJobs' icon: they open the
    #    dashboard on whatever port it's on (and start RawJobs if it isn't running).
    & $Launcher shortcuts --desktop | Out-Null
    if ($LASTEXITCODE -ne 0) { Warn "Couldn't add the RawJobs shortcuts; open http://127.0.0.1:4317 instead." } else { Ok 'Added RawJobs to the Start menu and the Desktop' }

    # 8. Wait for it to answer, then open the dashboard.
    $Url = $null
    for ($i = 0; $i -lt 60 -and -not $Url; $i++) {
      Start-Sleep -Milliseconds 500
      Draw
      $port = 4317
      $state = Join-Path $Dir 'state.json'
      if (Test-Path $state) { try { $port = (Get-Content -Raw $state | ConvertFrom-Json).port } catch { } }
      try {
        $h = Invoke-RestMethod -UseBasicParsing -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2
        if ($h.ok -and $h.version -eq $Version) { $Url = "http://127.0.0.1:$port" }
      } catch { }
    }
    if (-not $Url) { Fail "RawJobs was installed but didn't start. See $Log." }
    Finish 'Started RawJobs (and at every log in)'

    Write-Host ''
    if ($Fancy) {
      Box @(
        @("$Green$Dot$Off", $Bold, "RawJobs $Version is running"),
        @(' ', $Under, $Url),
        @(' ', '', ''),
        @(' ', '', "Installed in $Dir"),
        @(' ', '', 'It starts by itself when you log in. Open it any time:'),
        @(' ', '', 'RawJobs, on the Desktop or in the Start menu.'),
        @(' ', '', 'To update or repair it, run the same line again.'),
        @(' ', '', "To uninstall: & `"$Launcher`" uninstall")
      )
    } else {
      Write-Host "RawJobs $Version is running at $Url" -ForegroundColor Green
      Say "Installed in $Dir"
      Say 'It starts by itself when you log in. Open it any time: RawJobs, on the Desktop or in the Start menu.'
      Say 'To update or repair it, run the same line again.'
      Say "To uninstall: & `"$Launcher`" uninstall"
    }
    Write-Host ''
    if (-not $env:RAWJOBS_NO_OPEN) { Start-Process $Url }
  } finally {
    if ($Fancy) {
      # A step that stopped with an error (one Fail didn't raise) still gets its cross.
      if ($UI.Step) { Line "  $Red$Cross $($UI.Step)$Off`n" }
      Write-Host -NoNewline "$E[?25h"
    }
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Temp
  }
}
