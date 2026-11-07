/* ℂ𝕆ℝ𝕍𝕌𝕊 — public page */

(function () {
  'use strict';

  var form = document.getElementById('ask-form');
  var textarea = document.getElementById('question');
  var button = document.getElementById('send-btn');
  var notice = document.getElementById('notice');
  var cards = document.getElementById('cards');
  var empty = document.getElementById('empty');

  var noticeTimer;

  function say(message, kind) {
    clearTimeout(noticeTimer);
    notice.textContent = message;
    notice.className = 'notice show ' + (kind || '');
    noticeTimer = setTimeout(function () {
      notice.className = 'notice';
      notice.textContent = '';
    }, 4500);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function render(list) {
    cards.innerHTML = '';
    if (!list.length) {
      cards.appendChild(el('p', 'empty', 'لا توجد أجوبة منشورة بعد… كن أول من يسأل.'));
      return;
    }

    list.forEach(function (item, index) {
      var card = el('article', 'card');
      card.style.animationDelay = Math.min(index * 60, 360) + 'ms';

      card.appendChild(el('p', 'card__label', 'السؤال'));
      card.appendChild(el('p', 'card__text', item.question));
      card.appendChild(el('hr', 'card__divider'));
      card.appendChild(el('p', 'card__answer-name', 'ℂ𝕆ℝ𝕍𝕌𝕊'));
      card.appendChild(el('p', 'card__text', item.answer));

      cards.appendChild(card);
    });
  }

  function load() {
    UnspokenAPI.request('api/questions', { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : { questions: [] }; })
      .then(function (data) { render(Array.isArray(data.questions) ? data.questions : []); })
      .catch(function () { /* keep whatever is on the page */ });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var text = textarea.value.trim();
    if (!text) {
      say('اكتب سؤالك أولاً.', 'bad');
      textarea.focus();
      return;
    }
    if (text.length > 1000) {
      say('السؤال طويل جداً (الحد 1000 حرف).', 'bad');
      return;
    }

    button.disabled = true;
    say('...جارٍ الإرسال');

    UnspokenAPI.request('api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: text,
        website: document.getElementById('website').value
      })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { status: res.status, data: data };
        });
      })
      .then(function (result) {
        if (result.status === 201) {
          textarea.value = '';
          say('تم إرسال سؤالك. ستجد إجابتي هنا قريباً.', 'good');
          return;
        }
        say(result.data && result.data.error ? result.data.error : 'تعذّر الإرسال، حاول مجدداً.', 'bad');
      })
      .catch(function () {
        say('تعذّر الإرسال، حاول مجدداً.', 'bad');
      })
      .then(function () {
        button.disabled = false;
      });
  });

  textarea.addEventListener('input', function () {
    if (notice.classList.contains('bad')) notice.className = 'notice';
  });

  load();
})();
