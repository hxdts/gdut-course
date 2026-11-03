package com.gdut.course;

import android.content.SharedPreferences;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.util.Iterator;
import java.util.Map;

/**
 * JS <-> Java 桥。前端通过 Native.call(reqId, action, paramsJson) 发起异步调用，
 * Java 完成后执行 window.__cb(reqId, resultJson)。
 */
public class Bridge {

    private final MainActivity act;
    private final WebView ui;

    public Bridge(MainActivity act, WebView ui) {
        this.act = act;
        this.ui = ui;
    }

    @JavascriptInterface
    public void call(final String reqId, final String action, final String params) {
        new Thread(new Runnable() {
            public void run() {
                String out;
                try {
                    out = handle(action, params == null ? "{}" : params);
                } catch (Throwable t) {
                    out = err(t.getClass().getSimpleName() + ": " + t.getMessage());
                }
                emit(reqId, out);
            }
        }).start();
    }

    /** 由 Java 主动推事件给前端。 */
    public void emit(final String reqId, final String json) {
        final String js = "window.__cb(" + JSONObject.quote(reqId) + "," + json + ")";
        act.runOnUiThread(new Runnable() {
            public void run() {
                if (ui != null) ui.evaluateJavascript(js, null);
            }
        });
    }

    public static String ok(Object data) {
        return "{\"ok\":true,\"data\":" + (data == null ? "null" : String.valueOf(data)) + "}";
    }

    public static String err(String msg) {
        return "{\"ok\":false,\"err\":" + JSONObject.quote(msg == null ? "未知错误" : msg) + "}";
    }

    private SharedPreferences sp() {
        return act.prefs();
    }

