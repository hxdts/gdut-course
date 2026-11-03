# 广工课表

广东工业大学教务系统的安卓客户端。**直接调用学校接口取数据**，不是网页套壳。

> 作者：hxdts ｜ 包名：`com.gdut.course` ｜ 版本：**14.6** ｜ 支持 Android 6.0+

---

## 下载

- 最新安装包：[`gdut-course.apk`](https://ghproxy.net/https://raw.githubusercontent.com/hxdts/gdut-course-release/main/gdut-course.apk)
- 已经装过的话，打开 App 会自动提示更新，不用来这里下

---

## 功能

### 📅 课表

| 能力 | 说明 |
| --- | --- |
| 按周查看 | 周一到周日 7 列，节次 1-14 行，跨节的课自动合并成一个色块 |
| 课表浏览 | 一周一页：一屏显示周一到周五，页内横滑看周六日；滑到最左/最右还继续拉则切换上/下一周 |
| 显示日期 | 表头每天带日期（如「一 11-02」），今天高亮 |
| **直接选周** | 点顶部「第 N 周」弹出所有周次，**每个周次都标注该周的日期范围** |
| **按日期跳转** | 选周弹层里有日期选择器，选任意一天自动跳到所属教学周 |
| 切周动画 | 下一周从右滑入、上一周从左滑入 |
| 当前周自动定位 | 用本地时间 + 学期起始日期自己推算，**断网也能定位到本周** |
| 课程详情 | 点课程块，底部弹出：精确上课时间、地点、教师、周次、教学班、学时、人数 |
| 课程配色 | 5 套方案：默认 / 柔和 / 暖阳 / 清新 / 单色 |
| 离线可用 | 联网时自动把**整个学期每周**都缓存，断网可看任意一周 |

上课时间按广工官方作息表换算（来源：《2022年第十八次校长办公会议纪要》）：

| 节次 | 时间 | 节次 | 时间 |
| --- | --- | --- | --- |
| 第1节 | 8:30-9:15 | 第7节 | 15:30-16:15 |
| 第2节 | 9:20-10:05 | 第8节 | 16:30-17:15 |
| 第3节 | 10:25-11:10 | 第9节 | 17:20-18:05 |
| 第4节 | 11:15-12:00 | 第10节 | 18:30-19:15 |
| 第5节 | 13:50-14:35 | 第11节 | 19:20-20:05 |
| 第6节 | 14:40-15:25 | 第12节 | 20:10-20:55 |

### 🎨 外观

| 功能 | 说明 |
| --- | --- |
| **壁纸** | 从相册选图即用，留空处自动用同图模糊填充；可选「左右完整」或「上下完整」两种显示方式 |
| **主题色** | 12 种：蓝 / 血红 / 玫红 / 酒红 / 紫 / 绿 / 墨绿 / 橙 / 金 / 粉 / 青 / 靛 |
| **课程颜色** | 课表下方每门课右侧有颜色圆点，点它单独设置该课颜色；支持单课「默认」与「全部恢复默认」 |
| **课程透明度** | 0~100%，自定义滑块（**必须按住圆点拖动**，点击轨道无效） |
| **课表文字字号** | 周次 / 星期 / 日期 / 节数 / 课程 五类**各自独立**调节 70%~160%（圆点拖动） |
| **文字颜色** | 周次 / 星期 / 日期 / 节数 / 课程文字，五类独立设置，各 23 种颜色（含完整灰阶） |
| **文字描边** | 每类文字可单独选描边颜色（含「无」），引擎级 `-webkit-text-stroke` 渲染 |
| 恢复默认 | 一键回到「白字 + 黑边」 |
| **记住密码** | 登录一次后，重开 App 或会话过期都会自动登录 |
| **设置备份** | 外观设置备份到系统存储，覆盖更新后不丢失 |

### 📊 成绩与绩点

- 平均学分绩点（GPA）大卡片
- 加权平均分、总学分统计
- 全部课程成绩列表，按分数自动配色

### 🌐 英语四六级 · 💪 体测

分别走教务系统的「考级成绩」「体测成绩」接口。

### 🔄 自动更新

- **打开即检测**（登录页也检测），有新版本才弹窗
- **多源校验**：同时查多个源，取最高版本号，避免被单个 CDN 缓存骗成「已是最新」
- 支持**从手机本地文件更新**：选一个 apk 直接装

### 🔐 登录与隐私

- 学号 + 统一身份认证密码，复刻金智 CAS 协议（含密码 AES 加密）
- **不保存密码**，只保留学校下发的会话 Cookie
- 会话过期会主动提示重新登录
- 首次使用需同意《用户协议与隐私说明》

---

## 数据从哪来

全部来自学校教务系统 `jxfw.gdut.edu.cn`，App 没有自己的后端：

| 数据 | 接口 |
| --- | --- |
| 菜单 | `default!getMenu.action` |
| 当前学期 | `xsgrkbcx!xsgrkbMain.action` |
| **课表** | `xsgrkbcx!getKbRq.action?xnxqdm=<学期>&zc=<周次>` |
| 课程成绩 | `xskccjxx!getDataList.action` |
| 考级成绩 | `xskjcjxx!getDataList.action` |
| 体测成绩 | `xstccjxx!getDataList.action` |
| 登录 | `authserver.gdut.edu.cn/authserver/login`（CAS） |

App 不保存密码，所有请求都是你手机直接和学校服务器通信。

---

## 更新源（给维护者看）

`version.json`：

```json
{
  "versionCode": 137,
  "versionName": "14.6",
  "url": "https://ghproxy.net/https://raw.githubusercontent.com/hxdts/gdut-course-release/main/gdut-course.apk",
  "urlMirror": [
    "https://gh-proxy.com/https://raw.githubusercontent.com/hxdts/gdut-course-release/main/gdut-course.apk",
    "https://raw.githubusercontent.com/hxdts/gdut-course-release/main/gdut-course.apk"
  ],
  "notes": "这一版改了什么"
}
```

发新版流程：**覆盖上传 `gdut-course.apk`** → 改 `versionCode` / `versionName` / `notes`。

> **发版时必须用 commit 快照路径**：文件名是固定的 `gdut-course.apk`，而 ghproxy / gh-proxy 这类
> raw 代理会按路径强缓存（实测即使加 `?t=` 时间戳也无效）。所以 `version.json` 里的 `url`
> 要用 `<commit>/gdut-course.apk` 的快照地址——每版路径不同，缓存自然不会串。
>
> 流程：
> 1. 覆盖上传 `gdut-course.apk`
> 2. `gh api repos/hxdts/gdut-course-release/commits/main --jq .sha` 取到该 commit
> 3. 用这个 commit 拼出 url，写入 `version.json`

---

## 下载源可用性（2026-11 实测）

| 地址 | 结果 |
| --- | --- |
| `ghproxy.net` + raw | ✓ 正常 |
| `gh-proxy.com` + raw | ✓ 正常 |
| `raw.githubusercontent.com` | ✗ 国内多数网络不通 |
| `cdn.jsdelivr.net` / `gcore.jsdelivr.net` | ✗ 对固定文件名缓存旧版本 |

---

## 技术实现

- 纯 Java + WebView 前端，无第三方依赖
- 不用 Gradle，`aapt2 → javac → d8 → zipalign → apksigner` 手工构建
- 直接调用教务系统接口，不解析网页 DOM

---

## 免责

个人学习作品，与广东工业大学官方无任何隶属关系。数据仅供参考，与学校系统显示不一致时以学校系统为准。

学校系统改版可能导致功能暂时失效，届时请等待更新。






