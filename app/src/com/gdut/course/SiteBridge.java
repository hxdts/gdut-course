package com.gdut.course;

import android.webkit.JavascriptInterface;

/** 注入教务站点页面的辅助接口（保留给页面内脚本做轻量探测）。 */
public class SiteBridge {

    public SiteBridge(MainActivity act) {
        this.act = act;
    }

    private final MainActivity act;

    @JavascriptInterface
    public String ping() {
        return "pong";
    }

    @JavascriptInterface
    public String href() {
        return act == null ? "" : MainActivity.SITE;
    }
}
