package com.sleeperhq.rozenite.input

import org.json.JSONObject

/**
 * Scripts the injector runs in a web view's page, for what native views can't show: its fields, buttons and text.
 * Same-origin frames are searched too; another site's frame can't be read, so it shows as a placeholder.
 */
internal object WebContent {
    /**
     * The page's interactive and labelling elements, as `{dpr, vx, vy, vs, elements: [{label, value, traits, type, id,
     * x, y, w, h}]}`, rects in CSS px from the top-left of the layout viewport.
     */
    val SNAPSHOT = """
        (function () {
          var MAX = 400;
          var SELECTOR = 'input,textarea,select,button,a[href],[role=button],[role=link],[role=checkbox],[role=radio],' +
            '[role=tab],[role=menuitem],[contenteditable=""],[contenteditable=true],label,h1,h2,h3,iframe,frame';
          var out = [];
          var clean = function (text) { return (text || '').replace(/\s+/g, ' ').trim(); };
          var labelOf = function (el) {
            var aria = el.getAttribute('aria-label');
            if (aria) return clean(aria);
            var by = el.getAttribute('aria-labelledby');
            if (by) {
              var joined = clean(by.split(/\s+/).map(function (id) {
                var node = el.ownerDocument.getElementById(id);
                return node ? node.textContent : '';
              }).join(' '));
              if (joined) return joined;
            }
            if (el.labels && el.labels.length) {
              var forLabel = clean(el.labels[0].textContent);
              if (forLabel) return forLabel;
            }
            if (el.placeholder) return clean(el.placeholder);
            if (el.tagName === 'INPUT' && /^(submit|button|reset)$/.test(el.type)) return clean(el.value);
            if (!/^(INPUT|TEXTAREA|SELECT|IFRAME|FRAME)$/.test(el.tagName)) {
              var text = clean(el.innerText || el.textContent);
              if (text) return text.slice(0, 200);
            }
            return clean(el.getAttribute('title') || el.getAttribute('name') || '');
          };
          var valueOf = function (el) {
            if (el.tagName === 'SELECT') return el.selectedIndex >= 0 ? clean(el.options[el.selectedIndex].text) : '';
            if (!/^(INPUT|TEXTAREA)$/.test(el.tagName) || /^(submit|button|reset|checkbox|radio)$/.test(el.type)) return '';
            if (el.type === 'password') return new Array(el.value.length + 1).join('•');
            return el.value || '';
          };
          var traitsOf = function (el, doc) {
            var traits = [];
            var tag = el.tagName;
            var role = el.getAttribute('role');
            var typing = (tag === 'INPUT' && !/^(submit|button|reset|checkbox|radio|range|color|file|image)$/.test(el.type)) ||
              tag === 'TEXTAREA' || el.isContentEditable;
            if (typing) traits.push('editable');
            else if (/^(BUTTON|A|SELECT)$/.test(tag) || tag === 'INPUT' || /^(button|link|checkbox|radio|tab|menuitem)$/.test(role || '')) traits.push('button');
            else traits.push('text');
            if (/^H[1-3]$/.test(tag)) traits.push('header');
            if (el.disabled || el.getAttribute('aria-disabled') === 'true') traits.push('disabled');
            if (el.checked || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true') traits.push('selected');
            if (doc.activeElement === el) traits.push('focused');
            return traits;
          };
          var shown = function (el, rect) {
            if (rect.width <= 0 || rect.height <= 0) return false;
            if (el.tagName === 'INPUT' && el.type === 'hidden') return false;
            var style = el.ownerDocument.defaultView.getComputedStyle(el);
            return style.visibility !== 'hidden' && style.display !== 'none' && parseFloat(style.opacity) !== 0;
          };
          var walk = function (doc, offsetX, offsetY) {
            var nodes = doc.querySelectorAll(SELECTOR);
            for (var i = 0; i < nodes.length && out.length < MAX; i++) {
              var el = nodes[i];
              var rect = el.getBoundingClientRect();
              if (!shown(el, rect)) continue;
              var x = rect.left + offsetX;
              var y = rect.top + offsetY;
              if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
                var inner = null;
                try { inner = el.contentDocument; } catch (e) {}
                if (inner) {
                  walk(inner, x + el.clientLeft, y + el.clientTop);
                } else {
                  out.push({ label: 'Frame from another site: ' + (el.getAttribute('title') || el.src || ''), value: '', traits: ['text'],
                    type: 'web:iframe', id: el.id || '', x: x, y: y, w: rect.width, h: rect.height });
                }
                continue;
              }
              var label = labelOf(el);
              var value = valueOf(el);
              var traits = traitsOf(el, doc);
              if (traits[0] === 'text' && !label) continue;
              out.push({ label: label, value: value, traits: traits, type: 'web:' + el.tagName.toLowerCase() + (el.type ? ':' + el.type : ''),
                id: el.id || '', x: x, y: y, w: rect.width, h: rect.height });
            }
          };
          walk(document, 0, 0);
          var viewport = window.visualViewport;
          return { dpr: window.devicePixelRatio || 1, vx: viewport ? viewport.offsetLeft : 0, vy: viewport ? viewport.offsetTop : 0,
            vs: viewport ? viewport.scale : 1, elements: out };
        })()
    """.trimIndent()

