(function (global) {
  'use strict';

  var CONFIG = global.UNSPOKEN_CONFIG || {};
  var API_BASE = String(CONFIG.apiBase || '').replace(/\/+$/, '');
  var LOCAL_KEY = 'unspoken.questions.v1';
  var SESSION_KEY = 'unspoken.admin.session.v1';
  var LOCAL_PASSWORD = String(CONFIG.localAdminPassword || 'unspoken');
  var MAX_QUESTION = 1000;
  var MAX_ANSWER = 2000;

  var mode = null;
  var probePromise = null;
  var memory = null;
  var memorySession = false;

  function readQuestions() {
    if (memory) return memory;
    try {
      var raw = global.localStorage.getItem(LOCAL_KEY);
      var data = raw ? JSON.parse(raw) : [];
      if (Array.isArray(data)) {
        memory = data;
        return memory;
      }
    } catch (e) {}
    memory = [];
    return memory;
  }

  function writeQuestions(list) {
    memory = list;
    try {
      global.localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
    } catch (e) {}
  }

  function loggedIn() {
    if (memorySession) return true;
    try {
      return global.sessionStorage.getItem(SESSION_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function setLoggedIn(value) {
    memorySession = value;
    try {
      if (value) global.sessionStorage.setItem(SESSION_KEY, '1');
      else global.sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  function apiUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    var clean = String(path || '').replace(/^\/+/, '');
    return API_BASE ? API_BASE + '/' + clean : clean;
  }

  function detect() {
    if (mode) return Promise.resolve(mode);
    if (probePromise) return probePromise;

    if (!global.fetch) {
      mode = 'local';
      return Promise.resolve(mode);
    }

    if (!API_BASE && (/\.github\.io$/i.test(global.location.hostname) || global.location.protocol === 'file:')) {
      mode = 'local';
      return Promise.resolve(mode);
    }

    probePromise = global.fetch(apiUrl('api/questions'), { headers: { Accept: 'application/json' } })
      .then(function (res) {
        var type = '';
        try {
          type = res.headers.get('content-type') || '';
        } catch (e) {}
        mode = res.ok && type.indexOf('application/json') !== -1 ? 'api' : 'local';
        return mode;
      })
      .catch(function () {
        mode = 'local';
        return mode;
      });

    return probePromise;
  }

  function cleanText(value, max) {
    if (typeof value !== 'string') return null;
    var text = value
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!text) return null;
    if (text.length > max) text = text.slice(0, max);
    return text;
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(16).slice(2, 10);
  }

  function jsonResponse(status, data) {
    return {
      ok: status >= 200 && status < 300,
      status: status,
      headers: {
        get: function (name) {
          return String(name).toLowerCase() === 'content-type'
            ? 'application/json; charset=utf-8'
            : null;
        }
      },
      json: function () { return Promise.resolve(data); },
      text: function () { return Promise.resolve(JSON.stringify(data)); }
    };
  }

  function parseBody(options) {
    if (!options || typeof options.body !== 'string') return {};
    try {
      return JSON.parse(options.body);
    } catch (e) {
      return null;
    }
  }

  function publicList() {
    return readQuestions()
      .filter(function (q) { return q.answer; })
      .sort(function (a, b) { return (b.answeredAt || 0) - (a.answeredAt || 0); })
      .map(function (q) {
        return { id: q.id, question: q.question, answer: q.answer, createdAt: q.createdAt };
      });
  }

  function localRequest(path, options) {
    var method = String((options && options.method) || 'GET').toUpperCase();
    var route = String(path || '').replace(/^\/+/, '').split('?')[0];
    var body = parseBody(options);

    if (route === 'api/questions' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { questions: publicList() }));
    }

    if (route === 'api/questions' && method === 'POST') {
      if (!body) return Promise.resolve(jsonResponse(400, { error: 'طلب غير صالح.' }));
      if (body.website) return Promise.resolve(jsonResponse(200, { ok: true }));
      var question = cleanText(body.question, MAX_QUESTION);
      if (!question) return Promise.resolve(jsonResponse(400, { error: 'لا يمكن إرسال سؤال فارغ.' }));
      if (question.length < 2) return Promise.resolve(jsonResponse(400, { error: 'السؤال قصير جداً.' }));
      var list = readQuestions().slice();
      list.push({
        id: newId(),
        question: question,
        answer: null,
        createdAt: Date.now(),
        answeredAt: null
      });
      writeQuestions(list);
      return Promise.resolve(jsonResponse(201, { ok: true }));
    }

    if (route === 'api/admin/login' && method === 'POST') {
      if (!body || typeof body.password !== 'string') {
        return Promise.resolve(jsonResponse(400, { error: 'كلمة المرور مطلوبة.' }));
      }
      if (body.password !== LOCAL_PASSWORD) {
        return Promise.resolve(jsonResponse(401, { error: 'كلمة المرور غير صحيحة.' }));
      }
      setLoggedIn(true);
      return Promise.resolve(jsonResponse(200, { ok: true }));
    }

    if (route === 'api/admin/logout' && method === 'POST') {
      setLoggedIn(false);
      return Promise.resolve(jsonResponse(200, { ok: true }));
    }

    if (!loggedIn()) {
      return Promise.resolve(jsonResponse(401, { error: 'unauthorized' }));
    }

    if (route === 'api/admin/questions' && method === 'GET') {
      var all = readQuestions()
        .slice()
        .sort(function (a, b) { return b.createdAt - a.createdAt; })
        .map(function (q) {
          return {
            id: q.id,
            question: q.question,
            answer: q.answer,
            createdAt: q.createdAt,
            answeredAt: q.answeredAt || null
          };
        });
      return Promise.resolve(jsonResponse(200, { questions: all }));
    }

    if (route === 'api/admin/questions/answer' && method === 'POST') {
      if (!body) return Promise.resolve(jsonResponse(400, { error: 'طلب غير صالح.' }));
      var answer = cleanText(body.answer, MAX_ANSWER);
      if (!answer) return Promise.resolve(jsonResponse(400, { error: 'لا يمكن نشر إجابة فارغة.' }));
      var items = readQuestions().slice();
      var target = null;
      for (var i = 0; i < items.length; i++) {
        if (items[i].id === body.id) {
          target = items[i];
          break;
        }
      }
      if (!target) return Promise.resolve(jsonResponse(404, { error: 'السؤال غير موجود.' }));
      target.answer = answer;
      target.answeredAt = Date.now();
      writeQuestions(items);
      return Promise.resolve(jsonResponse(200, { ok: true }));
    }

    if (route === 'api/admin/questions/delete' && method === 'POST') {
      if (!body || !body.id) return Promise.resolve(jsonResponse(400, { error: 'طلب غير صالح.' }));
      var current = readQuestions();
      var next = current.filter(function (q) { return q.id !== body.id; });
      if (next.length === current.length) {
        return Promise.resolve(jsonResponse(404, { error: 'السؤال غير موجود.' }));
      }
      writeQuestions(next);
      return Promise.resolve(jsonResponse(200, { ok: true }));
    }

    return Promise.resolve(jsonResponse(404, { error: 'not found' }));
  }

  function request(path, options) {
    return detect().then(function (current) {
      if (current === 'api') return global.fetch(apiUrl(path), options);
      return localRequest(path, options);
    });
  }

  global.UnspokenAPI = {
    request: request,
    detect: detect,
    mode: function () { return mode; }
  };
})(window);
