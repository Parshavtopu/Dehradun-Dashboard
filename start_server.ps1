<#
.SYNOPSIS
    Starts a local HTTP server for the Dehradun GIS Dashboard & Layer Studio.
#>

param (
    [int]$Port = 8080
)

$webRoot = $PSScriptRoot

$prefix = "http://localhost:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Warning "Port $Port is in use. Trying port 8085..."
    $Port = 8085
    $prefix = "http://localhost:$Port/"
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add($prefix)
    $listener.Start()
}

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  DEHRADUN GIS DASHBOARD & LAYER STUDIO SERVER" -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Main Dashboard: $prefix" -ForegroundColor Green
Write-Host "  Layer Studio:   ${prefix}admin.html" -ForegroundColor Green
Write-Host "  Web root:       $webRoot" -ForegroundColor White
Write-Host "=================================================================" -ForegroundColor Cyan

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css"
    ".js"   = "application/javascript"
    ".json" = "application/json"
    ".geojson" = "application/json"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".tif"  = "image/tiff"
    ".tiff" = "image/tiff"
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        [System.Threading.Tasks.Task]::Run([Action]{
            try {
                $request = $context.Request
                $response = $context.Response
                $response.KeepAlive = $false

                $urlPath = $request.Url.LocalPath.TrimStart('/')
                if ([string]::IsNullOrEmpty($urlPath) -or $urlPath -eq "/") {
                    $urlPath = "index.html"
                }

                # API Routes
                if ($urlPath -eq "api/incoming") {
                    $incomingDir = Join-Path $webRoot "data\incoming"
                    $fileList = @()
                    if (Test-Path $incomingDir) {
                        Get-ChildItem -Path $incomingDir -File | Where-Object { $_.Name -ne "README.txt" } | ForEach-Object {
                            $sizeKb = [Math]::Round($_.Length / 1024, 1)
                            $fileList += @{
                                name = $_.Name
                                path = "data/incoming/" + $_.Name
                                size = "$sizeKb KB"
                            }
                        }
                    }
                    $json = if ($fileList.Count -eq 0) { "[]" } else { 
                        $raw = $fileList | ConvertTo-Json -Depth 3
                        if ($fileList.Count -eq 1) { "[$raw]" } else { $raw }
                    }
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $response.ContentType = "application/json"
                    $response.AddHeader("Access-Control-Allow-Origin", "*")
                    $response.ContentLength64 = $bytes.Length
                    if ($request.HttpMethod -ne "HEAD") {
                        $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    }
                    $response.StatusCode = 200
                    $response.OutputStream.Close()
                    return
                }

                if ($urlPath -eq "api/save-manifest" -and $request.HttpMethod -eq "POST") {
                    $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
                    $body = $reader.ReadToEnd()
                    $payload = $body | ConvertFrom-Json
                    if ($payload.vectors) {
                        $vecJson = $payload.vectors | ConvertTo-Json -Depth 6
                        [System.IO.File]::WriteAllText((Join-Path $webRoot "data\vector_manifest.json"), $vecJson, [System.Text.Encoding]::UTF8)
                    }
                    if ($payload.rasters) {
                        $rastJson = $payload.rasters | ConvertTo-Json -Depth 6
                        [System.IO.File]::WriteAllText((Join-Path $webRoot "data\raster_manifest.json"), $rastJson, [System.Text.Encoding]::UTF8)
                    }
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"status":"ok"}')
                    $response.ContentType = "application/json"
                    $response.AddHeader("Access-Control-Allow-Origin", "*")
                    $response.ContentLength64 = $bytes.Length
                    if ($request.HttpMethod -ne "HEAD") {
                        $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    }
                    $response.StatusCode = 200
                    $response.OutputStream.Close()
                    return
                }

                if ($urlPath -eq "api/git-push" -and $request.HttpMethod -eq "POST") {
                    $gitExe = "C:\Users\krish\AppData\Local\GitHubDesktop\app-3.6.11\resources\app\git\cmd\git.exe"
                    if (Test-Path $gitExe) {
                        & $gitExe -C $webRoot add -A
                        & $gitExe -C $webRoot commit -m "Update layer catalog and visual styles via Studio"
                        & $gitExe -C $webRoot push origin main
                    }
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"status":"deployed"}')
                    $response.ContentType = "application/json"
                    $response.AddHeader("Access-Control-Allow-Origin", "*")
                    $response.ContentLength64 = $bytes.Length
                    if ($request.HttpMethod -ne "HEAD") {
                        $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    }
                    $response.StatusCode = 200
                    $response.OutputStream.Close()
                    return
                }

                # Static File Serving
                $filePath = Join-Path $webRoot ($urlPath -replace '/', '\')

                if (Test-Path $filePath -PathType Leaf) {
                    $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                    $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }

                    $bytes = [System.IO.File]::ReadAllBytes($filePath)
                    $response.ContentType = $contentType
                    $response.ContentLength64 = $bytes.Length
                    $response.AddHeader("Access-Control-Allow-Origin", "*")
                    if ($request.HttpMethod -ne "HEAD") {
                        $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    }
                    $response.StatusCode = 200
                } else {
                    $response.StatusCode = 404
                    $errBytes = [System.Text.Encoding]::UTF8.GetBytes("404 - File Not Found: $urlPath")
                    $response.ContentLength64 = $errBytes.Length
                    if ($request.HttpMethod -ne "HEAD") {
                        $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
                    }
                }

                $response.OutputStream.Close()
            } catch {
                # Ignore connection resets
            }
        })
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
