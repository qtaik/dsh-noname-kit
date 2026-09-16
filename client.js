// dsh-noname-kit 浏览器半:顶部「无名杀工坊」页签 + 表单 + 历史面板 + 工具结果卡片。
// 形态参照 dsh-skin:纯 JS + React.createElement,零构建。
// 页签注册的是 conversation.view 列表槽(与官方"轨迹"页签同一插槽,order 排在它后面)。
window.__ModuleLoader__.load({
  id: 'dsh-noname-kit',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');

    // ── 样式(令牌取自 DSH 界面变量,自动适配亮/暗) ──────────────
    var CSS = [
      '.nnk-wrap{padding:16px;max-width:860px;margin:0 auto;overflow:auto;height:100%}',
      '.nnk-tabs{display:flex;gap:8px;margin-bottom:14px}',
      '.nnk-tab{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 14px;cursor:pointer;font:inherit;font-size:13px}',
      '.nnk-tab.nnk-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.nnk-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px;background:var(--dsw-alias-bg-layer-1);margin-bottom:14px}',
      '.nnk-label{display:block;font-size:12px;color:var(--dsw-alias-label-secondary);margin:10px 0 4px}',
      '.nnk-input,.nnk-textarea{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 10px;font:inherit;font-size:13px}',
      '.nnk-textarea{min-height:88px;resize:vertical;font-family:inherit}',
      '.nnk-code{font-family:Consolas,monospace;font-size:12px;min-height:140px;white-space:pre;overflow:auto}',
      '.nnk-radio{display:inline-flex;align-items:center;gap:4px;margin-right:16px;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.nnk-submit{border:1px solid var(--dsw-alias-brand-primary);border-radius:8px;padding:9px 22px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);cursor:pointer;font:inherit;font-size:14px;margin-top:14px}',
      '.nnk-submit:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}',
      '.nnk-submit:disabled{opacity:.5;cursor:default}',
      '.nnk-hint{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:10px;line-height:1.6}',
      '.nnk-err{color:var(--dsw-alias-state-error-primary);font-size:13px;margin-top:8px}',
      '.nnk-ok{color:var(--dsw-alias-state-success-primary);font-size:13px;margin-top:8px}',
      '.nnk-taskrow{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:13px}',
      '.nnk-taskmeta{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:4px}',
      '.nnk-note{background:var(--dsw-alias-bg-layer-2);border-radius:6px;padding:6px 10px;font-size:12px;margin:4px 0;color:var(--dsw-alias-label-primary)}',
      '.nnk-copy{border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:4px 12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;margin-top:8px}',
      '.nnk-badge{display:inline-block;border-radius:6px;padding:1px 8px;font-size:11px;margin-right:8px;border:1px solid var(--dsw-alias-border-l2)}',
      '.nnk-panel{position:fixed;width:380px;max-height:560px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.25);z-index:60}',
      '.nnk-panel-head{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);cursor:move;user-select:none}',
      '.nnk-panel-title{font-weight:600;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.nnk-panel-close{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:16px;line-height:1;padding:2px 6px}',
      '.nnk-panel-close:hover{color:var(--dsw-alias-state-error-primary)}',
      '.nnk-panel-body{padding:10px 12px;overflow-y:auto;flex:1}',
      '.nnk-status-open{color:var(--dsw-alias-state-warn-primary)}',
      '.nnk-status-written{color:var(--dsw-alias-state-warn-primary)}',
      '.nnk-status-done{color:var(--dsw-alias-state-success-primary)}',
      '.nnk-mini{width:100%;box-sizing:border-box;min-height:56px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:6px 8px;resize:vertical;margin-top:6px}',
      '.nnk-smallbtn{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:3px 10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:11px;margin:4px 6px 0 0}',
      '.nnk-fbrow{border-left:3px solid var(--dsw-alias-border-l2);padding:2px 8px;margin:4px 0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.nnk-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);margin-left:5px;vertical-align:middle}',
      '.nnk-cmd{font-family:Consolas,monospace;font-size:12px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px;margin-top:6px;display:inline-block;user-select:all}'
    ].join('\n');
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-noname-kit/ui"]') === null) {
      var tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-noname-kit';
      tag.dataset.pluginCss = 'dsh-noname-kit/ui';
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    function h(type, props) {
      var children = Array.prototype.slice.call(arguments, 2);
      return React.createElement.apply(React, [type, props].concat(children));
    }
    // e(tag, className, ...children):className 为字符串(可为空串);子元素数量不限。
    function e(tag, className) {
      var kids = Array.prototype.slice.call(arguments, 2);
      var props = className ? { className: className } : {};
      return h.apply(null, [tag, props].concat(kids));
    }

    function textField(label, value, onChange, opts) {
      opts = opts || {};
      return h('div', { key: label },
        e('label', 'nnk-label', label),
        h('textarea', {
          className: 'nnk-textarea' + (opts.code ? ' nnk-code' : ''),
          value: value,
          placeholder: opts.placeholder || '',
          onChange: function (ev) { onChange(ev.target.value) },
        })
      );
    }

    function radioGroup(label, value, options, onChange) {
      return h('div', {},
        e('label', 'nnk-label', label),
        h('div', {}, options.map(function (opt) {
          return h('label', { key: opt.value, className: 'nnk-radio' },
            h('input', { type: 'radio', name: label + opt.value, checked: value === opt.value, onChange: function () { onChange(opt.value) } }),
            opt.text
          );
        }))
      );
    }

    // ── 任务表单:武将区 / 卡牌区 ──────────────────────────────────
    function NewTaskForm(props) {
      var sessionId = props.sessionId;
      var send = props.send;
      var state = React.useState({
        mode: 'new', type: 'character', folder: '我的扩展', taskId: '', title: '', idPrefix: '',
        charInfo: '', skills: [{ name: '', desc: '' }], image: '', usedIds: [], notes: [],
        pileJoin: false, pileRows: [{ suit: 'spade', point: '' }],
        style: 'classic', writeMode: 'auto',
        reference: '', busy: false, err: '',
        extList: [], extLoading: false, currentInfo: '',
        goal: 'create', entryId: '', entryList: [], entryLoading: false, editNotes: '', addSkills: false,
        entrySkills: [], entrySkillsLoading: false, pickedSkills: []
      });
      // pickedSkills = [{ id, name, note }]:勾选的技能 + 用户当场写的修改内容
      var form = state[0], setForm = state[1];
      var set = function (key) { return function (v) { setForm(function (prev) { var next = {}; next[key] = v; return Object.assign({}, prev, next) }) } };
      var patch = function (p) { setForm(function (prev) { return Object.assign({}, prev, p) }) };

      var genTaskId = function (folder, avoid) {
        avoid = avoid || [];
        return fetch('/noname-kit-api/tasks').then(function (r) { return r.json() }).then(function (body) {
          var n = (body.tasks || []).filter(function (t) { return t.folder === folder }).length + 1;
          var used = {};
          avoid.forEach(function (id) { used[id] = true });
          var cand = folder + '-' + String(n).padStart(2, '0');
          while (used[cand]) { n += 1; cand = folder + '-' + String(n).padStart(2, '0') }
          return cand;
        }, function () { return folder + '-' + Date.now().toString().slice(-4) });
      };

      var switchMode = function (mode) {
        patch({ mode: mode, err: '', currentInfo: '', usedIds: [], notes: [],
          goal: 'create', entryId: '', entryList: [], entrySkills: [], pickedSkills: [], editNotes: '', addSkills: false });
        if (mode === 'edit' && form.extList.length === 0 && !form.extLoading) {
          patch({ extLoading: true });
          fetch('/noname-kit-api/history').then(function (r) { return r.json() }).then(function (body) {
            setForm(function (prev) { return Object.assign({}, prev, { extLoading: false, extList: (body.extensions || []).map(function (x) { return x.folder }) }) });
          }, function () { setForm(function (prev) { return Object.assign({}, prev, { extLoading: false, err: '扩展包列表获取失败' }) }) });
        }
      };

      // 「编辑已有武将/卡牌」:列出目标包内条目(锚点/无锚老包通吃)。
      // seq 守卫防竞态:快速连点时先发后至的旧响应不得覆盖新状态
      var entrySeq = 0, entrySkillSeq = 0;
      var loadEntries = function (folder, kind) {
        var seq = ++entrySeq;
        if (!folder) { patch({ entryList: [], entryId: '', entryLoading: false, entrySkills: [], pickedSkills: [] }); return }
        patch({ entryLoading: true });
        fetch('/noname-kit-api/entries?folder=' + encodeURIComponent(folder) + '&kind=' + kind).then(function (r) { return r.json() }).then(function (b) {
          if (seq !== entrySeq) return;
          setForm(function (prev) { return Object.assign({}, prev, {
            entryLoading: false,
            entryList: b.ok ? (b.entries || []) : [],
            entryId: '',
            entrySkills: [], pickedSkills: [],
            currentInfo: b.ok ? '' : '❌ ' + (b.error || '条目列表加载失败')
          }) });
        }, function () {
          if (seq !== entrySeq) return;
          setForm(function (prev) { return Object.assign({}, prev, { entryLoading: false, entryList: [], entryId: '', entrySkills: [], pickedSkills: [], currentInfo: '❌ 条目列表加载失败' }) });
        });
      };

      // 选中条目后:拉取该武将 skills 数组里的技能(勾选候选)
      var loadEntrySkills = function (folder, entryId) {
        var seq = ++entrySkillSeq;
        patch({ entrySkillsLoading: true });
        fetch('/noname-kit-api/entry-skills?folder=' + encodeURIComponent(folder) + '&id=' + encodeURIComponent(entryId)).then(function (r) { return r.json() }).then(function (b) {
          if (seq !== entrySkillSeq) return;
          setForm(function (prev) { return Object.assign({}, prev, { entrySkillsLoading: false, entrySkills: b.ok ? (b.skills || []) : [], pickedSkills: [] }) });
        }, function () {
          if (seq !== entrySkillSeq) return;
          setForm(function (prev) { return Object.assign({}, prev, { entrySkillsLoading: false, entrySkills: [], pickedSkills: [] }) });
        });
      };

      var pickEntry = function (id) {
        setForm(function (prev) { return Object.assign({}, prev, { entryId: id, pickedSkills: [], entrySkills: [], editNotes: '' }) });
        if (id) loadEntrySkills(form.folder, id);
      };

      var togglePicked = function (id, name) {
        var has = form.pickedSkills.some(function (p) { return p.id === id });
        patch({ pickedSkills: has ? form.pickedSkills.filter(function (p) { return p.id !== id }) : form.pickedSkills.concat([{ id: id, name: name, note: '' }]) });
      };

      var setPickedNote = function (id, note) {
        patch({ pickedSkills: form.pickedSkills.map(function (p) { return p.id === id ? Object.assign({}, p, { note: note }) : p }) });
      };

      var switchGoal = function (goal) {
        patch({ goal: goal, entryId: '', err: '', currentInfo: '', entrySkills: [], pickedSkills: [], editNotes: '' });
        if (goal === 'edit') loadEntries(form.folder, form.type);
      };

      var switchType = function (t) {
        setForm(function (prev) { return Object.assign({}, prev, { type: t, entryId: '', entrySkills: [], pickedSkills: [], editNotes: '', addSkills: false }) });
        if (form.mode === 'edit' && form.goal === 'edit') loadEntries(form.folder, t);
      };

      var pickExisting = function (folder) {
        patch({ folder: folder, currentInfo: '', usedIds: [], entryId: '', entryList: [], entrySkills: [], pickedSkills: [], editNotes: '', addSkills: false });
        if (!folder) return;
        if (form.goal === 'edit') loadEntries(folder, form.type);
        fetch('/noname-kit-api/extension?folder=' + encodeURIComponent(folder)).then(function (r) { return r.json() }).then(function (body) {
          if (body.error) { setForm(function (prev) { return Object.assign({}, prev, { currentInfo: '读取失败: ' + body.error }) }); return }
          var lines = body.code ? body.code.split('\n').length : 0;
          var style = body.code && body.code.indexOf('game.import(') >= 0 ? 'classic' : 'module';
          setForm(function (prev) { return Object.assign({}, prev, {
            currentInfo: '✅ ' + folder + ':约 ' + lines + ' 行,' + style + '写法',
            style: body.code && body.code.indexOf('game.import(') >= 0 ? 'classic' : 'module',
          }) });
        }, function () { setForm(function (prev) { return Object.assign({}, prev, { currentInfo: '读取失败' }) }) });
        // 已用任务ID + 历史注意点:登记处(进行中/已完成)+ 该包归档历史,合并去重
        fetch('/noname-kit-api/tasks').then(function (r) { return r.json() }).then(function (reg) {
          var used = (reg.tasks || []).filter(function (t) { return t.folder === folder })
            .map(function (t) { return { id: t.id, state: t.status === 'done' ? '已完成' : '进行中' } });
          return fetch('/noname-kit-api/history?folder=' + encodeURIComponent(folder)).then(function (r) { return r.json() }).then(function (hb) {
            ((hb.history && hb.history.tasks) || []).forEach(function (t) {
              if (t.taskId && !used.some(function (u) { return u.id === t.taskId })) used.push({ id: t.taskId, state: '已归档' });
            });
            return { used: used, notes: (hb.history && hb.history.notes) || [] };
          });
        }).then(function (r2) {
          setForm(function (prev) { return Object.assign({}, prev, { usedIds: r2.used, notes: r2.notes }) });
        }, function () { /* 拉不到就不显示,不挡流程 */ });
      };

      // 锚点化迁移:只由用户手动触发,给无锚老文件建立区块索引(只加注释行,不改代码)
      var migrateFolder = function () {
        if (!form.folder || !form.currentInfo || form.currentInfo.indexOf('读取失败') >= 0) { patch({ err: '请先选择扩展包并确认可读取' }); return }
        patch({ busy: true, currentInfo: '正在建立区块索引…' });
        fetch('/noname-kit-api/blocks/migrate', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ folder: form.folder }),
        }).then(function (r) { return r.json() }).then(function (b) {
          patch({ busy: false, currentInfo: b.ok
            ? '✅ 区块索引已建立:' + b.totalFiles + ' 个文件 / ' + b.totalBlocks + ' 个区块,插入 ' + b.totalInserted + ' 行锚点注释' + (b.totalCommas ? '(另补 ' + b.totalCommas + ' 个收尾逗号)' : '') + ';各文件原版已备份到同目录 backup/' + (b.filesSkipped ? '(跳过 ' + b.filesSkipped + ' 个无条目文件)' : '')
            : '❌ ' + (b.error || '建立失败') });
        }, function (e) { patch({ busy: false, currentInfo: '❌ 建立失败: ' + (e && e.message || e) }) });
      };

      // 技能列表行:{ name, desc }
      var addSkill = function () { patch({ skills: form.skills.concat([{ name: '', desc: '' }]) }) };
      var removeSkill = function (idx) {
        var skills = form.skills.filter(function (row, i) { return i !== idx });
        patch({ skills: skills });
      };
      var moveSkill = function (idx, dir) {
        var skills = form.skills.slice();
        var j = idx + dir;
        if (j < 0 || j >= skills.length) return;
        var tmp = skills[idx]; skills[idx] = skills[j]; skills[j] = tmp;
        patch({ skills: skills });
      };
      var setSkill = function (idx, key) { return function (v) {
        var skills = form.skills.slice();
        skills[idx] = Object.assign({}, skills[idx]); skills[idx][key] = v;
        patch({ skills: skills });
      }; };

      var submit = function () {
        var isEdit = form.mode === 'edit';
        var editingExisting = isEdit && form.goal === 'edit';
        var filledSkills = form.skills.filter(function (s) { return s.name.trim() || s.desc.trim() });
        var errSet = function (msg) { setForm(function (prev) { return Object.assign({}, prev, { err: msg }) }) };
        if (editingExisting) {
          if (!form.folder.trim()) { errSet('目标扩展文件夹不能为空'); return }
          if (!form.entryId) { errSet('请先选择要修改的' + (form.type === 'card' ? '卡牌' : '武将')); return }
          var emptyNote = form.pickedSkills.filter(function (p) { return !p.note.trim() }).map(function (p) { return p.name || p.id });
          if (emptyNote.length) { errSet('勾选的技能要填写修改内容: ' + emptyNote.join('、')); return }
          var addSkillFilled = form.addSkills && form.type === 'character' && form.skills.some(function (s) { return s.name.trim() || s.desc.trim() });
          if (!form.editNotes.trim() && !form.pickedSkills.length && !addSkillFilled) { errSet('请勾选要修改的技能、填写改动描述,或选「新增技能」——至少填一项'); return }
        } else {
          if (!filledSkills.length) { errSet('请至少填写一个技能(技能名和效果至少填一处)'); return }
          if (!form.folder.trim()) { errSet('目标扩展文件夹不能为空'); return }
        }
        var dupUsed = isEdit && form.taskId.trim() && (form.usedIds || []).some(function (u) { return u.id === form.taskId.trim() });
        if (dupUsed) { errSet('任务ID「' + form.taskId.trim() + '」此包已用过,请换一个'); return }
        setForm(function (prev) { return Object.assign({}, prev, { busy: true, err: '' }) });

        var type = form.type;
        var skills = editingExisting
          ? [].concat(
              form.editNotes.trim() ? [{ name: '修改 ' + form.entryId, desc: form.editNotes.trim() }] : [],
              form.pickedSkills.map(function (p) { return { name: p.name || p.id, desc: p.note.trim() } }),
              form.addSkills && type === 'character'
                ? form.skills.filter(function (s) { return s.name.trim() || s.desc.trim() }).map(function (s) { return { name: s.name.trim(), desc: s.desc.trim() } })
                : []
            )
          : (type === 'character'
          ? form.skills.filter(function (s) { return s.name.trim() || s.desc.trim() }).map(function (s) { return { name: s.name.trim(), desc: s.desc.trim() } })
          : [{ name: form.title.trim() || '新卡牌', desc: (form.skills[0] && form.skills[0].desc ? form.skills[0].desc.trim() : '') }]);

        // 游戏目录随任务消息下发给 AI(persona complete:true 会压掉插件 systemPrompt,
        // systemPrompt 里的环境小节到不了模型——任务消息是唯一保证可见的通道)
        var settingsP = fetch('/noname-kit-api/settings').then(function (r) { return r.json() }, function () { return {} });
        var ensureId = form.taskId.trim()
          ? Promise.resolve(form.taskId.trim())
          : genTaskId(form.folder.trim(), (form.usedIds || []).map(function (u) { return u.id }));
        Promise.all([ensureId, settingsP]).then(function (arr) {
          var taskId = arr[0];
          var settings = arr[1] || {};
          var gameDir = settings.nonameDir || '';
          var gameDirPosix = gameDir.replace(/^([A-Za-z]):[\\/]/, function (m, d) { return '/' + d.toLowerCase() + '/' }).replace(/\\/g, '/');
          var pile = type === 'card' && form.pileJoin
            ? { join: true, entries: form.pileRows.filter(function (r) { return r.point !== '' }).map(function (r) { return r.suit + ' ' + r.point }).join('\n') }
            : { join: false, entries: '' };
          return fetch('/noname-kit-api/tasks', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: taskId, folder: form.folder.trim(), type: type, title: form.title.trim(), charInfo: form.charInfo.trim(), pile: pile, idPrefix: form.idPrefix.trim(), skills: skills, image: form.image.trim(), target: editingExisting ? { kind: type, id: form.entryId } : null, writeMode: form.writeMode }),
          }).then(function (r) { return r.json() }).then(function (reg) {
            if (!reg.ok) throw new Error(reg.error || '任务注册失败');
            // gameDir/gameDirPosix 必须随 ctx 传给下一个 then(各自独立作用域,
            // 跨回调直接引用会 ReferenceError: gameDir is not defined)
            return { taskId: taskId, pile: pile, gameDir: gameDir, gameDirPosix: gameDirPosix };
          });
        }).then(function (ctx2) {
          var taskId = ctx2.taskId;
          var pile = ctx2.pile;
          var gameDir = ctx2.gameDir || '';
          var gameDirPosix = ctx2.gameDirPosix || '';
          var skillLines = skills.map(function (s, i) { return (i + 1) + '. ' + s.name + (s.desc ? ':' + s.desc : '') }).join('\n');
          var pileText;
          if (type === 'card' && pile.join && pile.entries) pileText = '加入牌堆,条目(每行「花色 点数」;花色只允许 spade/heart/club/diamond/none,none=无花色):\n' + pile.entries;
          else if (type === 'card') pileText = '不加入牌堆(仅作技能素材牌)';
          else pileText = '(武将无牌堆)';
          var text;
          if (editingExisting) {
            var newSkillRows = form.addSkills && type === 'character'
              ? form.skills.filter(function (s) { return s.name.trim() || s.desc.trim() }).map(function (s) { return { name: s.name.trim(), desc: s.desc.trim() } })
              : [];
            var pickedSkillRows = form.pickedSkills;
            var entryFile = (form.entryList.filter(function (en) { return en.id === form.entryId })[0] || {}).file || 'extension.js';
            text = [
              '【无名杀工坊·编辑任务】',
              '任务ID: ' + taskId,
              '任务性质: 编辑已有扩展包(已存在)',
              '类型: ' + (type === 'card' ? '卡牌' : '武将'),
              '编辑目标条目: ' + type + ':' + form.entryId + '(所在文件 ' + entryFile + (entryFile !== 'extension.js' ? ',read/write 都要传 file 参数' : '') + ';只改这个条目' + (pickedSkillRows.length ? '及其勾选技能' : '') + (newSkillRows.length ? ';新增技能作为新区块加到该条目上' : '') + ',其他武将/卡牌/技能/翻译一律不动)',
              (form.title.trim() ? '新名称(显示名,写入 translate;留空即不改名): ' + form.title.trim() : ''),
              '写入方式: ' + (form.writeMode === 'manual' ? '手动复制(只生成代码,不要写文件)' : '自动写入'),
              '目标扩展文件夹: ' + form.folder.trim() + '(已有扩展,老式/新式写法跟随现有代码)',
              (gameDir ? '游戏目录(所有读写的根;bash 里写作 ' + gameDirPosix + '): ' + gameDir : ''),
              (form.notes && form.notes.length ? '该包有历史注意点 ' + form.notes.length + ' 条(过往任务实测结论):与本任务相关时才用 noname_read_extension 传 notes:true 拉取,无关条目忽略,与需求冲突时以需求为准。' : ''),
              (form.editNotes.trim() ? '── ' + (type === 'card' ? '卡牌' : '武将') + '改动(条目本身:体力/护甲/名称等) ──\n' + form.editNotes.trim() : ''),
              (pickedSkillRows.length ? '── 修改技能(用户逐技能写明的改动要求) ──\n' + pickedSkillRows.map(function (p, i) { return (i + 1) + '. ' + p.name + '(内部ID ' + p.id + '):' + p.note.trim() }).join('\n') : ''),
              (newSkillRows.length ? '── 新增技能(加到目标' + (type === 'card' ? '卡牌' : '武将') + '上,按顺序实现) ──\n' + newSkillRows.map(function (s, i) { return (i + 1) + '. ' + s.name + (s.desc ? ':' + s.desc : '') }).join('\n') : ''),
              '── 任务技能节点(收口时 noname_skills_written 的 skills 参数必须逐字使用这些名称) ──\n' + skills.map(function (s) { return '- ' + s.name }).join('\n'),
              form.reference.trim() ? '── 用户提供的参考代码 ──\n' + form.reference.trim() : '',
              form.image.trim() ? '── 图片 ──\n用户已提供图片路径: ' + form.image.trim() + '\n实现完成后用 noname_copy_images 复制进扩展包 image/ 目录,按目标条目ID(' + form.entryId + ')命名文件,调用时带上任务ID。' : '',
              '── 执行要求(确认协议,逐步执行)──',
              '第 0 步【需求理解确认·硬门禁】:先 noname_read_extension 按块只读目标条目原文(' + (entryFile !== 'extension.js' ? 'file:\'' + entryFile + '\', ' : '') + 'block:\'' + type + ':' + form.entryId + '\')' + (pickedSkillRows.length ? '与各勾选技能原文(block:\'skill:<技能ID>\'' + (entryFile !== 'extension.js' ? ';技能可能在其他文件,用 listBlocks 定位后带对应 file' : '') + ')' : '') + '(定位不准时先传 listBlocks 看区块目录,多文件包的目录每项带 file 归属),把原文与需求对照,逐项输出【需求理解确认】(' + (form.editNotes.trim() ? '条目项:改什么 / 改动前→改动后 / 影响面' : '') + (form.editNotes.trim() && pickedSkillRows.length ? ';' : '') + (pickedSkillRows.length ? '修改技能项:改动前→改动后' : '') + ((pickedSkillRows.length || form.editNotes.trim()) && newSkillRows.length ? ';' : '') + (newSkillRows.length ? '新增技能按新技能模板逐条:触发/频率/目标/数值/边界' : '') + ')。输出后停下等待用户明确回复确认。',
              '有任何歧义必须先用 ask_user_question 提问;禁止猜测。ask_user_question 的回答只消除歧义、不算确认——澄清后把最终确认单呈现给用户,仍须等待用户明确回复「确认」后才能动笔。',
              '未获用户确认前,禁止生成代码、禁止调用 noname_write_extension。',
              '用户确认后动手:已有内容的改动只落在目标条目' + (pickedSkillRows.length ? '与其勾选技能' : '') + '对应区块(noname_write_extension' + (entryFile !== 'extension.js' ? ' 带 file:\'' + entryFile + '\'' : '') + ',用 blocks 组装或 edits 精确补丁,严禁全文重写)' + (newSkillRows.length ? ';新增技能作为新区块插入(锚点包裹,内部 ID 用下方前缀规则)' : '') + ',除上述区块与新增区块外严禁改动任何其他区块。noname_validate 通过后一次写入,调用 noname_skills_written 原样带回任务ID ' + taskId + '。',
              (newSkillRows.length && form.idPrefix.trim() ? '内部 ID 命名规则:新增技能的内部 ID 必须 = 「' + form.idPrefix.trim() + '」前缀 + 拼音或英文,中文显示名写入 translate。' : ''),
            ].filter(Boolean).join('\n');
          } else if (isEdit) {
            text = [
              '【无名杀工坊·编辑任务】',
              '任务ID: ' + taskId,
              '任务性质: 编辑已有扩展包(已存在)',
              '类型: ' + (type === 'card' ? '卡牌' : '武将(含 ' + skills.length + ' 个技能)'),
              (form.title.trim() ? '名称(显示名,写入 translate): ' + form.title.trim() : ''),
              '写入方式: ' + (form.writeMode === 'manual' ? '手动复制(只生成代码,不要写文件)' : '自动写入'),
              '目标扩展文件夹: ' + form.folder.trim() + '(已有扩展,老式/新式写法跟随现有代码)',
              (gameDir ? '游戏目录(所有读写的根;bash 里写作 ' + gameDirPosix + '): ' + gameDir : ''),
              (form.charInfo.trim() ? '── 武将/卡牌基本信息(势力/体力/性别等)──\n' + form.charInfo.trim() : ''),
              (form.notes && form.notes.length ? '该包有历史注意点 ' + form.notes.length + ' 条(过往任务实测结论):与本任务相关时才用 noname_read_extension 传 notes:true 拉取,无关条目忽略,与需求冲突时以需求为准。' : ''),
              '── 技能/卡牌清单(按顺序实现) ──',
              skillLines,
              '── 牌堆 ──',
              pileText,
              form.reference.trim() ? '── 用户提供的参考代码 ──\n' + form.reference.trim() : '',
              form.image.trim() ? '── 图片 ──\n用户已提供图片路径: ' + form.image.trim() + '\n实现完成后用 noname_copy_images 复制进扩展包 image/ 目录,按 武将ID/卡牌ID 命名文件,调用时带上任务ID。' : '',
              '── 执行要求(确认协议,逐步执行)──',
              '第 0 步【需求理解确认·硬门禁】:先 noname_read_extension 读取当前代码(大文件先传 listBlocks 看区块目录,再按 block:\'skill:ID\' 只读涉及的块),然后逐技能输出【需求理解确认】(每个技能一条:触发/频率/目标/数值/边界)。输出后停下等待用户明确回复确认。',
              '有任何歧义必须先用 ask_user_question 提问;禁止猜测。ask_user_question 的回答只消除歧义、不算确认——澄清后把最终确认单呈现给用户,仍须等待用户明确回复「确认」后才能动笔。',
              '未获用户确认前,禁止生成代码、禁止调用 noname_write_extension。',
              '用户确认后按顺序逐技能实现(每技能:noname_search_reference 搜参考→写→noname_validate),校验通过后一次写入,调用 noname_skills_written 原样带回任务ID ' + taskId + '。',
              form.idPrefix.trim() ? '内部 ID 命名规则:新增技能/武将/卡牌的内部 ID 必须 = 「' + form.idPrefix.trim() + '」前缀 + 拼音或英文,中文显示名写入 translate。' : '',
            ].filter(Boolean).join('\n');
          } else {
            var pileText;
            if (type === 'card' && pile.join && pile.entries) pileText = '加入牌堆,条目(每行「花色 点数」;花色只允许 spade/heart/club/diamond/none,none=无花色):\n' + pile.entries;
            else if (type === 'card') pileText = '不加入牌堆(仅作技能素材牌)';
            else pileText = '(武将无牌堆)';
            text = [
              '【无名杀工坊·新任务】',
              '任务ID: ' + taskId,
              '任务性质: 创建全新扩展包(目标文件夹当前不存在,需要从零创建 extension.js 与 info.json)',
              '类型: ' + (type === 'card' ? '卡牌' : '武将(含 ' + skills.length + ' 个技能)'),
              (form.title.trim() ? '名称(显示名,写入 translate): ' + form.title.trim() : ''),
              '写法: ' + (form.style === 'module' ? '新版 ES Module' : '老版 game.import'),
              '写入方式: ' + (form.writeMode === 'manual' ? '手动复制(只生成代码,不要写文件)' : '自动写入'),
              '目标扩展文件夹: ' + form.folder.trim(),
              (gameDir ? '游戏目录(所有读写的根;bash 里写作 ' + gameDirPosix + '): ' + gameDir : ''),
              form.charInfo.trim() ? '── 基本信息 ──\n' + form.charInfo.trim() : '',
              '── 技能/卡牌清单(按顺序实现) ──',
              skillLines,
              '── 牌堆 ──',
              pileText,
              form.reference.trim() ? '── 用户提供的参考代码 ──\n' + form.reference.trim() : '',
              form.image.trim() ? '── 图片 ──\n用户已提供图片路径: ' + form.image.trim() + '\n实现完成后用 noname_copy_images 复制进扩展包 image/ 目录,按 武将ID/卡牌ID 命名文件,调用时带上任务ID。' : '',
              '── 执行要求(确认协议,逐步执行)──',
              '第 0 步【需求理解确认·硬门禁】:逐技能输出【需求理解确认】(每个技能一条:触发/频率/目标/数值/边界)。输出后停下等待用户明确回复确认。',
              '有任何歧义必须先用 ask_user_question 提问;禁止猜测。ask_user_question 的回答只消除歧义、不算确认——澄清后把最终确认单呈现给用户,仍须等待用户明确回复「确认」后才能动笔。',
              '未获用户确认前,禁止生成代码、禁止调用 noname_write_extension。',
              '用户确认后按顺序逐技能实现(每技能:noname_search_reference 搜参考→写→noname_validate),校验通过后一次写入,调用 noname_skills_written 原样带回任务ID ' + taskId + '。',
              form.idPrefix.trim() ? '内部 ID 命名规则:所有新增技能/武将/卡牌的内部 ID 必须 = 「' + form.idPrefix.trim() + '」前缀 + 拼音或英文(如 ' + form.idPrefix.trim() + 'tianfa),中文显示名写入 translate——防止跨扩展包命名冲突。' : '',
            ].filter(Boolean).join('\n');
          }
          return Promise.resolve(send(text)).then(function () {
            setForm(function (prev) { return Object.assign({}, prev, { busy: false, reference: '', taskId: '' }) });
          });
        }).catch(function (error) {
          setForm(function (prev) { return Object.assign({}, prev, { busy: false, err: error && error.message || String(error) }) });
        });
      };

      var isEdit = form.mode === 'edit';
      var editingExisting = isEdit && form.goal === 'edit';
      // 技能列表编辑器(创建新武将 / 编辑已有+新增技能 共用)
      var skillRows = function () {
        return [
          e('label', 'nnk-label', '技能列表(按此顺序逐个实现;可增删、排序)'),
          form.skills.map(function (s, idx) {
            return h('div', { key: idx, className: 'nnk-card', style: { padding: '8px', marginBottom: '6px' } },
              h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px' } },
                h('b', { style: { fontSize: '12px' } }, '技能 ' + (idx + 1)),
                h('button', { className: 'nnk-smallbtn', onClick: function () { moveSkill(idx, -1) }, disabled: idx === 0 }, '↑'),
                h('button', { className: 'nnk-smallbtn', onClick: function () { moveSkill(idx, 1) }, disabled: idx === form.skills.length - 1 }, '↓'),
                h('button', { className: 'nnk-smallbtn', onClick: function () { removeSkill(idx) }, disabled: form.skills.length <= 1 }, '✕')
              ),
              h('input', { className: 'nnk-input', value: s.name, placeholder: '技能名(显示名,例: 挥砍)', style: { marginBottom: '4px' }, onChange: function (ev) { setSkill(idx, 'name')(ev.target.value) } }),
              h('textarea', { className: 'nnk-textarea', style: { minHeight: '60px' }, value: s.desc, placeholder: '效果:触发/频率/目标/数值/边界', onChange: function (ev) { setSkill(idx, 'desc')(ev.target.value) } })
            );
          }),
          h('button', { className: 'nnk-smallbtn', onClick: addSkill }, '➕ 添加技能')
        ];
      };
      try {
      return h('div', { className: 'nnk-card' },
        e('div', '', h('b', null, isEdit ? '编辑已有扩展包' : '创建新扩展包'), h('span', { className: 'nnk-hint' }, '　任务粒度:一个完整武将(含全部技能)或一张卡牌')),
        radioGroup('模式', form.mode, [{ value: 'new', text: '🆕 创建新扩展包' }, { value: 'edit', text: '📂 编辑已有扩展包' }], switchMode),
        textField('任务ID(留空自动按「文件夹名-序号」生成;反馈时用它精准定位)', form.taskId, set('taskId'), { placeholder: '例: my-pack-01' }),
        isEdit && form.taskId.trim() && (form.usedIds || []).some(function (u) { return u.id === form.taskId.trim() })
          ? e('div', 'nnk-err', '⚠️ 任务ID「' + form.taskId.trim() + '」此包已用过,请换一个')
          : null,
        isEdit
          ? [e('label', 'nnk-label', '选择已有扩展包' + (form.extLoading ? '(加载中…)' : '')),
             form.extList.length === 0 && !form.extLoading ? e('div', 'nnk-hint', '没有可选的扩展包(游戏 extension 目录为空或未配置游戏路径)') : null,
             h('select', { className: 'nnk-input', value: form.folder, onChange: function (ev) { pickExisting(ev.target.value) } },
               [h('option', { key: '', value: '' }, '— 选择扩展包 —')].concat(form.extList.map(function (f) {
                 return h('option', { key: f, value: f }, f)
               }))),
             form.folder ? h('button', { className: 'nnk-smallbtn', disabled: form.busy, onClick: migrateFolder, title: '给条目所在的 .js 文件插入锚点注释行,启用区块化读写(防抄错+省 token);一个代码字符都不会改,且会先自动备份。多文件包(条目在子目录模块)会对每个含条目的文件逐一处理' }, '🔨 建立区块索引') : null,
             form.currentInfo ? e('div', 'nnk-hint', form.currentInfo) : null,
             form.folder && form.usedIds && form.usedIds.length
               ? e('div', 'nnk-hint', '已用任务ID: ' + form.usedIds.map(function (u) { return u.id + '(' + u.state + ')' }).join('、') + ' —— 新任务请避开这些')
               : (form.folder ? e('div', 'nnk-hint', '此包暂无任务记录') : null)]
          : [textField('新扩展包名称(游戏 extension/ 下的文件夹名)', form.folder, set('folder'))],
        radioGroup('类型', form.type, [{ value: 'character', text: '⚔️ 武将' }, { value: 'card', text: '🃏 卡牌' }], switchType),
        isEdit ? radioGroup('目标', form.goal, [{ value: 'create', text: '✨ 创建新' }, { value: 'edit', text: '✏️ 编辑已有' }], switchGoal) : null,
        editingExisting ? [
          e('label', 'nnk-label', '编辑目标(选择要修改的' + (form.type === 'card' ? '卡牌' : '武将') + ')' + (form.entryLoading ? '(加载中…)' : '')),
          h('select', { className: 'nnk-input', value: form.entryId, onChange: function (ev) { pickEntry(ev.target.value) } },
            [h('option', { key: '', value: '' }, '— 选择要修改的' + (form.type === 'card' ? '卡牌' : '武将') + ' —')].concat(form.entryList.map(function (en) {
              var tag = en.file && en.file !== 'extension.js' ? ' · ' + en.file.replace(/\.js$/, '') : '';
              return h('option', { key: en.id, value: en.id }, en.id + (en.name ? '(' + en.name + ')' : '') + tag)
            }))),
          !form.entryLoading && form.entryList.length === 0
            ? e('div', 'nnk-hint', '此包没有检测到可编辑的' + (form.type === 'card' ? '卡牌' : '武将') + '(若确实有,先点「🔨 建立区块索引」或确认该包有 extension.js)')
            : null,
          form.entryId && form.entrySkills.length ? [
            e('label', 'nnk-label', '该' + (form.type === 'card' ? '卡牌' : '武将') + '的技能(勾选要修改的并在框里写清改成什么;不勾 = 不改技能)' + (form.entrySkillsLoading ? '(加载中…)' : '')),
            h('div', {}, form.entrySkills.map(function (en) {
              var picked = form.pickedSkills.filter(function (p) { return p.id === en.id })[0];
              return h('div', { key: en.id, style: { marginBottom: '6px' } },
                h('label', { className: 'nnk-radio' },
                  h('input', { type: 'checkbox', checked: !!picked, onChange: function () { togglePicked(en.id, en.name) } }),
                  en.id + (en.name ? '(' + en.name + ')' : '')
                ),
                picked ? h('input', { className: 'nnk-input', style: { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: '4px' }, value: picked.note, placeholder: '要改成什么(必填),例: 伤害 1 改为 2,每回合限一次', onChange: function (ev) { setPickedNote(en.id, ev.target.value) } }) : null
              );
            }))
          ] : null,
          form.entryId && !form.entrySkillsLoading && !form.entrySkills.length
            ? e('div', 'nnk-hint', '未从该条目解析出技能清单(技能改动可直接写进下面的改动描述,由 AI 在确认阶段澄清)')
            : null,
          e('label', 'nnk-label', (form.type === 'card' ? '卡牌' : '武将') + '改动描述(条目本身的变化:' + (form.type === 'card' ? '类别/花色点数/名称等' : '体力/护甲/名称等') + ';可选)'),
          h('textarea', { className: 'nnk-textarea', style: { minHeight: '80px' }, value: form.editNotes, placeholder: form.type === 'card' ? '例: 类别改为锦囊牌,花色点数改为黑桃 5;卡面描述同步修改' : '例: 初始体力信息改为 3/4/1(3 点体力、4 点上限、1 点护甲);显示名保持不变', onChange: function (ev) { set('editNotes')(ev.target.value) } }),
          form.type === 'character' ? radioGroup('是否新增技能', form.addSkills ? 'yes' : 'no', [{ value: 'no', text: '不新增' }, { value: 'yes', text: '新增技能(填下面的技能列表)' }], function (v) { patch({ addSkills: v === 'yes' }) }) : null,
          form.addSkills && form.type === 'character' ? skillRows() : null
        ] : null,
        textField((form.type === 'card' ? '卡牌名称' : '武将名称') + (editingExisting ? '(新显示名,可选;留空 = 不改名)' : '(显示名,会写入 translate)'), form.title, set('title'), { placeholder: form.type === 'card' ? '例: 疾风符' : '例: 凌霜' }),
        (editingExisting && !(form.addSkills && form.type === 'character')) ? null : textField('ID 前缀(防止与其他扩展包的技能/武将/卡牌重名;可选但强烈建议)', form.idPrefix, set('idPrefix'), { placeholder: '例: cs_ (则内部 ID 形如 cs_tianfa)' }),
        !editingExisting && form.type === 'character' ? textField('武将基本信息(势力、体力、性别…;可选)', form.charInfo, set('charInfo'), { placeholder: '例:群势力,3 体力,男性,风格偏辅助' }) : null,
        h('div', { key: 'img' },
          e('label', 'nnk-label', '图片路径(武将立绘/卡牌图;可选)'),
          h('input', { className: 'nnk-input', value: form.image, placeholder: '例: D:\\pic\\hero.png —— AI 复制进扩展包 image/ 后按 ID 命名', onChange: function (ev) { set('image')(ev.target.value) } })
        ),
        editingExisting ? null : (form.type === 'character' ? skillRows() : [
          e('label', 'nnk-label', '卡牌效果'),
          h('textarea', { className: 'nnk-textarea', value: form.skills[0].desc, placeholder: '效果:类型/花色点数需求/效果/边界', onChange: (function () {
            return function (ev) {
              var skills = form.skills.slice();
              if (!skills[0]) skills[0] = { name: '', desc: '' };
              skills[0] = Object.assign({}, skills[0]); skills[0].desc = ev.target.value;
              patch({ skills: skills });
            };
          })() })
        ]),
        isEdit ? e('div', 'nnk-hint', '写法将自动跟随现有代码(选中扩展包后会显示检测结果)。') : radioGroup('写法版本', form.style, [{ value: 'classic', text: '老版 game.import' }, { value: 'module', text: '新版 ES Module' }], set('style')),
        !editingExisting && form.type === 'card' ? [
          e('label', 'nnk-label', '是否加入牌堆'),
          radioGroup('加入牌堆', form.pileJoin ? 'yes' : 'no', [{ value: 'no', text: '不加入牌堆' }, { value: 'yes', text: '加入牌堆(选择花色点数)' }], function (v) { patch({ pileJoin: v === 'yes' }) }),
          form.pileJoin ? h('div', {},
            form.pileRows.map(function (row, idx) {
              return h('div', { key: idx, style: { display: 'flex', gap: '6px', marginBottom: '4px' } },
                h('select', { className: 'nnk-input', style: { width: '110px' }, value: row.suit, onChange: (function (idx2) { return function (ev) {
                  var rows = form.pileRows.slice(); rows[idx2] = Object.assign({}, rows[idx2]); rows[idx2].suit = ev.target.value;
                  patch({ pileRows: rows });
                } })(idx) },
                  h('option', { value: 'spade' }, '黑桃 ♠'),
                  h('option', { value: 'heart' }, '红桃 ♥'),
                  h('option', { value: 'club' }, '梅花 ♣'),
                  h('option', { value: 'diamond' }, '方块 ♦'),
                  h('option', { value: 'none' }, '无花色')
                ),
                h('input', { className: 'nnk-input', style: { width: '60px' }, type: 'number', min: 1, max: 13, value: row.point, placeholder: '点数', onChange: (function (idx2) { return function (ev) {
                  var rows = form.pileRows.slice(); rows[idx2] = Object.assign({}, rows[idx2]); rows[idx2].point = ev.target.value;
                  patch({ pileRows: rows });
                } })(idx) }),
                h('button', { className: 'nnk-smallbtn', disabled: form.pileRows.length <= 1, onClick: function () { patch({ pileRows: form.pileRows.filter(function (r, i2) { return i2 !== idx }) }) } }, '✕')
              );
            }),
            h('button', { className: 'nnk-smallbtn', onClick: function () { patch({ pileRows: form.pileRows.concat([{ suit: 'spade', point: '' }]) }) } }, '➕ 加一张')
          ) : null
        ] : null,
        radioGroup('写入方式', form.writeMode, [{ value: 'auto', text: '自动写入(校验通过后直接落盘)' }, { value: 'manual', text: '手动复制(只生成代码)' }], set('writeMode')),
        textField('示例参考代码(你找到的想模仿的官方实现;可选)', form.reference, set('reference'), { code: true, placeholder: '粘贴官方技能代码,AI 会优先参考它的写法' }),
        form.err ? e('div', 'nnk-err', form.err) : null,
        h('button', { className: 'nnk-submit', disabled: form.busy, onClick: submit }, form.busy ? '已发送…' : (isEdit ? '发给 AI 修改' : '发给 AI 开工')),
        e('div', 'nnk-hint', '提交后 AI 会逐技能给出【需求理解确认】并停下等待——回复「确认」后才会动笔写代码;有歧义它会先问你。')
      );
      } catch (renderError) {
        return e('div', 'nnk-err', '表单渲染错误: ' + (renderError && renderError.message || renderError));
      }
    }


    // ── 历史面板 ────────────────────────────────────────────────
    function HistoryPanel() {
      var state = React.useState({ loading: true, extensions: [], detail: null, msg: '' });
      var data = state[0], setData = state[1];
      var load = function () {
        fetch('/noname-kit-api/history').then(function (r) { return r.json() }).then(function (body) {
          setData({ loading: false, extensions: body.extensions || [], detail: null, msg: body.error || '' })
        }, function () { setData({ loading: false, extensions: [], detail: null, msg: '历史服务不可用(需配置 nonameDir 并重启)' }) });
      };
      React.useEffect(function () { load() }, []);
      var openDetail = function (folder) {
        fetch('/noname-kit-api/history?folder=' + encodeURIComponent(folder)).then(function (r) { return r.json() }).then(function (body) {
          setData(function (prev) { return Object.assign({}, prev, { detail: body }) })
        }, function () {
          setData(function (prev) { return Object.assign({}, prev, { msg: '读取备份详情失败(历史服务不可用)' }) });
        });
      };
      var rollback = function (folder, backup) {
        if (!window.confirm('把 ' + backup + ' 回滚为当前版本?当前版本会先自动备份。')) return;
        fetch('/noname-kit-api/rollback', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ folder: folder, backup: backup }),
        }).then(function (r) { return r.json() }).then(function (body) {
          setData(function (prev) { return Object.assign({}, prev, { msg: body.ok ? '已回滚 ' + backup : ('回滚失败: ' + body.error) }) });
          openDetail(folder);
        }, function () {
          setData(function (prev) { return Object.assign({}, prev, { msg: '回滚请求失败(历史服务不可用),未执行回滚' }) });
        });
      };
      var deleteNote = function (folder, index) {
        fetch('/noname-kit-api/history/note-delete', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ folder: folder, index: index }),
        }).then(function (r) { return r.json() }).then(function (body) {
          setData(function (prev) { return Object.assign({}, prev, { msg: body.ok ? '已删除注意点' : ('删除失败: ' + body.error) }) });
          openDetail(folder);
        }, function (error) { setData(function (prev) { return Object.assign({}, prev, { msg: '删除失败: ' + (error && error.message || error) }) }) });
      };

      if (data.loading) return e('div', 'nnk-hint', '加载中…');
      if (data.msg && data.extensions.length === 0) return e('div', 'nnk-err', data.msg);
      var fmt = function (ts) { return new Date(ts).toLocaleString() };

      return h('div', {},
        data.msg ? e('div', 'nnk-ok', data.msg) : null,
        // 详情卡片放列表上方:点「备份/注意点」后立即可见(列表很长时沉底等于没反应)
        data.detail ? (function () {
          var detail = data.detail, backups = detail.backups || [];
          return h('div', { className: 'nnk-card', ref: function (el) {
            if (el && !el.__nnkScrolled) { el.__nnkScrolled = true; el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }
          } },
            h('b', null, '备份与注意点: ' + detail.folder),
            backups.length ? [
              e('div', 'nnk-hint', '点击备份名把 extension.js 回滚到该时点(回滚前当前版会先自动备份):'),
              h('div', {}, backups.map(function (b) {
                return h('button', { key: b, className: 'nnk-copy', style: { marginRight: '8px', marginBottom: '4px' }, onClick: function () { rollback(detail.folder, b) } }, '⏪ ' + b)
              }))
            ] : e('div', 'nnk-hint', '该包还没有备份——每次覆盖写入前都会自动生成一份。'),
            (detail.history && detail.history.notes && detail.history.notes.length) ? [
              e('div', 'nnk-label', '注意点清单(无关/过时的单条删除,AI 仅按需拉取)'),
              detail.history.notes.map(function (n, i) {
                return h('div', { key: i, style: { display: 'flex', gap: '6px', alignItems: 'flex-start', marginBottom: '4px' } },
                  e('div', 'nnk-note', n),
                  h('button', { className: 'nnk-smallbtn', onClick: function () { deleteNote(detail.folder, i) } }, '🗑')
                )
              })
            ] : null
          );
        })() : null,
        h('div', { className: 'nnk-card' },
          e('b', null, '扩展总览'),
          data.extensions.length === 0 ? e('div', 'nnk-hint', '还没有记录:完成第一个任务后这里会出现历史。') : null,
          data.extensions.map(function (ext) {
            return h('div', { key: ext.folder, className: 'nnk-taskrow' },
              h('div', {},
                h('b', null, ext.folder),
                h('span', { className: 'nnk-badge', style: { marginLeft: '8px' } }, ext.taskCount + ' 个任务'),
                h('span', { className: 'nnk-badge' }, '累计 ' + ext.totalRounds + ' 轮'),
                ext.backupCount ? h('span', { className: 'nnk-badge' }, ext.backupCount + ' 备份') : null
              ),
              ext.lastTask ? e('div', 'nnk-taskmeta', '最近: [' + (ext.lastTask.kind === 'card' ? '卡牌' : '武将') + '] ' + ext.lastTask.summary + ' · ' + fmt(ext.lastTask.at)) : null,
              h('button', { className: 'nnk-copy', onClick: function () { openDetail(ext.folder) } }, '📦 备份/注意点')
            );
          })
        )
      );
    }

    // ── 设置面板(⚙ 子页):游戏目录 / AI 输出阀门 / 关于 ─────────
    function SettingsPanel() {
      var state = React.useState({ loading: true, version: '', nonameDir: '', source: 'none', bashMax: 64000, bashMaxK: '64', updateCheck: true, manual: '', scanning: false, scanned: false, candidates: [], busy: false, healthBusy: false, msg: '', err: '', healthMsg: '', healthErr: '' });
      var form = state[0], setForm = state[1];
      var set = function (patch) { setForm(function (prev) { return Object.assign({}, prev, patch) }) };
      var load = function () {
        fetch('/noname-kit-api/settings').then(function (r) { return r.json() }).then(function (s) {
          var bytes = s.bashMaxOutputBytes || 64000;
          set({ loading: false, version: s.version || '', nonameDir: s.nonameDir || '', source: s.source || 'none', bashMax: bytes, bashMaxK: String(Math.round(bytes / 1000)), updateCheck: s.updateCheck !== false });
        }, function () { set({ loading: false, err: '设置服务不可用(插件更新后需重启 DSH)' }) });
      };
      React.useEffect(function () { load() }, []);
      // 版本/一致性状态来自共享的 healthBus(🛠 按钮那份),挂载时刷一次
      var healthState = React.useState(healthBus.state);
      var health = healthState[0], setHealth = healthState[1];
      React.useEffect(function () {
        var off = healthBus.sub(setHealth);
        healthBus.refresh();
        return off;
      }, []);

      var scan = function () {
        set({ scanning: true, err: '' });
        fetch('/noname-kit-api/detect').then(function (r) { return r.json() }).then(function (body) {
          set({ scanning: false, scanned: true, candidates: body.candidates || [] });
        }, function () { set({ scanning: false, err: '扫描失败' }) });
      };
      var saveDir = function (dir) {
        if (!dir || !dir.trim()) { set({ err: '请先填写或选择游戏本体目录' }); return }
        set({ busy: true, err: '', msg: '' });
        fetch('/noname-kit-api/init', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nonameDir: dir.trim() }),
        }).then(function (r) { return r.json() }).then(function (body) {
          if (!body.ok) throw new Error(body.error || '保存失败');
          set({ busy: false, msg: '✅ 游戏目录已更新: ' + body.nonameDir });
          load();
        }, function (error) { set({ busy: false, err: '保存失败: ' + (error && error.message || error) }) });
      };
      var saveBashMax = function (v) {
        var n = parseInt(v, 10);
        if (!isFinite(n) || n < 64000 || n > 256000) { set({ err: '输出上限需在 64 ~ 256 K 之间' }); return }
        set({ busy: true, err: '', msg: '' });
        fetch('/noname-kit-api/settings', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ bashMaxOutputBytes: n }),
        }).then(function (r) { return r.json() }).then(function (body) {
          if (!body.ok) throw new Error(body.error || '保存失败');
          set({ busy: false, bashMax: body.bashMaxOutputBytes, bashMaxK: String(Math.round(body.bashMaxOutputBytes / 1000)), msg: '✅ 输出上限已保存为 ' + Math.round(body.bashMaxOutputBytes / 1000) + 'K——对新开的会话生效(已开的会话保持不变)' });
        }, function (error) { set({ busy: false, err: '保存失败: ' + (error && error.message || error) }) });
      };
      var checkNow = function () {
        set({ healthBusy: true, healthErr: '', healthMsg: '' });
        fetch('/noname-kit-api/update/check', { method: 'POST' }).then(function (r) { return r.json() }).then(function (body) {
          healthBus.adopt(body);
          var check = body.check || {};
          // link 方式不参与检测,直说,别绕
          set({ healthBusy: false, healthMsg: check.skipped === 'link' ? 'link 方式不参与版本检测' : (check.error ? '' : '✅ 已检查') });
        }, function (error) { set({ healthBusy: false, healthErr: '检查失败: ' + (error && error.message || error) }) });
      };
      var reinstallPreset = function () {
        set({ healthBusy: true, healthErr: '', healthMsg: '' });
        fetch('/noname-kit-api/preset/install', { method: 'POST' }).then(function (r) { return r.json() }).then(function (body) {
          if (!body.ok) throw new Error(body.error || '安装失败');
          healthBus.set({ preset: body.preset || null });
          set({ healthBusy: false, healthMsg: '✅ preset 已重装' + (body.backup ? '(旧版已备份)' : '') + '——对新建会话生效,已开的会话不变' });
        }, function (error) { set({ healthBusy: false, healthErr: '重装失败: ' + (error && error.message || error) }) });
      };
      var toggleUpdateCheck = function () {
        var next = !form.updateCheck;
        set({ busy: true, err: '', msg: '' });
        fetch('/noname-kit-api/settings', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ updateCheck: next }),
        }).then(function (r) { return r.json() }).then(function (body) {
          if (!body.ok) throw new Error(body.error || '保存失败');
          set({ busy: false, updateCheck: body.updateCheck });
          healthBus.set({ updateCheck: body.updateCheck });
        }, function (error) { set({ busy: false, err: '保存失败: ' + (error && error.message || error) }) });
      };

      // 版本与一致性两行:插件本体(能查新版就告知,不自动更新)+ preset 一致性
      var renderUpdateRow = function () {
        var check = health.update;
        var installForm = health.installForm || 'unknown';
        var line;
        if (installForm === 'link') {
          line = e('div', 'nnk-hint', 'link 方式加载的插件不参与版本检测');
        } else if (check && check.error) {
          line = e('div', 'nnk-hint', '检查失败:' + check.error + '(不影响使用,可稍后重试)');
        } else if (check && check.hasUpdate) {
          line = e('div', 'nnk-err', '⬆ 有新版本 v' + check.latest + '(当前 v' + (check.current || form.version) + ',来源 ' + check.source + ')');
        } else if (check) {
          line = e('div', 'nnk-hint', '✅ 已是最新(v' + (check.current || form.version) + ',来源 ' + check.source + ')');
        } else if (!form.updateCheck) {
          line = e('div', 'nnk-hint', '启动时自动检查已关闭,尚未检查过。');
        } else {
          line = e('div', 'nnk-hint', '尚未检查(点右侧「检查更新」)。');
        }
        var cmd = check && check.hasUpdate ? (health.installHint || check.installHint) : null;
        return e('div', {},
          h('div', {},
            h('b', null, '插件'),
            h('span', { className: 'nnk-hint' }, '　当前 v' + (form.version || '?') + (installForm === 'link' ? ' · link 方式加载' : ''))
          ),
          h('div', {},
            h('button', { className: 'nnk-smallbtn', disabled: form.healthBusy, onClick: checkNow }, form.healthBusy ? '检查中…' : '🔄 检查更新'),
            h('button', { className: 'nnk-smallbtn', disabled: form.busy, onClick: toggleUpdateCheck }, (form.updateCheck ? '☑' : '☐') + ' 启动时自动检查')
          ),
          line,
          cmd ? e('div', 'nnk-hint', '在终端执行(完成后重启 DSH):') : null,
          cmd ? h('div', {}, h('code', { className: 'nnk-cmd' }, cmd)) : null
        );
      };
      var renderPresetRow = function () {
        var preset = health.preset;
        var line;
        if (!health.loaded) line = e('div', 'nnk-hint', '读取中…');
        else if (!preset) line = e('div', 'nnk-hint', '状态不可用(服务端未响应)');
        else if (preset.state === 'ok') line = e('div', 'nnk-hint', '✅ 与插件自带的一致');
        else if (preset.state === 'missing') line = e('div', 'nnk-hint', '⚠️ 未安装——新建会话里选不到「无名杀开发模式」,点右侧重装。');
        else if (preset.state === 'stale') {
          // 只陈述事实(哈希不同)+ 后果(重装会覆盖本地这份),不替用户猜原因 ——
          // "本地被改过"或"插件更新了"都只是可能,猜错反而误导
          var mine = String(preset.installedHash || '').slice(0, 8);
          var theirs = String(preset.bundledHash || '').slice(0, 8);
          line = e('div', 'nnk-hint', '⚠️ 与插件自带的不一致(已装 ' + mine + ' ≠ 插件 ' + theirs + ')。点重装会用插件自带那份覆盖本地这份(先备份)。');
        }
        else line = e('div', 'nnk-hint', '⚠️ ' + (preset.error || '状态未知'));
        return e('div', {},
          h('div', {},
            h('b', null, '开发模式 preset'),
            h('span', { className: 'nnk-hint' }, '　AI 的人格、常驻工具名单与技能文档')
          ),
          h('div', {}, h('button', { className: 'nnk-smallbtn', disabled: form.healthBusy, onClick: reinstallPreset }, '♻️ 重装 preset')),
          line,
          e('div', 'nnk-hint', 'preset 是插件行为的第二份副本,代码更新后不重装会拿到自相矛盾的指令且不报错,所以单列一行。覆盖前会先备份成 noname-dev.bak-<时间戳>。')
        );
      };

      if (form.loading) return e('div', 'nnk-hint', '加载中…');
      var PRESETS = [['64K', 64000], ['128K', 128000], ['256K', 256000]];
      return h('div', { className: 'nnk-card' },
        form.msg ? e('div', 'nnk-ok', form.msg) : null,
        form.err ? e('div', 'nnk-err', form.err) : null,

        e('div', {}, h('b', null, '游戏目录'), h('span', { className: 'nnk-hint' }, '　AI 自动写入扩展的游戏本体位置(extension/ 所在层)')),
        e('div', 'nnk-hint', form.nonameDir
          ? '当前: ' + form.nonameDir + '(' + (form.source === 'cordis.yml' ? '由配置文件指定' : '工坊设置') + ')'
          : '⚠️ 未配置——AI 无法自动写入,只能用「手动复制」模式'),
        h('input', { className: 'nnk-input', value: form.manual, placeholder: '手动填写游戏本体目录,例: D:\\Games\\noname\\resources\\app', onChange: function (ev) { set({ manual: ev.target.value }) } }),
        h('div', { style: { marginTop: '6px' } },
          h('button', { className: 'nnk-smallbtn', disabled: form.scanning || form.busy, onClick: scan }, form.scanning ? '扫描中…' : (form.scanned ? '🔍 重新扫描本机' : '🔍 自动扫描本机')),
          form.manual.trim() ? h('button', { className: 'nnk-smallbtn', disabled: form.busy, onClick: function () { saveDir(form.manual) } }, '💾 保存所填目录') : null
        ),
        form.scanned && form.candidates.length === 0 ? e('div', 'nnk-hint', '没扫到——游戏在非常规位置就用上面手动填写。') : null,
        form.candidates.map(function (dir) {
          return h('label', { key: dir, className: 'nnk-radio', style: { display: 'block', margin: '4px 0' } },
            h('input', { type: 'radio', name: 'nnk-set-candidate', checked: form.manual === dir, onChange: function () { set({ manual: dir }) } }),
            dir
          );
        }),

        h('div', { style: { marginTop: '14px' } }, h('b', null, 'AI 单次命令输出上限'), h('span', { className: 'nnk-hint' }, '　直接影响 token 消耗(新会话生效)')),
        e('div', 'nnk-hint', '控制 AI 每次执行命令/查资料最多往对话里灌多少内容。'),
        h('div', {}, PRESETS.map(function (p) {
          var active = Number(form.bashMax) === p[1];
          return h('button', { key: p[1], className: 'nnk-smallbtn', style: active ? { borderColor: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)' } : {}, disabled: form.busy, onClick: function () { saveBashMax(p[1]) } }, p[0] + (active ? ' ✓' : ''));
        })),
        h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px' } },
          h('input', { className: 'nnk-input', style: { width: '120px' }, type: 'number', min: 64, max: 256, value: form.bashMaxK, onChange: function (ev) { set({ bashMaxK: ev.target.value }) } }),
          e('span', 'nnk-hint', 'K(64 ~ 256)'),
          h('button', { className: 'nnk-smallbtn', disabled: form.busy, onClick: function () { saveBashMax((parseInt(form.bashMaxK, 10) || 0) * 1000) } }, '💾 保存上限')
        ),

        h('div', { style: { marginTop: '14px' } }, h('b', null, '版本与一致性'), h('span', { className: 'nnk-hint' }, '　插件本体与开发模式 preset')),
        form.healthMsg ? e('div', 'nnk-ok', form.healthMsg) : null,
        form.healthErr ? e('div', 'nnk-err', form.healthErr) : null,
        renderUpdateRow(),
        h('div', { style: { marginTop: '12px' } }, renderPresetRow()),

        h('div', { style: { marginTop: '14px' } }, h('b', null, '关于')),
        e('div', 'nnk-hint', '无名杀工坊(noname-kit)v' + (form.version || '?') + ' · 「无名杀开发模式」与工坊同属一套,本页设置保存在 ~/.dsh/noname-kit.json')
      );
    }

    // ── 工坊页(四个子页签:任务 / 任务列表 / 历史 / 设置) ───────
    function WorkshopView(props) {
      var sessionId = props.sessionId;
      // Hooks 规则:所有 hook 必须在任何条件返回之前声明
      var ready = React.useState(null); // null=检测中, false=需初始化, true=正常
      var phase = ready[0], setPhase = ready[1];
      var tab = React.useState('new');
      var active = tab[0], setActive = tab[1];
      React.useEffect(function () {
        fetch('/noname-kit-api/status').then(function (r) { return r.json() }).then(function (status) {
          setPhase(Boolean(status.active));
        }, function () { setPhase(true) }); // 服务不可用时照常显示,工具会自行报错
      }, []);
      React.useEffect(function () {
        // 未配置游戏目录时默认落在「⚙ 设置」页:新用户第一眼就是配置入口
        if (phase === false) setActive('settings');
      }, [phase]);
      var presetFlip = React.useState(false);
      var presetFlipDone = presetFlip[0], setPresetFlipDone = presetFlip[1];
      React.useEffect(function () {
        if (presetFlipDone) return
        // 「无名杀开发模式」没装时也默认落在「⚙ 设置」页 —— 那页有「♻️ 重装 preset」按钮。
        // 从 npm 装的用户手里没有插件目录路径(它在 ~/.dsh/profiles/web/node_modules/ 下),
        // 指望他去命令行跑 install-preset.mjs 是不现实的(实测:陌生人卡在这一步)。
        healthBus.refresh().then(function (body) {
          setPresetFlipDone(true)
          var preset = body && body.preset
          if (preset && preset.state === 'missing') setActive('settings')
        })
      }, [presetFlipDone]);
      var send = function (text) {
        var session = sessionId;
        return Promise.resolve(session).then(function (id) {
          // sessions 服务由插件 inject 提供;绑定当前会话并发送结构化消息
          var sessions = props.sessions;
          return sessions.binding(id).session.prompt([{ type: 'text', text: text }], 'queue');
        });
      };
      if (phase === null) return e('div', 'nnk-hint', '正在检查插件配置…');

      return h('div', { className: 'nnk-wrap' },
        h('div', { className: 'nnk-tabs' },
          h('button', { className: 'nnk-tab' + (active === 'new' ? ' nnk-active' : ''), onClick: function () { setActive('new') } }, '🛠 任务'),
          h('button', { className: 'nnk-tab' + (active === 'tasklist' ? ' nnk-active' : ''), onClick: function () { setActive('tasklist') } }, '📋 任务列表'),
          h('button', { className: 'nnk-tab' + (active === 'history' ? ' nnk-active' : ''), onClick: function () { setActive('history') } }, '📜 历史'),
          h('button', { className: 'nnk-tab' + (active === 'settings' ? ' nnk-active' : ''), onClick: function () { setActive('settings') } }, '⚙ 设置')
        ),
        phase === false && active === 'new' ? e('div', 'nnk-err', '⚠️ 还没配置游戏目录——到「⚙ 设置」页填一下就能自动写入;暂时不配也行,把写入方式设为「手动复制」。') : null,
        active === 'new' ? h(NewTaskForm, { sessionId: sessionId, send: send }) : null,
        active === 'tasklist' ? h(TaskListContent, { sessions: props.sessions, compact: false }) : null,
        active === 'history' ? h(HistoryPanel) : null,
        active === 'settings' ? h(SettingsPanel) : null
      );
    }

    // ── 工具结果卡片 ────────────────────────────────────────────
    /** 从 ToolCallBlock 提取参数与结果(兼容运行中/已结束两种形态)。 */
    function parseBlock(block) {
      block = block || {};
      var settled = Boolean(block.call);
      var argsRaw = (settled ? block.call.argsRaw : block.argsRaw) || '{}';
      var args = {};
      try { args = JSON.parse(argsRaw) } catch (e) { args = {} }
      var text = '';
      if (settled && Array.isArray(block.content)) {
        text = block.content.map(function (c) { return (c && typeof c.text === 'string') ? c.text : '' }).join('\n');
      }
      return { args: args, text: text, settled: settled, isError: settled && block.isError };
    }

    function ValidateCard(props) {
      var parsed = parseBlock(props.block);
      if (!parsed.settled) return e('div', 'nnk-hint', '⏳ 正在校验扩展代码…');
      if (parsed.isError) return e('div', 'nnk-err', '❌ 校验返回异常,详见文本结果。');
      // render 文本是工具结果的唯一载体(无结构化值通道),按文本前缀判定,正文全量展示
      var ok = (parsed.text || '').indexOf('校验通过') === 0;
      return h('div', {},
        e('div', {}, h('b', null, '扩展代码校验')),
        ok ? e('div', 'nnk-ok', '✅ 校验通过') : e('div', 'nnk-err', '❌ 校验未通过(未写入)'),
        h('pre', { className: 'nnk-note', style: { whiteSpace: 'pre-wrap', maxHeight: '260px', overflow: 'auto' } }, parsed.text || '(无返回)')
      );
    }

    function WriteCard(props) {
      var parsed = parseBlock(props.block);
      if (!parsed.settled) return e('div', 'nnk-hint', '⏳ 正在校验并写入扩展…');
      if (parsed.isError) return e('div', 'nnk-err', '❌ 写入返回异常,详见文本结果。');
      var text = parsed.text || '';
      var head = text.split('\n')[0] || '';
      var title = head.indexOf('已写入') === 0 ? '✅ 扩展已写入'
        : head.indexOf('手动模式') === 0 ? '📋 代码已生成(手动复制模式)'
        : (head.indexOf('写入被拒') === 0 || head.indexOf('校验未通过') === 0) ? '❌ 未写入'
        : '写入结果';
      return h('div', {},
        e('div', {}, h('b', null, title)),
        head.indexOf('手动模式') === 0 ? e('div', 'nnk-hint', '代码在 AI 的消息里,从对话中的代码块复制保存到目标文件即可。') : null,
        h('pre', { className: 'nnk-note', style: { whiteSpace: 'pre-wrap', maxHeight: '260px', overflow: 'auto' } }, text)
      );
    }

    function CompleteCard(props) {
      var parsed = parseBlock(props.block);
      if (!parsed.settled) return e('div', 'nnk-hint', '⏳ 正在标记技能…');
      if (parsed.isError) return e('div', 'nnk-err', '❌ 收口返回异常,详见文本结果。');
      var text = parsed.text || '';
      var ok = text.indexOf('已标记') === 0;
      return h('div', {},
        e('div', {}, h('b', null, ok ? '🏁 技能已写入,待游戏测试' : '⚠️ 收口未完成')),
        e('div', { className: ok ? 'nnk-ok' : 'nnk-err' }, text),
        ok ? null : e('div', 'nnk-hint', '若任务列表状态未更新,可让 AI 重试收口;或直接在「📋 任务列表」里操作。')
      );
    }

    /** 导出:apply 注册页签 + 三张工具卡片。 */
    // ── 悬浮任务列表小窗(全局,shell.overlay + 侧栏按钮) ───────
    var panelBus = {
      open: false,
      subs: [],
      set: function (v) { this.open = v; this.subs.forEach(function (f) { f(v) }) },
      sub: function (f) { var self = this; this.subs.push(f); return function () { self.subs = self.subs.filter(function (x) { return x !== f }) } },
    };

    /** 任务列表内容(浮窗与工坊子页共用):进行中/已完成分区、反馈、删除。 */
    function TaskListContent(props) {
      var sessions = props && props.sessions;
      var data = React.useState({ list: [], loading: false, expanded: null, fbFor: null, issue: '', busy: false, err: '', msg: '' });
      var box = data[0], setBox = data[1];
      var setD = function (patch) { setBox(function (prev) { return Object.assign({}, prev, patch) }) };

      var load = function () {
        setD({ loading: true });
        fetch('/noname-kit-api/tasks').then(function (r) { return r.json() }).then(function (body) {
          setD({ loading: false, list: body.tasks || [] });
        }, function () { setD({ loading: false, err: '任务列表获取失败' }) });
      };
      React.useEffect(function () { load() }, []);

      var SKILL_BADGE = { open: ['nnk-status-open', '🟡待实现'], written: ['nnk-status-written', '🟠待测试'], confirmed: ['nnk-status-done', '✅已确认'] };

      var confirmSkill = function (task, skill) {
        fetch('/noname-kit-api/tasks/skill-status', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: task.id, skill: skill, status: 'confirmed' }),
        }).then(function (r) { return r.json() }).then(function (b) {
          if (!b.ok) { setD({ err: b.error || '操作失败' }); return }
          setD({ msg: b.autoCompleted ? '🎉 「' + task.id + '」全部技能确认且图片就位,自动完成并归档!' : '' });
          load();
        }, function (error) { setD({ err: error && error.message || String(error) }) });
      };
      var addImage = function (task) {
        var p = window.prompt('图片本地路径(将复制进扩展包 image/ 目录):', '');
        if (!p || !p.trim()) return;
        var base = p.trim().split(/[\\/]/).pop() || '';
        var name = window.prompt('包内保存的文件名(武将立绘/卡面图建议用「内部ID.jpg」,AI 预留的路径以交付说明为准):', base);
        if (!name || !name.trim()) return;
        fetch('/noname-kit-api/tasks/image', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: task.id, folder: task.folder, source: p.trim(), fileName: name.trim() }),
        }).then(function (r) { return r.json() }).then(function (b) {
          if (!b.ok) { setD({ err: b.error || '补图失败' }); return }
          setD({ msg: '📷 「' + task.id + '」图片已复制进扩展包: ' + (b.copied || []).join(', ') + (b.autoCompleted ? ' —— 🎉 全部确认+图片就位,自动完成并归档!' : '') });
          load();
        }, function (error) { setD({ err: error && error.message || String(error) }) });
      };
      var feedbackSubmit = function (task, skill) {
        if (!box.issue.trim()) { setD({ err: '问题描述不能为空' }); return }
        setD({ busy: true, err: '' });
        fetch('/noname-kit-api/tasks/feedback', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: task.id, skill: skill || '', issue: box.issue.trim() }),
        }).then(function (r) { return r.json() }).then(function (fb) {
          if (!fb.ok) throw new Error(fb.error || '记录失败');
          var sendErr = null;
          try {
            var sid = sessions && sessions.list && sessions.list.getSnapshot ? sessions.list.getSnapshot().current : null;
            if (sid) {
              var text = [
                '【无名杀工坊·问题反馈】',
                '任务ID: ' + task.id,
                '目标扩展文件夹: ' + task.folder,
                skill ? '问题技能: ' + skill : '',
                '当前轮次: 第 ' + fb.task.rounds + ' 轮',
                '── 问题描述/游戏内表现/报错 ──',
                box.issue.trim(),
                '── 执行要求 ──',
                '先 noname_read_extension 读取当前代码,定位问题并说明原因,修复后 noname_validate,校验通过后写入。修复后调用 noname_skills_written,原样带回任务ID ' + task.id + '。',
              ].filter(Boolean).join('\n');
              sessions.binding(sid).session.prompt([{ type: 'text', text: text }], 'queue');
            } else {
              sendErr = '已记录反馈,但当前没有打开的会话——请打开会话后重试,或把反馈粘贴到对话里';
            }
          } catch (e) { sendErr = '反馈已记录,但发送失败: ' + (e && e.message || e) }
          setD({ busy: false, issue: '', fbFor: null, err: sendErr || '' });
          load();
        }, function (error) { setD({ busy: false, err: error && error.message || String(error) }) });
      };
      var markDone = function (task) {
        // 防呆:缺图或技能未全确认时,手动完成会绕过「缺图不自动完成」的保护——
        // 弹确认把状态亮出来,用户明确选择才放行(不剥夺自由度,只防手滑)
        var skills = Array.isArray(task.skills) ? task.skills : [];
        var confirmed = skills.filter(function (s) { return s.status === 'confirmed' }).length;
        var warn = [];
        if (!task.image) warn.push('未登记图片');
        if (skills.length && confirmed < skills.length) warn.push('技能确认 ' + confirmed + '/' + skills.length);
        if (warn.length && !window.confirm('「' + task.id + '」' + warn.join('、') + '。\n确定仍要标记完成并归档吗?')) return;
        fetch('/noname-kit-api/tasks/complete', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: task.id, summary: task.summary || '手动标记完成' + (skills.length ? '(确认 ' + confirmed + '/' + skills.length + ')' : '') }),
        }).then(function (r) { return r.json() }).then(function (body) {
          if (!body.ok) { setD({ err: body.error || '完成失败' }); return }
          load();
        }, function (error) { setD({ err: error && error.message || String(error) }) });
      };
      var reopenTask = function (task) {
        fetch('/noname-kit-api/tasks/reopen', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: task.id }),
        }).then(function (r) { return r.json() }).then(function (body) {
          if (!body.ok) { setD({ err: body.error || '重开失败' }); return }
          setD({ msg: '🔁 「' + task.id + '」已重开——补图或重新确认后可再次收口' });
          load();
        }, function (error) { setD({ err: error && error.message || String(error) }) });
      };
      var removeTask = function (task) {
        var msg = '删除任务「' + task.id + '」?\n\n将清除:任务记录、轮次、反馈日志。\n不会删除:已写入的扩展代码、备份文件、历史归档。';
        if (!window.confirm(msg)) return;
        fetch('/noname-kit-api/tasks/delete', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: task.id }),
        }).then(function (r) { return r.json() }).then(function (body) {
          if (!body.ok) { setD({ err: body.error || '删除失败' }); return }
          load();
        }, function (error) { setD({ err: error && error.message || String(error) }) });
      };

      if (box.loading) return e('div', 'nnk-hint', '加载中…');
      var fmt = function (ts) { return new Date(ts).toLocaleString() };
      var open = box.list.filter(function (t) { return t.status === 'open' });
      var done = box.list.filter(function (t) { return t.status !== 'open' });

      var renderRow = function (task, isDoneSection) {
        var expanded = box.expanded === task.id;
        var fbTarget = box.fbFor && box.fbFor.id === task.id ? box.fbFor : null;
        var skills = Array.isArray(task.skills) ? task.skills : [];
        return h('div', { key: task.id, className: 'nnk-taskrow' },
          h('div', {},
            h('span', { className: 'nnk-badge ' + (task.status === 'open' ? 'nnk-status-open' : 'nnk-status-done') },
              task.status === 'open' ? '🔵进行中' : '✅已完成'),
            h('b', null, task.id)
          ),
          e('div', 'nnk-taskmeta', '📂 ' + task.folder + ' · 返工 ' + task.rounds + ' 轮 · ' + fmt(task.updatedAt)),
          skills.length
            ? e('div', 'nnk-taskmeta', '技能确认进度: ' + skills.filter(function (s) { return s.status === 'confirmed' }).length + '/' + skills.length + (!task.image && !task.target ? ' · 📷 缺图片(不登记图片不会自动完成)' : (!task.image && task.target ? ' · 编辑任务:不涉及图片' : '')))
            : null,
          h('div', {},
            h('button', { className: 'nnk-smallbtn', onClick: function () { setD({ expanded: expanded ? null : task.id, fbFor: null, msg: '' }) } }, expanded ? '收起' : (skills.length ? '展开技能树' : '展开')),
            !isDoneSection ? h('button', { className: 'nnk-smallbtn', onClick: function () { setD({ expanded: task.id, fbFor: fbTarget && !fbTarget.skill ? null : { id: task.id, skill: '' }, issue: '', msg: '' }) } }, '🔁 反馈') : null,
            !isDoneSection && !task.image ? h('button', { className: 'nnk-smallbtn', onClick: function () { addImage(task) } }, '📷 补图') : null,
            !isDoneSection ? h('button', { className: 'nnk-smallbtn', onClick: function () { markDone(task) } }, '✅ 标记完成') : null,
            isDoneSection ? h('button', { className: 'nnk-smallbtn', title: '回到进行中:可补图或重新确认后再次收口' , onClick: function () { reopenTask(task) } }, '🔁 重开') : null,
            h('button', { className: 'nnk-smallbtn', onClick: function () { removeTask(task) } }, '🗑 删除')
          ),
          expanded && skills.length ? skills.map(function (s, i) {
            var badge = SKILL_BADGE[s.status] || SKILL_BADGE.open;
            return h('div', { key: s.name + '-' + i, className: 'nnk-card', style: { padding: '8px', marginBottom: '4px' } },
              h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
                h('span', { className: 'nnk-badge ' + badge[0] }, badge[1]),
                h('b', { style: { fontSize: '12px' } }, (i + 1) + '. ' + (s.name || '(未命名)')),
                s.rounds ? e('span', 'nnk-hint', '返工 ' + s.rounds + ' 轮') : null,
                h('span', { style: { flex: '1' } }),
                !isDoneSection && s.status !== 'confirmed' ? h('button', { className: 'nnk-smallbtn', onClick: function () { confirmSkill(task, s.name) } }, '✅ 确认无误') : null,
                !isDoneSection ? h('button', { className: 'nnk-smallbtn', onClick: function () { setD({ expanded: task.id, fbFor: fbTarget && fbTarget.skill === s.name ? null : { id: task.id, skill: s.name }, issue: '', msg: '' }) } }, '🔁 反馈') : null
              ),
              s.desc ? e('div', 'nnk-hint', s.desc.slice(0, 100) + (s.desc.length > 100 ? '…' : '')) : null,
              s.feedbacks && s.feedbacks.length ? s.feedbacks.map(function (f, j) {
                return e('div', 'nnk-fbrow', '第' + (j + 1) + '轮: ' + (f.issue || '').slice(0, 80));
              }) : null
            );
          }) : null,
          expanded && fbTarget && !isDoneSection ? h('div', {},
            e('div', 'nnk-hint', '向' + (fbTarget.skill ? '技能「' + fbTarget.skill + '」' : '任务「' + task.id + '」') + '反馈(记录后自动发给当前会话的 AI):'),
            h('textarea', {
              className: 'nnk-mini', value: box.issue,
              placeholder: '现象 / game.log 输出 / 报错',
              onChange: function (ev) { setD({ issue: ev.target.value }) },
            }),
            h('button', { className: 'nnk-smallbtn', disabled: box.busy, onClick: function () { feedbackSubmit(task, fbTarget.skill) } }, box.busy ? '提交中…' : '提交反馈')
          ) : null,
          expanded && task.feedbacks && task.feedbacks.length
            ? task.feedbacks.map(function (fb, i) {
                // 按提交时间正序编号:第1轮=最初的问题(此前 reverse 后按显示位置编号,
                // 导致最新的反馈被标成第1轮 —— issue #2)
                return e('div', 'nnk-fbrow', '第' + (i + 1) + '轮反馈' + (fb.skill ? '(' + fb.skill + ')' : '') + ': ' + (fb.issue || '').slice(0, 80))
              })
            : null
        );
      };

      return h('div', {},
        box.err ? e('div', 'nnk-err', box.err) : null,
        box.msg ? e('div', 'nnk-ok', box.msg) : null,
        e('div', 'nnk-hint', '🔵 进行中 ' + open.length + ' 个 · ✅ 已完成 ' + done.length + ' 个'),
        open.length ? h('div', {}, open.map(function (task) { return renderRow(task, false) })) : e('div', 'nnk-hint', '没有进行中的任务。在工坊「🛠 任务」页创建一个吧。'),
        done.length ? [
          e('div', 'nnk-label', '已完成'),
          h('div', {}, done.map(function (task) { return renderRow(task, true) }))
        ] : null
      );
    }

    /** 悬浮窗框架:拖动/位置记忆/开关,内容复用 TaskListContent。 */
    function TaskPanelWindow(props) {
      var sessions = props && props.sessions;
      var openState = React.useState(panelBus.open);
      var isOpen = openState[0], setIsOpen = openState[1];
      var posState = React.useState(function () {
        try { return JSON.parse(localStorage.getItem('dsh-noname-kit.panelPos')) || { x: 90, y: 70 } } catch (e) { return { x: 90, y: 70 } }
      });
      var pos = posState[0], setPos = posState[1];

      React.useEffect(function () { return panelBus.sub(function (v) { setIsOpen(v) }) }, []);

      // 拖动:标题栏 mousedown → document mousemove/mouseup
      var startDrag = function (ev) {
        var startX = ev.clientX - pos.x, startY = ev.clientY - pos.y;
        var latest = null;
        var move = function (e2) {
          var next = { x: Math.max(0, e2.clientX - startX), y: Math.max(0, e2.clientY - startY) };
          latest = next;
          setPos(next);
        };
        var up = function () {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          // 闭包里的 pos 是拖动前的快照,必须存 move 里更新过的 latest
          try { localStorage.setItem('dsh-noname-kit.panelPos', JSON.stringify(latest || pos)) } catch (e) {}
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      };

      if (!isOpen) return null;
      return h('div', { className: 'nnk-panel', style: { left: pos.x + 'px', top: pos.y + 'px' } },
        h('div', { className: 'nnk-panel-head', onMouseDown: startDrag },
          e('span', 'nnk-panel-title', '📋 无名杀任务列表'),
          h('button', { className: 'nnk-panel-close', onClick: function () { panelBus.set(false) } }, '✕')
        ),
        h('div', { className: 'nnk-panel-body' }, h(TaskListContent, { sessions: sessions }))
      );
    }

    /** 侧栏底部按钮:开关任务浮窗(wide=侧栏展开, false=56px 窄轨只显示图标)。 */
    function SidebarTaskButton(props) {
      var openState = React.useState(panelBus.open);
      var isOpen = openState[0], setIsOpen = openState[1];
      React.useEffect(function () { return panelBus.sub(function (v) { setIsOpen(v) }) }, []);
      var wide = props && props.wide !== false;
      return h('button', {
        className: 'nnk-smallbtn',
        style: wide ? {} : { fontSize: '16px', padding: '4px' },
        title: '无名杀任务列表',
        onClick: function () { panelBus.set(!panelBus.open) },
      }, wide ? (isOpen ? '📋 关闭任务列表' : '📋 任务列表') : '📋');
    }

    /** 工坊浮窗总线:输入条工坊入口按钮开关(hero 初始屏与任意会话可见)。 */
    var workshopBus = {
      open: false,
      subs: [],
      set: function (v) { this.open = v; this.subs.forEach(function (f) { f(v) }) },
      sub: function (f) { var self = this; this.subs.push(f); return function () { self.subs = self.subs.filter(function (x) { return x !== f }) } },
    };

    /** 版本/一致性状态:🛠 按钮的红点与 ⚙ 设置页共用一份,避免两处各查一次。
     *  GET /noname-kit-api/update 只做本地探测(读 profile 的 package.json + 算
     *  preset 哈希),版本信息取服务端进程内的 6 小时缓存,不发网络请求。 */
    var healthBus = {
      state: { loaded: false, failed: false, update: null, preset: null, updateCheck: true, installForm: null, installHint: null },
      subs: [],
      // 注意:通知时必须先把新状态取到局部变量再 forEach —— 回调里的 this 不是
      // 这个对象(非严格模式下是全局对象),直接写 this.state 会把 undefined 推给
      // 所有订阅者,把 React 状态设成 undefined(实测踩过:设置页整块渲染崩溃)。
      set: function (next) {
        this.state = Object.assign({}, this.state, next);
        var snapshot = this.state;
        this.subs.forEach(function (f) { f(snapshot) });
      },
      sub: function (f) { var self = this; this.subs.push(f); return function () { self.subs = self.subs.filter(function (x) { return x !== f }) } },
      adopt: function (body) {
        this.set({
          loaded: true, failed: false,
          update: body.check || null,
          preset: body.preset || null,
          updateCheck: body.updateCheck !== false,
          installForm: body.installForm || null,
          installHint: body.installHint || null,
        });
        return body;
      },
      refresh: function () {
        var self = this;
        return fetch('/noname-kit-api/update').then(function (r) { return r.json() })
          .then(function (body) { return self.adopt(body) },
            function () { self.set({ loaded: true, failed: true }); return null });
      },
      /** 是否需要提醒用户:有新版本,或 preset 没装/与插件版本不一致。 */
      needsAttention: function () {
        var s = this.state;
        if (s.failed) return false;
        return Boolean((s.update && s.update.hasUpdate) || (s.preset && s.preset.state !== 'ok' && s.preset.state !== 'unknown'));
      },
      attentionText: function () {
        var s = this.state;
        if (s.preset && s.preset.state === 'missing') return '「无名杀开发模式」preset 未安装'
        if (s.preset && s.preset.state === 'stale') return 'preset 与插件版本不一致'
        if (s.update && s.update.hasUpdate) return '插件有新版本 v' + s.update.latest
        return ''
      },
    };

    /** 输入条工坊入口:conversation.input.left 是 list 插槽,追加不替换官方件。 */
    function WorkshopChipButton(props) {
      var openState = React.useState(workshopBus.open);
      var isOpen = openState[0], setIsOpen = openState[1];
      var healthState = React.useState(healthBus.state);
      var health = healthState[0], setHealth = healthState[1];
      React.useEffect(function () { return workshopBus.sub(function (v) { setIsOpen(v) }) }, []);
      React.useEffect(function () {
        var off = healthBus.sub(setHealth);
        healthBus.refresh();
        return off;
      }, []);
      var attention = healthBus.attentionText();
      return h('button', {
        type: 'button',
        className: 'nnk-smallbtn',
        style: { margin: '0 6px', whiteSpace: 'nowrap' },
        title: '无名杀工坊:创建任务 / 任务列表 / 历史' + (attention ? '(⚠️ ' + attention + ')' : ''),
        onClick: function () { workshopBus.set(!workshopBus.open) },
      }, isOpen ? '🛠 关闭工坊' : '🛠 工坊', attention ? h('span', { className: 'nnk-dot' }) : null);
    }

    /** 工坊浮窗:初始屏/任意会话用浮层承载整个工坊页;任务发进当前会话。 */
    function WorkshopPanelWindow(props) {
      var sessions = props && props.sessions;
      var openState = React.useState(workshopBus.open);
      var isOpen = openState[0], setIsOpen = openState[1];
      var posState = React.useState(function () {
        try { return JSON.parse(localStorage.getItem('dsh-noname-kit.workshopPanelPos')) || { x: 620, y: 70 } } catch (e) { return { x: 620, y: 70 } }
      });
      var pos = posState[0], setPos = posState[1];
      React.useEffect(function () { return workshopBus.sub(function (v) { setIsOpen(v) }) }, []);
      var startDrag = function (ev) {
        var startX = ev.clientX - pos.x, startY = ev.clientY - pos.y;
        var latest = null;
        var move = function (e2) { var next = { x: Math.max(0, e2.clientX - startX), y: Math.max(0, e2.clientY - startY) }; latest = next; setPos(next) };
        var up = function () {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          try { localStorage.setItem('dsh-noname-kit.workshopPanelPos', JSON.stringify(latest || pos)) } catch (e) {}
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      };
      if (!isOpen) return null;
      var sid = sessions && sessions.list && sessions.list.getSnapshot ? sessions.list.getSnapshot().current : null;
      return h('div', { className: 'nnk-panel', style: { left: pos.x + 'px', top: pos.y + 'px', width: '420px', maxHeight: '640px' } },
        h('div', { className: 'nnk-panel-head', onMouseDown: startDrag },
          e('span', 'nnk-panel-title', '🛠 无名杀工坊'),
          h('button', { className: 'nnk-panel-close', onClick: function () { workshopBus.set(false) } }, '✕')
        ),
        h('div', { className: 'nnk-panel-body' },
          sid
            ? h(WorkshopView, { sessionId: sid, sessions: sessions })
            : e('div', 'nnk-hint', '当前没有会话——先新建会话,再用工坊派任务。')
        )
      );
    }

    exports.apply = function (ctx) {
      var slots = ctx.get('slots');
      var sessions = ctx.get('sessions');

      // 顶部页签(与官方"轨迹"同一插槽,order 排在后面)
      slots.inject('conversation.view', function () {
        return slots.register({
          name: 'conversation.view',
          id: 'noname-workshop',
          order: 20,
          label: function () { return '无名杀工坊' },
          inject: function (sessionId) { return { sessionId: sessionId } },
        }, function (props) {
          props = props || {};
          // DSH 布局的侧栏拖宽手柄是透明覆盖层,侵入内容区约 40px(z=8):
          // 工坊内容贴左渲染时,左侧按钮的点击会被它吃掉(现象=点了没反应)。
          // 留出安全边距让内容避开手柄热区;手柄压在空白上,拖拽功能不受影响。
          return React.createElement('div', { style: { paddingLeft: '48px' } },
            React.createElement(WorkshopView, Object.assign({}, props, { sessions: sessions })));
        });
      });

      // 工具结果卡片(按工具名认领渲染)
      var card = function (key, component) {
        slots.inject('tool.call.toolview', function () {
          return slots.register({ name: 'tool.call.toolview', key: key }, function (props) {
            return React.createElement(component, props);
          });
        });
      };
      card('noname_validate', ValidateCard);
      card('noname_write_extension', WriteCard);
      card('noname_skills_written', CompleteCard);

      // 悬浮任务列表:侧栏按钮开关 + shell 浮层渲染(传 sessions 供浮窗反馈发消息)
      var sessionsForPanel = ctx.get('sessions');
      ctx.slots.inject('sidebar.footer.action', function () {
        return ctx.slots.register({ name: 'sidebar.footer.action', id: 'noname-kit-tasks', order: 5 }, function (props) {
          return React.createElement(SidebarTaskButton, props);
        });
      });
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({ name: 'shell.overlay', id: 'noname-kit-tasks' }, function (props) {
          return React.createElement(TaskPanelWindow, Object.assign({}, props, { sessions: sessionsForPanel }));
        });
      });

      // 工坊入口:输入条 list 插槽(hero 初始屏与任意会话都渲染)+ 独立工坊浮层。
      // 纯插件方案,不动 DSH 源码——发布自包含是硬约束。
      ctx.slots.inject('conversation.input.left', function () {
        return ctx.slots.register({ name: 'conversation.input.left', id: 'noname-workshop-chip', order: 90 }, function (props) {
          return React.createElement(WorkshopChipButton, props);
        });
      });
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({ name: 'shell.overlay', id: 'noname-kit-workshop' }, function (props) {
          return React.createElement(WorkshopPanelWindow, Object.assign({}, props, { sessions: sessionsForPanel }));
        });
      });
    };

    exports.inject = ['slots', 'sessions'];
    return module.exports;
  }
});