    // Finds the focused field, through same-origin frames. Answers with it, or with "none" or "cross-origin".
    private const val FOCUSED_FIELD = """
        var doc = document, el = doc.activeElement;
        while (el && (el.tagName === 'IFRAME' || el.tagName === 'FRAME')) {
          try { doc = el.contentDocument; } catch (e) { doc = null; }
          if (!doc) return 'cross-origin';
          el = doc.activeElement;
        }
        if (!el || !(el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return 'none';
        var setValue = function (value) {
          var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        };
    """

    /**
     * Types `text` into the page's focused field the way the keyboard does, through `insertText`, so the page's own
     * input handlers (a card number's formatting, say) still run. "\n" is the return key. Answers "ok:<tag>" or why not.
     */
    fun type(text: String) = """
        (function (text) {
          $FOCUSED_FIELD
          if (text === '\n') {
            var key = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
            var proceed = el.dispatchEvent(new KeyboardEvent('keydown', key));
            el.dispatchEvent(new KeyboardEvent('keypress', key));
            el.dispatchEvent(new KeyboardEvent('keyup', key));
            if (proceed && el.form && el.tagName === 'INPUT') {
              if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit();
            }
            return 'ok:' + el.tagName;
          }
          if (!doc.execCommand('insertText', false, text) && !el.isContentEditable) {
            var start = el.selectionStart == null ? el.value.length : el.selectionStart;
            var end = el.selectionEnd == null ? start : el.selectionEnd;
            setValue(el.value.slice(0, start) + text + el.value.slice(end));
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
          }
          return 'ok:' + el.tagName;
        })(${JSONObject.quote(text)})
    """.trimIndent()

    /** Takes focus from the page's focused field, through same-origin frames, so the page doesn't show the keyboard again. */
    val BLUR = """
        (function () {
          var doc = document, el = doc.activeElement;
          while (el && (el.tagName === 'IFRAME' || el.tagName === 'FRAME')) {
            try { doc = el.contentDocument; } catch (e) { doc = null; }
            if (!doc) break;
            el = doc.activeElement;
          }
          if (el && el.blur) el.blur();
        })()
    """.trimIndent()

    /** The delete key, `count` times, in the page's focused field. Answers like `type`. */
    fun delete(count: Int) = """
        (function (count) {
          $FOCUSED_FIELD
          for (var i = 0; i < count; i++) {
            if (doc.execCommand('delete', false)) continue;
            if (el.isContentEditable) break;
            var start = el.selectionStart == null ? el.value.length : el.selectionStart;
            var end = el.selectionEnd == null ? start : el.selectionEnd;
            if (end === start && start === 0) break;
            var from = end > start ? start : start - 1;
            setValue(el.value.slice(0, from) + el.value.slice(end));
            el.setSelectionRange(from, from);
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
          }
          return 'ok:' + el.tagName;
        })($count)
    """.trimIndent()
}
