package com.gdut.course;

import android.graphics.Bitmap;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** 教务站点 WebView 的客户端：每个页面开始加载时就注入嗅探钩子。 */
public class SiteClient extends WebViewClient {

    private final MainActivity act;

    public SiteClient(MainActivity act) {
        this.act = act;
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        super.onPageStarted(view, url, favicon);
        // onPageStarted 早于页面脚本执行，此时注入可以覆盖到 SPA 的首批请求
        view.evaluateJavascript(Sniffer.HOOK_JS, null);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        view.evaluateJavascript(Sniffer.HOOK_JS, null);
        act.evalUi("window.__siteState && window.__siteState(" +
                org.json.JSONObject.quote(url) + ")");
        // 能停在教务系统域名下，说明 CAS 已经放行（登录成功）
        if (url != null && url.contains("jxfw.gdut.edu.cn")) {
            act.evalUi("window.__siteLoggedIn && window.__siteLoggedIn()");
        }
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
        return false; // 站点内部跳转一律在站点 WebView 内完成
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        // 校园系统常用自签证书，直接放行（仅本应用内）
        handler.proceed();
    }
}
