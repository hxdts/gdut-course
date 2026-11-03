package com.gdut.course;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * 单 Activity 宿主：
 *   root        —— 承载自研 UI（assets/index.html）
 *   siteWebView —— 承载教务系统真实页面（网页兜底 / 数据嗅探）
 * 两者共享系统 CookieManager，登录态天然互通。
 */
public class MainActivity extends android.app.Activity {

    public static final String SITE = "https://jxfw.gdut.edu.cn/new/";
    public static final String AUTH = "https://authserver.gdut.edu.cn/";

    private FrameLayout root;
    private WebView ui;
    private WebView site;
    private android.widget.LinearLayout siteBar;
    private Bridge bridge;
    private SharedPreferences sp;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        sp = getSharedPreferences("app", Context.MODE_PRIVATE);

        Window w = getWindow();
        w.setStatusBarColor(Color.WHITE);
        w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        if (Build.VERSION.SDK_INT >= 26) {
            w.setNavigationBarColor(Color.WHITE);
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(0xFFF5F6FA);
        setContentView(root, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // ---- 教务站点 WebView（下层，网页兜底时显示）----
        // 注意：必须先创建 WebView，再使用 CookieManager，兼容部分定制系统
        site = buildWebView(false);
        site.setVisibility(View.GONE);
        root.addView(site, match());
        site.loadUrl("about:blank");
        site.addJavascriptInterface(new SiteBridge(this), "SiteNative");

        // ---- 自研 UI（上层）----
        ui = buildWebView(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(ui, true);
        root.addView(ui, match());
        ui.loadUrl("file:///android_asset/index.html");

        bridge = new Bridge(this, ui);
        ui.addJavascriptInterface(bridge, "Native");

        // ---- 站点页面的顶部返回条（最上层，保证永远能回到 App）----
        buildSiteBar();
        root.addView(siteBar, topBarParams());

        cookieAccept();
    }

    /** 站点页面顶部的「返回 App」条：不依赖系统返回键，也不依赖网页历史。 */
    private void buildSiteBar() {
        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (12 * d);

        siteBar = new android.widget.LinearLayout(this);
        siteBar.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        siteBar.setBackgroundColor(0xFF2F6BFF);
        siteBar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        siteBar.setPadding(pad, statusBarHeight() + (int) (10 * d), pad, (int) (10 * d));

        android.widget.TextView back = new android.widget.TextView(this);
        back.setText("‹  返回 App");
        back.setTextColor(0xFFFFFFFF);
        back.setTextSize(15);
        back.setPadding(0, (int) (4 * d), (int) (14 * d), (int) (4 * d));
        back.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                hideSite();
            }
        });
        siteBar.addView(back);

        android.widget.TextView title = new android.widget.TextView(this);
        title.setText("教务系统");
        title.setTextColor(0xCCFFFFFF);
        title.setTextSize(13);
        siteBar.addView(title);

