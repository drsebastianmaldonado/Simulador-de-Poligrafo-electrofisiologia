param([int]$Port = 8420)
$root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root on http://localhost:$Port/"
$mime = @{ ".html"="text/html"; ".js"="application/javascript"; ".css"="text/css"; ".json"="application/json"; ".svg"="image/svg+xml" }
while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    $path = $req.Url.LocalPath
    if ($path -eq "/") { $path = "/simulador_ep_estimulacion_programada.html" }
    $filePath = Join-Path $root ($path.TrimStart("/"))
    if (Test-Path $filePath -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($filePath)
        $ct = $mime[$ext]
        if (-not $ct) { $ct = "application/octet-stream" }
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $res.ContentType = $ct
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $res.StatusCode = 404
    }
    $res.OutputStream.Close()
}
