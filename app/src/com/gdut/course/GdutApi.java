package com.gdut.course;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 广工教务系统（jxfw，正方系）真实接口封装。
 *
 * 下面是实测确认过的地址（2026-11 验证）：
 *   菜单        GET  default!getMenu.action
 *   当前学期    GET  xsgrkbcx!xsgrkbMain.action          （解析 selected 的 option）
 *   课表 JSON   GET  xsgrkbcx!getKbRq.action?xnxqdm=&zc=  （fullcalendar 用）
 *   课程成绩    GET  xskccjxx!getDataList.action?page=1&rows=200
 *
 * 课表 JSON 形如 [[课程对象...],[{xqmc,rq}...]]，
 * 课程对象关键字段：kcmc 课程名、teaxms 教师、jxcdmc 教室、
 *                  xq 星期(1-7)、jcdm2 节次("06,07")、zc 周次。
 */
public final class GdutApi {

    public static final String BASE = "https://jxfw.gdut.edu.cn";

    private static final String HDR =
            "Referer: " + BASE + "/login!welcome.action\n" +
            "X-Requested-With: XMLHttpRequest\n" +
            "Accept: application/json, text/javascript, */*; q=0.01";

    private GdutApi() {
    }

    /** 当前学年学期代码，如 202601（2026 秋季）。 */
    public static String currentTerm() {
        try {
            Net.Resp r = Net.follow("GET", BASE + "/xsgrkbcx!xsgrkbMain.action", null, 6, HDR);
            if (r.body != null) {
                Matcher m = Pattern.compile("<option\\s+value='(\\d{6})'\\s+selected").matcher(r.body);
                if (m.find()) return m.group(1);
                Matcher m2 = Pattern.compile("value='(\\d{6})'[^>]*selected").matcher(r.body);
                if (m2.find()) return m2.group(1);
            }
        } catch (Throwable ignored) {
        }
        return "202601";
    }

    /** 学期列表（代码 + 名称），用于前端下拉。 */
    public static String terms() {
        JSONArray out = new JSONArray();
        try {
            Net.Resp r = Net.follow("GET", BASE + "/xsgrkbcx!xsgrkbMain.action", null, 6, HDR);
            if (r.body != null) {
                Matcher m = Pattern.compile(
                        "<option\\s+value='(\\d{6})'[^>]*>([^<]*)</option>").matcher(r.body);
                while (m.find()) {
                    JSONObject o = new JSONObject();
                    o.put("code", m.group(1));
                    o.put("name", m.group(2).trim());
                    out.put(o);
                }
            }
        } catch (Throwable ignored) {
        }
        return out.toString();
    }

    /** 原始课表 JSON（未加工）。 */
    public static String rawTimetable(String term, int week) {
        try {
            String url = BASE + "/xsgrkbcx!getKbRq.action?xnxqdm=" + term + "&zc=" + week;
            Net.Resp r = Net.follow("GET", url, null, 4, HDR);
            return r.body == null ? "" : r.body;
        } catch (Throwable t) {
            return "";
        }
    }

    /** 学期起始日期缓存：只要成功拿过一次就一直用，避免网络抖动导致算错周次 */
    private static String sCachedTerm = "";
    private static String sCachedStart = "";

    /** 第 1 周的起始日期（yyyy-MM-dd），用来推算当前教学周。 */
    public static String termStartDate(String term) {
        if (term != null && term.equals(sCachedTerm) && !sCachedStart.isEmpty()) {
            return sCachedStart;
        }
        try {
            String raw = rawTimetable(term, 1);
            JSONArray outer = new JSONArray(raw);
            if (outer.length() >= 2) {
                JSONArray days = outer.getJSONArray(1);
                if (days.length() > 0) {
                    String rq = days.getJSONObject(0).optString("rq", "");
                    if (!rq.isEmpty()) {
                        sCachedTerm = term;
                        sCachedStart = rq;
                        return rq;
                    }
                }
            }
        } catch (Throwable ignored) {
        }
        return sCachedStart;
    }

    /** 当前是第几教学周。 */
    public static int currentWeek(String term) {
        try {
            String start = termStartDate(term);
            if (start.isEmpty()) return 1;
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd");
            Date s = f.parse(start);
            long days = (System.currentTimeMillis() - s.getTime()) / 86400000L;
            int w = (int) (days / 7) + 1;
            if (w < 1) w = 1;
            if (w > 30) w = 30;
            return w;
        } catch (Throwable t) {
            return 1;
        }
    }

