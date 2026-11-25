param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Arduino', 'ESP32')]
  [string]$Board,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^COM\d+$')]
  [string]$Port,

  [ValidatePattern('^COM\d+$')]
  [string]$HoldEspPort,

  [switch]$BuildOnly
)

$ErrorActionPreference = 'Stop'
$smartbedRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\Smartben'))
$source = Join-Path $smartbedRoot "$Board.cpp"
if (-not (Test-Path -LiteralPath $source)) { throw "ไม่พบไฟล์ $source" }

$project = Join-Path $env:TEMP "smartbed-upload-$($Board.ToLowerInvariant())"
$src = Join-Path $project 'src'
New-Item -ItemType Directory -Force -Path $src | Out-Null
Copy-Item -LiteralPath $source -Destination (Join-Path $src 'main.ino') -Force

if ($Board -eq 'Arduino') {
  $configuration = "[env:uno]`nplatform = atmelavr`nboard = uno`nframework = arduino`n"
  $environment = 'uno'
} else {
  $configuration = @'
[env:esp32]
platform = espressif32
board = esp32dev
framework = arduino
monitor_speed = 115200
lib_deps =
  knolleary/PubSubClient@2.8
  bblanchon/ArduinoJson@6.21.5
  olkal/HX711_ADC@1.2.12
'@
  $environment = 'esp32'
}

[System.IO.File]::WriteAllText((Join-Path $project 'platformio.ini'), $configuration, [System.Text.UTF8Encoding]::new($false))
$pio = Join-Path $env:USERPROFILE '.platformio\penv\Scripts\pio.exe'
if (-not (Test-Path -LiteralPath $pio)) { throw "ไม่พบ PlatformIO ที่ $pio" }

$arguments = @('run', '-d', $project, '-e', $environment)
if (-not $BuildOnly) { $arguments += @('-t', 'upload', '--upload-port', $Port) }
$heldEsp = $null
try {
  if ($Board -eq 'Arduino' -and -not $BuildOnly -and $HoldEspPort) {
    if ($HoldEspPort -eq $Port) { throw 'พอร์ต ESP32 และ Arduino ต้องต่างกัน' }
    $heldEsp = [System.IO.Ports.SerialPort]::new($HoldEspPort, 115200)
    $heldEsp.DtrEnable = $false
    $heldEsp.RtsEnable = $true
    $heldEsp.Open()
    Start-Sleep -Milliseconds 500
  }
  & $pio @arguments
  $result = $LASTEXITCODE
} finally {
  if ($heldEsp) {
    if ($heldEsp.IsOpen) { $heldEsp.Close() }
    $heldEsp.Dispose()
  }
}
exit $result
