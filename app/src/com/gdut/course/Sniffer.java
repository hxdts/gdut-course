package com.gdut.course;

/**
 * 注入教务站点页面里的嗅探钩子。
 * 目的：不依赖任何写死的接口地址，直接观察站点自身发出的请求，
 * 从而拿到课表 / 成绩 / 等级考试的真实数据结构。
 */
public final class Sniffer {

    private Sniffer() {
    }

    public static final String HOOK_JS =
            "(function(){try{" +
            "  if(window.__GDUT_HOOK_V2) return 'already'; window.__GDUT_HOOK_V2=1;" +
            "  window.__NETLOG__=[];" +
            "  var push=function(o){try{if(window.__NETLOG__.length>400)window.__NETLOG__.shift();" +
            "     window.__NETLOG__.push(o);}catch(e){}};" +
            "  var clip=function(s){s=(s==null?'':String(s));return s.length>120000?s.slice(0,120000):s;};" +
            "  var of=window.fetch;" +
            "  if(of){window.fetch=function(a,b){var url=(typeof a==='string')?a:((a&&a.url)||'');" +
            "    try{return of.apply(this,arguments).then(function(r){try{var c=r.clone();" +
            "      c.text().then(function(t){push({u:url,m:'FETCH',s:r.status,b:clip(t)});}).catch(function(){});" +
            "    }catch(e){} return r;});}catch(e){return of.apply(this,arguments);}};}" +
            "  var XO=XMLHttpRequest.prototype.open,XS=XMLHttpRequest.prototype.send;" +
            "  XMLHttpRequest.prototype.open=function(m,u){try{this.__u=u;this.__m=m;}catch(e){}" +
            "    return XO.apply(this,arguments);};" +
            "  XMLHttpRequest.prototype.send=function(){var self=this;" +
            "    try{this.addEventListener('loadend',function(){try{" +
            "      push({u:self.__u,m:self.__m||'XHR',s:self.status,b:clip(self.responseText)});" +
            "    }catch(e){}});}catch(e){}" +
            "    return XS.apply(this,arguments);};" +
            "  return 'hooked';}catch(e){return 'err:'+e;}})()";

    /** 取回全部捕获记录。返回值经 evaluateJavascript 传出后是 JSON 字符串字面量。 */
    public static final String DUMP_JS =
            "JSON.stringify(window.__NETLOG__||[])";

    /** 取当前页面可见文本（用于 DOM 兜底解析）。 */
    public static final String TEXT_JS =
            "JSON.stringify({url:location.href,title:document.title," +
            "text:(document.body?document.body.innerText:'').slice(0,60000)})";

    /**
     * 浏览器性能条目里的资源列表。
     * 就算 hook 注入晚了，这里也能列出页面实际请求过的所有 URL（含 XHR / fetch），
     * 是定位"教务系统到底请求了哪个接口"最可靠的办法。
     */
    public static final String RES_JS =
            "JSON.stringify((function(){try{var a=performance.getEntriesByType('resource')||[];" +
            "var o=[];for(var i=0;i<a.length&&i<200;i++){" +
            "o.push({n:a[i].name,t:a[i].initiatorType||'',s:a[i].transferSize||0});}return o;}" +
            "catch(e){return [];}})())";

    /** 页面结构概览：有多少 iframe、有多少可点菜单、当前路由。 */
    public static final String SHAPE_JS =
            "JSON.stringify({url:location.href,title:document.title," +
            "iframes:document.querySelectorAll('iframe').length," +
            "links:document.querySelectorAll('a').length," +
            "textLen:(document.body?document.body.innerText.length:0)," +
            "hooked:!!window.__GDUT_HOOK_V2," +
            "logCount:(window.__NETLOG__||[]).length})";

    /** 找出页面上所有 iframe 的地址，方便继续钻取。 */
    public static final String FRAMES_JS =
            "JSON.stringify(Array.prototype.map.call(document.querySelectorAll('iframe')," +
            "function(f){return f.src;}))";
}
