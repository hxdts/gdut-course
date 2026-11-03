# 广工课表 · 源码

广东工业大学教务系统的安卓客户端源码。**直接调用学校接口取数据**，不是网页套壳。

- 安装包发布地址：[gdut-course-release](https://github.com/hxdts/gdut-course-release)
- 当前版本：**v5.8** ｜ 包名：`com.gdut.course` ｜ 支持 Android 6.0+

---

## 这个 App 做了什么

- **课表**：按周网格、显示每天日期、直接选周（带日期范围）、按日期跳转、点课程看详情（精确上课时间）
- **成绩绩点**：GPA、加权平均分、总学分、课程明细
- **四六级、体测**：走教务系统对应接口
- **外观**：壁纸（比例不匹配自动模糊填充）、12 种主题色、5 套课程配色、课程透明度、全局字体缩放、课表五类文字各自的字号与颜色与描边
- **离线**：联网时把整学期每周课表都缓存，断网可看任意一周、可定位本周
- **自动更新**：打开即检测，多源校验版本

---

## 为什么要开源

这个 App 需要用户输入**学号 + 教务系统密码**。

闭源 APK 只能靠信任，而代码公开后，任何人可以确认：

> 密码只 POST 给 `authserver.gdut.edu.cn`（学校官方认证），
> 本应用没有后端，不上传任何数据到第三方。

核心逻辑集中在 [`Cas.java`](app/src/com/gdut/course/Cas.java)（登录）和 [`GdutApi.java`](app/src/com/gdut/course/GdutApi.java)（取数据）两个文件，几十行就能看完。

---

## 目录结构

```
.
├── app/
│   ├── AndroidManifest.xml
│   ├── src/com/gdut/course/        Java 源码
│   │   ├── MainActivity.java       宿主 Activity（UI WebView + 站点 WebView）
│   │   ├── Bridge.java             JS ↔ Java 桥
│   │   ├── Cas.java                统一身份认证登录（金智 CAS + AES 密码加密）
│   │   ├── GdutApi.java            教务系统接口封装
│   │   ├── Net.java                HTTP 客户端（与 WebView 共享 Cookie）
│   │   ├── Update.java             应用内更新
│   │   ├── ApkProvider.java        安装包 ContentProvider
│   │   ├── Sniffer.java            网页模式下的网络嗅探
│   │   ├── SiteClient.java         站点 WebView 客户端
│   │   └── SiteBridge.java         站点侧 JS 桥
│   ├── res/                        图标、主题、网络安全配置
│   └── assets/                     前端（原生 HTML/CSS/JS，无框架）
│       ├── index.html
│       ├── style.css
│       └── app.js
├── build.ps1                       一键打包脚本
└── README.md
```

---

## 怎么编译

**不需要 Android Studio，不需要 Gradle。** 用 `aapt2 → javac → d8 → zipalign → apksigner` 手工打包。

### 1. 准备环境

| 依赖 | 说明 |
| --- | --- |
| JDK 17+ | 提供 `javac`、`keytool`、`java` |
| Android build-tools | 提供 `aapt2` / `d8` / `zipalign` / `apksigner` |
| Android platform | 提供 `android.jar` |

后两者可以从 [Android SDK 仓库](https://dl.google.com/android/repository/repository2-3.xml) 直接下 zip，不用装整个 SDK：

```
build-tools:  https://dl.google.com/android/repository/build-tools_r34-windows.zip
platform:     https://dl.google.com/android/repository/platform-35_r02.zip
```

解开后放到工程目录下，结构如下：

```
tools/sdk/
├── build-tools/<版本>/        （含 aapt2.exe、d8.bat、apksigner.bat、zipalign.exe）
└── platforms/
    └── android-35/android.jar
```

> `build.ps1` 会自动递归查找 `aapt2.exe` 和 `android.jar`，目录名不要求严格一致。

### 2. 打包

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

产物在 `out/广工课表.apk`。首次运行会自动生成签名证书 `tools/debug.keystore`。

### 3. Linux / macOS

`build.ps1` 是 PowerShell 脚本，Linux 上可以用 `pwsh` 跑，但需要把脚本里的 `.exe`、`.bat` 后缀去掉。核心命令顺序不变：

```bash
aapt2 compile --dir app/res -o build/res.zip
aapt2 link -o build/base.apk -I android.jar \
  --manifest app/AndroidManifest.xml -R build/res.zip \
  --auto-add-overlay --java build/gen -A app/assets
javac --release 11 -XDstringConcat=inline -cp android.jar -d build/classes $(find app/src build/gen -name '*.java')
d8 --lib android.jar --min-api 23 --output build/dex $(find build/classes -name '*.class')
# 把 build/dex/classes.dex 塞进 base.apk，然后
zipalign -f -p 4 in.apk aligned.apk
apksigner sign --ks debug.keystore --out out.apk aligned.apk
```

---

## 构建时踩过的坑（都写进脚本了）

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| d8 崩溃 `NullPointerException: String.length()` | javac 11 用 `invokedynamic` 做字符串拼接，老版 d8 处理不了 | javac 加 `-XDstringConcat=inline` |
| d8 处理 `NestHost` 属性崩溃 | build-tools 34 的 d8（8.2.2）太老 | 换用 **build-tools 36** 的 d8（8.10.9） |

---

## 接口说明

全部来自学校教务系统，App 没有自己的后端：

| 数据 | 接口 |
| --- | --- |
| 登录 | `authserver.gdut.edu.cn/authserver/login`（CAS） |
| 菜单 | `default!getMenu.action` |
| 当前学期 | `xsgrkbcx!xsgrkbMain.action` |
| 课表 | `xsgrkbcx!getKbRq.action?xnxqdm=<学期>&zc=<周次>` |
| 课程成绩 | `xskccjxx!getDataList.action` |
| 考级成绩 | `xskjcjxx!getDataList.action` |
| 体测成绩 | `xstccjxx!getDataList.action` |

登录协议实现见 `Cas.java`：先取 `execution` 与 `pwdEncryptSalt`，密码用金智的 AES-128-CBC/PKCS7 方案加密（明文 = 64 位随机串 + 密码），再 POST 提交。

---

## 免责

个人学习作品，与广东工业大学官方无任何隶属关系。

代码仅供学习参考。**请仅用于查询自己的数据，不要批量爬取或用于任何商业用途。** 使用本代码产生的一切后果由使用者自行承担。

学校系统改版可能导致功能失效。



