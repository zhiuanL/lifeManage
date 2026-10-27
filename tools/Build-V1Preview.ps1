param(
    [string]$EvidenceDirectory = ".verification/v1-20261022",
    [string]$OutputDirectory = "portable/v1-20261022"
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$evidence = [IO.Path]::GetFullPath((Join-Path $root $EvidenceDirectory))
$output = [IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))
$rootPrefix = $root.TrimEnd("\") + "\"
foreach ($path in @($evidence, $output)) {
    if (-not $path.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Evidence and output directories must be inside this workspace."
    }
}
if (Test-Path -LiteralPath $output) {
    throw "Output already exists. Use a new directory; existing programs are never replaced."
}
$report = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $evidence "full-scoped-queries.json") -Raw | ConvertFrom-Json
if (-not $report.success -or $report.numFailedTests -ne 0 -or $report.numPendingTests -ne 0) {
    throw "The final unified regression report must pass before packaging."
}
$isolatedConfig = Join-Path $evidence "tauri-isolated.json"
$isolated = Get-Content -Encoding UTF8 -LiteralPath $isolatedConfig -Raw | ConvertFrom-Json
if ($isolated.identifier -ne "com.lifeos.verification20261022" -or $isolated.bundle.active) {
    throw "The test configuration must use the isolated identifier and disable installers."
}
$web = [IO.Path]::GetFullPath((Join-Path (Join-Path $root "src-tauri") $isolated.build.frontendDist))
if ($web -ne (Join-Path $evidence "web") -or -not (Test-Path -LiteralPath (Join-Path $web "index.html"))) {
    throw "The configuration must embed the verified isolated frontend."
}
$executable = Join-Path $root "src-tauri/target/debug/lifeos.exe"
$originalLocation = Get-Location
Set-Location -LiteralPath $root
try {
    & pnpm tauri build --debug --no-bundle --ci --config $isolatedConfig
    if ($LASTEXITCODE -ne 0) { throw "Isolated preview build failed." }
    $testDirectory = Join-Path $output "test"
    $userDirectory = Join-Path $output "user-data"
    New-Item -ItemType Directory -Path $testDirectory, $userDirectory | Out-Null
    $testExecutable = Join-Path $testDirectory "LifeOS.exe"
    Copy-Item -LiteralPath $executable -Destination $testExecutable
    $formalConfig = Join-Path $output "tauri-user-preview.json"
    $formalConfiguration = @{
        productName = "LifeOS"
        identifier = "com.lifeos.app"
        build = @{ beforeBuildCommand = ""; frontendDist = $isolated.build.frontendDist }
        bundle = @{ active = $false }
    } | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText($formalConfig, $formalConfiguration, [Text.UTF8Encoding]::new($false))
    try {
        & pnpm tauri build --debug --no-bundle --ci --config $formalConfig
        if ($LASTEXITCODE -ne 0) { throw "User-data preview build failed." }
        Copy-Item -LiteralPath $executable -Destination (Join-Path $userDirectory "LifeOS.exe")
    } finally {
        # Existing isolated runners still point to target/debug/lifeos.exe.
        Copy-Item -LiteralPath $testExecutable -Destination $executable
    }
    foreach ($entry in @(
        @{ directory = $testDirectory; identifier = $isolated.identifier; dataMode = "isolated-test" },
        @{ directory = $userDirectory; identifier = "com.lifeos.app"; dataMode = "existing-user-data" }
    )) {
        $file = Join-Path $entry.directory "LifeOS.exe"
        @{
            product = "LifeOS"
            version = "0.1.0"
            schemaVersion = 52
            identifier = $entry.identifier
            dataMode = $entry.dataMode
            buildKind = "debug-preview"
            installer = $false
            signed = $false
            executable = "LifeOS.exe"
            sha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
            bytes = (Get-Item -LiteralPath $file).Length
            generatedAt = (Get-Date).ToString("o")
            regressionReport = $EvidenceDirectory + "/full-scoped-queries.json"
            regressionTestsPassed = $report.numPassedTests
        } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $entry.directory "manifest.json") -Encoding UTF8
    }
    Write-Output "Created two unsigned debug previews: $output"
    Write-Output "Neither application has been launched. User data and existing release files were not accessed."
} finally {
    Set-Location -LiteralPath $originalLocation.Path
}
