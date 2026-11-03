package com.gdut.course;

import android.util.Base64;

import java.security.SecureRandom;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 广东工业大学统一身份认证（金智 authserver / Apereo CAS）登录实现。
 *
 * 登录流程：
 *   1. GET  https://authserver.gdut.edu.cn/authserver/login?service=<jxfw ssoLogin>
 *      取 execution / pwdEncryptSalt / 会话 Cookie
 *   2. POST 同一地址，password 用金智 AES 方案加密
 *   3. 成功后 302 带 ticket 回 service，跟随即可拿到教务系统会话
 */
public class Cas {

    public static final String AUTH_BASE = "https://authserver.gdut.edu.cn/authserver";
    public static final String SERVICE = "https://jxfw.gdut.edu.cn/new/ssoLogin";
    public static final String SSO_URL = AUTH_BASE + "/login?service=" + Net.enc(SERVICE);

    /** CryptoJS randomString 使用的字符集（注意不含 i l o u v 0 1 与 I L O U V）。 */
    private static final String AES_CHARS =
            "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";

    public static class Result {
        public boolean ok;
        public boolean needCaptcha;
        public String message = "";
        public String debug = "";
        public int stage; // 0 网络 1 解析 2 认证

        public static Result fail(int stage, String msg) {
            Result r = new Result();
            r.ok = false;
            r.stage = stage;
            r.message = msg;
            return r;
        }
    }

    private static Result failDbg(int stage, String msg, StringBuilder dbg) {
        Result r = Result.fail(stage, msg);
        r.debug = dbg == null ? "" : dbg.toString();
        return r;
    }

    /** 摘一小段页面文本，用于诊断登录失败原因。 */
    private static String snippet(String html) {
        if (html == null) return "";
        String[] keys = {"showErrorTip", "auth_error", "错误", "验证码", "密码"};
        for (String k : keys) {
            int i = html.indexOf(k);
            if (i >= 0) {
                int s = Math.max(0, i - 40);
                int e = Math.min(html.length(), i + 90);
                return html.substring(s, e).replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").trim();
            }
        }
        return html.length() > 90 ? html.substring(0, 90).replaceAll("\\s+", " ") : html;
    }

    /** 对应金智 encrypt.js 的 encryptPassword()：AES-128-CBC/PKCS7 + Base64。 */
    public static String encryptPassword(String password, String salt) {
        try {
            SecureRandom rnd = new SecureRandom();
            StringBuilder pre = new StringBuilder(64);
            for (int i = 0; i < 64; i++) pre.append(AES_CHARS.charAt(rnd.nextInt(AES_CHARS.length())));
            StringBuilder ivs = new StringBuilder(16);
            for (int i = 0; i < 16; i++) ivs.append(AES_CHARS.charAt(rnd.nextInt(AES_CHARS.length())));

            String plain = pre.toString() + password;
            String key = salt.trim();
            byte[] keyBytes = key.getBytes("UTF-8");
            byte[] ivBytes = ivs.toString().getBytes("UTF-8");
            Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
            cipher.init(Cipher.ENCRYPT_MODE,
                    new SecretKeySpec(keyBytes, "AES"),
                    new IvParameterSpec(ivBytes));
            byte[] out = cipher.doFinal(plain.getBytes("UTF-8"));
            return Base64.encodeToString(out, Base64.NO_WRAP);
        } catch (Exception e) {
            return password;
        }
    }

    public static String pick(String html, String regex) {
        Matcher m = Pattern.compile(regex).matcher(html);
        return m.find() ? m.group(1) : "";
    }