    /**
     * 取某一周的课表，返回标准化后的 JSON：
     * {term, week, startDate, today, totalWeeks, courses:[{name,teacher,room,day,start,end,weeks}]}
     */
    public static String timetable(String term, int week) {
        JSONObject out = new JSONObject();
        try {
            out.put("term", term);
            out.put("week", week);
            out.put("totalWeeks", 22);

            String raw = rawTimetable(term, week);
            if (expired(raw)) {
                out.put("courses", new JSONArray());
                out.put("expired", true);
                out.put("error", "登录已过期，请重新登录");
                return out.toString();
            }
            if (raw == null || raw.trim().isEmpty()) {
                out.put("courses", new JSONArray());
                out.put("error", "教务系统没有返回数据（登录态可能已失效）");
                return out.toString();
            }
            // 返回的是网页而不是 JSON：多半是会话被弹回登录页/错误页
            String head = raw.trim();
            if (head.startsWith("<") || head.startsWith("<!") || !head.startsWith("[")) {
                out.put("courses", new JSONArray());
                out.put("expired", true);
                out.put("error", "教务系统返回了网页而不是数据，请重新登录");
                return out.toString();
            }
            JSONArray outer = new JSONArray(raw);
            JSONArray courses = outer.length() > 0 ? outer.getJSONArray(0) : new JSONArray();
            JSONArray days = outer.length() > 1 ? outer.getJSONArray(1) : new JSONArray();

            List<JSONObject> list = new ArrayList<JSONObject>();
            for (int i = 0; i < courses.length(); i++) {
                JSONObject c = courses.getJSONObject(i);
                String name = c.optString("kcmc", "").trim();
                if (name.isEmpty()) continue;

                String dayStr = c.optString("xq", "");
                int day = parseIntSafe(dayStr);
                if (day <= 0) day = dayFromText(dayStr);

                String jcdm2 = c.optString("jcdm2", "");
                if (jcdm2.isEmpty()) jcdm2 = c.optString("jcdm", "");
                int[] sec = parseSections(jcdm2);

                JSONObject o = new JSONObject();
                o.put("name", name);
                o.put("teacher", c.optString("teaxms", "").trim());
                o.put("room", c.optString("jxcdmc", "").trim());
                o.put("day", day);
                o.put("start", sec[0]);
                o.put("end", sec[1]);
                o.put("weeks", c.optString("zc", ""));
                o.put("cls", c.optString("jxbmc", ""));
                // 详情用字段
                o.put("code", c.optString("kcbh", "").trim());
                o.put("hours", c.optString("zxs", "").trim());
                o.put("people", c.optString("pkrs", "").trim());
                o.put("mode", c.optString("jxhjmc", "").trim());
                o.put("content", c.optString("sknrjj", "").trim());
                o.put("sections", jcdm2);
                list.add(o);
            }
            out.put("courses", new JSONArray(list));

            // 该周每一天的日期（xqmc 是星期几，rq 是日期），用于课表表头
            JSONArray dayList = new JSONArray();
            for (int i = 0; i < days.length(); i++) {
                JSONObject d = days.getJSONObject(i);
                JSONObject o = new JSONObject();
                o.put("day", parseIntSafe(d.optString("xqmc", "")));
                o.put("date", d.optString("rq", ""));
                dayList.put(o);
            }
            out.put("days", dayList);
            if (days.length() > 0) {
                out.put("startDate", days.getJSONObject(0).optString("rq", ""));
            }
            // 关键：这是「第 1 周周一」，不是当周周一。前端算每周日期范围必须用它。
            String termStart = (week == 1 && days.length() > 0)
                    ? days.getJSONObject(0).optString("rq", "")
                    : termStartDate(term);
            out.put("termStart", termStart);
            Calendar cal = Calendar.getInstance();
            out.put("today", new SimpleDateFormat("yyyy-MM-dd").format(cal.getTime()));
            out.put("weekday", cal.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY ? 7
                    : cal.get(Calendar.DAY_OF_WEEK) - 1);
            return out.toString();
        } catch (Throwable t) {
            try {
                out.put("courses", new JSONArray());
                String msg = t.getMessage();
                out.put("error", "课表解析失败：" + t.getClass().getSimpleName()
                        + (msg == null ? "" : (" - " + msg)));
            } catch (Throwable ignored) {
            }
            return out.toString();
        }
    }

    /** 判断响应是不是被弹回了登录页（会话过期）。 */
    public static boolean expired(String body) {
        if (body == null || body.isEmpty()) return false;
        return body.contains("loginFromId")
                || body.contains("统一身份认证")
                || body.contains("name=\"execution\"");
    }

    /** 考级成绩（四六级等）。接口：xskjcjxx!getDataList.action */
    public static String cet() {
        return datagrid("/xskjcjxx!getDataList.action");
    }

    /** 体测成绩。接口：xstccjxx!getDataList.action */
    public static String fitness() {
        return datagrid("/xstccjxx!getDataList.action");
    }

