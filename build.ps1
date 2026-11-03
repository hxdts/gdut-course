# 广工课表 —— 免 Gradle 一键打包
#
# 依赖：
#   1. JDK 17+（javac / keytool）
#   2. Android SDK 的两样东西（不需要 Gradle、不需要 Android Studio）：
#        - build-tools（提供 aapt2 / d8 / zipalign / apksigner）
#        - platforms 里的 android.jar
#
# 目录约定（把 SDK 放到工程下的 tools/sdk 里，或者改下面的 $sdkRoot）：
#   tools/sdk/build-tools/34.0.0/...
#   tools/sdk/platforms/android-35/android.jar
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\build.ps1

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }

$sdkRoot = "$root\tools\sdk"

# ---------- 自动定位构建工具 ----------
if (!(Test-Path $sdkRoot)) {
    throw "找不到 $sdkRoot`n请把 Android SDK 的 build-tools 和 platforms 放进去（详见 README）"
}

$btDir = Get-ChildItem $sdkRoot -Directory -Filter "build-tools*" -ErrorAction SilentlyContinue |
         Sort-Object Name -Descending | Select-Object -First 1
if (-not $btDir) {
    $btDir = Get-ChildItem $sdkRoot -Recurse -Directory -ErrorAction SilentlyContinue |
             Where-Object { Test-Path (Join-Path $_.FullName 'aapt2.exe') } |
             Sort-Object FullName -Descending | Select-Object -First 1
}
if (-not $btDir) { throw "找不到 build-tools（需要 aapt2.exe / d8.bat / apksigner.bat / zipalign.exe）" }
$bt = $btDir.FullName

$jarFile = Get-ChildItem $sdkRoot -Recurse -Filter "android.jar" -ErrorAction SilentlyContinue |
           Select-Object -First 1
if (-not $jarFile) { throw "找不到 android.jar（需要 platforms/android-XX/android.jar）" }
$jar = $jarFile.FullName

$app   = "$root\app"
$build = "$root\build"
$out   = "$root\out"

Write-Host "构建目录: $root"
Write-Host "build-tools: $bt"
Write-Host "android.jar: $jar"
Write-Host ""

Write-Host "==> 清理" -ForegroundColor Cyan
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Force -Path $build, "$build\gen", "$build\classes", "$build\dex" | Out-Null
if (!(Test-Path $out)) { New-Item -ItemType Directory -Force -Path $out | Out-Null }

Write-Host "==> 1/6 编译资源 (aapt2)" -ForegroundColor Cyan
& "$bt\aapt2.exe" compile --dir "$app\res" -o "$build\res.zip"
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile 失败" }

Write-Host "==> 2/6 链接资源 (aapt2 link)" -ForegroundColor Cyan
& "$bt\aapt2.exe" link `
    -o "$build\base.apk" `
    -I $jar `
    --manifest "$app\AndroidManifest.xml" `
    -R "$build\res.zip" `
    --auto-add-overlay `
    --java "$build\gen" `
    -A "$app\assets" `
    --min-sdk-version 23 `
    --target-sdk-version 35
if ($LASTEXITCODE -ne 0) { throw "aapt2 link 失败" }

Write-Host "==> 3/6 编译 Java (javac)" -ForegroundColor Cyan
$srcs = @()
$srcs += Get-ChildItem "$app\src" -Recurse -Filter *.java | ForEach-Object { $_.FullName }
if (Test-Path "$build\gen") {
    $srcs += Get-ChildItem "$build\gen" -Recurse -Filter *.java | ForEach-Object { $_.FullName }
}
# -XDstringConcat=inline 必须加：否则 javac 11 会用 invokedynamic 做字符串拼接，
# 老版本 d8 处理时会直接崩溃
& javac --release 11 -XDstringConcat=inline -encoding UTF-8 -nowarn -cp $jar -d "$build\classes" $srcs
if ($LASTEXITCODE -ne 0) { throw "javac 编译失败" }

Write-Host "==> 4/6 转换 dex (d8)" -ForegroundColor Cyan
$classes = Get-ChildItem "$build\classes" -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& "$bt\d8.bat" --lib $jar --min-api 23 --output "$build\dex" $classes
if ($LASTEXITCODE -ne 0) { throw "d8 失败" }

Write-Host "==> 5/6 组装 APK" -ForegroundColor Cyan
$unsigned = "$build\app-unsigned.apk"
Copy-Item "$build\base.apk" $unsigned -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($unsigned, 'Update')
$old = $zip.GetEntry('classes.dex')
if ($old) { $old.Delete() }
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $zip, "$build\dex\classes.dex", "classes.dex",
    [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
$zip.Dispose()

& "$bt\zipalign.exe" -f -p 4 $unsigned "$build\app-aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "zipalign 失败" }

Write-Host "==> 6/6 签名 (apksigner)" -ForegroundColor Cyan
$ks = "$root\tools\debug.keystore"
if (!(Test-Path $ks)) {
    & keytool -genkeypair -v -keystore $ks -alias gdut -storepass android123 `
        -keypass android123 -keyalg RSA -keysize 2048 -validity 10000 `
        -dname "CN=GDUT Course, OU=Student, O=GDUT, L=Guangzhou, ST=Guangdong, C=CN"
    if ($LASTEXITCODE -ne 0) { throw "生成签名证书失败" }
}

$final = "$out\广工课表.apk"
if (Test-Path $final) { Remove-Item $final -Force }
& "$bt\apksigner.bat" sign --ks $ks --ks-key-alias gdut `
    --ks-pass pass:android123 --key-pass pass:android123 `
    --v1-signing-enabled true --v2-signing-enabled true `
    --out $final "$build\app-aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "apksigner 签名失败" }

& "$bt\apksigner.bat" verify --print-certs $final | Select-Object -First 6

$fi = Get-Item $final
Write-Host ""
Write-Host ("构建完成: {0}  ({1:N2} MB)" -f $fi.FullName, ($fi.Length / 1MB)) -ForegroundColor Green
