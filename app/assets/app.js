/* 广工课表 —— 前端逻辑
 * 与原生层通过 window.Native.call(reqId, action, paramsJson) 通信，
 * 原生完成后回调 window.__cb(reqId, {ok, data|err})。
 */
(function () {
  'use strict';

  var HAS_NATIVE = typeof window.Native !== 'undefined' && window.Native &&
                   typeof window.Native.call === 'function';

  var seq = 0;
  var pending = {};

  function call(action, params) {
    return new Promise(function (resolve, reject) {
      if (!HAS_NATIVE) {
        reject(new Error('NATIVE_UNAVAILABLE'));
        return;
      }
      var id = 'r' + (++seq);
      pending[id] = { resolve: resolve, reject: reject };
      try {
        window.Native.call(id, action, JSON.stringify(params || {}));
      } catch (e) {
        delete pending[id];
        reject(e);
      }
      setTimeout(function () {
        if (pending[id]) {
          delete pending[id];
          reject(new Error('请求超时'));
        }
      }, 45000);
    });
  }

  window.__cb = function (id, payload) {
    var p = pending[id];
    if (!p) return;
    delete pending[id];
    if (payload && payload.ok) p.resolve(payload.data);
    else p.reject(new Error((payload && payload.err) || '请求失败'));
  };

  /* ================= 工具 ================= */
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t.__t);
    t.__t = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }
  window.toast = toast; // 供 Java 侧通过 evaluateJavascript 调用

  function loading(on, text) {
    var el = $('#loading');
    if (!el) return;
    el.classList.toggle('show', !!on);
    if (on) {
      var t = $('#loadText');
      if (t) t.textContent = text || '正在加载…';
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 自定义圆润弹窗（替代 window.confirm / prompt）。
   * 系统对话框在 WebView 里会带上"网址为：..."的标题，很难看。
   */
  function uiDialog(o) {
    o = o || {};
    var el = document.createElement('div');
    el.className = 'ui-modal';
    var html = '<div class="ui-card">';
    if (o.title) html += '<div class="ui-title">' + esc(o.title) + '</div>';
    if (o.message) html += '<div class="ui-msg">' + esc(o.message) + '</div>';
    if (o.input) {
      html += '<input class="ui-input" id="uiInput" type="text" value="' +
        esc(o.value || '') + '" placeholder="' + esc(o.placeholder || '') + '">';
    }
    html += '<div class="ui-actions">';
    if (o.cancelText !== false) {
      html += '<button class="ui-btn ui-cancel">' + esc(o.cancelText || '取消') + '</button>';
    }
    html += '<button class="ui-btn ui-ok">' + esc(o.okText || '确定') + '</button>';
    html += '</div></div>';
    el.innerHTML = html;
    document.body.appendChild(el);

    var input = el.querySelector('#uiInput');
    if (input) setTimeout(function () { try { input.focus(); } catch (e) {} }, 120);

    function close() {
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    var cancelBtn = el.querySelector('.ui-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        close();
        if (o.onCancel) o.onCancel();
      });
    }
    el.querySelector('.ui-ok').addEventListener('click', function () {
      var v = input ? input.value : undefined;
      close();
      if (o.onOk) o.onOk(v);
    });
  }

  /* ================= 状态 ================= */
  var state = {
    sid: '',
    name: '',
    term: '',
    week: 0,
    totalWeeks: 22,
    startDate: '',
    termStart: '',
    days: [],
    ttError: '',
    gradeError: '',
    courses: [],
    grades: [],
    cetRows: [],
    fitRows: [],
    cetError: '',
    fitError: '',
    expired: false,
    offline: false,
    offlineAt: 0,
    gpa: null,
    avgScore: null,
    totalCredit: null,
    rank: '',
    cet4: null,
    cet6: null,
    netCount: 0,
    captureUrl: '',
    updatedAt: 0
  };

  /* ================= 登录 ================= */
  function showLoginMsg(text, kind) {
    var el = $('#loginMsg');
    if (!text) { el.className = 'login-msg'; el.textContent = ''; return; }
    el.className = 'login-msg show ' + (kind || 'info');
    el.textContent = text;
  }

  /* ================= 记住密码 ================= */
  var rememberPwd = true;

  function initRemember() {
    try {
      var v = localStorage.getItem('rememberPwd');
      if (v === '0') rememberPwd = false;
    } catch (e) {}
    var row = $('#rememberRow');
    if (row) row.classList.toggle('on', rememberPwd);
    // 点击绑定走 bindLoginCheckboxes 的 document 委托，不依赖启动时序
  }

  /** 登录页两个勾选框：document 级委托，页面一加载就生效 */
  function bindLoginCheckboxes() {
    if (window.__cbBound) return;
    window.__cbBound = true;
    // 用 parentNode 逐级上找，不用 closest：部分安卓 WebView 对 SVG 子元素不支持 closest
    function findById(el, id) {
      while (el && el.nodeType === 1) {
        if (el.id === id) return el;
        el = el.parentNode;
      }
      return null;
    }

    document.addEventListener('click', function (e) {
      var t = e.target || e.srcElement;

      var ag = findById(t, 'agreeRow');
      if (ag) {
        if (t.id === 'lnkTerms') {
          var tm = $('#terms');
          if (tm) tm.classList.remove('hidden');
          return;
        }
        agreed = !agreed;
        ag.classList.toggle('on', agreed);
        try { localStorage.setItem('agreed', agreed ? '1' : '0'); } catch (err) {}
        return;
      }

      var rm = findById(t, 'rememberRow');
      if (rm) {
        rememberPwd = !rememberPwd;
        rm.classList.toggle('on', rememberPwd);
        try { localStorage.setItem('rememberPwd', rememberPwd ? '1' : '0'); } catch (err) {}
        if (!rememberPwd) {
          try {
            localStorage.removeItem('savedSid');
            localStorage.removeItem('savedPwd');
          } catch (err) {}
        }
      }
    }, true);
  }

  function saveLogin(sid, pwd) {
    try {
      if (rememberPwd) {
        localStorage.setItem('savedSid', sid);
        localStorage.setItem('savedPwd', pwd);
        localStorage.setItem('agreed', '1');
      } else {
        localStorage.removeItem('savedSid');
        localStorage.removeItem('savedPwd');
      }
    } catch (e) {}
  }

  function getSavedLogin() {
    try {
      return {
        sid: localStorage.getItem('savedSid') || '',
        pwd: localStorage.getItem('savedPwd') || ''
      };
    } catch (e) { return { sid: '', pwd: '' }; }
  }

  /** 用记住的密码自动登录，返回是否发起了自动登录 */
  function autoLogin() {
    // 主动退出登录后，本次启动不自动登录
    try {
      if (localStorage.getItem('noAutoLogin') === '1') {
        localStorage.removeItem('noAutoLogin');
        return false;
      }
    } catch (e) {}
    var c = getSavedLogin();
    if (!c.sid || !c.pwd) return false;
    var sidEl = $('#sid');
    var pwdEl = $('#pwd');
    if (sidEl) sidEl.value = c.sid;
    if (pwdEl) pwdEl.value = c.pwd;
    agreed = true;
    try { localStorage.setItem('agreed', '1'); } catch (e) {}
    var row = $('#agreeRow');
    if (row) row.classList.add('on');
    doLogin();
    return true;
  }
  /* ================= 设置备份到原生（更新后不丢） ================= */
  var PREF_KEYS = [
    'theme', 'palette', 'courseOpacity', 'fontScale', 'ttFontScale',
    'textColors', 'stroke', 'wallpaper', 'wallLum',
    'agreed', 'rememberPwd', 'savedSid', 'savedPwd',
    'term', 'termStart', 'termStartDate'
  ];

  var prefTimer = null;

  function backupPrefs() {
    if (!HAS_NATIVE) return;
    if (prefTimer) clearTimeout(prefTimer);
    prefTimer = setTimeout(function () {
      var o = {};
      PREF_KEYS.forEach(function (k) {
        try {
          var v = localStorage.getItem(k);
          if (v !== null) o[k] = v;
        } catch (e) {}
      });
      try {
        call('savePrefs', { data: JSON.stringify(o) }).catch(function () {});
      } catch (e) {}
    }, 600);
  }

  function restorePrefs(done) {
    // 只允许回调一次：之前 then 和 catch 都可能触发 done，
    // 导致 bootInner 跑两遍、事件重复绑定，勾选框点一次切换两次等于没反应。
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      if (done) done();
    }
    if (!HAS_NATIVE) { finish(); return; }
    call('loadPrefs').then(function (r) {
      if (r && r.data) {
        try {
          var o = JSON.parse(r.data);
          Object.keys(o).forEach(function (k) {
            if (PREF_KEYS.indexOf(k) < 0) return;
            // 只补本地缺失的，不覆盖用户当前设置
            if (localStorage.getItem(k) === null) {
              localStorage.setItem(k, o[k]);
            }
          });
        } catch (e) {}
      }
      finish();
    }).catch(function () {
      finish();
    });
  }

  function doLogin() {
    var sid = $('#sid').value.trim();
    var pwd = $('#pwd').value;
    var cap = $('#cap').value.trim();

    if (!agreed) {
      showLoginMsg('请先阅读并勾选《用户协议与隐私说明》', 'err');
      return;
    }
    if (!sid) { showLoginMsg('请输入学号', 'err'); return; }
    if (!pwd) { showLoginMsg('请输入密码', 'err'); return; }

    var btn = $('#btnLogin');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    showLoginMsg('正在连接统一身份认证…', 'info');

    call('login', { username: sid, password: pwd, captcha: cap })
      .then(function (r) {
        if (r && r.ok) {
          state.sid = sid;
          saveLogin(sid, pwd);
          backupPrefs();
          showLoginMsg('登录成功，正在载入教务系统…', 'info');
          enterApp();
        } else {
          if (r && r.needCaptcha) {
            $('#capField').classList.remove('hidden');
            showLoginMsg('学校要求输入验证码，请填写后重试', 'err');
          } else {
            var txt = (r && r.message) || '登录失败';
            if (r && r.debug) txt += '\n\n诊断：' + r.debug;
            txt += '\n\n若一直失败，点右下角「网页登录」，在学校页面里登录一次即可。';
            showLoginMsg(txt, 'err');
          }
          btn.disabled = false;
          btn.textContent = '登 录';
        }
      })
      .catch(function (e) {
        if (e.message === 'NATIVE_UNAVAILABLE') {
          showLoginMsg('当前为浏览器预览模式，无法真正登录', 'err');
        } else {
          showLoginMsg('登录异常：' + e.message, 'err');
        }
        btn.disabled = false;
        btn.textContent = '登 录';
      });
  }

  /* ================= 进入主界面 ================= */
  function enterApp() {
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#meSid').textContent = state.sid || '—';
    if ($('#whoLine')) $('#whoLine').textContent = (state.sid ? '学号 ' + state.sid + ' · ' : '') + '已连接教务系统';
    switchPage('tt');
    // 每次打开都定位到"今天所在的周"。
    // 关键：先用本地缓存的学期起始日期自己算，断网也能定位到本周，
    // 不依赖后端（后端要联网才能拿到学期起始日期）。
    var savedStart = '';
    try { savedStart = localStorage.getItem('termStart') || ''; } catch (e) {}
    if (savedStart) state.termStart = savedStart;
    try {
      if (!state.term) state.term = localStorage.getItem('term') || '';
    } catch (e) {}
    var localWeek = guessWeekFromStart(savedStart);
    state.week = localWeek > 0 ? localWeek : 0;
    setTimeout(function () {
      refresh(false);
    }, 300);
  }

  /* ================= 刷新 / 抓取 ================= */
  var sniffing = false;

  function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /* 自动在教务系统里点进「课表」菜单（含 iframe 场景），点不到也不会报错 */
  var NAV_WORDS = ['我的课表', '课表查询', '课程表', '学生课表', '我的课程', '课表'];

  function clickMenuJs() {
    return "JSON.stringify(function(){var KW=" + JSON.stringify(NAV_WORDS) + ";" +
      "function scan(doc){if(!doc)return '';var nodes=doc.querySelectorAll('a,li,span,div,button');" +
      "for(var i=0;i<nodes.length;i++){var el=nodes[i];" +
      "var t=(el.textContent||'').replace(/\\s+/g,'');" +
      "if(!t||t.length>12)continue;" +
      "for(var k=0;k<KW.length;k++){if(t===KW[k]){try{el.click();return 'ok:'+t;}catch(e){}}}}" +
      "var fr=doc.querySelectorAll('iframe');" +
      "for(var j=0;j<fr.length;j++){try{var r=scan(fr[j].contentDocument);if(r)return r;}catch(e){}}" +
      "return '';}" +
      "return {hit:scan(document),url:location.href};}())";
  }

  /* ================= 课表本地缓存（离线兜底） ================= */
  function ttCacheKey(term, week) {
    return 'ttc_' + (term || 'x') + '_' + week;
  }

  function saveTtCache() {
    try {
      localStorage.setItem(ttCacheKey(state.term, state.week), JSON.stringify({
        term: state.term,
        week: state.week,
        totalWeeks: state.totalWeeks,
        startDate: state.startDate,
        days: state.days,
        courses: state.courses,
        savedAt: Date.now()
      }));
    } catch (e) { /* 容量满等情况忽略 */ }
  }

  /** 保存任意一周到缓存（用于整学期预缓存） */
  function saveTtCacheFor(term, week, d) {
    try {
      localStorage.setItem(ttCacheKey(term, week), JSON.stringify({
        term: term,
        week: week,
        totalWeeks: d.totalWeeks || 22,
        startDate: d.startDate || '',
        days: d.days || [],
        courses: d.courses || [],
        savedAt: Date.now()
      }));
      return true;
    } catch (e) { return false; }
  }

  function hasTtCache(term, week) {
    try { return !!localStorage.getItem(ttCacheKey(term, week)); } catch (e) { return false; }
  }

  /**
   * 后台把整个学期的每一周都拉下来缓存一次。
   * 这样断网时任何一周都能看，而不是只缓存点开过的那几周。
   */
  var prefetching = false;

  function prefetchAllWeeks() {
    if (prefetching) return;
    prefetching = true;

    // 只在 WiFi 下做整学期预缓存，避免消耗移动数据（整个学期也就 100 多 KB）
    call('isWifi').then(function (net) {
      if (!net || !net.wifi) {
        prefetching = false;
        return;
      }
      doPrefetchAllWeeks();
    }).catch(function () {
      prefetching = false;
    });
  }

  function doPrefetchAllWeeks() {
    var total = state.totalWeeks || 22;
    var term = state.term || '';
    if (!term) { prefetching = false; return; }

    // 先算出需要补哪些周
    var todo = [];
    for (var i = 1; i <= total; i++) {
      if (!hasTtCache(term, i)) todo.push(i);
    }
    if (!todo.length) { prefetching = false; return; }

    var idx = 0;
    var okCount = 0;

    function step() {
      if (idx >= todo.length) {
        prefetching = false;
        if (okCount > 0) {
          renderLastUpdated();
          toast('已缓存 ' + okCount + ' 周课表，断网也能看');
        }
        return;
      }
      var w = todo[idx++];
      var stEl = $('#ttStatus');
      if (stEl) stEl.textContent = '缓存 ' + idx + '/' + todo.length;
      call('timetable', { term: term, week: w })
        .then(function (d) {
          if (d && !d.error) {
            if (saveTtCacheFor(term, w, d)) okCount++;
          }
          setTimeout(step, 120);
        })
        .catch(function () {
          setTimeout(step, 200);
        });
    }
    step();
  }

  function loadTtCache(term, week) {
    try {
      var s = localStorage.getItem(ttCacheKey(term, week));
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }

  /** 把缓存数据套用到 state，返回是否成功 */
  function applyTtCache(term, week) {
    var c = loadTtCache(term, week);
    if (!c) return false;
    state.offline = true;
    state.offlineAt = c.savedAt || 0;
    state.term = c.term || term;
    state.week = c.week || week;
    state.totalWeeks = c.totalWeeks || 22;
    state.startDate = c.startDate || '';
    state.days = c.days || [];
    state.courses = c.courses || [];
    state.ttError = '';
    return true;
  }

  function clearOffline() {
    state.offline = false;
    state.offlineAt = 0;
  }

  /** 用学期起始日期推算当前教学周（前端兜底，防止后端算错） */
  function guessWeekFromStart(start) {
    if (!start || start.length < 10) return 0;
    try {
      var y = parseInt(start.substr(0, 4), 10);
      var m = parseInt(start.substr(5, 2), 10) - 1;
      var d = parseInt(start.substr(8, 2), 10);
      var s = Date.UTC(y, m, d);
      var days = Math.floor((Date.now() - s) / 86400000);
      var w = Math.floor(days / 7) + 1;
      if (w < 1 || w > 30) return 0;
      return w;
    } catch (e) { return 0; }
  }

  function refresh(silent) {
    // 之前这里是静默 return，正在刷新时点按钮毫无反应。
    // 现在至少给出提示，用户能知道"点了、在忙"。
    if (sniffing) {
      toast('正在刷新中，请稍候…');
      return;
    }
    sniffing = true;
    setRefreshing(true);
    // 不弹全屏遮罩：那张浅色遮罩切换时会"白闪"，反馈改用按钮旋转 + 顶部状态文字
    setWho('正在刷新数据…');

    var finished = false;
    var watchdog = null;

    var finish = function (msg, isErr) {
      if (finished) return;
      finished = true;
      if (watchdog) clearTimeout(watchdog);
      sniffing = false;
      loading(false);
      setRefreshing(false);
      if (msg) toast(msg);
      try {
        renderTimetable();
        renderGrades();
        renderCet();
        renderFitness();
        renderDiagnostics();
        if (state.updatedAt) renderLastUpdated();
        else setWho(state.sid ? '学号 ' + state.sid : '已连接教务系统');
      } catch (err) { /* 渲染异常不能卡住刷新状态 */ }
    };

    // 看门狗：任何异常导致流程中断时，60 秒后强制恢复，避免按钮永久失灵
    watchdog = setTimeout(function () {
      if (!finished) finish('刷新超时，请检查网络后重试');
    }, 60000);

    call('timetable', { term: state.term || '', week: state.week || 0 })
      .then(function (d) {
        d = d || {};
        if (d.expired) state.expired = true;
        var term = d.term || state.term;
        var week = d.week || state.week;

        if (d.error) {
          // 接口出错或会话过期 → 优先用本地缓存，保证还能看课表
          if (applyTtCache(term, week)) return call('grades', {});
          // 连缓存都没有时，也绝不清空当前已显示的内容：
          // 让用户继续看到上次的课表，只是明确告诉他这次刷新失败了
          state.ttError = d.error;
          return call('grades', {});
        }

        clearOffline();
        state.term = term;
        try { if (term) localStorage.setItem('term', term); } catch (e) {}
        state.week = week;
        state.totalWeeks = d.totalWeeks || 22;
        state.startDate = d.startDate || '';
        // termStart 是「第 1 周周一」，一周的日期范围必须用它来推
        state.termStart = d.termStart || '';
        try {
          if (state.termStart) localStorage.setItem('termStart', state.termStart);
          else state.termStart = localStorage.getItem('termStart') || '';
          if (state.startDate) localStorage.setItem('termStartDate', state.startDate);
        } catch (e) {}
        state.days = d.days || [];
        state.ttError = '';
        state.courses = (d.courses || []).map(function (c) {
          return {
            name: c.name, teacher: c.teacher || '', room: c.room || '',
            day: c.day || 0, start: c.start || 0, end: c.end || 0, weeks: c.weeks || '',
            code: c.code || '', cls: c.cls || '', hours: c.hours || '',
            people: c.people || '', mode: c.mode || '', content: c.content || ''
          };
        });
        saveTtCache();
        return call('grades', {});
      })
      .then(function (g) {
        g = g || {};
        if (g.expired) state.expired = true;
        if (g.error) {
          // 失败时保留已有成绩，不清空
          state.gradeError = g.error;
          return call('cet', {});
        }
        state.gradeError = '';
        state.grades = (g.rows || []).map(function (c) {
          return {
            name: c.name, credit: parseFloat(c.credit) || 0,
            score: c.score || '', gpa: isNaN(parseFloat(c.gpa)) ? null : parseFloat(c.gpa)
          };
        });
        state.gpa = g.gpa > 0 ? g.gpa : null;
        state.avgScore = g.avgScore > 0 ? g.avgScore : null;
        state.totalCredit = g.creditSum || 0;
        return call('cet', {});
      })
      .then(function (c) {
        c = c || {};
        if (c.expired) state.expired = true;
        if (!c.error) {
          state.cetRows = c.rows || [];
          state.cetError = '';
        } else {
          state.cetError = c.error;
        }
        return call('fitness', {});
      })
      .then(function (f) {
        f = f || {};
        if (f.expired) state.expired = true;
        if (!f.error) {
          state.fitRows = f.rows || [];
          state.fitError = '';
        } else {
          state.fitError = f.error;
        }
        state.netCount = state.courses.length;
        state.updatedAt = Date.now();
        renderLastUpdated();

        var msg;
        if (state.expired) {
          msg = '登录已过期，显示的是本地数据';
        } else if (state.ttError) {
          msg = '刷新失败：' + state.ttError;
        } else if (state.offline) {
          msg = '无法联网，显示第 ' + state.week + ' 周的本地缓存';
        } else if (state.courses.length) {
          msg = '第 ' + state.week + ' 周 · ' + state.courses.length + ' 节课';
        } else {
          msg = '第 ' + state.week + ' 周暂无课程';
        }
        finish(msg);
        if (state.expired) setTimeout(showExpired, 700);

        // 联网时顺手把整学期每一周都缓存下来，断网也能看任何一周
        if (!state.expired && !state.offline) {
          setTimeout(prefetchAllWeeks, 2500);
        }

        // 后端算成第 1 周、但按学期起始日期推算明显不是第一周 → 自动切到正确周
        if (!state.expired && state.week === 1) {
          var wLocal = guessWeekFromStart(state.termStart || state.startDate);
          if (wLocal > 1) {
            setTimeout(function () { goToWeek(wLocal); }, 150);
          }
        }
      })
      .catch(function (e) {
        state.ttError = (e && e.message) ? e.message : '读取失败';
        finish('读取失败：' + state.ttError);
      });
  }

  function setWho(text) {
    var el = $('#whoLine');
    if (el) el.textContent = text;
  }

  function showExpired() {
    if (state.__expiredShown) return;
    state.__expiredShown = true;
    // 记住密码时直接用记住的账号密码自动重登，不用用户再输一遍
    var c = getSavedLogin();
    if (rememberPwd && c.sid && c.pwd) {
      toast('登录已过期，正在自动重新登录…');
      state.__expiredShown = false;
      call('logout').then(function () {
        autoLogin();
      }).catch(function () {
        autoLogin();
      });
      return;
    }
    uiDialog({
      title: '登录已过期',
      message: '教务系统会话已失效，需要重新登录才能获取最新数据。\n已显示的内容会保留。',
      cancelText: '以后再说',
      okText: '去登录',
      onCancel: function () { state.__expiredShown = false; },
      onOk: function () {
        call('logout').then(function () {
          location.reload();
        }).catch(function () {
          location.reload();
        });
      }
    });
  }

  function setRefreshing(on) {
    var b = $('#btnRefresh');
    if (!b) return;
    if (on) {
      b.classList.add('spinning');
      b.style.opacity = '.6';
    } else {
      b.classList.remove('spinning');
      b.style.opacity = '';
    }
  }

  function renderLastUpdated() {
    var el = $('#whoLine');
    if (!el) return;

    function fmt(dt) {
      return dt.getFullYear() + '.' + two(dt.getMonth() + 1) + '.' + two(dt.getDate()) +
             ' ' + two(dt.getHours()) + ':' + two(dt.getMinutes());
    }

    if (state.offline && state.offlineAt) {
      el.textContent = fmt(new Date(state.offlineAt)) + ' · 离线';
      return;
    }
    if (!state.updatedAt) return;
    el.textContent = fmt(new Date(state.updatedAt)) + ' 更新';
  }

  /** 跳转到指定教学周：不显示全屏遮罩（会白闪），改用标签微提示 + 滑动动画 */
  function goToWeek(w) {
    var total = state.totalWeeks || 22;
    if (w < 1) w = 1;
    if (w > total) w = total;
    if (w === state.week) return;

    var dir = w > (state.week || 1) ? 1 : -1;
    state.lastDir = dir;   // 渲染时用这个方向做 DOM 轮转（只重建一页）

    // 课表已整学期缓存在本地：有缓存就直接用，不走网络（换周瞬间完成）
    var cached = loadTtCache(state.term, w);
    if (cached && cached.courses) {
      state.courses = cached.courses;
      state.days = cached.days || [];
      state.ttError = '';
      state.offline = false;
      renderTimetable();
      animateTimetable(dir);
      setWeekPending(false);
      return;
    }

    // 只有这一周没有缓存时才去请求
    setWeekPending(true);
    call('timetable', { term: state.term || '', week: w })
      .then(function (d) {
        d = d || {};
        var term = d.term || state.term;
        var week = d.week || w;

        if (d.error) {
          if (applyTtCache(term, week)) {
            renderTimetable();
            animateTimetable(dir);
            setWeekPending(false);
            toast('无法获取，显示第 ' + state.week + ' 周的本地缓存');
            return;
          }
          state.ttError = d.error;
          state.courses = [];
          renderTimetable();
          setWeekPending(false);
          return;
        }

        clearOffline();
        state.week = week;
        state.term = term;
        state.ttError = '';
        state.days = d.days || [];
        state.courses = (d.courses || []).map(function (c) {
          return {
            name: c.name, teacher: c.teacher || '', room: c.room || '',
            day: c.day || 0, start: c.start || 0, end: c.end || 0, weeks: c.weeks || '',
            code: c.code || '', cls: c.cls || '', hours: c.hours || '',
            people: c.people || '', mode: c.mode || '', content: c.content || ''
          };
        });
        saveTtCache();
        renderTimetable();
        animateTimetable(dir);
        setWeekPending(false);
      })
      .catch(function (e) {
        setWeekPending(false);
        // 网络异常也尝试用缓存
        if (applyTtCache(state.term, w)) {
          renderTimetable();
          toast('网络异常，显示本地缓存');
        } else {
          // 连缓存都没有：仍然切到目标周并显示空状态，不要卡在原周
          state.week = w;
          state.courses = [];
          state.ttError = '无法联网，且这一周没有本地缓存';
          renderTimetable();
          animateTimetable(dir);
          toast('第 ' + w + ' 周 · 无法联网');
        }
      });
  }

  function setWeekPending(on) {
    var el = $('#weekLabel');
    if (!el) return;
    el.classList.toggle('pending', !!on);
  }

  /** 课表滑动动画：下一周从右进，上一周从左进 */
  function animateTimetable(dir) {
    // 换页动画统一由 #ttStrip 的 CSS transform 过渡完成。
    // 这里原本会加 .anim-left/.anim-right（opacity .35 → 1 的淡入），
    // 与翻页位移叠加后就表现为"换页完闪一下"，所以不再使用。
  }

  /** 上一周 / 下一周 */
  function goWeek(delta) {
    goToWeek((state.week || 1) + delta);
  }

  /** 周次选择器：直接点第几周 */
  /** 把 yyyy-MM-dd 解析成本地 Date（避免时区偏移） */
  function parseYmd(s) {
    if (!s || s.length < 10) return null;
    var y = parseInt(s.substr(0, 4), 10);
    var m = parseInt(s.substr(5, 2), 10) - 1;
    var d = parseInt(s.substr(8, 2), 10);
    var dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  function fmtMd(dt) {
    return two(dt.getMonth() + 1) + '-' + two(dt.getDate());
  }

  /** 第 w 周对应的日期范围文字，如 11-02 ~ 11-08 */
  function weekDateRange(w) {
    var s = parseYmd(state.termStart || state.startDate);
    if (!s || !w) return '';
    var a = new Date(s.getTime());
    a.setDate(a.getDate() + (w - 1) * 7);
    var b = new Date(a.getTime() + 6 * 86400000);
    return fmtMd(a) + '~' + fmtMd(b);
  }

  /** 某个日期属于第几教学周 */
  function weekOfDate(ymd) {
    var s = parseYmd(state.termStart || state.startDate);
    var d = parseYmd(ymd);
    if (!s || !d) return 0;
    var days = Math.floor((d.getTime() - s.getTime()) / 86400000);
    var w = Math.floor(days / 7) + 1;
    if (w < 1) w = 1;
    if (w > (state.totalWeeks || 22)) w = state.totalWeeks || 22;
    return w;
  }

  function showWeekPicker() {
    closeWeekPicker();
    var total = state.totalWeeks || 22;
    var today = new Date();
    var todayYmd = today.getFullYear() + '-' + two(today.getMonth() + 1) + '-' + two(today.getDate());

    var html = '<div class="wp-mask" id="wpMask"></div>' +
      '<div class="wp-sheet">' +
      '<div class="wp-title">选择教学周 · 共 ' + total + ' 周</div>';

    // 按日期跳转
    if (state.startDate) {
      html += '<div class="wp-date-row">' +
        '<input type="date" id="wpDate" class="wp-date-input" value="' + todayYmd + '">' +
        '<button class="wp-date-btn" id="wpDateGo">按日期跳转</button>' +
        '</div>';
    }

    html += '<div class="wp-grid">';
    for (var i = 1; i <= total; i++) {
      var range = weekDateRange(i);
      html += '<div class="wp-item' + (i === state.week ? ' on' : '') +
        '" data-w="' + i + '">' +
        '<span class="wp-n">' + i + '</span>' +
        (range ? '<span class="wp-d">' + range + '</span>' : '') +
        '</div>';
    }
    html += '</div></div>';

    var el = document.createElement('div');
    el.id = 'weekPicker';
    el.className = 'week-picker';
    el.innerHTML = html;
    document.body.appendChild(el);

    el.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.id === 'wpMask') { closeWeekPicker(); return; }
      if (t && t.id === 'wpDateGo') {
        var inp = document.getElementById('wpDate');
        var v = inp ? inp.value : '';
        var w = weekOfDate(v);
        if (w > 0) {
          closeWeekPicker();
          goToWeek(w);
        } else {
          toast('请选择有效日期');
        }
        return;
      }
      // 点周次（可能在子元素上）
      var node = t;
      while (node && node !== el) {
        var w2 = node.getAttribute ? node.getAttribute('data-w') : null;
        if (w2) { closeWeekPicker(); goToWeek(parseInt(w2, 10)); return; }
        node = node.parentNode;
      }
    });
  }

  function closeWeekPicker() {
    var el = document.getElementById('weekPicker');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* ================= 嗅探数据解析 ================= */
  var NAME_KEYS = ['kcmc', 'courseName', 'kcm', 'kcname', 'coursename', 'kcmcZh', 'course_name', 'kcmcname'];
  var TEACH_KEYS = ['xm', 'jsxm', 'teacherName', 'teacher', 'teacher_name', 'skls', 'jsxmZh'];
  var ROOM_KEYS = ['cdmc', 'jsmc', 'classroom', 'room', 'place', 'skdd', 'jsmcZh'];
  var DAY_KEYS = ['xqj', 'weekDay', 'weekday', 'dayOfWeek', 'xingqi', 'xqjdm', 'week_day'];
  var SEC_KEYS = ['jcs', 'jc', 'section', 'jieci', 'jcsdm', 'jcstr', 'sections'];
  var WEEK_KEYS = ['zcd', 'zcs', 'week', 'weeks', 'zcmc', 'zc', 'weekstr'];
  var CREDIT_KEYS = ['xf', 'credit', 'credits', 'creditValue', 'xfZh'];
  var SCORE_KEYS = ['cj', 'score', 'zscj', 'totalScore', 'kscj', 'scorestr'];
  var GPA_KEYS = ['jd', 'gpa', 'gradePoint', 'jdpj', 'xfjd'];

  function pick(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      if (obj[keys[i]] !== undefined && obj[keys[i]] !== null && obj[keys[i]] !== '') return obj[keys[i]];
    }
    return null;
  }

  function walk(o, fn, depth) {
    if (!o || typeof o !== 'object' || (depth || 0) > 14) return;
    fn(o);
    if (Array.isArray(o)) {
      for (var i = 0; i < o.length; i++) walk(o[i], fn, (depth || 0) + 1);
    } else {
      for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) walk(o[k], fn, (depth || 0) + 1);
    }
  }

  function normDay(v) {
    if (v == null) return 0;
    var s = String(v);
    var map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
    if (map[s]) return map[s];
    var m = s.match(/([1-7])/);
    if (m) return parseInt(m[1], 10);
    if (s.indexOf('星期') >= 0 || s.indexOf('周') >= 0) {
      for (var k in map) if (s.indexOf(k) >= 0) return map[k];
    }
    return 0;
  }

  function normSection(v) {
    if (v == null) return { start: 0, end: 0 };
    var s = String(v);
    var nums = s.match(/\d+/g);
    if (!nums) return { start: 0, end: 0 };
    if (nums.length >= 2) {
      return { start: parseInt(nums[0], 10), end: parseInt(nums[1], 10) };
    }
    var n = parseInt(nums[0], 10);
    // "12" 这种可能是 1-2 节，也可能是第 12 节；课表里通常一节占 2 小节
    return { start: n, end: n };
  }

  function parseCapture(log) {
    var courses = [], grades = [], cet = [];
    var seenC = {}, seenG = {};

    for (var i = 0; i < log.length; i++) {
      var body = log[i].b;
      if (!body || body.charAt(0) !== '{' && body.charAt(0) !== '[') continue;
      var js;
      try { js = JSON.parse(body); } catch (e) { continue; }

      walk(js, function (o) {
        if (Array.isArray(o)) return;
        var nm = pick(o, NAME_KEYS);
        if (!nm || typeof nm !== 'string' || nm.length > 60) return;

        var day = pick(o, DAY_KEYS);
        var sec = pick(o, SEC_KEYS);
        var wk = pick(o, WEEK_KEYS);
        var credit = pick(o, CREDIT_KEYS);
        var score = pick(o, SCORE_KEYS);
        var gpa = pick(o, GPA_KEYS);

        var looksCourse = day != null && sec != null;
        var looksGrade = credit != null && (score != null || gpa != null);

        if (looksCourse) {
          var key = nm + '|' + day + '|' + sec;
          if (!seenC[key]) {
            seenC[key] = 1;
            var ds = normSection(sec);
            courses.push({
              name: nm,
              teacher: pick(o, TEACH_KEYS) || '',
              room: pick(o, ROOM_KEYS) || '',
              day: normDay(day),
              start: ds.start,
              end: ds.end,
              weeks: wk == null ? '' : String(wk)
            });
          }
        } else if (looksGrade) {
          var gk = nm + '|' + (score == null ? '' : score);
          if (!seenG[gk]) {
            seenG[gk] = 1;
            grades.push({
              name: nm,
              credit: parseFloat(credit) || 0,
              score: score == null ? '' : String(score),
              gpa: gpa == null ? null : parseFloat(gpa)
            });
          }
        }
      });
    }

    // 绩点 / 加权平均 / 学分
    var gpa = null, avg = null, totalCredit = 0;
    if (grades.length) {
      var cwSum = 0, wSum = 0, gSum = 0, gW = 0;
      grades.forEach(function (g) {
        var sc = parseFloat(g.score);
        if (!isNaN(sc) && g.credit > 0) {
          cwSum += sc * g.credit;
          wSum += g.credit;
        }
        if (g.gpa != null && g.credit > 0) {
          gSum += g.gpa * g.credit;
          gW += g.credit;
        }
        totalCredit += g.credit;
      });
      if (wSum > 0) avg = cwSum / wSum;
      if (gW > 0) gpa = gSum / gW;
    }

    state.courses = courses;
    state.grades = grades;
    state.gpa = gpa;
    state.avgScore = avg;
    state.totalCredit = totalCredit;
  }

  /* ================= 渲染 ================= */
  /* 广工官方作息时间（www.gdut.edu.cn 学校作息时间） */
  var SECTIONS = [
    ['08:30', '09:15'], ['09:20', '10:05'], ['10:25', '11:10'], ['11:15', '12:00'],
    ['13:50', '14:35'], ['14:40', '15:25'], ['15:30', '16:15'],
    ['16:30', '17:15'], ['17:20', '18:05'],
    ['18:30', '19:15'], ['19:20', '20:05'], ['20:10', '20:55']
  ];

  function secStart(n) { var s = SECTIONS[n - 1]; return s ? s[0] : ''; }
  function secEnd(n) { var s = SECTIONS[n - 1]; return s ? s[1] : ''; }
  function two(n) { return n < 10 ? '0' + n : '' + n; }

  function todayDateStr() {
    var t = new Date();
    return two(t.getMonth() + 1) + '-' + two(t.getDate());
  }

  function dayDate(d) {
    var arr = state.days || [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].day === d) {
        var s = arr[i].date || '';
        return s.length >= 10 ? s.substring(5) : '';
      }
    }
    return '';
  }

  function csRow(k, v) {
    return '<div class="cs-row"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
  }

  function closeCourse() {
    $('#course').classList.add('hidden');
  }

  function showCourse(idx) {
    var c = state.courses[idx];
    if (!c) return;
    var DAY = ['一', '二', '三', '四', '五', '六', '日'];
    var startT = secStart(c.start);
    var endT = secEnd(c.end || c.start);
    var secText = '第 ' + c.start + (c.end && c.end !== c.start ? '-' + c.end : '') + ' 节';
    var dateText = dayDate(c.day);
    var timeRange = startT ? (startT + ' – ' + endT) : '';

    var html = '<div class="cs-head">' +
      '<div class="cs-dot" style="background:' + colorOf(c.name) + '"></div>' +
      '<div><div class="cs-title">' + esc(c.name) + '</div>' +
      '<div class="cs-sub">' + esc(c.mode || '课程') +
      (c.code ? ' · ' + esc(c.code) : '') + '</div></div></div>';

    html += '<div class="cs-grid">';
    html += csRow('时间', '<b>每周' + DAY[c.day - 1] + ' ' + secText + '</b>' +
      (timeRange ? '<br>' + esc(timeRange) : '') +
      (dateText ? '<br><span style="color:#8b93a7;font-size:12px">' + dateText + '</span>' : ''));
    html += csRow('地点', esc(c.room || '未安排教室'));
    html += csRow('教师', esc(c.teacher || '—'));
    if (c.weeks) html += csRow('周次', '第 ' + esc(c.weeks) + ' 周');
    if (c.cls) html += csRow('教学班', esc(c.cls));
    if (c.hours) {
      html += csRow('学时', esc(c.hours) + ' 学时' +
        (c.people ? ' · ' + esc(c.people) + ' 人' : ''));
    }
    if (c.content) html += csRow('内容', esc(c.content));
    html += '</div>';
    html += '<button class="cs-close" id="csClose">关闭</button>';

    $('#courseSheet').innerHTML = html;
    $('#course').classList.remove('hidden');
    $('#csClose').addEventListener('click', closeCourse);
  }

  /* ================= 每门课自定义颜色 ================= */
  function getCourseColors() {
    try {
      var sc = localStorage.getItem('courseColors');
      return sc ? JSON.parse(sc) : {};
    } catch (e) { return {}; }
  }

  function saveCourseColors(m) {
    try { localStorage.setItem('courseColors', JSON.stringify(m)); } catch (e) {}
  }

  function setCourseColor(name, hex) {
    var m = getCourseColors();
    if (hex) m[name] = hex;
    else delete m[name];
    saveCourseColors(m);
  }

  function resetAllCourseColors() {
    try { localStorage.removeItem('courseColors'); } catch (e) {}
    renderTimetable();
    toast('所有课程颜色已恢复默认');
  }

  /** 课程颜色：优先用自定义，否则按课程名散列到内置调色板 */
  function colorOf(name) {
    var m = getCourseColors();
    if (m[name]) return m[name];
    var pal = currentPalette();
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return pal.colors[h % pal.colors.length];
  }

  /** 打开某门课的颜色选择器 */
  function showCourseColorPicker(name) {
    var cur = getCourseColors()[name] || '';
    var html = '<div class="ccp-mask" id="ccpMask"></div>' +
      '<div class="ccp-sheet">' +
      '<div class="ccp-title">' + esc(name) + '</div>' +
      '<div class="ccp-grid">' +
      '<div class="ccp-item' + (cur ? '' : ' on') + '" data-c=""><span class="ccp-none">默认</span></div>';
    CC_COLORS.forEach(function (c) {
      html += '<div class="ccp-item' + (cur === c ? ' on' : '') + '" data-c="' + c + '">' +
        '<span class="ccp-sw" style="background:' + c + '"></span></div>';
    });
    html += '</div>' +
      '<div class="ccp-foot">' +
      '<div class="ccp-btn" id="ccpAllReset">全部恢复默认</div>' +
      '<div class="ccp-btn primary" id="ccpClose">关闭</div>' +
      '</div></div>';
    var el = document.createElement('div');
    el.id = 'courseColorPicker';
    el.className = 'ccp';
    el.innerHTML = html;
    document.body.appendChild(el);

    el.addEventListener('click', function (e) {
      var t = e.target;
      if (!t) return;
      if (t.id === 'ccpMask' || t.id === 'ccpClose') { closeCcp(); return; }
      if (t.id === 'ccpAllReset') {
        resetAllCourseColors();
        closeCcp();
        return;
      }
      var item = t.closest ? t.closest('.ccp-item') : null;
      if (item) {
        var c = item.getAttribute('data-c');
        setCourseColor(name, c);
        renderTimetable();
        closeCcp();
        toast(c ? '已设置颜色' : '已恢复默认颜色');
      }
    });
  }

  function closeCcp() {
    var el = document.getElementById('courseColorPicker');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  var CC_COLORS = [
    '#3b82f6', '#60a5fa', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16',
    '#eab308', '#f59e0b', '#f97316', '#ef4444', '#dc2626', '#ec4899',
    '#d946ef', '#a855f7', '#7c3aed', '#6366f1', '#0ea5e9', '#64748b',
    '#0f172a', '#334155'
  ];
  /** 把某一周的课程渲染成完整网格（周一到周日 7 列）；courses 为空时渲染空网格 */
  /** 只更新下方的课程清单（换页时用，避免整块重建） */
  function renderCourseList(cs) {
    var card = $('#courseListCard');
    if (!card) return;
    var days = ['一', '二', '三', '四', '五', '六', '日'];
    cs = cs || [];
    var byName = {};
    cs.forEach(function (c) { (byName[c.name] = byName[c.name] || []).push(c); });
    var html2;
    if (!cs.length) {
      html2 = '<div class="card-title">课程 · 0 门</div>' +
        '<div class="meta" style="padding:6px 0 10px;color:var(--sub)">' +
        (state.ttError || '这一周没有课，左右滑动可以查看别的周') + '</div>';
    } else {
      html2 = '<div class="card-title">课程 · ' + Object.keys(byName).length + ' 门</div>';
      Object.keys(byName).forEach(function (n) {
        var arr = byName[n];
        var c = arr[0];
        var times = arr.map(function (x) { return '周' + days[x.day - 1] + ' 第' + x.start + '-' + x.end + '节'; }).join('，');
        var isCustom = !!getCourseColors()[n];
        html2 += '<div class="course-row"><div style="flex:1">' +
          '<div class="nm">' + esc(n) + '</div>' +
          '<div class="meta">' + esc(times) + (c.teacher ? ' · ' + esc(c.teacher) : '') + (c.room ? ' · ' + esc(c.room) : '') + '</div>' +
          '</div>' +
          '<span class="cc-dot' + (isCustom ? ' custom' : '') + '" data-name="' + esc(n) + '"' +
          ' style="background:' + colorOf(n) + '"></span>' +
          '</div>';
      });
    }
    card.innerHTML = html2;
  }
  function buildPane(courses, colW) {
    var days = ['一', '二', '三', '四', '五', '六', '日'];
    var cs = courses || [];

    var minS = 99, maxS = 0;
    cs.forEach(function (c) {
      if (c.start) minS = Math.min(minS, c.start);
      if (c.end) maxS = Math.max(maxS, c.end);
    });
    if (minS > maxS) { minS = 1; maxS = 8; }
    minS = Math.min(minS, 1);
    maxS = Math.max(maxS, Math.min(12, maxS));
    var sections = [];
    for (var s = minS; s <= maxS; s++) sections.push(s);

    var grid = {};
    cs.forEach(function (c, i) {
      c.__i = i;
      var e = c.end || c.start;
      for (var k = c.start; k <= e; k++) grid[c.day + '_' + k] = c;
    });

    var todayStr = todayDateStr();
    var css = 'width:' + (26 + colW * 7 + 3 * 7) + 'px;grid-template-columns:26px repeat(7,' + colW + 'px)';
    var html = '<div class="timetable" style="' + css + '">';
    html += '<div class="tt-head" style="grid-row:1;grid-column:1"></div>';
    for (var d = 1; d <= 7; d++) {
      var dd = dayDate(d);
      var isToday = dd && dd === todayStr;
      html += '<div class="tt-head" style="grid-row:1;grid-column:' + (d + 1) + '">' + days[d - 1] +
        (dd ? '<span class="tt-date' + (isToday ? ' today' : '') + '">' + dd + '</span>' : '') +
        '</div>';
    }
    sections.forEach(function (sec, idx) {
      var row = idx + 2;
      html += '<div class="tt-side" style="grid-row:' + row + ';grid-column:1">' + sec + '</div>';
      for (var d = 1; d <= 7; d++) {
        var c = grid[d + '_' + sec];
        if (c && c.start === sec) {
          var span = Math.min((c.end || c.start) - c.start + 1, sections.length - idx);
          html += '<div class="tt-cell" style="grid-row:' + row + ' / span ' + span +
            ';grid-column:' + (d + 1) + '">' +
            '<div class="tt-course" data-idx="' + c.__i + '" style="background:' + colorOf(c.name) + '">' +
            '<span class="n">' + esc(shortName(c.name)) + '</span>' +
            (c.room ? '<span class="r">' + esc(c.room) + '</span>' : '') +
            (c.teacher ? '<span class="r">' + esc(c.teacher) + '</span>' : '') +
            '</div></div>';
        } else if (!c) {
          html += '<div class="tt-cell" style="grid-row:' + row + ';grid-column:' + (d + 1) + '"></div>';
        }
      }
    });
    html += '</div>';
    return html;
  }

  /** 取某周的课程（优先本地缓存），没有则返回空数组 */
  function coursesOfWeek(w) {
    if (w < 1 || w > (state.totalWeeks || 22)) return [];
    try {
      var c = loadTtCache(state.term, w);
      if (c && c.courses) return c.courses;
    } catch (e) {}
    return [];
  }
  function renderTimetable() {
    var wrap = $('#ttWrap');
    var cs = state.courses;

    // 这一周没课也要渲染条带（空网格），否则手势无处可滑、换不了周
    var isEmptyWeek = !cs.length;
    if (isEmptyWeek) {
      var emsg = state.ttError
        ? state.ttError
        : '第 ' + (state.week || 1) + ' 周教务系统没有返回课程。';
    }

    // 连续时间线：上一周 | 本周 | 下一周 并排，横向滚动可以一路滑过去
    var vpW = document.documentElement.clientWidth || 360;
    var colW = Math.max(46, Math.floor((vpW - 108) / 5));
    var curW = state.week || 1;
    var prevC = coursesOfWeek(curW - 1);
    var nextC = coursesOfWeek(curW + 1);
    var pageW = 26 + colW * 7 + 3 * 8 + 8;
    state.pageW = pageW;
    var html = '<div class="tt-scroll" id="ttScroll">' +
      '<div class="tt-strip" id="ttStrip" style="width:' + (pageW * 3) + 'px">' +
      '<div class="tt-week" style="width:' + pageW + 'px">' + buildPane(prevC, colW) + '</div>' +
      '<div class="tt-week" style="width:' + pageW + 'px">' + buildPane(cs, colW) + '</div>' +
      '<div class="tt-week" style="width:' + pageW + 'px">' + buildPane(nextC, colW) + '</div>' +
      '</div></div>';
    // ★ 增量更新：条带还在就只替换必要的那一页，不重建外层 DOM
    var existStrip = $('#ttStrip');
    if (existStrip && existStrip.children.length === 3) {
      var rot = state.lastDir || 0;
      if (rot > 0) {
        // 切到下一周：把第一页挪到末尾，只重建新的「下一周」这一页
        existStrip.appendChild(existStrip.children[0]);
        existStrip.children[2].innerHTML = buildPane(nextC, colW);
      } else if (rot < 0) {
        // 切到上一周：把最后一页挪到最前，只重建新的「上一周」这一页
        existStrip.insertBefore(existStrip.children[2], existStrip.children[0]);
        existStrip.children[0].innerHTML = buildPane(prevC, colW);
      } else {
        existStrip.children[0].innerHTML = buildPane(prevC, colW);
        existStrip.children[1].innerHTML = buildPane(cs, colW);
        existStrip.children[2].innerHTML = buildPane(nextC, colW);
      }
      existStrip.style.width = (pageW * 3) + 'px';
      for (var wi = 0; wi < 3; wi++) existStrip.children[wi].style.width = pageW + 'px';
      renderCourseList(cs);
      $('#weekLabel').textContent = '第 ' + (state.week || 1) + ' 周';
      state.lastDir = 0;
      if (typeof ttSetPos === 'function') ttSetPos(pageW, false);
      return;
    }


    var days = ['一', '二', '三', '四', '五', '六', '日'];
    html += '<div class="card" id="courseListCard" style="margin-top:12px"></div>';

    wrap.innerHTML = html;
    renderCourseList(cs);
    $('#weekLabel').textContent = '第 ' + (state.week || 1) + ' 周';

    // 每次重建后：复位并绑定滚动跨周
    initTTSwipe();

    // 点课程行右侧的色点 → 打开该课颜色选择器
    if (!wrap.__ccBound) {
      wrap.__ccBound = true;
      wrap.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var dot = t.closest('.cc-dot');
        if (!dot) return;
        var nm = dot.getAttribute('data-name');
        if (nm) showCourseColorPicker(nm);
      });
    }
  }

  function shortName(n) {
    return n.length > 9 ? n.slice(0, 9) + '…' : n;
  }

  function scoreClass(sc) {
    var v = parseFloat(sc);
    if (isNaN(v)) return '';
    if (v >= 90) return 's-excellent';
    if (v >= 80) return 's-good';
    if (v >= 60) return 's-mid';
    return 's-low';
  }

  function renderGrades() {
    var wrap = $('#gradeWrap');
    var gs = state.grades;

    if (!gs.length) {
      wrap.innerHTML = emptyState(
        '还没有成绩数据',
        '打开教务系统进入「成绩查询」页面，成绩会自动被读取。',
        '打开教务系统'
      );
      bindOpenSite(wrap);
      return;
    }

    var html = '<div class="gpa-hero"><div class="gpa-box">' +
      '<div class="k">平均学分绩点</div>' +
      '<div class="v">' + (state.gpa == null ? '—' : state.gpa.toFixed(2)) + '</div>' +
      '<div class="u">' + gs.length + ' 门课程</div></div></div>';

    html += '<div class="stat-grid">' +
      '<div class="stat"><div class="k">加权平均分</div><div class="v">' +
        (state.avgScore == null ? '—' : state.avgScore.toFixed(1)) + '</div></div>' +
      '<div class="stat"><div class="k">总学分</div><div class="v">' +
        (state.totalCredit ? state.totalCredit.toFixed(1) : '—') + '</div></div>' +
      '<div class="stat"><div class="k">专业排名</div><div class="v">' +
        (state.rank || '—') + '</div></div>' +
      '<div class="stat"><div class="k">统计课程</div><div class="v">' +
        gs.length + '</div></div></div>';
    if (!state.rank) {
      html += '<div class="muted" style="margin:-4px 4px 10px">' +
        '排名需教务系统返回，可在「打开教务系统 → 成绩排名」里查看</div>';
    }

    html += '<div class="card" style="margin-top:12px"><div class="card-title">全部成绩</div>';
    gs.slice().sort(function (a, b) { return b.credit - a.credit; }).forEach(function (g) {
      html += '<div class="course-row"><div style="flex:1">' +
        '<div class="nm">' + esc(g.name) + '</div>' +
        '<div class="meta">' + (g.credit ? g.credit + ' 学分' : '') +
        (g.gpa != null ? ' · 绩点 ' + g.gpa.toFixed(2) : '') + '</div></div>' +
        '<div class="score-pill ' + scoreClass(g.score) + '">' + esc(g.score || '—') + '</div></div>';
    });
    html += '</div>';

    wrap.innerHTML = html;
  }

  /* 通用成绩行渲染：不确定接口字段时按常见映射展示，未知字段也不丢 */
  var FIELD_LABELS = {
    kmmc: '科目', ksmc: '考试', kjmc: '级别', dj: '级别', kcdj: '级别', kcdjmc: '级别',
    cj: '成绩', zf: '总分', score: '成绩', total: '总分', zcj: '总成绩',
    tl: '听力', yd: '阅读', xz: '写作', fy: '翻译', lh: '综合',
    ksrq: '考试日期', xnxqdm: '学期', xnxq: '学期',
    mc: '名称', xmmc: '项目', xmmc2: '项目', csmc: '测试项目',
    df: '得分', dj2: '等级', cj2: '成绩', bz: '备注', jl: '结论',
    xb: '性别', nj: '年级', sfzh: '学号'
  };

  function rowsToCards(rows, emptyText) {
    var allKeys = {};
    rows.forEach(function (r) {
      Object.keys(r).forEach(function (k) {
        var v = r[k];
        if (v !== null && v !== undefined && String(v).trim() !== '') allKeys[k] = 1;
      });
    });
    var known = Object.keys(FIELD_LABELS).filter(function (k) { return allKeys[k]; });
    var keys = known.length ? known : Object.keys(allKeys).slice(0, 8);

    // 主标题字段
    var titleKey = null;
    ['kmmc', 'ksmc', 'xmmc', 'csmc', 'mc'].some(function (k) {
      if (allKeys[k]) { titleKey = k; return true; }
      return false;
    });

    var html = '';
    rows.forEach(function (r) {
      var title = titleKey ? String(r[titleKey] || '') : '记录';
      var big = '';
      ['cj', 'zf', 'score', 'df', 'total'].some(function (k) {
        if (r[k] !== undefined && String(r[k]).trim() !== '') { big = String(r[k]); return true; }
        return false;
      });
      html += '<div class="card" style="padding:14px 16px">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between">' +
        '<div style="font-size:15px;font-weight:600">' + esc(title || '—') + '</div>' +
        (big ? '<div style="font-size:22px;font-weight:700;color:var(--blue)">' + esc(big) + '</div>' : '') +
        '</div>';
      var meta = [];
      keys.forEach(function (k) {
        if (k === titleKey) return;
        if (['cj', 'zf', 'score', 'df', 'total'].indexOf(k) >= 0) return;
        var v = r[k];
        if (v === null || v === undefined || String(v).trim() === '') return;
        meta.push((FIELD_LABELS[k] || k) + ' ' + v);
      });
      if (meta.length) {
        html += '<div class="meta" style="margin-top:6px">' + esc(meta.join(' · ')) + '</div>';
      }
      html += '</div>';
    });
    return html;
  }

  function renderCet() {
    var wrap = $('#cetWrap');
    var rows = state.cetRows || [];
    if (!rows.length) {
      wrap.innerHTML = emptyState(
        '还没有四六级成绩',
        state.cetError ? state.cetError
          : '教务系统「考级成绩」里暂无记录。大一新生一般还没考，考过之后这里会自动出现。',
        '重新加载'
      );
      bindOpenSite(wrap);
      return;
    }
    wrap.innerHTML = rowsToCards(rows);
  }

  function renderFitness() {
    var wrap = $('#fitWrap');
    var rows = state.fitRows || [];
    if (!rows.length) {
      wrap.innerHTML = emptyState(
        '还没有体测成绩',
        state.fitError ? state.fitError
          : '教务系统「体测成绩」里暂无记录。体测成绩录入后这里会自动出现。',
        '重新加载'
      );
      bindOpenSite(wrap);
      return;
    }
    wrap.innerHTML = rowsToCards(rows);
  }

  function emptyState(title, desc, action) {
    return '<div class="empty">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="#2f6bff" stroke-width="1.4" stroke-linecap="round">' +
      '<rect x="3" y="4.5" width="18" height="16" rx="3"/>' +
      '<path d="M3 9.5h18M9 9.5v11M15 9.5v11"/></svg>' +
      '<div class="t">' + esc(title) + '</div>' +
      '<div class="d">' + esc(desc) + '</div>' +
      '<div class="btn-ghost" data-open-site="1">' + esc(action) + '</div></div>';
  }

  function bindOpenSite(root) {
    var b = root.querySelector('[data-open-site]');
    if (b) b.addEventListener('click', function () { refresh(false); });
  }

  function openSite() {
    call('browse', { url: 'https://jxfw.gdut.edu.cn/new/' }).catch(function (e) {
      toast('打开失败：' + e.message);
    });
  }

  /* ================= 页面切换 ================= */
  var TITLES = { tt: '我的课表', grade: '成绩与绩点', cet: '英语四六级', fit: '体测成绩', me: '我的' };

  function switchPage(p) {
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.page === p); });
    $$('.page').forEach(function (el) { el.classList.remove('active'); });
    var page = $('#page-' + p);
    if (page) page.classList.add('active');
    if ($('#pageTitle')) $('#pageTitle').textContent = TITLES[p] || '广工课表';
    $('.content').scrollTop = 0;
  }

  /* ================= 协议 ================= */
  var agreed = false;

  var TERMS_HTML =
    '<p>欢迎使用「广工课表」。使用前请阅读以下说明。</p>' +
    '<h4>一、这个 App 做什么</h4>' +
    '<p>它只是把广东工业大学教务系统（jxfw.gdut.edu.cn）里的课表、成绩、等级考试成绩用更顺手的方式展示出来。' +
    '所有数据都来自学校系统，本应用不提供、也不修改任何学校数据。</p>' +
    '<h4>二、关于你的账号</h4>' +
    '<p>1. 账号密码只用于向学校统一身份认证（authserver.gdut.edu.cn）发起一次登录请求，' +
    '这是学校的官方登录接口，本应用不经过任何第三方服务器。</p>' +
    '<p>2. <b>本应用不保存你的密码</b>，只保存登录成功后学校下发的会话凭证（Cookie），' +
    '它等价于"已登录状态"，退出登录即清除。</p>' +
    '<p>3. 所有请求都是你手机直接和学校服务器通信，本应用没有后端、不上传任何数据到第三方。</p>' +
    '<h4>三、数据准确性</h4>' +
    '<p>课表、绩点等由教务系统返回后仅做展示与本地计算，若与学校系统显示不一致，以学校系统为准。' +
    '请勿把本应用的数据用于正式场合的证明材料。</p>' +
    '<h4>四、使用方式</h4>' +
    '<p>请仅使用你自己的账号登录，不要用它查询他人信息或做批量抓取。' +
    '因违反学校规定产生的一切后果由使用者自行承担。</p>' +
    '<h4>五、更新</h4>' +
    '<p>应用支持在线检查更新，更新包同样只从你配置的地址下载，安装前系统会再次向你确认。</p>' +
    '<h4>六、免责</h4>' +
    '<p>本应用为个人学习作品，与广东工业大学官方无隶属关系。' +
    '学校系统改版可能导致部分功能暂时失效，届时请等待更新。</p>';

  function initTerms() {
    // 勾选逻辑统一走 bindLoginCheckboxes 的 document 委托（避免重复绑定导致切两次）
    var tc = $('#termsClose');
    if (tc) {
      tc.addEventListener('click', function () {
        var tm = $('#terms');
        if (tm) tm.classList.add('hidden');
      });
    }
    var tb = $('#termsBody');
    if (tb) tb.innerHTML = TERMS_HTML;
  }

  /* ================= 诊断 ================= */
  function diagSummary() {
    var p = [];
    p.push('第 ' + (state.week || 1) + ' 周');
    p.push((state.courses || []).length + ' 节课');
    p.push((state.grades || []).length + ' 门成绩');
    if (state.ttError) p.push('课表：' + state.ttError);
    if (state.gradeError) p.push('成绩：' + state.gradeError);
    return p.join(' · ');
  }

  function isApiUrl(u, t) {
    if (!u) return false;
    if (t === 'fetch' || t === 'xmlhttprequest') return true;
    if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|map)(\?|$)/i.test(u)) return false;
    return /api|json|query|list|data|course|grade|score|kb|kbcx/i.test(u);
  }

  function renderDiagnostics() {
    var el = $('#dumpMeta');
    if (el) el.textContent = '请求 ' + (state.netCount || 0) + ' 条 / 资源 ' +
      (state.resList || []).length + ' 个';
  }

  function showDiagnostics() {
    var log = state.netlog || [];
    var res = (state.resList || []).filter(function (r) { return isApiUrl(r.n, r.t); });
    var body = $('#diagBody');
    var html = '';

    html += '<div class="diag-row" style="background:#eef4ff">' +
      '<div class="u" style="font-weight:600">' + esc(diagSummary()) + '</div></div>';

    if (res.length) {
      html += '<div class="muted" style="margin:12px 0 8px">页面实际请求的接口（截图这段最能定位问题）</div>';
      res.forEach(function (r) {
        html += '<div class="diag-row"><div class="u">' + esc(r.n) + '</div>' +
          '<div class="m">' + esc(r.t || '') + '</div></div>';
      });
    }

    if (log.length) {
      html += '<div class="muted" style="margin:14px 0 8px">已捕获的响应</div>';
      log.forEach(function (r) {
        var b = r.b || '';
        html += '<div class="diag-row">' +
          '<div class="u">' + esc(r.u || '') + '</div>' +
          '<div class="m">' + esc(r.m || '') + ' · HTTP ' + esc(r.s == null ? '?' : r.s) +
          ' · ' + b.length + ' 字符</div>' +
          (b ? '<div class="m">' + esc(b.replace(/\s+/g, ' ').slice(0, 110)) + '</div>' : '') +
          '</div>';
      });
    }

    if (!res.length && !log.length) {
      html += '<div class="muted" style="margin-top:14px">' +
        '一条请求都没捕获到。<br><br>' +
        '请回到「课表」页点右上角 ⟳ 刷新；如果刷新后这里还是空的，' +
        '说明 App 没能读到教务系统页面（可能是登录态掉了，或页面还没加载完）。</div>';
    }

    body.innerHTML = html;
    $('#diag').classList.remove('hidden');
  }

  /* ================= 课程透明度 / 文字样式 ================= */
  var TEXT_COLORS = [
    'none',
    '#000000', '#111418', '#22262d', '#2b2f36', '#3a3f47', '#4b5563',
    '#6b7280', '#8b93a7', '#a8b0bf', '#b8c0d2', '#d5dbe7', '#e8ecf4',
    '#f2f4f8', '#ffffff',
    '#dc2626', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#2f6bff',
    '#7c5cff', '#ee46bc'
  ];

  function hex2rgb(c) {
    return [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16),
            parseInt(c.substr(5, 2), 16)];
  }

  /** 两色之间线性插值，t=0 取 a，t=1 取 b */
  function mix(a, b, t) {
    var A = hex2rgb(a), B = hex2rgb(b);
    var r = Math.round(A[0] + (B[0] - A[0]) * t);
    var g = Math.round(A[1] + (B[1] - A[1]) * t);
    var bl = Math.round(A[2] + (B[2] - A[2]) * t);
    function h(x) { return ('0' + x.toString(16)).slice(-2); }
    return '#' + h(r) + h(g) + h(bl);
  }

  /** 透明度：0 = 完全不透明，100 = 全透明 */
  function getCourseOpacity() {
    var v = 10;
    try { v = parseInt(localStorage.getItem('courseOpacity') || '10', 10); } catch (e) {}
    if (isNaN(v)) v = 10;
    return Math.min(100, Math.max(0, v));
  }

  function applyCourseOpacity(v) {
    try { localStorage.setItem('courseOpacity', String(v)); } catch (e) {}
    document.documentElement.style.setProperty('--course-op', (1 - v / 100).toFixed(2));
    var lab = $('#opacityVal');
    if (lab) lab.textContent = v + '%';
    var fill = $('#opacityFill');
    var thumb = $('#opacityThumb');
    if (fill) fill.style.width = v + '%';
    if (thumb) thumb.style.left = v + '%';
  }

  /* ================= 课表文字字号（五类独立） ================= */
  var TT_FS_KEYS = [
    { k: 'week', name: '周次' },
    { k: 'day', name: '星期' },
    { k: 'date', name: '日期' },
    { k: 'sec', name: '节数' },
    { k: 'course', name: '课程' }
  ];

  function getTtFs() {
    var d = {};
    TT_FS_KEYS.forEach(function (it) { d[it.k] = 100; });
    try {
      var s = localStorage.getItem('ttFontScale');
      if (s) {
        var o = JSON.parse(s);
        TT_FS_KEYS.forEach(function (it) {
          var v = parseInt(o[it.k], 10);
          if (!isNaN(v)) d[it.k] = Math.min(160, Math.max(70, v));
        });
      }
    } catch (e) {}
    return d;
  }

  function saveTtFs(d) {
    try { localStorage.setItem('ttFontScale', JSON.stringify(d)); } catch (e) {}
  }

  function applyTtFs() {
    var v = getTtFs();
    TT_FS_KEYS.forEach(function (it) {
      document.documentElement.style.setProperty('--fs-' + it.k, (v[it.k] / 100).toFixed(2));
    });
    renderTtFsList(v);
  }

  function setTtFs(key, val) {
    val = Math.min(160, Math.max(70, val));
    var v = getTtFs();
    v[key] = val;
    saveTtFs(v);
    applyTtFs();
  }
  function renderTtFsList(v) {
    var box = $('#ttFsList');
    if (!box) return;
    if (!box.children.length) {
      var html = '';
      TT_FS_KEYS.forEach(function (it) {
        html += '<div class="ttfs-row" data-k="' + it.k + '">' +
          '<span class="ttfs-name">' + it.name + '</span>' +
          '<div class="ttfs-slider">' +
            '<div class="ttfs-track"></div>' +
            '<div class="ttfs-fill"></div>' +
            '<div class="ttfs-thumb"></div>' +
          '</div>' +
          '<span class="ttfs-val">100%</span>' +
          '</div>';
      });
      box.innerHTML = html;
    }
    TT_FS_KEYS.forEach(function (it) {
      var row = box.querySelector('.ttfs-row[data-k="' + it.k + '"]');
      if (!row) return;
      var pct = v[it.k];
      var w = Math.max(0, Math.min(1, (pct - 70) / 90));
      var fill = row.querySelector('.ttfs-fill');
      var thumb = row.querySelector('.ttfs-thumb');
      var slider = row.querySelector('.ttfs-slider');
      var val = row.querySelector('.ttfs-val');
      if (val) val.textContent = pct + '%';

      // 位置完全交给 CSS 计算：--p 是 0~1 的进度，CSS 里按
      // left = 11px + (100% - 22px) * --p 定位，两端都不会溢出
      row.style.setProperty('--p', String(w));
    });
  }

  function initTtFontScale() {
    applyTtFs();
    // 首次渲染时滑块可能还没宽度，布局稳定后再补算两次
    setTimeout(function () { applyTtFs(); }, 60);
    setTimeout(function () { applyTtFs(); }, 320);
    window.addEventListener('resize', function () { applyTtFs(); });
    window.addEventListener('orientationchange', function () {
      setTimeout(function () { applyTtFs(); }, 260);
    });
    var box = $('#ttFsList');
    if (box) {
      var dragging = false, dragKey = null, dragEl = null;

      box.addEventListener('pointerdown', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var thumb = t.closest('.ttfs-thumb');
        if (!thumb) return;
        var row = thumb.closest('.ttfs-row');
        var key = row ? row.getAttribute('data-k') : null;
        if (!key) return;
        dragging = true;
        dragKey = key;
        dragEl = thumb;
        thumb.classList.add('dragging');
        try { thumb.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      });

      box.addEventListener('pointermove', function (e) {
        if (!dragging || !dragEl) return;
        var slider = dragEl.closest ? dragEl.closest(".ttfs-slider") : dragEl.parentNode;
        var r = slider.getBoundingClientRect();
        if (!r.width) return;
        var p = (e.clientX - r.left) / r.width;
        p = Math.max(0, Math.min(1, p));
        // 把点击位置换算回 70~160 之间（两端各留 11px 给圆点）
        var R = 11, W = r.width;
        var usable = Math.max(1, W - R * 2);
        var q = (e.clientX - r.left - R) / usable;
        q = Math.max(0, Math.min(1, q));
        var val = Math.round((70 + q * 90) / 5) * 5;
        setTtFs(dragKey, val);
        e.preventDefault();
      });

      function endDrag() {
        if (!dragging) return;
        dragging = false;
        if (dragEl) dragEl.classList.remove('dragging');
        dragEl = null;
      }
      box.addEventListener('pointerup', endDrag);
      box.addEventListener('pointercancel', endDrag);
      box.addEventListener('pointerleave', endDrag);
    }

    var reset = $('#ttFsReset');
    if (reset) {
      reset.addEventListener('click', function () {
        var d = {};
        TT_FS_KEYS.forEach(function (it) { d[it.k] = 100; });
        saveTtFs(d);
        applyTtFs();
        toast('课表文字字号已重置');
      });
    }
  }
  /* ================= 字体大小 ================= */
  function getFontScale() {
    var v = 100;
    try { v = parseInt(localStorage.getItem('fontScale') || '100', 10); } catch (e) {}
    if (isNaN(v)) v = 100;
    return Math.min(140, Math.max(80, v));
  }

  function applyFontScale(v) {
    v = Math.min(140, Math.max(80, v));
    try { localStorage.setItem('fontScale', String(v)); } catch (e) {}
    document.documentElement.style.setProperty('--fs', (v / 100).toFixed(2));
    var lab = $('#fontVal');
    if (lab) lab.textContent = v + '%';
    var fill = $('#fsFill');
    if (fill) fill.style.width = Math.round((v - 80) / 60 * 100) + '%';
  }

  function initFontScale() {
    applyFontScale(getFontScale());
    var minus = $('#fsMinus');
    var plus = $('#fsPlus');
    if (minus) {
      minus.addEventListener('click', function () {
        applyFontScale(getFontScale() - 5);
      });
    }
    if (plus) {
      plus.addEventListener('click', function () {
        applyFontScale(getFontScale() + 5);
      });
    }
  }
  /** 自定义滑块：只有按住圆点拖动才改变，点击轨道无效（防误触） */
  function initOpacitySlider() {
    var slider = $('#opacitySlider');
    var thumb = $('#opacityThumb');
    if (!slider || !thumb) return;

    var dragging = false;

    function posToVal(clientX) {
      var r = slider.getBoundingClientRect();
      if (!r.width) return 0;
      var p = (clientX - r.left) / r.width;
      p = Math.max(0, Math.min(1, p));
      return Math.round(p * 100 / 5) * 5;   // 每 5% 一档，和字号一致
    }

    thumb.addEventListener('pointerdown', function (e) {
      dragging = true;
      thumb.classList.add('dragging');
      try { thumb.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
      e.stopPropagation();
    });

    slider.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      applyCourseOpacity(posToVal(e.clientX));
      e.preventDefault();
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      thumb.classList.remove('dragging');
      try { thumb.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    slider.addEventListener('pointerup', endDrag);
    slider.addEventListener('pointercancel', endDrag);
    slider.addEventListener('pointerleave', endDrag);
  }

  function getAutoText() {
    try { return localStorage.getItem('autoText') !== '0'; } catch (e) { return true; }
  }

  /** 默认配色：白色文字 + 黑色描边 */
  var DEFAULT_TEXT_COLORS = {
    week: '#ffffff', day: '#ffffff', date: '#ffffff', sec: '#ffffff', course: '#ffffff',
    weekStroke: '#000000', dayStroke: '#000000', dateStroke: '#000000',
    secStroke: '#000000', courseStroke: '#000000'
  };

  function getTextColors() {
    var d = {};
    Object.keys(DEFAULT_TEXT_COLORS).forEach(function (k) { d[k] = DEFAULT_TEXT_COLORS[k]; });
    try {
      var s = localStorage.getItem('textColors');
      if (s) {
        var o = JSON.parse(s);
        Object.keys(d).forEach(function (k) {
          if (o[k]) d[k] = o[k];
        });
      }
    } catch (e) {}
    return d;
  }

  function resetTextColors() {
    try { localStorage.removeItem('textColors'); } catch (e) {}
    applyTextStyle();
    renderSwatches();
    toast('已恢复默认：白字黑边');
  }

  function saveTextColors(c) {
    try { localStorage.setItem('textColors', JSON.stringify(c)); } catch (e) {}
  }

  function getWallLum() {
    try {
      var v = parseInt(localStorage.getItem('wallLum') || '-1', 10);
      return isNaN(v) ? -1 : v;
    } catch (e) { return -1; }
  }

  /**
   * 按壁纸平均亮度算出四类文字的灰阶。
   * 不是简单的黑/白二选一，而是在黑、深灰、中灰、浅灰、白之间连续过渡。
   */
  function autoColors(lum) {
    if (lum < 0) lum = 235;          // 没设壁纸 → 当作很亮的背景
    // 阈值放在 120：只要背景不算暗，就一律用深色文字，
    // 避免"背景灰白、文字也灰白"的情况
    if (lum >= 120) {
      var k = Math.min(1, (255 - lum) / 135);
      return {
        dark: false,
        day: mix('#0d1015', '#3a4049', k),
        date: mix('#6f7683', '#8b93a1', k),
        sec: mix('#7a8290', '#98a0ae', k),
        course: '#ffffff'
      };
    }
    var k2 = Math.min(1, lum / 120);
    return {
      dark: true,
      day: mix('#ffffff', '#c6cede', k2),
      date: mix('#e4e9f2', '#a4aec2', k2),
      sec: mix('#e6ebf4', '#a2acc0', k2),
      course: '#ffffff'
    };
  }

  /** 描边强度档位 */
  var STROKES = [
    { id: 'auto', name: '自动' },
    { id: 'none', name: '无' },
    { id: 'thin', name: '细' },
    { id: 'mid', name: '中' },
    { id: 'thick', name: '粗' }
  ];

  function getStroke() {
    try { return localStorage.getItem('stroke') || 'auto'; } catch (e) { return 'auto'; }
  }

  function setStroke(id) {
    try { localStorage.setItem('stroke', id); } catch (e) {}
    renderStrokeRow();
    applyTextStyle();
    toast('文字描边：' + (STROKES.filter(function (s) { return s.id === id; })[0] || {}).name);
  }

  function renderStrokeRow() {
    var cur = getStroke();
    var html = '';
    STROKES.forEach(function (s) {
      html += '<div class="pal-item' + (s.id === cur ? ' on' : '') +
        '" data-s="' + s.id + '"><div class="pal-name" style="margin:0">' + s.name + '</div></div>';
    });
    var el = $('#strokeRow');
    if (el) el.innerHTML = html;
  }

  /** 文字亮度的粗略值 */
  function lumOf(hex) {
    var c = hex2rgb(hex);
    return (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000;
  }

  /** 判断一个颜色是深还是浅（用于决定描边用黑还是白） */
  function isLightColor(hex) {
    return lumOf(hex) > 128;
  }

  function getStrokeOn() {
    try { return localStorage.getItem('strokeOn') !== '0'; } catch (e) { return true; }
  }

  /** 按当前设置应用文字颜色与描边（不再有自适应） */
  function applyTextStyle() {
    var root = document.documentElement;
    var c = getTextColors();

    root.style.setProperty('--tt-week', c.week);
    root.style.setProperty('--tt-day', c.day);
    root.style.setProperty('--tt-date', c.date);
    root.style.setProperty('--tt-sec', c.sec);
    root.style.setProperty('--tt-course', c.course);

    // 每一类文字独立的描边颜色，'none' 表示不描边
    root.style.setProperty('--tt-stroke-week', strokeVal(c.weekStroke));
    root.style.setProperty('--tt-stroke-day', strokeVal(c.dayStroke));
    root.style.setProperty('--tt-stroke-date', strokeVal(c.dateStroke));
    root.style.setProperty('--tt-stroke-sec', strokeVal(c.secStroke));
    root.style.setProperty('--tt-stroke-course', strokeVal(c.courseStroke));

    // 描边粗细（全局）
    var mode = getStroke();
    var w = 0;
    if (mode === 'none') w = 0;
    else if (mode === 'thin') w = 0.7;
    else if (mode === 'mid') w = 1.2;
    else if (mode === 'thick') w = 2;
    else w = 1;
    root.style.setProperty('--tt-sw', w + 'px');

    var lab = $('#strokeVal');
    if (lab) {
      var cur = STROKES.filter(function (s) { return s.id === mode; })[0];
      lab.textContent = cur ? cur.name : '自动';
    }
  }

  function strokeVal(v) {
    return (!v || v === 'none') ? 'transparent' : v;
  }

  function renderSwatches() {
    var cur = getTextColors();
    Array.prototype.forEach.call(document.querySelectorAll('.swatches'), function (row) {
      var key = row.getAttribute('data-for');
      var html = '';
      TEXT_COLORS.forEach(function (col) {
        var isNone = col === 'none';
        html += '<div class="sw' + (isNone ? ' none' : '') +
          (cur[key] === col ? ' on' : '') +
          '" data-k="' + key + '" data-c="' + col + '"' +
          (isNone ? '' : ' style="background:' + col + '"') + '></div>';
      });
      row.innerHTML = html;
    });
  }

  /* ================= 壁纸与主题色 ================= */
  var THEMES = [
    { name: '蓝', main: '#2f6bff', dark: '#1f4fd8' },
    { name: '血红', main: '#dc2626', dark: '#991b1b' },
    { name: '玫红', main: '#f43f5e', dark: '#be123c' },
    { name: '酒红', main: '#9f1239', dark: '#670f25' },
    { name: '紫', main: '#7c5cff', dark: '#5b3fd6' },
    { name: '绿', main: '#12b76a', dark: '#0b8f52' },
    { name: '墨绿', main: '#047857', dark: '#02523c' },
    { name: '橙', main: '#f79009', dark: '#c26f00' },
    { name: '金', main: '#ca8a04', dark: '#854d0e' },
    { name: '粉', main: '#ee46bc', dark: '#c11574' },
    { name: '青', main: '#06aed4', dark: '#0885a3' },
    { name: '靛', main: '#344054', dark: '#1d2939' }
  ];

  /* 课程块配色方案 */
  var PALETTES = [
    {
      id: 'default', name: '默认', colors: [
        'linear-gradient(145deg,#4d8bff,#2f63e0)',
        'linear-gradient(145deg,#ff8a5b,#e8622f)',
        'linear-gradient(145deg,#3ecf8e,#12a866)',
        'linear-gradient(145deg,#a07bff,#7148d8)',
        'linear-gradient(145deg,#ff6f91,#d63c66)',
        'linear-gradient(145deg,#f7b955,#e09400)',
        'linear-gradient(145deg,#5ec7e8,#2b93bd)'
      ]
    },
    {
      id: 'soft', name: '柔和', colors: [
        'linear-gradient(145deg,#7fa8f0,#5f88d4)',
        'linear-gradient(145deg,#e9a58a,#cf8465)',
        'linear-gradient(145deg,#7fc9a6,#5aa887)',
        'linear-gradient(145deg,#a99ae0,#8878c4)',
        'linear-gradient(145deg,#e09aae,#c07a8e)',
        'linear-gradient(145deg,#dcc08a,#c0a067)',
        'linear-gradient(145deg,#8fc0d0,#6fa2b3)'
      ]
    },
    {
      id: 'warm', name: '暖阳', colors: [
        'linear-gradient(145deg,#ff6b5b,#e04633)',
        'linear-gradient(145deg,#ff9f43,#e07c1a)',
        'linear-gradient(145deg,#ffc048,#e09a12)',
        'linear-gradient(145deg,#ee5a7a,#cc3860)',
        'linear-gradient(145deg,#f4743b,#d1551e)',
        'linear-gradient(145deg,#d9455f,#b02a44)',
        'linear-gradient(145deg,#ffb86b,#e08f3a)'
      ]
    },
    {
      id: 'fresh', name: '清新', colors: [
        'linear-gradient(145deg,#3ecf8e,#12a866)',
        'linear-gradient(145deg,#4ddad4,#1aa8a3)',
        'linear-gradient(145deg,#5ec7e8,#2b93bd)',
        'linear-gradient(145deg,#7ed957,#4fae2c)',
        'linear-gradient(145deg,#6fd6c0,#39ab96)',
        'linear-gradient(145deg,#8ee3a1,#4fb56a)',
        'linear-gradient(145deg,#4fb3d9,#2c88b0)'
      ]
    },
    {
      id: 'mono', name: '单色', colors: [
        'linear-gradient(145deg, var(--blue), var(--blue-d))',
        'linear-gradient(145deg, var(--blue-d), var(--blue-d))',
        'linear-gradient(145deg, var(--blue), var(--blue))',
        'linear-gradient(145deg, var(--blue), var(--blue-d))',
        'linear-gradient(145deg, var(--blue-d), var(--blue))',
        'linear-gradient(145deg, var(--blue), var(--blue-d))',
        'linear-gradient(145deg, var(--blue-d), var(--blue-d))'
      ]
    }
  ];

  function currentPalette() {
    var id = 'default';
    try { id = localStorage.getItem('palette') || 'default'; } catch (e) {}
    for (var i = 0; i < PALETTES.length; i++) if (PALETTES[i].id === id) return PALETTES[i];
    return PALETTES[0];
  }

  function setPalette(id) {
    try { localStorage.setItem('palette', id); } catch (e) {}
    renderTimetable();
    toast('课程配色：' + currentPalette().name);
  }

  function renderPaletteRow() {
    var cur = currentPalette().id;
    var html = '';
    PALETTES.forEach(function (p) {
      var dots = '';
      for (var i = 0; i < 3; i++) {
        dots += '<span style="background:' + p.colors[i] + '"></span>';
      }
      html += '<div class="pal-item' + (p.id === cur ? ' on' : '') + '" data-p="' + p.id + '">' +
        '<div class="pal-dots">' + dots + '</div>' +
        '<div class="pal-name">' + p.name + '</div></div>';
    });
    var el = $('#paletteRow');
    if (el) el.innerHTML = html;
  }

  /* ================= 壁纸屏幕适应 ================= */
  function getWallFit() {
    try { return localStorage.getItem('wallFit') || 'width'; } catch (e) { return 'width'; }
  }

  function wallFitSize(fit) {
    if (fit === 'height') return 'auto 100%';   // 上下完整：高度撑满
    return '100% auto';                          // 左右完整：宽度撑满
  }
  function applyWallFit(fit) {
    try { localStorage.setItem('wallFit', fit); } catch (e) {}
    var img = $('#wpImg');
    if (img) {
      img.style.backgroundSize = wallFitSize(fit);
      img.style.backgroundRepeat = 'no-repeat';
      img.style.backgroundPosition = 'center';
    }
    renderWallFit();
  }

  function renderWallFit() {
    var fit = getWallFit();
    var row = $('#wallFitRow');
    if (row) {
      Array.prototype.forEach.call(row.children, function (el) {
        el.classList.toggle('on', el.getAttribute('data-fit') === fit);
      });
    }
    var lab = $('#wallFitVal');
    if (lab) lab.textContent = fit === 'height' ? '上下完整' : '左右完整';
    var block = $('#wallFitBlock');
    if (block) {
      var has = false;
      try { has = !!localStorage.getItem('wallpaper'); } catch (e) {}
      block.style.display = has ? 'block' : 'none';
    }
  }
  function updateWallTools() {
    var el = $('#wallTools');
    if (!el) return;
    var has = false;
    try { has = !!localStorage.getItem('wallpaper'); } catch (e) {}
    el.style.display = has ? 'flex' : 'none';
  }

  function applyWallpaper(path) {
    updateWallTools();
    var wp = $('#wp');
    var blur = $('#wpBlur');
    var img = $('#wpImg');
    if (!path) {
      wp.classList.add('hidden');
      document.body.classList.remove('has-wallpaper');
      if (blur) blur.style.backgroundImage = '';
      if (img) img.style.backgroundImage = '';
      var meta = $('#wallMeta');
      if (meta) meta.textContent = '从相册选一张图片，自动模糊填充';
      renderWallFit();
      return;
    }
    var u = 'url("' + path + '")';
    if (blur) blur.style.backgroundImage = u;
    if (img) {
      img.style.backgroundImage = u;
      var fit = getWallFit();
      img.style.backgroundSize = wallFitSize(fit);
      img.style.backgroundRepeat = 'no-repeat';
      img.style.backgroundPosition = 'center';
    }
    wp.classList.remove('hidden');
    document.body.classList.add('has-wallpaper');
    renderWallFit();
    var m2 = $('#wallMeta');
    if (m2) m2.textContent = '已设置 · 比例不匹配处自动模糊填充';
  }

  // 原生层选完图后回调（第二个参数是图片平均亮度 0-255，用于自适应文字颜色）
  window.__onWallpaperPicked = function (path, lum) {
    if (!path) { toast('图片读取失败'); return; }
    if (typeof lum === 'number' && lum >= 0) {
      try { localStorage.setItem('wallLum', String(lum)); } catch (e) {}
    }
    try { localStorage.setItem('wallpaper', path); } catch (e) {}
    applyWallpaper(path);
    applyTextStyle();
    toast('壁纸已应用');
  };

  function clearWallpaper() {
    try { localStorage.removeItem('wallpaper'); } catch (e) {}
    applyWallpaper('');
    toast('已移除壁纸');
  }

  function applyTheme(name) {
    var t = null;
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].name === name) t = THEMES[i];
    if (!t) t = THEMES[0];
    var root = document.documentElement;
    root.style.setProperty('--blue', t.main);
    root.style.setProperty('--blue-d', t.dark);
    try { localStorage.setItem('theme', t.name); } catch (e) {}
  }

  function renderThemeDots() {
    var cur = '蓝';
    try { cur = localStorage.getItem('theme') || '蓝'; } catch (e) {}
    var html = '';
    THEMES.forEach(function (t) {
      html += '<div class="theme-dot' + (t.name === cur ? ' on' : '') +
        '" data-t="' + t.name + '" style="background:' + t.main + '"></div>';
    });
    var el = $('#themeDots');
    if (el) el.innerHTML = html;
  }

  function initAppearance() {
    try {
      var w = localStorage.getItem('wallpaper');
      // 无论有没有壁纸都走一遍，保证"壁纸工具条"的显示状态正确
      applyWallpaper(w || '');
      var th = localStorage.getItem('theme');
      if (th) applyTheme(th);
    } catch (e) {}
    renderThemeDots();

    var dots = $('#themeDots');
    if (dots) {
      dots.addEventListener('click', function (e) {
        var t = e.target;
        var name = t && t.getAttribute ? t.getAttribute('data-t') : null;
        if (!name) return;
        applyTheme(name);
        renderThemeDots();
        renderTimetable(); // 单色配色依赖主题色，需要重绘
        toast('主题色：' + name);
      });
    }

    var palRow = $('#paletteRow');
    if (palRow) {
      palRow.addEventListener('click', function (e) {
        var el = e.target;
        while (el && el !== palRow) {
          var id = el.getAttribute ? el.getAttribute('data-p') : null;
          if (id) { setPalette(id); return; }
          el = el.parentNode;
        }
      });
    }

    // 课程透明度（自定义滑块，只有拖圆点才变）
    applyCourseOpacity(getCourseOpacity());
    initOpacitySlider();


    // 课表文字字号（五类独立）
    initTtFontScale();

    // 描边强度
    renderStrokeRow();
    var sr = $('#strokeRow');
    if (sr) {
      sr.addEventListener('click', function (e) {
        var el = e.target;
        while (el && el !== sr) {
          var id = el.getAttribute ? el.getAttribute('data-s') : null;
          if (id) { setStroke(id); return; }
          el = el.parentNode;
        }
      });
    }

    // 文字颜色与描边
    applyTextStyle();
    renderSwatches();

    // 恢复默认配色
    var resetBtn = $('#rowResetColors');
    if (resetBtn) {
      resetBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        resetTextColors();
      });
    }

    // 色块点击（document 级委托，覆盖所有分组）
    document.addEventListener('click', function (e) {
      var el = e.target;
      if (!el || !el.classList || !el.classList.contains('sw')) return;
      var k = el.getAttribute('data-k');
      var c2 = el.getAttribute('data-c');
      if (!k || !c2) return;
      var cur = getTextColors();
      cur[k] = c2;
      saveTextColors(cur);
      renderSwatches();
      applyTextStyle();
    });
  }

  /* ================= 事件绑定 ================= */
  $('#btnLogin').addEventListener('click', doLogin);
  $('#pwd').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  $('#cap').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });

  $('#btnWebLogin').addEventListener('click', function () {
    call('browse', { url: 'https://jxfw.gdut.edu.cn/new/' })
      .catch(function () { toast('无法打开网页登录'); });
  });

  $$('.tab').forEach(function (t) {
    t.addEventListener('click', function () { switchPage(t.dataset.page); });
  });

  // 刷新：点击的瞬间就先把反馈画出来，不等任何网络请求
  $('#btnRefresh').addEventListener('click', function () {
    if (sniffing) {
      toast('正在刷新中，请稍候…');
      return;
    }
    setRefreshing(true);
    setWho('正在刷新数据…');
    // 让浏览器先把视觉变化绘制出来，再发请求
    setTimeout(function () { refresh(false); }, 20);
  });
  $('#prevWeek').addEventListener('click', function () { goWeek(-1); });
  $('#nextWeek').addEventListener('click', function () { goWeek(1); });
  $('#weekLabel').addEventListener('click', function () { showWeekPicker(); });

  $('#courseMask').addEventListener('click', closeCourse);
  $('#ttWrap').addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== this) {
      if (el.className && String(el.className).indexOf('tt-course') >= 0) {
        var i = el.getAttribute('data-idx');
        if (i != null) showCourse(parseInt(i, 10));
        return;
      }
      el = el.parentNode;
    }
  });

  $('#rowSniff').addEventListener('click', openSite);
  $('#diagClose').addEventListener('click', function () {
    $('#diag').classList.add('hidden');
  });
  $('#rowClear').addEventListener('click', function () {
    // 主动退出登录：阻止本次自动登录，并清掉记住的账号密码
    try {
      localStorage.setItem('noAutoLogin', '1');
      localStorage.removeItem('savedSid');
      localStorage.removeItem('savedPwd');
    } catch (e) {}
    call('logout').then(function () {
      location.reload();
    }).catch(function () { location.reload(); });
  });

  $('#rowUpdate').addEventListener('click', function () {
    doCheckUpdate();
  });

  var wallTools = $('#wallTools');
  if (wallTools) {
    wallTools.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var tool = t.closest('.wall-tool');
      if (!tool) return;
      var op = tool.getAttribute('data-op');
      if (!op) return;
      if (!localStorage.getItem('wallpaper')) {
        toast('先设置一张壁纸');
        return;
      }
      call('transformWallpaper', { op: op }).then(function (r) {
        if (r && r.path) {
          try { localStorage.setItem('wallpaper', r.path); } catch (err) {}
          applyWallpaper(r.path);
          toast('已' + ({ rotate: '旋转', flipH: '左右镜像', flipV: '上下镜像', crop: '裁剪' }[op] || '处理'));
        } else {
          toast('处理失败');
        }
      }).catch(function () {
        toast('处理失败');
      });
    });
  }
  var fitRow = $('#wallFitRow');
  if (fitRow) {
    fitRow.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var fit = t.getAttribute('data-fit');
      if (!fit) return;
      applyWallFit(fit);
    });
  }
  /* ================= 课表：三周条带，手势平移 + CSS transition 回弹 ================= */
  var ttSwipe = { pos: 0, startX: 0, startPos: 0, dragging: false, pageW: 1, vpW: 1 };

  function ttSetPos(x, animate, dur) {
    var strip = $('#ttStrip');
    var sc = $('#ttScroll');
    if (!strip || !sc) return;
    // 关键：屏宽和页宽都实时读，屏幕旋转/分屏后不会用过期值把滑动截断
    var vp = sc.clientWidth || document.documentElement.clientWidth || 360;
    var pw = state.pageW || 1;
    ttSwipe.vpW = vp;
    ttSwipe.pageW = pw;
    var max = Math.max(0, pw * 3 - vp);
    ttSwipe.pos = Math.max(0, Math.min(max, x));
    var tr = animate ? ('transform ' + (dur || 800) + 'ms cubic-bezier(.4,0,.2,1)') : 'none';
    if (strip.__tr !== tr) { strip.style.transition = tr; strip.__tr = tr; }
    strip.style.transform = 'translateX(' + (-ttSwipe.pos) + 'px)';
  }

  function initTTSwipe() {
    var sc = $('#ttScroll');
    var strip = $('#ttStrip');
    if (!sc || !strip) return;

    var vp = sc.clientWidth || document.documentElement.clientWidth || 360;
    ttSwipe.vpW = vp;
    ttSwipe.pageW = state.pageW || 1;

    if (!sc.__inited) {
      sc.__inited = true;
      var d = new Date().getDay();
      var base = ttSwipe.pageW;
      if (d === 0 || d === 6) {
        base = ttSwipe.pageW + Math.max(0, ttSwipe.pageW - vp);
      }
      ttSetPos(base, false);
    } else {
      // 已经初始化过：保持当前位置（可能正在看周六日），只做边界修正
      ttSetPos(ttSwipe.pos, false);
    }

    if (sc.__bound) return;
    sc.__bound = true;


    function xOf(e) {
      if (e.touches && e.touches.length) return e.touches[0].clientX;
      return e.clientX;
    }

    function onStart(e) {
      // 上一次换页动画还在跑时快速再滑：先取实际位移，避免跳一下
      var strip = $('#ttStrip');
      if (strip) {
        var m = getComputedStyle(strip).transform;
        if (m && m !== 'none' && m.indexOf('matrix') === 0) {
          var parts = m.replace(/matrix\(|\)/g, '').split(',');
          var tx = parseFloat(parts[4]);
          if (!isNaN(tx)) ttSwipe.pos = -tx;
        }
      }
      // 取消上一次还没完成的换页（用户又滑了，说明想反悔）
      if (ttSwipe.cancelSwap) { try { ttSwipe.cancelSwap(); } catch (err) {} }
      ttSwipe.startX = xOf(e);
      ttSwipe.samples = [];   // 每次按下清空速度采样
      ttSwipe.samples.push({ x: ttSwipe.startX, t: Date.now() });
      ttSwipe.dragging = true;
      ttSwipe.startPos = ttSwipe.pos;
      ttSetPos(ttSwipe.pos, false);
    }

    function onMove(e) {
      if (!ttSwipe.dragging) return;
      doMove(xOf(e));
    }

    /** 记录位移 + 速度采样，供松手时判断“甩”的力度 */
    function doMove(x) {
      var now = Date.now();
      ttSwipe.curX = x;
      ttSwipe.curT = now;
      if (!ttSwipe.samples) ttSwipe.samples = [];
      ttSwipe.samples.push({ x: x, t: now });
      if (ttSwipe.samples.length > 6) ttSwipe.samples.shift();
      ttSetPos(ttSwipe.startPos - (x - ttSwipe.startX), false);
    }
    function onEnd() {
      // 用实时屏宽算边界，避免过期值导致"到不了周末也换不了周"
      var scNow = $('#ttScroll');
      if (scNow) { ttSwipe.vpW = scNow.clientWidth || ttSwipe.vpW; }
      ttSwipe.pageW = state.pageW || ttSwipe.pageW;
      if (!ttSwipe.dragging) return;
      ttSwipe.dragging = false;
      var pw = ttSwipe.pageW;
      var vp = ttSwipe.vpW;
      var leftEdge = pw;
      var rightEdge = 2 * pw - vp;
      var p = ttSwipe.pos;
      var DUR = 800;   // 换页动画时长（与 ttSetPos 的 transition 一致）

      // 松手瞬间的速度（px/ms）：快速一甩时以“最新动作”为准，不等滑够距离
      var vel = 0;
      var sp = ttSwipe.samples || [];
      if (sp.length >= 2) {
        var a = sp[0], b = sp[sp.length - 1];
        var dt = b.t - a.t;
        if (dt > 0) vel = (b.x - a.x) / dt;
      }
      var FLING = 0.5;   // 约 500px/s

      // 已经越过本周边界的部分：位置够了 或 甩得够快，都直接换页
      if (p < leftEdge) {
        if (p < leftEdge - pw * 0.12 || vel > FLING) {
          slideThenSwap(0, -1, DUR);
        } else {
          ttSetPos(leftEdge, true, 320);
        }
        return;
      }
      if (p > rightEdge) {
        if (p > rightEdge + pw * 0.12 || vel < -FLING) {
          slideThenSwap(pw * 2, 1, DUR);
        } else {
          ttSetPos(rightEdge, true, 320);
        }
        return;
      }
    }

    /** 滑到目标位置，动画真正结束的那一刻再换数据（比 setTimeout 精确，不会卡顿） */
    function slideThenSwap(target, dir, dur) {
      var strip = $('#ttStrip');
      if (!strip) { ttSetPos(target, false); goWeek(dir); return; }
      var done = false;
      var timer = setTimeout(finish, dur + 150);
      function cleanup() {
        strip.removeEventListener('transitionend', onTE);
        if (timer) { clearTimeout(timer); timer = null; }
        ttSwipe.cancelSwap = null;
      }
      function finish() {
        if (done) return;
        done = true;
        cleanup();
        goWeek(dir);
      }
      function onTE(e) {
        if (!e || e.propertyName === 'transform') finish();
      }
      // 让 onStart 能取消掉这次挂起的换页（用户又滑了就是反悔）
      ttSwipe.cancelSwap = function () { done = true; cleanup(); };
      strip.addEventListener('transitionend', onTE);
      ttSetPos(target, true, dur);
    }

    sc.addEventListener('touchstart', onStart, { passive: true });
    sc.addEventListener('touchmove', onMove, { passive: true });
    sc.addEventListener('touchend', onEnd, { passive: true });
    sc.addEventListener('touchcancel', onEnd, { passive: true });

    sc.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      onStart(e);
    });
    document.addEventListener('mousemove', function (e) {
      if (!ttSwipe.dragging) return;
      onMove(e);
    });
    document.addEventListener('mouseup', onEnd);
  }

  function resetSwipeOffset() { }
  $('#rowWallpaper').addEventListener('click', function () {
    call('pickWallpaper').catch(function () {
      toast('无法打开相册');
    });
  });

  $('#rowWallClear').addEventListener('click', clearWallpaper);

  /** 下载并安装 */
  function doDownloadUpdate(r) {
    loading(true, '正在下载更新包…');
    var urls = [];
    if (r.url) urls.push(r.url);
    if (r.mirrors && r.mirrors.length) urls = urls.concat(r.mirrors);
    call('downloadUpdate', { urls: urls })
      .then(function (res) {
        loading(false);
        if (res && res.launched) {
          toast('已开始安装，请按系统提示操作');
        } else {
          toast('已下载，但无法自动安装，请到文件管理器里打开');
        }
      })
      .catch(function (e) {
        loading(false);
        toast('更新失败：' + e.message);
      });
  }

  /** 更新弹窗（自定义，比系统 confirm 好看） */
  function promptUpdate(r) {
    if (document.getElementById('updModal')) return;
    var el = document.createElement('div');
    el.id = 'updModal';
    el.className = 'upd-modal';
    el.innerHTML =
      '<div class="upd-card">' +
        '<div class="upd-badge">发现新版本</div>' +
        '<div class="upd-ver">v' + esc(r.versionName) + '</div>' +
        (r.notes ? '<div class="upd-notes">' + esc(r.notes) + '</div>' : '') +
        '<div class="upd-actions">' +
          '<button class="upd-btn later" id="updLater">以后再说</button>' +
          '<button class="upd-btn go" id="updNow">立即更新</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);

    document.getElementById('updLater').addEventListener('click', function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    document.getElementById('updNow').addEventListener('click', function () {
      if (el.parentNode) el.parentNode.removeChild(el);
      doDownloadUpdate(r);
    });
  }

  function doCheckUpdate() {
    loading(true, '正在检查更新…');
    call('version').then(function (v) {
      $('#verMeta').textContent = '当前版本 v' + (v && v.name ? v.name : '1.6');
      return call('checkUpdate', {});
    }).then(function (r) {
      loading(false);
      if (!r) { toast('检查更新失败'); return; }
      if (!r.configured) {
        uiDialog({
          title: '设置更新源',
          message: '填入一个指向 version.json 的网址：',
          input: true,
          placeholder: 'https://...',
          okText: '保存',
          onOk: function (u) {
            if (!u || !u.trim()) return;
            call('setUpdateUrl', { url: u.trim() }).then(function () {
              toast('更新源已保存，再点一次检查更新');
            }).catch(function (e) { toast('保存失败：' + e.message); });
          }
        });
        return;
      }
      if (r.error) {
        uiDialog({
          title: '检查更新失败',
          message: r.error + '\n\n要重新填写更新地址吗？',
          cancelText: '取消',
          okText: '重新填写',
          onOk: function () {
            uiDialog({
              title: '更新源地址',
              message: '指向 version.json 的网址：',
              input: true,
              value: r.updateUrl || '',
              okText: '保存',
              onOk: function (nu) {
                if (nu === undefined) return;
                call('setUpdateUrl', { url: (nu || '').trim() }).then(function () {
                  toast(nu.trim() ? '地址已保存，再点一次检查' : '已恢复默认更新源');
                }).catch(function (e) { toast('保存失败：' + e.message); });
              }
            });
          }
        });
        return;
      }
      if (!r.hasUpdate) {
        toast('已是最新版本 v' + r.currentName);
        return;
      }
      promptUpdate(r);
    }).catch(function (e) {
      loading(false);
      toast('检查更新失败：' + e.message);
    });
  }

  /** 启动时静默检查一次更新：有新版本才弹窗，没问题就不打扰 */
  function autoCheckUpdate() {
    call('checkUpdate', {}).then(function (r) {
      if (!r || !r.configured || r.error || !r.hasUpdate) return;
      setTimeout(function () { promptUpdate(r); }, 700);
    }).catch(function () {});
  }

  // 站点页面加载完成
  window.__siteState = function (url) {
    state.captureUrl = url || '';
  };

  // 站点停在教务系统域名下 = 网页登录已经成功
  window.__siteLoggedIn = function () {
    state.webLoggedIn = true;
  };

  // 从站点页返回 App：如果这时已经有登录态，直接进入主界面
  window.__onBackToApp = function () {
    call('status').then(function (s) {
      if (!s || !s.loggedIn) return;
      if ($('#app').classList.contains('hidden')) {
        state.sid = s.sid || state.sid || '';
        $('#meSid').textContent = state.sid || '—';
        enterApp();
      } else {
        refresh(true);
      }
    }).catch(function () {});
  };

  /* ================= 启动 ================= */
  var __booted = false;
  function boot() {
    if (__booted) return;
    __booted = true;
    // 先把原生备份里的设置补回本地（更新/重装后不丢外观设置）
    restorePrefs(function () {
      bootInner();
    });
  }

  function bootInner() {
    initTerms();
    initAppearance();
    renderDiagnostics();
    initRemember();
    initTTSwipe();

    // 每 3 秒检查一次设置有无变化，有则备份到原生（更新后不丢）
    var lastPrefSig = '';
    setInterval(function () {
      var sig = '';
      PREF_KEYS.forEach(function (k) {
        try { sig += k + '=' + (localStorage.getItem(k) || '') + ';'; } catch (e) {}
      });
      if (sig !== lastPrefSig) {
        lastPrefSig = sig;
        backupPrefs();
      }
    }, 3000);

    if (!HAS_NATIVE) {
      // 浏览器预览：直接进入主界面看空状态
      $('#app').classList.remove('hidden');
      $('#login').classList.add('hidden');
      if ($('#whoLine')) $('#whoLine').textContent = '浏览器预览模式';
      if (location.search.indexOf('mock') >= 0) fillMock();
      renderTimetable();
      renderGrades();
      renderCet();
      renderFitness();
      return;
    }
    call('status').then(function (s) {
      if (s && s.loggedIn) {
        state.sid = s.sid || '';
        state.name = s.name || '';
        enterApp();
        setTimeout(autoCheckUpdate, 900);
      } else {
        if (s && s.sid) $('#sid').value = s.sid;
        setTimeout(autoCheckUpdate, 900);
        // 没有有效会话时，用记住的密码自动登录
        setTimeout(function () {
          if (!autoLogin()) {
            // 没有记住密码：如果之前同意过协议，恢复勾选状态
            try {
              if (localStorage.getItem('agreed') === '1') {
                agreed = true;
                var row = $('#agreeRow');
                if (row) row.classList.add('on');
              }
            } catch (e) {}
          }
        }, 400);
      }
    }).catch(function () {
      setTimeout(autoCheckUpdate, 900);
      setTimeout(function () { autoLogin(); }, 400);
    });
  }

  /* 仅用于浏览器里预览排版，真机不会走到这里 */
  function fillMock() {
    state.sid = '3123000000';
    state.week = 10;
    state.totalWeeks = 22;
    state.term = '202601';
    state.days = [
      { day: 1, date: '2026-11-02' }, { day: 2, date: '2026-11-03' },
      { day: 3, date: '2026-11-04' }, { day: 4, date: '2026-11-05' },
      { day: 5, date: '2026-11-06' }, { day: 6, date: '2026-11-07' },
      { day: 7, date: '2026-11-08' }
    ];
    state.courses = [
      { name: '高等数学A(二)', teacher: '陈老师', room: '教1-201', day: 1, start: 1, end: 2, weeks: '1-16' },
      { name: '大学物理', teacher: '李老师', room: '教2-304', day: 1, start: 5, end: 6, weeks: '1-16' },
      { name: '线性代数', teacher: '王老师', room: '教3-102', day: 2, start: 3, end: 4, weeks: '1-8' },
      { name: '程序设计基础', teacher: '刘老师', room: '实验楼B402', day: 3, start: 1, end: 2, weeks: '1-16' },
      { name: '大学英语(三)', teacher: '张老师', room: '教4-210', day: 3, start: 7, end: 8, weeks: '1-16' },
      { name: '电路与电子学', teacher: '黄老师', room: '教1-105', day: 4, start: 3, end: 5, weeks: '9-16' },
      { name: '体育（篮球）', teacher: '赵老师', room: '东区体育馆', day: 5, start: 1, end: 2, weeks: '1-16' },
      { name: '毛泽东思想和中国特色社会主义理论体系概论', teacher: '孙老师', room: '教5-301', day: 5, start: 5, end: 6, weeks: '1-12' }
    ];
    state.grades = [
      { name: '高等数学A(一)', credit: 5, score: '92', gpa: 4.2 },
      { name: '大学物理(上)', credit: 4, score: '87', gpa: 3.7 },
      { name: '线性代数', credit: 3, score: '95', gpa: 4.5 },
      { name: '程序设计基础', credit: 4, score: '89', gpa: 3.9 },
      { name: '大学英语(二)', credit: 3, score: '84', gpa: 3.4 },
      { name: '体育', credit: 1, score: '78', gpa: 2.8 },
      { name: '思想道德与法治', credit: 3, score: '91', gpa: 4.1 },
      { name: '工程制图', credit: 2, score: '86', gpa: 3.6 }
    ];
    var cw = 0, w = 0, g = 0, gw = 0;
    state.grades.forEach(function (x) {
      var sc = parseFloat(x.score);
      cw += sc * x.credit; w += x.credit; g += x.gpa * x.credit; gw += x.credit;
    });
    state.gpa = g / gw;
    state.avgScore = cw / w;
    state.totalCredit = w;
    state.cet4 = { total: 528, listen: 178, read: 186, write: 164, date: '2026-06' };
    state.cet6 = { total: 462, listen: 152, read: 168, write: 142, date: '2026-12' };
    $('#meSid').textContent = state.sid;
  }

  bindLoginCheckboxes();
  boot();
})();




































































