    /** 通用的 EasyUI datagrid 数据接口请求。 */
    private static String datagrid(String path) {
        JSONObject out = new JSONObject();
        try {
            Net.Resp r = Net.follow("GET", BASE + path + "?page=1&rows=200", null, 4, HDR);
            if (expired(r.body)) {
                out.put("expired", true);
                out.put("rows", new JSONArray());
                out.put("error", "登录已过期");
                return out.toString();
            }
            if (r.body == null || r.body.trim().isEmpty()) {
                out.put("rows", new JSONArray());
                out.put("error", "接口没有返回数据");
                return out.toString();
            }
            JSONObject src = new JSONObject(r.body);
            JSONArray rows = src.optJSONArray("rows");
            out.put("rows", rows == null ? new JSONArray() : rows);
            out.put("total", src.optInt("total", rows == null ? 0 : rows.length()));
            return out.toString();
        } catch (Throwable t) {
            try {
                out.put("rows", new JSONArray());
                out.put("error", "解析失败：" + t.getClass().getSimpleName());
            } catch (Throwable ignored) {
            }
            return out.toString();
        }
    }

    /** 课程成绩列表。 */
    public static String grades() {
        JSONObject out = new JSONObject();
        try {
            String url = BASE + "/xskccjxx!getDataList.action?page=1&rows=300";
            Net.Resp r = Net.follow("GET", url, null, 4, HDR);
            if (expired(r.body)) {
                out.put("rows", new JSONArray());
                out.put("expired", true);
                out.put("error", "登录已过期，请重新登录");
                return out.toString();
            }
            if (r.body == null || r.body.trim().isEmpty()) {
                out.put("rows", new JSONArray());
                out.put("error", "成绩接口没有返回数据");
                return out.toString();
            }
            JSONObject src = new JSONObject(r.body);
            JSONArray rows = src.optJSONArray("rows");
            JSONArray list = new JSONArray();
            double creditSum = 0, weighted = 0, gpaSum = 0, gpaWeight = 0;
            if (rows != null) {
                for (int i = 0; i < rows.length(); i++) {
                    JSONObject c = rows.getJSONObject(i);
                    String name = c.optString("kcmc", "").trim();
                    if (name.isEmpty()) continue;
                    double xf = parseDoubleSafe(c.optString("xf", "0"));
                    String cj = c.optString("cj", "").trim();
                    String jd = c.optString("jd", "").trim();

                    JSONObject o = new JSONObject();
                    o.put("name", name);
                    o.put("credit", xf);
                    o.put("score", cj);
                    o.put("gpa", jd);
                    o.put("term", c.optString("xnxqdm", ""));
                    o.put("type", c.optString("kclbmc", c.optString("kcflmc", "")));
                    list.put(o);

                    creditSum += xf;
                    double sc = parseDoubleSafe(cj);
                    if (sc > 0 && xf > 0) weighted += sc * xf;
                    double g = parseDoubleSafe(jd);
                    if (g > 0 && xf > 0) {
                        gpaSum += g * xf;
                        gpaWeight += xf;
                    }
                }
            }
            out.put("rows", list);
            out.put("total", src.optInt("total", list.length()));
            out.put("creditSum", creditSum);
            out.put("avgScore", weighted > 0 && creditSum > 0 ? weighted / creditSum : 0);
            out.put("gpa", gpaWeight > 0 ? gpaSum / gpaWeight : 0);
            return out.toString();
        } catch (Throwable t) {
            try {
                out.put("rows", new JSONArray());
                out.put("error", "成绩解析失败：" + t.getClass().getSimpleName());
            } catch (Throwable ignored) {
            }
            return out.toString();
        }
    }

    // ---------------- 工具 ----------------

    private static int parseIntSafe(String s) {
        try {
            return Integer.parseInt(s.trim());
        } catch (Throwable t) {
            return 0;
        }
    }

    private static double parseDoubleSafe(String s) {
        try {
            return Double.parseDouble(s.trim());
        } catch (Throwable t) {
            return 0;
        }
    }

    private static int dayFromText(String s) {
        if (s == null) return 0;
        String t = s.trim();
        String[] cn = {"一", "二", "三", "四", "五", "六", "日"};
        for (int i = 0; i < cn.length; i++) {
            if (t.contains(cn[i])) return i + 1;
        }
        return 0;
    }

    /** "06,07" 或 "0607" -> {6,7} */
    private static int[] parseSections(String s) {
        if (s == null) return new int[]{0, 0};
        List<Integer> nums = new ArrayList<Integer>();
        Matcher m = Pattern.compile("\\d{1,2}").matcher(s);
        while (m.find()) {
            int v = parseIntSafe(m.group());
            if (v > 0 && v <= 20) nums.add(v);
        }
        if (nums.isEmpty()) return new int[]{0, 0};
        int start = nums.get(0);
        int end = nums.get(nums.size() - 1);
        if (end < start) end = start;
        return new int[]{start, end};
    }
}