    /**
     * 执行完整登录。成功后 CookieManager 中即持有 authserver + jxfw 的会话。
     */
    public static Result login(String username, String password, String captcha) {
        try {
            // ---------- 1. 取登录页 ----------
            // 必须跟随重定向：设备上已有登录会话时，CAS 会直接 302 到 service，
            // 用不跟随重定向的请求会拿到 302，被误判成"连不上"。
            Net.Resp page = Net.follow("GET", SSO_URL, null, 8);
            String landedUrl = page.finalUrl == null ? "" : page.finalUrl;

            // 已经落在教务系统域名下 = 这台设备已有有效会话，直接算登录成功
            if (landedUrl.contains("jxfw.gdut.edu.cn") && !landedUrl.contains("authserver")) {
                Result ok = new Result();
                ok.ok = true;
                ok.message = "ok";
                ok.debug = "检测到已有登录会话，直接进入教务系统：" + landedUrl;
                return ok;
            }

            if (page.code >= 300 && page.code < 400) {
                return Result.fail(0, "统一身份认证反复跳转（HTTP " + page.code
                        + "），请稍后重试或重启应用");
            }
            if (page.code != 200 || page.body == null || page.body.isEmpty()) {
                return Result.fail(0, "无法连接统一身份认证（HTTP " + page.code + "）");
            }
            String html = page.body;
            String execution = firstNonEmpty(
                    pick(html, "name=\"execution\"\\s+value=\"([^\"]*)\""),
                    pick(html, "id=\"execution\"\\s+value=\"([^\"]*)\""));
            String salt = firstNonEmpty(
                    pick(html, "id=\"pwdEncryptSalt\"\\s+value=\"([^\"]*)\""),
                    pick(html, "name=\"pwdEncryptSalt\"\\s+value=\"([^\"]*)\""));
            StringBuilder dbg = new StringBuilder();
            dbg.append("① 取登录页 HTTP ").append(page.code)
               .append("，长度 ").append(html.length())
               .append("，execution=").append(execution)
               .append("，saltLen=").append(salt.length());

            if (execution.isEmpty()) {
                return failDbg(1, "登录页结构已变化（未找到 execution）", dbg);
            }
            if (salt.isEmpty()) {
                // 极少数主题不带盐：退化处理，直接放弃加密
                salt = "0123456789abcdef";
            }

            // 只检查「账号密码登录」这张表单里的 captchaDiv：
            // 页面上有两个 captchaDiv（手机号登录 / 账号密码登录），后者带 hide 表示默认不需要验证码
            boolean captchaRequired = captchaVisible(html);
            dbg.append("，需验证码=").append(captchaRequired);

            if (captchaRequired && (captcha == null || captcha.trim().isEmpty())) {
                Result r = failDbg(2, "本次登录需要验证码", dbg);
                r.needCaptcha = true;
                return r;
            }

            // ---------- 2. 提交 ----------
            String encPwd = encryptPassword(password, salt);
            StringBuilder form = new StringBuilder();
            form.append("username=").append(Net.enc(username));
            form.append("&password=").append(Net.enc(encPwd));
            form.append("&_eventId=submit");
            form.append("&cllt=userNameLogin");
            form.append("&dllt=generalLogin");
            form.append("&lt=");
            form.append("&execution=").append(Net.enc(execution));
            form.append("&rmShown=1");
            form.append("&rememberMe=true");
            if (captcha != null && !captcha.trim().isEmpty()) {
                form.append("&captcha=").append(Net.enc(captcha.trim()));
            }

            Net.Resp post = Net.one("POST", SSO_URL, form.toString(), null);
            dbg.append("\n② 提交登录 HTTP ").append(post.code)
               .append("，Location=").append(post.location == null ? "(无)" : post.location);
            if (post.body != null && !post.body.isEmpty()) {
                dbg.append("，响应含提示=").append(snippet(post.body));
            }

            // ---------- 3. 判定 ----------
            // 认证失败时 CAS 会直接以 401/403 重绘登录页（而不是重定向）
            if (post.code == 401 || post.code == 403) {
                String msg = extractError(post.body);
                Result r = failDbg(2, msg.isEmpty() ? "账号或密码不正确" : msg, dbg);
                r.needCaptcha = captchaVisible(post.body);
                return r;
            }
            if (post.code >= 400) {
                return failDbg(2, "认证服务返回 HTTP " + post.code, dbg);
            }
            if (!post.isRedirect()) {
                // 200：多半是错误页，尝试提取提示
                String msg = extractError(post.body);
                Result r = failDbg(2, msg.isEmpty() ? "登录失败：账号或密码不正确" : msg, dbg);
                r.needCaptcha = captchaVisible(post.body);
                return r;
            }

            String loc = post.location;
            if (loc.contains("/authserver/login")) {
                // 被弹回登录页 = 认证失败
                return failDbg(2, errorText(loc), dbg);
            }

            // 成功：跟随到 service 换取教务系统会话
            dbg.append("\n③ 跳转到 ").append(loc);
            Net.Resp landed = Net.follow("GET", Net.absolute(SSO_URL, loc), null, 8);
            dbg.append("，落地 HTTP ").append(landed.code)
               .append("，最终地址 ").append(landed.finalUrl);
            if (landed.code >= 400) {
                return failDbg(0, "登录成功但教务系统返回 " + landed.code, dbg);
            }

            Result ok = new Result();
            ok.ok = true;
            ok.message = "ok";
            ok.debug = dbg.toString();
            return ok;

        } catch (Exception e) {
            return Result.fail(0, "网络异常：" + safe(e.getMessage()));
        }
    }

    private static String safe(String s) {
        return s == null ? "未知错误" : s;
    }

    /** 账号密码登录表单里的验证码是否被要求填写。 */
    private static boolean captchaVisible(String html) {
        if (html == null) return false;
        int i = html.indexOf("value=\"userNameLogin\"");
        if (i < 0) return false;
        String seg = html.substring(i, Math.min(html.length(), i + 8000));
        Matcher m = Pattern.compile("id=\"captchaDiv\"[^>]*").matcher(seg);
        if (!m.find()) return false;
        return !m.group().contains("hide");
    }

    private static String firstNonEmpty(String a, String b) {
        return a != null && !a.isEmpty() ? a : (b == null ? "" : b);
    }

    private static String extractError(String html) {
        if (html == null) return "";
        Matcher m = Pattern.compile("id=\"showErrorTip\"[^>]*>([^<]{1,120})<").matcher(html);
        if (m.find()) return m.group(1).trim();
        Matcher m2 = Pattern.compile("class=\"auth_error[^\"]*\"[^>]*>([^<]{1,120})<").matcher(html);
        if (m2.find()) return m2.group(1).trim();
        if (html.contains("密码有误") || html.contains("密码错误")) return "账号或密码不正确";
        if (html.contains("验证码")) return "验证码不正确";
        return "";
    }

    private static String errorText(String loc) {
        if (loc.contains("bad_credentials")) return "账号或密码不正确";
        if (loc.contains("captcha")) return "验证码不正确";
        if (loc.contains("locked")) return "账号已被锁定，请稍后再试";
        return "登录失败，请检查账号密码";
    }
}
