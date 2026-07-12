param(
    [string]$OutputDirectory = 'dist'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifestPath = Join-Path $root 'manifest.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$outputRoot = Join-Path $root $OutputDirectory
$zipName = "PortalAtlas-v$($manifest.version).zip"
$zipPath = Join-Path $outputRoot $zipName
$staging = Join-Path ([System.IO.Path]::GetTempPath()) "portal-atlas-$([guid]::NewGuid())"
$packageEntries = @('manifest.json', 'index.html', 'css', 'icons', 'js', 'lang')

function Test-GitIgnored([string]$RelativePath) {
    $gitPath = $RelativePath.Replace('\', '/')
    & git -C $root check-ignore --quiet -- $gitPath
    return $LASTEXITCODE -eq 0
}

try {
    New-Item -ItemType Directory -Path $staging | Out-Null
    New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

    foreach ($entry in $packageEntries) {
        $source = Join-Path $root $entry
        if (-not (Test-Path -LiteralPath $source)) {
            throw "Required package entry is missing: $entry"
        }

        $files = if ((Get-Item -LiteralPath $source).PSIsContainer) {
            Get-ChildItem -LiteralPath $source -Recurse -File
        } else {
            Get-Item -LiteralPath $source
        }

        foreach ($file in $files) {
            $relative = $file.FullName.Substring($root.Length).TrimStart('\', '/')
            if (Test-GitIgnored $relative) {
                Write-Verbose "Excluded by .gitignore: $relative"
                continue
            }

            $destination = Join-Path $staging $relative
            $destinationDirectory = Split-Path -Parent $destination
            New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
            Copy-Item -LiteralPath $file.FullName -Destination $destination
        }
    }

    foreach ($required in @('manifest.json', 'index.html', 'js/config/default.js')) {
        if (-not (Test-Path -LiteralPath (Join-Path $staging $required))) {
            throw "Required runtime file was not packaged: $required"
        }
    }

    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath
    }
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -CompressionLevel Optimal

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $entryNames = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
        foreach ($required in @('manifest.json', 'index.html', 'js/config/default.js')) {
            if ($entryNames -notcontains $required) {
                throw "Generated ZIP is invalid; missing $required"
            }
        }
        if ($entryNames | Where-Object { $_ -match '(^|/)default\.affiliate\.js$' }) {
            throw 'Generated ZIP contains the ignored affiliate defaults file'
        }
    } finally {
        $archive.Dispose()
    }

    Write-Output $zipPath
} finally {
    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
}
