/* ℂ𝕆ℝ𝕍𝕌𝕊 — admin */

(function () {
  'use strict';

  var loginView = document.getElementById('login-view');
  var adminView = document.getElementById('admin-view');
  var loginForm = document.getElementById('login-form');
  var password = document.getElementById('password');
  var loginNotice = document.getElementById('login-notice');
  var list = document.getElementById('list');
  var empty = document.getElementById('admin-empty');
  var count = document.getElementById('count');

  var items = [];
  var loginTimer;

  function say(node, message, kind) {
    clearTimeout(loginTimer);
    node.textContent = message;
    node.className = 'notice show ' + (kind || '');
    loginTimer = setTimeout(function () {
      node.className = 'notice';
      node.textContent = '';
    }, 4500);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function api(path, options) {
    return UnspokenAPI.request(path, options).then(function (res) {
      if (res.status === 401) {
        showLogin();
        throw new Error('unauthorized');
      }
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || 'request failed');
        return data;
      });
    });
  }

  function showAdmin() {
    loginView.classList.add('hidden');
    adminView.classList.remove('hidden');
    load();
  }

  function showLogin() {
    adminView.classList.add('hidden');
    loginView.classList.remove('hidden');
  }

  function formatDate(ts) {
    try {
      return new Date(ts).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) {
      return '';
    }
  }

  function render() {
    list.innerHTML = '';
    empty.classList.toggle('hidden', items.length > 0);
    count.textContent = items.length ? items.length + ' سؤال' : '';

    items.forEach(function (item, index) {
      var box = el('article', 'item');
      box.style.animationDelay = Math.min(index * 50, 300) + 'ms';
      box.dataset.id = item.id;

      var meta = el('div', 'item__meta');
      meta.appendChild(el('span', 'badge ' + (item.answer ? 'badge--done' : 'badge--new'),
        item.answer ? 'مُجابة' : 'بانتظار الإجابة'));
      meta.appendChild(el('span', null, formatDate(item.createdAt)));
      box.appendChild(meta);

      box.appendChild(el('p', 'item__q', item.question));

      if (item.answer) {
        box.appendChild(el('p', 'item__answer', item.answer));
      }

      var actions = el('div', 'item__actions');

      if (!item.answer) {
        var write = el('button', null, 'كتابة إجابة');
        write.type = 'button';
        write.addEventListener('click', function () { openComposer(box, item); });
        actions.appendChild(write);
      } else {
        var edit = el('button', null, 'تعديل الإجابة');
        edit.type = 'button';
        edit.addEventListener('click', function () { openComposer(box, item); });
        actions.appendChild(edit);
      }

      var remove = el('button', 'danger', 'حذف');
      remove.type = 'button';
      remove.addEventListener('click', function () {
        if (!window.confirm('حذف هذا السؤال نهائياً؟')) return;
        remove.disabled = true;
        api('api/admin/questions/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id })
        })
          .then(function () { items = items.filter(function (q) { return q.id !== item.id; }); render(); })
          .catch(function (err) { say(loginNotice, err.message, 'bad'); });
      });
      actions.appendChild(remove);

      box.appendChild(actions);
      list.appendChild(box);
    });
  }

  function openComposer(box, item) {
    if (box.querySelector('textarea')) return;

    var area = el('textarea');
    area.rows = 4;
    area.maxLength = 2000;
    area.placeholder = 'اكتب إجابتك هنا...';
    area.value = item.answer || '';
    box.appendChild(area);

    var actions = box.querySelector('.item__actions');
    var publish = el('button', null, item.answer ? 'حفظ' : 'نشر الإجابة');
    publish.type = 'button';
    publish.addEventListener('click', function () {
      var text = area.value.trim();
      if (!text) {
        area.focus();
        return;
      }
      publish.disabled = true;
      api('api/admin/questions/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, answer: text })
      })
        .then(function () { return load(); })
        .catch(function (err) {
          publish.disabled = false;
          say(loginNotice, err.message, 'bad');
        });
    });
    actions.insertBefore(publish, actions.firstChild);
    area.focus();
  }

  function load() {
    return api('api/admin/questions')
      .then(function (data) {
        items = data.questions || [];
        render();
      })
      .catch(function (err) {
        if (err.message !== 'unauthorized') say(loginNotice, err.message, 'bad');
      });
  }

  loginForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var value = password.value;
    if (!value) return;

    var submit = loginForm.querySelector('button');
    submit.disabled = true;

    api('api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: value })
    })
      .then(function () {
        password.value = '';
        showAdmin();
      })
      .catch(function (err) {
        say(loginNotice, err.message, 'bad');
        password.select();
      })
      .then(function () {
        submit.disabled = false;
      });
  });

  document.getElementById('refresh').addEventListener('click', load);

  document.getElementById('logout').addEventListener('click', function () {
    UnspokenAPI.request('api/admin/logout', { method: 'POST' }).then(function () {
      showLogin();
      password.focus();
    });
  });

  // check existing session
  api('api/admin/questions')
    .then(function (data) {
      items = data.questions || [];
      showAdmin();
    })
    .catch(function (err) {
      if (err.message !== 'unauthorized') say(loginNotice, err.message, 'bad');
      showLogin();
    });
})();
