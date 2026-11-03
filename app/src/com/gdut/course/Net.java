package com.gdut.course;

import android.webkit.CookieManager;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.Map;

/**
 * 极简 HTTP 客户端。Cookie 通过系统 CookieManager 与 WebView 双向共享，
 * 因此 Java 侧登录后的会话可以直接被 WebView 使用（反之亦然）。
 */
public class Net {

    public static final String UA =
            "Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/120.0.0.0 Mobile Safari/537.36";

    public static class Resp {
        public int code;
        public String body = "";
        public String location = null;
        public String finalUrl = "";

        public Resp() {
        }

        public Resp(int code) {
            this.code = code;
        }

        public boolean isRedirect() {
            return code >= 300 && code < 400 && location != null;
        }
    }

    /** 暴露给 Update 下载 APK 时复用同一个宽松 SSL 工厂。 */
    public static javax.net.ssl.SSLSocketFactory looseSslFactoryPublic() throws Exception {
        return looseSslFactory();
    }

    private static javax.net.ssl.SSLSocketFactory sLooseSsl;

    /** 接受任意证书的 SSL 工厂（只用于访问校园系统）。 */
    private static synchronized javax.net.ssl.SSLSocketFactory looseSslFactory() throws Exception {
        if (sLooseSsl != null) return sLooseSsl;
        javax.net.ssl.TrustManager[] tm = new javax.net.ssl.TrustManager[]{
                new javax.net.ssl.X509TrustManager() {
                    public void checkClientTrusted(java.security.cert.X509Certificate[] chain, String authType) {
                    }

                    public void checkServerTrusted(java.security.cert.X509Certificate[] chain, String authType) {
                    }

                    public java.security.cert.X509Certificate[] getAcceptedIssuers() {
                        return new java.security.cert.X509Certificate[0];
                    }
                }
        };
        javax.net.ssl.SSLContext ctx = javax.net.ssl.SSLContext.getInstance("TLS");
        ctx.init(null, tm, new java.security.SecureRandom());
        sLooseSsl = ctx.getSocketFactory();
        return sLooseSsl;
    }

    private static String cookiesFor(String url) {        try {
            String c = CookieManager.getInstance().getCookie(url);
            return c == null ? "" : c;
        } catch (Throwable t) {
            return "";
        }
    }

    private static void absorbCookies(HttpURLConnection c) {
        try {
            Map<String, List<String>> hs = c.getHeaderFields();
            for (Map.Entry<String, List<String>> e : hs.entrySet()) {
                String k = e.getKey();
                if (k == null || !k.equalsIgnoreCase("Set-Cookie")) continue;
                for (String v : e.getValue()) {
                    try {
                        CookieManager.getInstance().setCookie(c.getURL().toString(), v);
                    } catch (Throwable ignored) {
                    }
                }
            }
            CookieManager.getInstance().flush();
        } catch (Throwable ignored) {
        }
    }

    /** 单次请求，不跟随重定向。 */
    public static Resp one(String method, String url, String postBody, String extraHeaders)
            throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        // 校园系统常用不完整证书链，Android 的严格校验会直接握手失败，这里放行
        if (c instanceof javax.net.ssl.HttpsURLConnection) {
            javax.net.ssl.HttpsURLConnection https = (javax.net.ssl.HttpsURLConnection) c;
            try {
                https.setSSLSocketFactory(looseSslFactory());
                https.setHostnameVerifier(new javax.net.ssl.HostnameVerifier() {
                    public boolean verify(String host, javax.net.ssl.SSLSession session) {
                        return true;
                    }
                });
            } catch (Throwable ignored) {
            }
        }
        c.setRequestMethod(method);
        c.setRequestProperty("User-Agent", UA);
        c.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
        c.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        String ck = cookiesFor(url);
        if (!ck.isEmpty()) c.setRequestProperty("Cookie", ck);
        if (extraHeaders != null) {
            String[] lines = extraHeaders.split("\n");
            for (String line : lines) {
                int i = line.indexOf(':');
                if (i > 0) c.setRequestProperty(line.substring(0, i).trim(), line.substring(i + 1).trim());
            }
        }
        byte[] payload = null;
        if (postBody != null) {
            payload = postBody.getBytes("UTF-8");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type",
                    "application/x-www-form-urlencoded; charset=UTF-8");
            c.setFixedLengthStreamingMode(payload.length);
        }
        Resp r = new Resp(0);
        try {
            // 注意：不要显式 connect()。HttpURLConnection 在 getOutputStream 时隐式连接，
            // 先 connect 再写 body 在部分 Android 版本上会发不出请求体。
            if (payload != null) {
                OutputStream os = c.getOutputStream();
                os.write(payload);
                os.flush();
                os.close();
            }
            r.code = c.getResponseCode();
            absorbCookies(c);
            String loc = c.getHeaderField("Location");
            r.location = loc;
            r.finalUrl = c.getURL().toString();
            InputStream in = r.code >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in != null) r.body = readAll(in);
        } finally {
            c.disconnect();
        }
        return r;
    }

    /** 请求并自动跟随重定向（同域 / 跨域均跟随），返回最后一跳。 */
    public static Resp follow(String method, String url, String postBody, int maxHops)
            throws Exception {
        return follow(method, url, postBody, maxHops, null);
    }

    /** 带自定义请求头的版本。 */
    public static Resp follow(String method, String url, String postBody, int maxHops,
                              String extraHeaders) throws Exception {
        String cur = url;
        String body = postBody;
        String m = method;
        Resp r = null;
        for (int i = 0; i < maxHops; i++) {
            r = one(m, cur, body, extraHeaders);
            if (!r.isRedirect()) return r;
            cur = absolute(r.finalUrl, r.location);
            // 重定向后一律改为 GET，丢弃请求体（与浏览器行为一致）
            m = "GET";
            body = null;
        }
        return r;
    }

    public static Resp get(String url) throws Exception {
        return follow("GET", url, null, 12);
    }

    public static String absolute(String base, String ref) {
        try {
            return new URL(new URL(base), ref).toString();
        } catch (Exception e) {
            return ref;
        }
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        in.close();
        return new String(bos.toByteArray(), "UTF-8");
    }

    public static String enc(String s) {
        try {
            return java.net.URLEncoder.encode(s == null ? "" : s, "UTF-8");
        } catch (Exception e) {
            return "";
        }
    }
}