    private String handle(String action, String paramsJson) throws Exception {
        JSONObject p = new JSONObject(paramsJson);

        if ("status".equals(action)) {
            String sid = sp().getString("sid", "");
            boolean marked = sp().getBoolean("logged", false);
            // 必须"本地标记 + 教务系统 Cookie"同时成立才算已登录。
            // 卸载重装后两者都会被清掉，所以一定会回到登录页。
            boolean logged = marked && loggedIn() && !sid.isEmpty();
            JSONObject o = new JSONObject();
            o.put("loggedIn", logged);
            o.put("sid", sid);
            o.put("name", sp().getString("name", ""));
            o.put("hasCred", !sid.isEmpty());
            return ok(o.toString());
        }

        if ("login".equals(action)) {
            String user = p.optString("username", "").trim();
            String pass = p.optString("password", "");
            String captcha = p.optString("captcha", "");
            if (user.isEmpty() || pass.isEmpty()) return err("请输入学号和密码");

            Cas.Result r = Cas.login(user, pass, captcha);
            JSONObject o = new JSONObject();
            o.put("ok", r.ok);
            o.put("needCaptcha", r.needCaptcha);
            o.put("message", r.message);
            o.put("debug", r.debug);
            if (r.ok) {
                sp().edit().putString("sid", user).putBoolean("logged", true).apply();
            }
            return ok(o.toString());
        }

        if ("logout".equals(action)) {
            act.clearAllSession();
            return ok("{\"ok\":true}");
        }

        if ("browse".equals(action)) {
            String url = p.optString("url", MainActivity.SITE);
            act.openSite(url);
            return ok("{\"ok\":true}");
        }

        if ("hideSite".equals(action)) {
            act.hideSite();
            return ok("{\"ok\":true}");
        }

        if ("sniff".equals(action)) {
            String url = p.optString("url", MainActivity.SITE);
            act.sniff(url);
            return ok("{\"ok\":true,\"url\":" + JSONObject.quote(url) + "}");
        }

        if ("timetable".equals(action)) {
            String term = p.optString("term", "");
            if (term.isEmpty()) term = GdutApi.currentTerm();
            int week = p.optInt("week", 0);
            if (week <= 0) week = GdutApi.currentWeek(term);
            String json = GdutApi.timetable(term, week);
            return "{\"ok\":true,\"data\":" + json + "}";
        }

        if ("terms".equals(action)) {
            return "{\"ok\":true,\"data\":" + GdutApi.terms() + "}";
        }

        if ("grades".equals(action)) {
            return "{\"ok\":true,\"data\":" + GdutApi.grades() + "}";
        }

        if ("cet".equals(action)) {
            return "{\"ok\":true,\"data\":" + GdutApi.cet() + "}";
        }

        if ("fitness".equals(action)) {
            return "{\"ok\":true,\"data\":" + GdutApi.fitness() + "}";
        }

        if ("dumpNet".equals(action)) {
            // 同步向站点 WebView 取回嗅探到的网络记录
            String arr = act.evalSiteSync(Sniffer.DUMP_JS, 12000);
            if (arr == null || "null".equals(arr)) arr = "[]";
            return "{\"ok\":true,\"data\":" + arr + "}";
        }

        if ("dumpRes".equals(action)) {
            // 页面实际请求过的资源 URL（hook 失效时也能用）
            String arr = act.evalSiteSync(Sniffer.RES_JS, 12000);
            if (arr == null || "null".equals(arr)) arr = "[]";
            return "{\"ok\":true,\"data\":" + arr + "}";
        }

        if ("siteShape".equals(action)) {
            String o = act.evalSiteSync(Sniffer.SHAPE_JS, 12000);
            if (o == null || "null".equals(o)) o = "{}";
            return "{\"ok\":true,\"data\":" + o + "}";
        }

        if ("siteEval".equals(action)) {
            // 同步在站点页执行 JS 并取回结果（用于自动导航 / 诊断）
            String js = p.optString("js", "");
            long to = p.optInt("timeout", 8000);
            String r = act.evalSiteSync(js, to);
            return "{\"ok\":true,\"data\":" + (r == null ? "null" : r) + "}";
        }

        if ("http".equals(action)) {
            // 供前端越过同源限制直接请求教务系统（带登录态 Cookie）
            String method = p.optString("method", "GET");
            String url = p.optString("url", "");
            String body = p.has("body") ? p.optString("body", "") : null;
            if (url.isEmpty()) return err("缺少 url");
            Net.Resp r = Net.follow(method, url, body, 10);
            JSONObject o = new JSONObject();
            o.put("code", r.code);
            o.put("body", r.body);
            o.put("finalUrl", r.finalUrl);
            return ok(o.toString());
        }

        if ("cachePut".equals(action)) {
            sp().edit().putString("cache_" + p.optString("key"), p.optString("value")).apply();
            return ok("{\"ok\":true}");
        }

        if ("cacheGet".equals(action)) {
            String v = sp().getString("cache_" + p.optString("key"), "");
            return ok("{\"value\":" + JSONObject.quote(v) + "}");
        }

        if ("checkUpdate".equals(action)) {
            String url = sp().getString("updateUrl", "");
            Update.Info info;
            if (url.isEmpty()) {
                // 默认：多源并行校验，取最高版本，避免单个源缓存导致漏更新
                info = Update.checkAll(Update.DEFAULT_MANIFESTS);
            } else {
                info = Update.check(url);
            }
            JSONObject o = new JSONObject();
            o.put("configured", info.configured);
            o.put("hasUpdate", info.hasUpdate);
            o.put("versionCode", info.versionCode);
            o.put("versionName", info.versionName);
            o.put("notes", info.notes);
            o.put("error", info.error);
            o.put("url", info.url);
            org.json.JSONArray ma = new org.json.JSONArray();
            for (String m : info.mirrors) ma.put(m);
            o.put("mirrors", ma);
            o.put("currentCode", BuildConfigVersion.CODE);
            o.put("currentName", BuildConfigVersion.NAME);
            o.put("updateUrl", url);
            return ok(o.toString());
        }

        if ("setUpdateUrl".equals(action)) {
            sp().edit().putString("updateUrl", p.optString("url", "").trim()).apply();
            return ok("{\"ok\":true}");
        }

        if ("downloadUpdate".equals(action)) {
            // 支持主地址 + 备用地址，前端把 version.json 里的 url 和 urlMirror 一起传进来
            org.json.JSONArray arr = p.optJSONArray("urls");
            java.util.List<String> list = new java.util.ArrayList<>();
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    String s = arr.optString(i, "");
                    if (!s.isEmpty()) list.add(s);
                }
            }
            if (list.isEmpty()) {
                String single = p.optString("url", "");
                if (single.isEmpty()) return err("缺少下载地址");
                list.add(single);
            }
            String path = Update.download(act, list.toArray(new String[0]));
            if (path == null) return err("所有下载源都失败了，请稍后重试");
            boolean launched = Update.install(act, path);
            JSONObject o = new JSONObject();
            o.put("path", path);
            o.put("launched", launched);
            return ok(o.toString());
        }

        if ("savePrefs".equals(action)) {
            try {
                android.content.SharedPreferences sp = act.getSharedPreferences(
                        "gdut_prefs", android.content.Context.MODE_PRIVATE);
                sp.edit().putString("data", p.optString("data", "")).apply();
            } catch (Throwable ignored) {
            }
            return ok("{\"ok\":true}");
        }

        if ("loadPrefs".equals(action)) {
            String data = "";
            try {
                android.content.SharedPreferences sp = act.getSharedPreferences(
                        "gdut_prefs", android.content.Context.MODE_PRIVATE);
                data = sp.getString("data", "");
            } catch (Throwable ignored) {
            }
            JSONObject o = new JSONObject();
            o.put("data", data);
            return ok(o.toString());
        }
        if ("isWifi".equals(action)) {
            boolean wifi = false;
            boolean connected = false;
            try {
                android.net.ConnectivityManager cm =
                        (android.net.ConnectivityManager) act.getSystemService(
                                android.content.Context.CONNECTIVITY_SERVICE);
                android.net.NetworkInfo ni = cm.getActiveNetworkInfo();
                connected = ni != null && ni.isConnected();
                if (connected) {
                    int t = ni.getType();
                    wifi = (t == android.net.ConnectivityManager.TYPE_WIFI
                            || t == android.net.ConnectivityManager.TYPE_ETHERNET);
                }
            } catch (Throwable ignored) {
            }
            JSONObject o = new JSONObject();
            o.put("wifi", wifi);
            o.put("connected", connected);
            return ok(o.toString());
        }

        if ("transformWallpaper".equals(action)) {
            String op = p.optString("op", "");
            String newPath = act.transformWallpaper(op);
            JSONObject o = new JSONObject();
            o.put("path", newPath == null ? "" : newPath);
            return ok(o.toString());
        }
        if ("pickWallpaper".equals(action)) {
            act.pickWallpaper();
            return ok("{\"ok\":true}");
        }

        if ("pickApk".equals(action)) {
            act.pickApk();
            return ok("{\"ok\":true}");
        }

        if ("version".equals(action)) {
            JSONObject o = new JSONObject();
            o.put("code", BuildConfigVersion.CODE);
            o.put("name", BuildConfigVersion.NAME);
            return ok(o.toString());
        }

        if ("cookies".equals(action)) {
            String url = p.optString("url", MainActivity.SITE);
            String c = CookieManager.getInstance().getCookie(url);
            return ok("{\"cookie\":" + JSONObject.quote(c == null ? "" : c) + "}");
        }

        return err("未知操作: " + action);
    }

    /** 粗判登录态：能拿到教务站点 Cookie 就认为会话还在。 */
    private boolean loggedIn() {
        String c = CookieManager.getInstance().getCookie(MainActivity.SITE);
        return c != null && !c.isEmpty();
    }

    @SuppressWarnings("unused")
    private static String junk() {
        return "";
    }
}


