$root = "d:\repos\geospatial-aws-book"
$port = 8743
$url  = "http://localhost:$port/"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)
$listener.Start()
Write-Host "Serving $root at $url"

$mimeMap = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript'
    '.json' = 'application/json'
    '.svg'  = 'image/svg+xml'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.png'  = 'image/png'
    '.gif'  = 'image/gif'
    '.ico'  = 'image/x-icon'
    '.woff2'= 'font/woff2'
}

while ($listener.IsListening) {
    $ctx  = $listener.GetContext()
    $req  = $ctx.Request
    $resp = $ctx.Response
    $localPath = $req.Url.LocalPath -replace '/', '\'
    if ($localPath -eq '\') { $localPath = '\index.html' }
    $filePath = Join-Path $root $localPath.TrimStart('\')
    if (Test-Path $filePath -PathType Leaf) {
        $ext  = [IO.Path]::GetExtension($filePath).ToLower()
        $mime = if ($mimeMap[$ext]) { $mimeMap[$ext] } else { 'application/octet-stream' }
        $bytes = [IO.File]::ReadAllBytes($filePath)
        $resp.ContentType     = $mime
        $resp.ContentLength64 = $bytes.Length
        $resp.StatusCode      = 200
        $resp.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $resp.StatusCode = 404
        $msg = [Text.Encoding]::UTF8.GetBytes("404 Not Found: $localPath")
        $resp.ContentLength64 = $msg.Length
        $resp.OutputStream.Write($msg, 0, $msg.Length)
    }
    $resp.OutputStream.Close()
}
