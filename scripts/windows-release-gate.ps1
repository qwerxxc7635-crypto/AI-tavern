param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [Parameter(Mandatory = $true)]
  [string]$EvidenceOutput
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$productName = 'Ember Tavern'
$appIdentifier = 'com.embertavern.windows'
$startedAt = [DateTime]::UtcNow.ToString('o')
$evidence = [ordered]@{
  schemaVersion = 1
  startedAt = $startedAt
  endedAt = $null
  success = $false
  environment = [ordered]@{
    ci = $env:CI
    runnerOs = $env:RUNNER_OS
    osVersion = [Environment]::OSVersion.VersionString
    architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  }
  installer = $null
  credentialManager = $null
  webView2 = $null
  install = $null
  launch = $null
  uninstall = $null
  error = $null
}

function Get-ProductRegistrations {
  @(Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -eq $productName })
}

function Get-QuotedExecutablePath([string]$commandLine) {
  if ($commandLine -match '^"([^"]+\.exe)"') {
    return $Matches[1]
  }
  if ($commandLine -match '^([^ ]+\.exe)') {
    return $Matches[1]
  }
  throw "Unable to extract an executable path from the uninstall registration."
}

function Get-WebView2Installations {
  $roots = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\EdgeWebView\Application')
  )
  @($roots |
      Where-Object { Test-Path -LiteralPath $_ -PathType Container } |
      ForEach-Object {
        Get-ChildItem -LiteralPath $_ -Directory -ErrorAction Stop |
          Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'msedgewebview2.exe') -PathType Leaf } |
          ForEach-Object {
            [ordered]@{
              version = $_.Name
              executable = (Join-Path $_.FullName 'msedgewebview2.exe')
            }
          }
      })
}

function Wait-Until([scriptblock]$Condition, [int]$TimeoutSeconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (& $Condition) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  return $false
}

$failure = $null
$appProcess = $null
$newWebViewProcesses = @()
$dataPath = $null

