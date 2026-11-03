package com.gdut.course;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 应用内更新。
 *
 * 更新源是一个 JSON（你自己放在任意能公网访问的地方即可）：
 * {
 *   "versionCode": 2,
 *   "versionName": "1.1",
 *   "url": "https://xxx/gdut-course.apk",
 *   "notes": "修复课表解析"
 * }
 */
public class Update {

    /**
     * 内置更新源（按实时性排序）。
     * GitHub API 是实时的；ghproxy 有分钟级缓存；jsDelivr 缓存最久但最稳定。
     * 多个源都查一遍，取 versionCode 最大的那个，避免单个源缓存导致"以为已是最新"。
     */
    public static final String[] DEFAULT_MANIFESTS = {
            "https://api.github.com/repos/hxdts/gdut-course-release/contents/version.json",
            "https://ghproxy.net/https://raw.githubusercontent.com/"
                    + "hxdts/gdut-course-release/main/version.json",
            "https://gcore.jsdelivr.net/gh/hxdts/gdut-course-release@main/version.json"
    };

    public static class Info {
        public boolean configured;
        public boolean hasUpdate;
        public int versionCode;
        public String versionName = "";
        public String url = "";
        public java.util.List<String> mirrors = new java.util.ArrayList<String>();
        public String notes = "";
        public String error = "";
    }

    public static Info check(String manifestUrl) {
        if (manifestUrl == null || manifestUrl.trim().isEmpty()) {
            Info info = new Info();
            info.configured = false;
            return info;
        }
        return checkAll(new String[]{manifestUrl});
    }

    /** 逐个源查询，返回 versionCode 最大的那份。 */
    public static Info checkAll(String[] urls) {
        Info best = null;
        String lastErr = "";
        for (String u : urls) {
            if (u == null || u.trim().isEmpty()) continue;
            Info info = checkOne(u.trim());
            if (!info.error.isEmpty()) {
                lastErr = info.error;
                continue;
            }
            if (best == null || info.versionCode > best.versionCode) best = info;
        }
        if (best == null) {
            Info fail = new Info();
            fail.configured = true;
            fail.error = lastErr.isEmpty() ? "所有更新源都连不上" : lastErr;
            return fail;
        }
        best.hasUpdate = best.versionCode > BuildConfigVersion.CODE;
        return best;
    }

    private static Info checkOne(String manifestUrl) {
        Info info = new Info();
        info.configured = true;
        try {
            boolean isApi = manifestUrl.contains("api.github.com");
            String u = manifestUrl;
            if (!isApi) {
                // 给可能有缓存的源加时间戳
                if (u.indexOf('?') < 0) {
                    u = u + "?t=" + System.currentTimeMillis();
                } else {
                    u = u + "&t=" + System.currentTimeMillis();
                }
            }
            // GitHub API 需要 raw 头才会返回文件原文
            String hdr = isApi
                    ? "Accept: application/vnd.github.raw\nUser-Agent: gdut-course"
                    : null;
            Net.Resp r = Net.follow("GET", u, null, 6, hdr);
            if (r.code != 200 || r.body == null) {
                info.error = "更新源返回 HTTP " + r.code;
                return info;
            }
            JSONObject o = new JSONObject(r.body);
            info.versionCode = o.optInt("versionCode", 0);
            info.versionName = o.optString("versionName", "");
            info.url = o.optString("url", "");
            info.notes = o.optString("notes", "");
            org.json.JSONArray ma = o.optJSONArray("urlMirror");
            if (ma != null) {
                for (int i = 0; i < ma.length(); i++) {
                    String s = ma.optString(i, "");
                    if (!s.isEmpty()) info.mirrors.add(s);
                }
            }
            if (info.versionCode > 0 && info.url.isEmpty()) {
                info.error = "更新源缺少 url 字段";
            }
            return info;
        } catch (Exception e) {
            info.error = "检查更新失败：" + (e.getMessage() == null
                    ? e.getClass().getSimpleName() : e.getMessage());
            return info;
        }
    }

    /**
     * 依次尝试多个下载地址，任何一个成功就返回文件路径。
     * jsDelivr 的不同节点在国内可达性差别很大，一个被重置就换下一个。
     */
    public static String download(Context ctx, String[] urls) {
        if (urls == null) return null;
        for (String u : urls) {
            if (u == null || u.trim().isEmpty()) continue;
            String p = downloadOne(ctx, u.trim());
            if (p != null) return p;
        }
        return null;
    }

    private static String downloadOne(Context ctx, String url) {
        try {
            File dir = ctx.getExternalFilesDir("update");
            if (dir == null) dir = new File(ctx.getFilesDir(), "update");
            if (!dir.exists() && !dir.mkdirs()) return null;
            File out = new File(dir, "update.apk");
            if (out.exists()) out.delete();

            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(20000);
            c.setReadTimeout(60000);
            c.setRequestProperty("User-Agent", Net.UA);
            if (c instanceof javax.net.ssl.HttpsURLConnection) {
                // 与 Net 保持一致：接受校园/自建服务器证书
                try {
                    ((javax.net.ssl.HttpsURLConnection) c).setSSLSocketFactory(
                            Net.looseSslFactoryPublic());
                } catch (Throwable ignored) {
                }
            }
            if (c.getResponseCode() != 200) return null;
            InputStream in = c.getInputStream();
            FileOutputStream fos = new FileOutputStream(out);
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
            fos.flush();
            fos.close();
            in.close();
            c.disconnect();
            return out.getAbsolutePath();
        } catch (Exception e) {
            return null;
        }
    }

    /** 调起系统安装器。 */
    public static boolean install(Context ctx, String apkPath) {
        try {
            File f = new File(apkPath);
            if (!f.exists()) return false;
            Uri uri = Uri.parse("content://com.gdut.course.files/" + f.getName());
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            if (Build.VERSION.SDK_INT >= 26) {
                // 需要用户在系统设置里允许"安装未知应用"
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            ctx.startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