        siteBar.setVisibility(View.GONE);
    }

    private FrameLayout.LayoutParams topBarParams() {
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.gravity = android.view.Gravity.TOP;
        return lp;
    }

    private int statusBarHeight() {
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? getResources().getDimensionPixelSize(id) : 0;
    }

    private FrameLayout.LayoutParams match() {
        return new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    private WebView uiWeb() {
        if (ui == null) ui = buildWebView(true);
        return ui;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView buildWebView(boolean isUi) {
        WebView wv = new WebView(this);
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        // 壁纸放在私有目录，需要允许 file:// 页面读取其它 file:// 资源
        try {
            s.setAllowFileAccessFromFileURLs(true);
            s.setAllowUniversalAccessFromFileURLs(true);
        } catch (Throwable ignored) {
        }
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setTextZoom(100);
        if (!isUi) {
            s.setUserAgentString(Net.UA.replace("Mobile ", "Mobile "));
        }
        wv.setBackgroundColor(isUi ? 0xFFF5F6FA : Color.WHITE);
        wv.setOverScrollMode(View.OVER_SCROLL_NEVER);
        wv.setVerticalScrollBarEnabled(isUi ? false : true);

        if (isUi) {
            wv.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                    String u = req.getUrl().toString();
                    if (u.startsWith("file:///android_asset/")) return false;
                    // 外链交给站点 WebView，避免弄丢自研 UI
                    openSite(u);
                    return true;
                }
            });
            wv.setWebChromeClient(new WebChromeClient());
        } else {
            wv.setWebViewClient(new SiteClient(this));
            wv.setWebChromeClient(new WebChromeClient());
        }
        return wv;
    }

    private void cookieAccept() {
        CookieManager.getInstance().setAcceptCookie(true);
        try {
            CookieManager.getInstance().setAcceptThirdPartyCookies(ui, true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(site, true);
        } catch (Throwable ignored) {
        }
    }

    /** 打开教务站点真实页面（网页兜底 / 手动浏览），自研 UI 让位。 */
    public void openSite(final String url) {
        runOnUiThread(new Runnable() {
            public void run() {
                ui.setVisibility(View.GONE);
                siteBar.setVisibility(View.VISIBLE);
                site.setVisibility(View.VISIBLE);
                site.loadUrl(url);
            }
        });
    }

    public void hideSite() {
        runOnUiThread(new Runnable() {
            public void run() {
                site.setVisibility(View.GONE);
                siteBar.setVisibility(View.GONE);
                ui.setVisibility(View.VISIBLE);
                // 回到 App 后让前端重新检查一次登录态（网页登录成功后可直接进主界面）
                evalUi("window.__onBackToApp && window.__onBackToApp()");
            }
        });
    }

    /**
     * 在站点 WebView 里同步执行 JS：Bridge 的调用线程本来就在后台，
     * 这里用闩锁等 UI 线程把结果算出来即可。
     */
    public String evalSiteSync(String js, long timeoutMs) {
        final java.util.concurrent.CountDownLatch latch =
                new java.util.concurrent.CountDownLatch(1);
        final String[] out = new String[1];
        runOnUiThread(new Runnable() {
            public void run() {
                if (site == null) {
                    latch.countDown();
                    return;
                }
                site.evaluateJavascript(js, new android.webkit.ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        out[0] = value;
                        latch.countDown();
                    }
                });
            }
        });
        try {
            latch.await(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) {
        }
        return innerJson(out[0]);
    }

    /** 取出 evaluateJavascript 结果里的真实 JSON 文本。 */
    private static String innerJson(String value) {
        if (value == null || "null".equals(value)) return "null";
        if (value.length() >= 2 && value.charAt(0) == '"') {
            try {
                Object inner = new org.json.JSONTokener(value).nextValue();
                return String.valueOf(inner);
            } catch (Throwable ignored) {
            }
        }
        return value;
    }

    /** 在站点 WebView 里执行 JS 并把结果回传 UI 层。 */
    public void evalSite(String js, final String cbId) {
        runOnUiThread(new Runnable() {
            public void run() {
                site.evaluateJavascript(js, new android.webkit.ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        bridge.emit(cbId, unwrap(value));
                    }
                });
            }
        });
    }

    /**
     * evaluateJavascript 回传的是「JS 返回值的 JSON 编码」，例如 "\"[1,2]\""。
     * 这里剥掉外层引号，并包成统一的 {ok,data} 结构给前端。
     */
    private static String unwrap(String value) {
        if (value == null || "null".equals(value)) {
            return "{\"ok\":false,\"err\":\"页面尚未就绪\"}";
        }
        if (value.length() >= 2 && value.charAt(0) == '"') {
            try {
                Object inner = new org.json.JSONTokener(value).nextValue();
                value = String.valueOf(inner);
            } catch (Throwable ignored) {
            }
        }
        return "{\"ok\":true,\"data\":" + value + "}";
    }

    public void evalUi(String js) {
        runOnUiThread(new Runnable() {
            public void run() {
                ui.evaluateJavascript(js, null);
            }
        });
    }

    /** 让站点 WebView 加载并注入嗅探钩子。 */
    public void sniff(final String url) {
        runOnUiThread(new Runnable() {
            public void run() {
                // 关键：不能用 GONE。GONE 的 WebView 不参与测量/布局，部分机型上
                // 页面脚本根本不执行，嗅探自然什么都抓不到。INVISIBLE 仍会布局。
                site.setVisibility(View.INVISIBLE);
                site.loadUrl(url);
            }
        });
    }

    public SharedPreferences prefs() {
        return sp;
    }

    /** 彻底清除登录态：Cookie、localStorage、WebView 缓存与表单。 */
    public void clearAllSession() {
        runOnUiThread(new Runnable() {
            public void run() {
                try {
                    CookieManager.getInstance().removeAllCookies(null);
                    CookieManager.getInstance().flush();
                } catch (Throwable ignored) {
                }
                try {
                    android.webkit.WebStorage.getInstance().deleteAllData();
                } catch (Throwable ignored) {
                }
                try {
                    if (site != null) {
                        site.clearCache(true);
                        site.clearHistory();
                        site.clearFormData();
                        site.reload();
                    }
                    if (ui != null) {
                        ui.clearCache(true);
                    }
                } catch (Throwable ignored) {
                }
                try {
                    sp.edit().clear().apply();
                } catch (Throwable ignored) {
                }
            }
        });
    }

    // ---------------- 本地安装包更新 ----------------

    private static final int REQ_PICK_APK = 1001;
    private static final int REQ_PICK_WALLPAPER = 1002;

    /** 打开系统相册选一张壁纸。 */
    public void pickWallpaper() {
        runOnUiThread(new Runnable() {
            public void run() {
                try {
                    android.content.Intent i = new android.content.Intent(
                            android.content.Intent.ACTION_GET_CONTENT);
                    i.setType("image/*");
                    i.addCategory(android.content.Intent.CATEGORY_OPENABLE);
                    startActivityForResult(
                            android.content.Intent.createChooser(i, "选择壁纸"), REQ_PICK_WALLPAPER);
                } catch (Throwable t) {
                    evalUi("window.toast && window.toast('无法打开相册')");
                }
            }
        });
    }

    /** 打开系统文件选择器，让用户挑一个 APK 来更新（不需要任何存储权限）。 */
    public void pickApk() {
        runOnUiThread(new Runnable() {
            public void run() {
                try {
                    android.content.Intent i = new android.content.Intent(
                            android.content.Intent.ACTION_GET_CONTENT);
                    i.setType("application/vnd.android.package-archive");
                    i.addCategory(android.content.Intent.CATEGORY_OPENABLE);
                    startActivityForResult(
                            android.content.Intent.createChooser(i, "选择更新包"), REQ_PICK_APK);
                } catch (Throwable t) {
                    try {
                        android.content.Intent i2 = new android.content.Intent(
                                android.content.Intent.ACTION_GET_CONTENT);
                        i2.setType("*/*");
                        startActivityForResult(
                                android.content.Intent.createChooser(i2, "选择更新包"), REQ_PICK_APK);
                    } catch (Throwable t2) {
                        evalUi("window.toast && window.toast('无法打开文件选择器')");
                    }
                }
            }
        });
    }

    @Override
    protected void onActivityResult(int req, int res, android.content.Intent data) {
        super.onActivityResult(req, res, data);
        if (res != RESULT_OK || data == null || data.getData() == null) {
            evalUi("window.toast && window.toast('已取消')");
            return;
        }
        final android.net.Uri uri = data.getData();

        if (req == REQ_PICK_WALLPAPER) {
            evalUi("window.toast && window.toast('正在处理图片…')");
            new Thread(new Runnable() {
                public void run() {
                    String p = copyImageToPrivate(uri);
                    if (p == null) {
                        evalUi("window.toast && window.toast('读取图片失败')");
                    } else {
                        int lum = luminanceOf(p);
                        evalUi("window.__onWallpaperPicked && window.__onWallpaperPicked("
                                + org.json.JSONObject.quote(p) + "," + lum + ")");
                    }
                }
            }).start();
            return;
        }

        if (req != REQ_PICK_APK) return;
        evalUi("window.toast && window.toast('正在读取安装包…')");
        new Thread(new Runnable() {
            public void run() {
                String path = copyApkToPrivate(uri);
                if (path == null) {
                    evalUi("window.toast && window.toast('读取安装包失败')");
                    return;
                }
                boolean launched = Update.install(MainActivity.this, path);
                evalUi(launched
                        ? "window.toast && window.toast('已调起安装，请按系统提示操作')"
                        : "window.toast && window.toast('安装包已保存，请到文件管理器安装')");
            }
        }).start();
    }

    /**
     * 图片"典型亮度"（0-255），用中位数而不是平均值。
     * 平均值容易被大片留白或大片纯黑带偏，中位数更接近肉眼感受的背景亮度。
     */
    private int luminanceOf(String fileUrl) {
        try {
            String path = fileUrl.startsWith("file://") ? fileUrl.substring(7) : fileUrl;
            android.graphics.BitmapFactory.Options opt = new android.graphics.BitmapFactory.Options();
            opt.inSampleSize = 4;
            android.graphics.Bitmap bmp = android.graphics.BitmapFactory.decodeFile(path, opt);
            if (bmp == null) return -1;
            int w = bmp.getWidth();
            int h = bmp.getHeight();
            if (w <= 0 || h <= 0) return -1;
            int stepX = Math.max(1, w / 48);
            int stepY = Math.max(1, h / 48);
            java.util.ArrayList<Integer> vals = new java.util.ArrayList<Integer>();
            for (int y = 0; y < h; y += stepY) {
                for (int x = 0; x < w; x += stepX) {
                    int c = bmp.getPixel(x, y);
                    int r = (c >> 16) & 0xFF;
                    int g = (c >> 8) & 0xFF;
                    int b = c & 0xFF;
                    vals.add((r * 299 + g * 587 + b * 114) / 1000);
                }
            }
            bmp.recycle();
            if (vals.isEmpty()) return -1;
            java.util.Collections.sort(vals);
            return vals.get(vals.size() / 2);
        } catch (Throwable t) {
            return -1;
        }
    }

    /** 把选中的图片复制到应用私有目录，返回 file:// 地址。 */
    /**
     * 对当前壁纸做变换：rotate(顺时针90°) / flipH(水平镜像) / flipV(垂直镜像) / crop(按9:16居中裁剪)
     * 返回新的 file:// 路径；失败返回 null。
     */
    public String transformWallpaper(String op) {
        try {
            java.io.File dir = new java.io.File(getFilesDir(), "wallpaper");
            java.io.File[] files = dir.listFiles();
            if (files == null || files.length == 0) return null;
            java.io.File src = files[0];
            android.graphics.Bitmap bmp =
                    android.graphics.BitmapFactory.decodeFile(src.getAbsolutePath());
            if (bmp == null) return null;

            android.graphics.Matrix m = new android.graphics.Matrix();
            boolean needMatrix = true;

            if ("rotate".equals(op)) {
                m.postRotate(90);
            } else if ("flipH".equals(op)) {
                m.postScale(-1, 1);
            } else if ("flipV".equals(op)) {
                m.postScale(1, -1);
            } else if ("crop".equals(op)) {
                needMatrix = false;
                int w = bmp.getWidth();
                int h = bmp.getHeight();
                float target = 9f / 16f;
                float cur = (float) w / (float) h;
                if (cur > target) {
                    int nw = Math.max(1, (int) (h * target));
                    int x = (w - nw) / 2;
                    bmp = android.graphics.Bitmap.createBitmap(bmp, x, 0, nw, h);
                } else if (cur < target) {
                    int nh = Math.max(1, (int) (w / target));
                    int y = (h - nh) / 2;
                    bmp = android.graphics.Bitmap.createBitmap(bmp, 0, y, w, nh);
                }
            } else {
                return null;
            }

            android.graphics.Bitmap outBmp = bmp;
            if (needMatrix) {
                outBmp = android.graphics.Bitmap.createBitmap(
                        bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
            }

            // 清掉旧文件
            java.io.File[] olds = dir.listFiles();
            if (olds != null) {
                for (java.io.File f2 : olds) f2.delete();
            }

            java.io.File dst = new java.io.File(dir,
                    "wallpaper_" + System.currentTimeMillis() + ".jpg");
            java.io.FileOutputStream fos = new java.io.FileOutputStream(dst);
            outBmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 92, fos);
            fos.flush();
            fos.close();

            if (outBmp != bmp && !outBmp.isRecycled()) outBmp.recycle();
            if (!bmp.isRecycled()) bmp.recycle();

            return "file://" + dst.getAbsolutePath();
        } catch (Throwable t) {
            return null;
        }
    }
    private String copyImageToPrivate(android.net.Uri uri) {
        java.io.InputStream in = null;
        java.io.FileOutputStream fos = null;
        try {
            String mime = null;
            try {
                mime = getContentResolver().getType(uri);
            } catch (Throwable ignored) {
            }
            String ext = ".jpg";
            if (mime != null) {
                if (mime.contains("png")) ext = ".png";
                else if (mime.contains("gif")) ext = ".gif";
                else if (mime.contains("webp")) ext = ".webp";
                else if (mime.contains("jpeg") || mime.contains("jpg")) ext = ".jpg";
            }
            java.io.File dir = new java.io.File(getFilesDir(), "wallpaper");
            if (!dir.exists()) dir.mkdirs();
            // 清掉旧文件，避免残留
            java.io.File[] olds = dir.listFiles();
            if (olds != null) {
                for (java.io.File f : olds) f.delete();
            }
            // 文件名必须每次都不同：同名文件会被 WebView 图片缓存命中，
            // 导致用户换壁纸后看到的还是上一张。
            java.io.File out = new java.io.File(dir,
                    "wallpaper_" + System.currentTimeMillis() + ext);
            in = getContentResolver().openInputStream(uri);
            if (in == null) return null;
            fos = new java.io.FileOutputStream(out);
            byte[] buf = new byte[32768];
            int n;
            while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
            fos.flush();
            return "file://" + out.getAbsolutePath();
        } catch (Throwable t) {
            return null;
        } finally {
            try {
                if (fos != null) fos.close();
            } catch (Throwable ignored) {
            }
            try {
                if (in != null) in.close();
            } catch (Throwable ignored) {
            }
        }
    }

    private String copyApkToPrivate(android.net.Uri uri) {
        java.io.InputStream in = null;
        java.io.FileOutputStream fos = null;
        try {
            java.io.File dir = getExternalFilesDir("update");
            if (dir == null) dir = new java.io.File(getFilesDir(), "update");
            if (!dir.exists()) dir.mkdirs();
            java.io.File out = new java.io.File(dir, "update.apk");
            in = getContentResolver().openInputStream(uri);
            if (in == null) return null;
            fos = new java.io.FileOutputStream(out);
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
            fos.flush();
            return out.getAbsolutePath();
        } catch (Throwable t) {
            return null;
        } finally {
            try {
                if (fos != null) fos.close();
            } catch (Throwable ignored) {
            }
            try {
                if (in != null) in.close();
            } catch (Throwable ignored) {
            }
        }
    }

    @Override
    public boolean onKeyDown(int code, KeyEvent e) {
        if (code == KeyEvent.KEYCODE_BACK) {
            if (site != null && site.getVisibility() == View.VISIBLE) {
                // 站点页面可见时，返回键一律先回 App，避免在网页历史里倒退不出来
                hideSite();
                return true;
            }
            if (ui != null && ui.canGoBack()) {
                ui.goBack();
                return true;
            }
        }
        return super.onKeyDown(code, e);
    }

    @Override
    protected void onDestroy() {
        try {
            if (ui != null) {
                root.removeView(ui);
                ui.destroy();
            }
            if (site != null) {
                root.removeView(site);
                site.destroy();
            }
        } catch (Throwable ignored) {
        }
        super.onDestroy();
    }
}