try {
  if ($env:CI -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'Windows release gate is restricted to an ephemeral CI Windows runner.'
  }
  if (-not [Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::Windows)) {
    throw 'Windows release gate requires the Windows operating system.'
  }
  if (@(Get-ProductRegistrations).Count -ne 0) {
    throw 'Refusing to replace a pre-existing Ember Tavern installation.'
  }

  $installer = (Resolve-Path -LiteralPath $InstallerPath -ErrorAction Stop).Path
  $installerFile = Get-Item -LiteralPath $installer -ErrorAction Stop
  if ($installerFile.Extension -ne '.exe' -or $installerFile.Name -notmatch 'setup') {
    throw 'The release gate requires an NSIS setup executable.'
  }
  $evidence.installer = [ordered]@{
    path = $installer
    bytes = $installerFile.Length
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash.ToLowerInvariant()
  }

  $credentialTest = Start-Process -FilePath 'cargo.exe' -ArgumentList @(
    'test',
    '-p',
    'ember-secure-secrets',
    'tests::operating_system_store_round_trip_and_idempotent_delete',
    '--',
    '--exact'
  ) -Wait -PassThru -NoNewWindow
  if ($credentialTest.ExitCode -ne 0) {
    throw "Windows Credential Manager contract test failed with exit code $($credentialTest.ExitCode)."
  }
  $evidence.credentialManager = [ordered]@{
    command = 'cargo test -p ember-secure-secrets tests::operating_system_store_round_trip_and_idempotent_delete -- --exact'
    exitCode = $credentialTest.ExitCode
    secretPersistedAfterTest = $false
  }

  $webViewInstallations = @(Get-WebView2Installations)
  if ($webViewInstallations.Count -eq 0) {
    throw 'Microsoft Edge WebView2 Runtime executable was not found.'
  }
  $webViewBefore = @((Get-Process -Name 'msedgewebview2' -ErrorAction SilentlyContinue).Id)

  $installProcess = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
  if ($installProcess.ExitCode -ne 0) {
    throw "NSIS installation failed with exit code $($installProcess.ExitCode)."
  }
  $registrations = @(Get-ProductRegistrations)
  if ($registrations.Count -ne 1) {
    throw "Expected one current-user uninstall registration, found $($registrations.Count)."
  }
  $registration = $registrations[0]
  $uninstaller = Get-QuotedExecutablePath ([string]$registration.UninstallString)
  if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
    throw 'Registered NSIS uninstaller does not exist.'
  }
  $installDirectory = Split-Path -Parent $uninstaller
  $application = Get-ChildItem -LiteralPath $installDirectory -Filter '*.exe' -File -Recurse |
    Where-Object { $_.FullName -ne $uninstaller -and $_.VersionInfo.ProductName -eq $productName } |
    Select-Object -First 1
  if ($null -eq $application) {
    throw 'Installed Ember Tavern application executable was not found.'
  }
  if ($application.VersionInfo.ProductVersion -notmatch '^0\.2\.0') {
    throw "Installed product version is not 0.2.0: $($application.VersionInfo.ProductVersion)"
  }
  $evidence.install = [ordered]@{
    exitCode = $installProcess.ExitCode
    scope = 'currentUser'
    registryPath = $registration.PSPath
    installDirectory = $installDirectory
    application = $application.FullName
    productVersion = $application.VersionInfo.ProductVersion
    uninstaller = $uninstaller
  }

  $roamingRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
  $dataPath = Join-Path $roamingRoot $appIdentifier
  if ((Split-Path -Parent $dataPath) -ne $roamingRoot -or (Split-Path -Leaf $dataPath) -ne $appIdentifier) {
    throw 'Resolved application data path failed its exact-root safety check.'
  }
  if (Test-Path -LiteralPath $dataPath) {
    throw 'Refusing to touch a pre-existing Ember Tavern application data directory.'
  }
  New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
  $sentinel = Join-Path $dataPath 'm9-t02-uninstall-preserves-data.sentinel'
  Set-Content -LiteralPath $sentinel -Value 'ephemeral-ci-only' -Encoding utf8NoBOM

  $launchStartedAt = [DateTime]::UtcNow
  $appProcess = Start-Process -FilePath $application.FullName -PassThru
  $webViewStarted = Wait-Until -TimeoutSeconds 30 -Condition {
    $script:newWebViewProcesses = @((Get-Process -Name 'msedgewebview2' -ErrorAction SilentlyContinue) |
        Where-Object { $_.Id -notin $webViewBefore })
    $script:newWebViewProcesses.Count -gt 0
  }
  Start-Sleep -Seconds 10
  $appProcess.Refresh()
  if ($appProcess.HasExited) {
    throw "Installed application exited during the launch soak with code $($appProcess.ExitCode)."
  }
  if (-not $webViewStarted) {
    throw 'Application launch did not create a new WebView2 process.'
  }
  $evidence.webView2 = [ordered]@{
    installations = $webViewInstallations
    newProcessIds = @($newWebViewProcesses.Id)
  }
  $evidence.launch = [ordered]@{
    processId = $appProcess.Id
    observedAliveSeconds = [Math]::Floor(([DateTime]::UtcNow - $launchStartedAt).TotalSeconds)
    webView2ProcessObserved = $true
  }

  Stop-Process -Id $appProcess.Id -Force -ErrorAction Stop
  $appProcess.WaitForExit()
  foreach ($webViewProcess in $newWebViewProcesses) {
    Stop-Process -Id $webViewProcess.Id -Force -ErrorAction SilentlyContinue
  }

  $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
  if ($uninstallProcess.ExitCode -ne 0) {
    throw "NSIS uninstallation failed with exit code $($uninstallProcess.ExitCode)."
  }
  $uninstalled = Wait-Until -TimeoutSeconds 30 -Condition {
    @(Get-ProductRegistrations).Count -eq 0 -and -not (Test-Path -LiteralPath $installDirectory)
  }
  if (-not $uninstalled) {
    throw 'Installation files or current-user uninstall registration remained after uninstall.'
  }
  if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf)) {
    throw 'NSIS uninstall removed application data that must be preserved.'
  }
  $evidence.uninstall = [ordered]@{
    exitCode = $uninstallProcess.ExitCode
    registrationRemoved = $true
    installDirectoryRemoved = $true
    applicationDataPreserved = $true
  }

  Remove-Item -LiteralPath $dataPath -Recurse -Force
  $dataPath = $null
  $evidence.success = $true
}
catch {
  $failure = $_
  $evidence.error = $_.Exception.Message
}
finally {
  if ($null -ne $appProcess -and -not $appProcess.HasExited) {
    Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
  }
  foreach ($webViewProcess in $newWebViewProcesses) {
    Stop-Process -Id $webViewProcess.Id -Force -ErrorAction SilentlyContinue
  }
  $evidence.endedAt = [DateTime]::UtcNow.ToString('o')
  $outputPath = [IO.Path]::GetFullPath($EvidenceOutput)
  New-Item -ItemType Directory -Path (Split-Path -Parent $outputPath) -Force | Out-Null
  $evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outputPath -Encoding utf8NoBOM
}

if ($null -ne $failure) {
  Write-Error $failure
  exit 1
}

Write-Output "Windows release gate passed; evidence: $EvidenceOutput"
