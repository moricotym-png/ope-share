/**
 * オペ共有アプリ — サーバー側（Google Apps Script）
 *
 * データはこのスクリプトが入っているスプレッドシートに保存されます。
 * シートは初回アクセス時に自動で作られます。
 *  - 「設定」シートの B1 セルが合言葉です。変えたいときはここを書き換えてください。
 *  - それ以外のシート（症例・振り返り など）は手で編集しないでください。
 */

var KINDS = {
  templates: 'テンプレート',
  cases: '症例',
  feedback: '振り返り',
  posts: '掲示板',
  comments: 'コメント'
};
var SETTINGS_SHEET = '設定';
var DEFAULT_PASSCODE = 'ope2026'; // 初回のみ使われます。必ず「設定」シートで変更してください。

function doGet() {
  ensureSheets_();
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('オペ共有')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** GitHub Pages 版の画面からの入口（JSONで受けてJSONで返す） */
function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = { ok: true, result: api(req.pass, req.op, req.payload) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** クライアントからの唯一の入口。合言葉が違えばエラー。入力ミスが続くと10分ロック。 */
function api(passcode, op, payload) {
  ensureSheets_();
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('pass_fail') || 0);
  if (fails >= 20) throw new Error('LOCKED');
  if (String(passcode || '') !== getPasscode_()) {
    cache.put('pass_fail', String(fails + 1), 600);
    throw new Error('PASSCODE');
  }
  payload = payload || {};
  switch (op) {
    case 'ping':
      return { ok: true };
    case 'listAll':
      var out = {};
      Object.keys(KINDS).forEach(function (k) { out[k] = readAll_(k); });
      return out;
    case 'save':
      return withLock_(function () { return save_(payload.kind, payload.obj); });
    case 'remove':
      return withLock_(function () { return remove_(payload.kind, payload.id); });
    case 'toggleCheck':
      return withLock_(function () {
        var c = find_('cases', payload.caseId);
        if (!c) throw new Error('NOT_FOUND');
        c.checks = c.checks || {};
        if (payload.value) {
          c.checks[payload.item] = { by: payload.name, at: new Date().toISOString() };
        } else {
          delete c.checks[payload.item];
        }
        return save_('cases', c);
      });
    case 'confirm':
      return withLock_(function () {
        var c = find_('cases', payload.caseId);
        if (!c) throw new Error('NOT_FOUND');
        c.confirmedBy = c.confirmedBy || [];
        if (c.confirmedBy.indexOf(payload.name) < 0) c.confirmedBy.push(payload.name);
        return save_('cases', c);
      });
    case 'patch':
      return withLock_(function () {
        var o = find_(payload.kind, payload.id);
        if (!o) throw new Error('NOT_FOUND');
        var f = payload.fields || {};
        Object.keys(f).forEach(function (k) {
          if (k === 'id') return;
          if (f[k] && typeof f[k] === 'object' && !Array.isArray(f[k]) && o[k] && typeof o[k] === 'object') {
            Object.keys(f[k]).forEach(function (kk) { o[k][kk] = f[k][kk]; });
          } else {
            o[k] = f[k];
          }
        });
        return save_(payload.kind, o);
      });
    case 'seed':
      return withLock_(function () {
        if (readAll_('templates').length > 0) return { skipped: true };
        (payload.templates || []).forEach(function (t) { save_('templates', t); });
        return { seeded: true };
      });
    default:
      throw new Error('UNKNOWN_OP');
  }
}

/* ---------- 内部処理 ---------- */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheets_() {
  var ss = ss_();
  Object.keys(KINDS).forEach(function (k) {
    var name = KINDS[k];
    if (!ss.getSheetByName(name)) {
      var sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, 3).setValues([['id', '更新日時', 'データ']]);
      sh.setFrozenRows(1);
    }
  });
  if (!ss.getSheetByName(SETTINGS_SHEET)) {
    var st = ss.insertSheet(SETTINGS_SHEET, 0);
    st.getRange('A1:B1').setValues([['合言葉', DEFAULT_PASSCODE]]);
    st.getRange('A3').setValue('↑ B1 を書き換えると合言葉が変わります。スタッフの退職時や年1回は変更してください。');
  }
}

function getPasscode_() {
  return String(ss_().getSheetByName(SETTINGS_SHEET).getRange('B1').getValue()).trim();
}

function sheet_(kind) {
  if (!KINDS[kind]) throw new Error('BAD_KIND');
  return ss_().getSheetByName(KINDS[kind]);
}

function readAll_(kind) {
  var sh = sheet_(kind);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 3).getValues()
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      try { return JSON.parse(r[2]); } catch (e) { return null; }
    })
    .filter(function (x) { return x; });
}

function rowOf_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function find_(kind, id) {
  var sh = sheet_(kind);
  var row = rowOf_(sh, id);
  if (row < 0) return null;
  return JSON.parse(sh.getRange(row, 3).getValue());
}

function save_(kind, obj) {
  if (!obj || !obj.id) throw new Error('NO_ID');
  var sh = sheet_(kind);
  obj.updatedAt = new Date().toISOString();
  var json = JSON.stringify(obj);
  if (json.length > 45000) throw new Error('TOO_LARGE');
  var row = rowOf_(sh, obj.id);
  var values = [[obj.id, obj.updatedAt, json]];
  if (row < 0) {
    sh.appendRow(values[0]);
  } else {
    sh.getRange(row, 1, 1, 3).setValues(values);
  }
  return obj;
}

function remove_(kind, id) {
  var sh = sheet_(kind);
  var row = rowOf_(sh, id);
  if (row > 0) sh.deleteRow(row);
  return { removed: row > 0 };
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
