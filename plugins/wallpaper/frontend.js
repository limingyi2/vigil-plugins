// wallpaper 插件 v3.2 —— 接入 Wallpaper Engine (Steam)
// 扫描 WE 创意工坊，把视频/网页壁纸渲染到客户端背景；
// 场景壁纸挂客户端本地渲染页（WebWallGL），实时渲染而不是静态预览图。
(function () {
  'use strict';

  // Injection may happen again after a market refresh. Tear down the previous
  // owner before creating any DOM, listeners, or WebGL state.
  if (typeof window.__vigilWallpaperDispose === 'function') {
    try { window.__vigilWallpaperDispose(); } catch (e) { console.warn('[wallpaper] prior instance cleanup failed', e); }
  }

  // ========== 工具 ==========
  // 插件运行在 Electron 的 file:// 渲染层，CSP 禁止直接 fetch。
  // 所有大脑请求必须经过主进程代理的 VigilAPI，token 也只留在主进程。
  function apiGet(path) {
    var api = window.VigilAPI || window.API;
    if (!api || typeof api.get !== 'function') {
      return Promise.resolve({ ok: false, err: '客户端 API 尚未就绪' });
    }
    return api.get(path).then(function (r) {
      if (!r || !r.ok) {
        return { ok: false, err: (r && (r.err || (r.json && r.json.err))) || '请求失败' };
      }
      return r.json || { ok: false, err: '接口返回为空' };
    });
  }
  function apiPost(path, body) {
    var api = window.VigilAPI || window.API;
    if (!api || typeof api.post !== 'function') {
      return Promise.resolve({ ok: false, err: '客户端 API 尚未就绪' });
    }
    return api.post(path, body || {}).then(function (r) {
      if (!r || !r.ok) {
        return { ok: false, err: (r && (r.err || (r.json && r.json.err))) || '请求失败' };
      }
      return r.json || { ok: false, err: '接口返回为空' };
    });
  }
  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark'
      || document.body.classList.contains('dark')
      || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  // ========== 背景层 ==========
  var bgLayer = document.getElementById('wallpaper-bg-layer');
  if (!bgLayer) {
    bgLayer = document.createElement('div');
    bgLayer.id = 'wallpaper-bg-layer';
    bgLayer.className = 'wallpaper-bg';
    document.body.appendChild(bgLayer);
  }
  var scrimLayer = document.getElementById('wallpaper-scrim-layer');
  if (!scrimLayer) {
    scrimLayer = document.createElement('div');
    scrimLayer.id = 'wallpaper-scrim-layer';
    scrimLayer.className = 'wallpaper-scrim';
    document.body.appendChild(scrimLayer);
  }

  // ========== 状态 ==========
  var currentConfig = null;
  var library = [];       // WE 壁纸库
  var customLibrary = [];
  var wePath = null;
  var libraryError = '';
  var ready = Promise.resolve();
  // 场景壁纸跑在独立的渲染页 iframe 里：渲染引擎是上游 WebWallGL 的构建产物，
  // 由客户端本地只读服务供出，插件这边只负责挂框、传配置、收首帧回报。
  var sceneFrameEl = null;
  var sceneMessageHandler = null;
  var sceneReadyTimer = 0;
  var visibilityHandler = null;
  var applyGeneration = 0;
  var themeChangeHandler = null;
  var disposed = false;
  // Style-only changes must not remount the active Scene.
  var activeWallpaperKey = null;
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function setResource(element, resource, generation) {
    if (!window.vigil || !window.vigil.plugins || !window.vigil.plugins.resourceUrl) {
      console.error('[wallpaper] 客户端缺少媒体桥，请升级客户端');
      return;
    }
    window.vigil.plugins.resourceUrl(resource).then(function (r) {
      if (r && r.ok && element.isConnected && (generation == null || generation === applyGeneration) && !disposed) element.src = r.url;
      else if (!r || !r.ok) console.error('[wallpaper] 媒体地址失败:', r && r.err);
    });
  }
  function setLocalResource(element, id, generation) {
    var bridge = window.vigil && window.vigil.wallpaperImports;
    if (!bridge || !bridge.url) return;
    bridge.url(id).then(function (r) {
      if (r && r.ok && element.isConnected && (generation == null || generation === applyGeneration) && !disposed) element.src = r.url;
      else if (!r || !r.ok) console.error('[wallpaper] 导入媒体不可访问:', r && r.err);
    });
  }

  // 媒体代理 URL
  function mediaUrl(id, file) {
    return '/api/plugin/wallpaper/we/media?id=' + encodeURIComponent(id)
      + '&file=' + encodeURIComponent(file);
  }
  function previewUrl(id) {
    return '/api/plugin/wallpaper/we/preview?id=' + encodeURIComponent(id);
  }

  function destroyScene() {
    if (sceneReadyTimer) { clearTimeout(sceneReadyTimer); sceneReadyTimer = 0; }
    if (sceneFrameEl) {
      try { sceneFrameEl.src = 'about:blank'; } catch (_) {}
      try { sceneFrameEl.remove(); } catch (_) {}
      sceneFrameEl = null;
    }
  }
  // 渲染页跨源，控制面只能用 postMessage：渲染页里那段桥把指令转给 __wp。
  function tellScene(op, value) {
    if (!sceneFrameEl) return;
    try {
      sceneFrameEl.contentWindow.postMessage({ __vigil: 1, op: op, value: value }, '*');
    } catch (e) { console.warn('[wallpaper scene] 指令下发失败', e); }
  }
  // 实时渲染没起来时退回预览图，并留一个重试入口 —— 不静默降级。
  function failScene(container, id, message) {
    if (!container || !container.isConnected) return;
    if (sceneReadyTimer) { clearTimeout(sceneReadyTimer); sceneReadyTimer = 0; }
    if (sceneFrameEl) { try { sceneFrameEl.remove(); } catch (_) {} sceneFrameEl = null; }
    var status = container.querySelector('.wp-scene-status');
    if (!status) {
      status = document.createElement('div');
      status.className = 'wp-scene-status';
      container.appendChild(status);
    }
    status.classList.add('error');
    status.textContent = '场景实时渲染失败：' + message + '（下方仅为预览图）';
    if (container.querySelector('.wp-scene-fallback')) return;
    var fallback = document.createElement('img');
    fallback.className = 'wp-scene-fallback';
    fallback.alt = '场景预览图（不是实时渲染）';
    container.appendChild(fallback);
    setResource(fallback, previewUrl(id));
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'wp-scene-retry';
    retry.textContent = '重新加载场景';
    retry.addEventListener('click', function () {
      if (disposed) return;
      activeWallpaperKey = null;
      applyWallpaper(currentConfig);
    });
    container.appendChild(retry);
    console.error('[wallpaper scene] 实时渲染失败，已退回预览图; id=' + id, message);
  }
  function onSceneMessage(ev) {
    var data = ev && ev.data;
    if (!data || data.__vigilWallpaper !== 1 || !sceneFrameEl) return;
    if (ev.source && ev.source !== sceneFrameEl.contentWindow) return;
    var stage = bgLayer.querySelector('.wp-scene-stage');
    if (!stage || !stage.isConnected) return;
    if (data.op === 'ready') {
      if (sceneReadyTimer) { clearTimeout(sceneReadyTimer); sceneReadyTimer = 0; }
      stage.dataset.liveReady = 'true';
      var status = stage.querySelector('.wp-scene-status');
      if (status) status.remove();
      console.info('[wallpaper scene] 首帧就绪 ' + (data.ms || 0) + 'ms; id=' + stage.dataset.wallpaperId);
    } else if (data.op === 'error' || data.op === 'slow') {
      failScene(stage, stage.dataset.wallpaperId,
        data.op === 'slow' ? '渲染页没有在 20 秒内画出首帧' : String(data.message || '渲染页报错'));
    }
  }
  async function mountScene(container, id, generation) {
    container.dataset.wallpaperId = String(id);
    var status = document.createElement('div');
    status.className = 'wp-scene-status';
    status.textContent = '正在加载场景渲染…';
    container.appendChild(status);
    try {
      var plugins = window.vigil && window.vigil.plugins;
      if (!plugins || !plugins.resourceUrl) throw new Error('客户端缺少媒体桥，请升级客户端');
      if (!plugins.sceneLiveUrl) throw new Error('客户端没有场景渲染页，请升级客户端');
      var entry = await plugins.sceneLiveUrl();
      if (!entry || !entry.ok) throw new Error((entry && entry.err) || '场景渲染页地址获取失败');
      // project.json 换来的票据是目录票据：同一票据下渲染页还能继续取
      // scene.pkg 与纹理（客户端 plugin-media 的 directoryTicket 分支）。
      var ticket = await plugins.resourceUrl(mediaUrl(id, 'project.json'));
      if (!ticket || !ticket.ok) throw new Error((ticket && ticket.err) || '场景资源票据申请失败');
      var base = String(ticket.url || '').replace(/\/project\.json$/, '');
      if (base === ticket.url) throw new Error('票据没有返回可用的场景资源基址');
      if (generation !== applyGeneration || !container.isConnected) return;
      // 渲染页把数据源拼成 mediaBase + "/" + src，所以把完整地址拆成
      // 协议头与 "//host/path" 两半传进去，拼回来就是原地址。
      var parts = /^(https?:)(\/\/.+)$/.exec(base);
      if (!parts) throw new Error('场景资源基址格式异常');
      var cfg = currentConfig || {};
      var frame = document.createElement('iframe');
      frame.className = 'wp-scene-frame';
      frame.setAttribute('allow', 'autoplay');
      frame.setAttribute('title', '场景壁纸');
      frame.src = entry.url
        + '?type=scene'
        + '&fit=' + (cfg.sceneFit === 'contain' ? 'contain' : 'cover')
        + '&sceneFps=' + ([15, 30, 60].indexOf(cfg.sceneFps) >= 0 ? cfg.sceneFps : 30)
        + '&muted=' + (cfg.muted === false ? 'false' : 'true')
        + '&mediaBase=' + encodeURIComponent(parts[1])
        + '&src=' + encodeURIComponent(parts[2]);
      sceneFrameEl = frame;
      container.appendChild(frame);
      // 渲染页自己会在 20 秒报 slow；这里再兜一层，防止桥没接上就静默黑屏。
      sceneReadyTimer = setTimeout(function () {
        if (container.isConnected && container.dataset.liveReady !== 'true') {
          failScene(container, id, '渲染页没有在预期时间内就绪');
        }
      }, 24000);
    } catch (error) {
      if (generation !== applyGeneration || !container.isConnected) return;
      failScene(container, id, String((error && error.message) || error));
    }
  }
  function disposeWallpaper() {
    disposed = true;
    activeWallpaperKey = null;
    applyGeneration++;
    destroyScene();
    var video = bgLayer.querySelector('video');
    if (video) { try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_) {} }
    var frame = bgLayer.querySelector('iframe');
    if (frame) { try { frame.src = 'about:blank'; } catch (_) {} }
    if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
    bgLayer.replaceChildren();
    scrimLayer.replaceChildren();
    bgLayer.style.display = 'none';
    scrimLayer.style.display = 'none';
    document.body.classList.remove('wallpaper-active');
    document.documentElement.style.removeProperty('--wp-glass-blur');
    bgLayer.remove();
    scrimLayer.remove();
    if (themeChangeHandler && window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', themeChangeHandler);
      themeChangeHandler = null;
    }
    if (sceneMessageHandler) {
      window.removeEventListener('message', sceneMessageHandler);
      sceneMessageHandler = null;
    }
    if (window.vigil && window.vigil.plugins && window.vigil.plugins.releaseResources) {
      window.vigil.plugins.releaseResources().catch(function (error) {
        console.warn('[wallpaper] media ticket cleanup failed', error);
      });
    }
    if (window.__vigilWallpaperDispose === disposeWallpaper) delete window.__vigilWallpaperDispose;
  }

  // Visual appearance and playback have separate lifetimes.
  function applyAppearance(cfg) {
    var enabled = !!(cfg && cfg.enabled && cfg.wallpaper_id);
    bgLayer.style.display = enabled ? 'block' : 'none';
    scrimLayer.style.display = enabled ? 'block' : 'none';
    document.body.classList.toggle('wallpaper-active', enabled);
    if (!enabled) {
      document.documentElement.style.removeProperty('--wp-glass-blur');
      return;
    }
    bgLayer.style.opacity = cfg.opacity != null ? cfg.opacity : 0.7;
    var scrimColor = isDark() ? 'rgba(0,0,0,' : 'rgba(255,255,255,';
    scrimLayer.style.background = scrimColor + (cfg.scrim != null ? cfg.scrim : 0.4) + ')';
    document.documentElement.style.setProperty('--wp-glass-blur', (cfg.blur || 0) + 'px');
  }

  // ========== 应用壁纸到背景层 ==========
  function applyWallpaper(cfg) {
    var key = cfg && cfg.enabled && cfg.wallpaper_id
      ? JSON.stringify([String(cfg.wallpaper_id), String(cfg.wallpaper_type || ''), String(cfg.wallpaper_file || '')])
      : null;
    if (key && key === activeWallpaperKey && bgLayer.isConnected && bgLayer.childElementCount) {
      var playingVideo = bgLayer.querySelector('video');
      if (playingVideo) playingVideo.muted = cfg.muted !== false;
      applyAppearance(cfg);
      return;
    }
    activeWallpaperKey = key;
    var generation = ++applyGeneration;
    destroyScene();
    var oldVideo = bgLayer.querySelector('video');
    if (oldVideo) { try { oldVideo.pause(); oldVideo.removeAttribute('src'); oldVideo.load(); } catch (_) {} }
    var oldFrame = bgLayer.querySelector('iframe');
    if (oldFrame) { try { oldFrame.src = 'about:blank'; } catch (_) {} }
    bgLayer.replaceChildren();
    applyAppearance(cfg);
    if (!key) return;

    var id = cfg.wallpaper_id;
    // WE 的 project.json 里 type 有 Scene/Video 与 scene/video 两种写法，
    // 这里按小写比较，不然大写那批会掉进"不支持的类型"只画预览图。
    var type = String(cfg.wallpaper_type || '').toLowerCase();
    var file = cfg.wallpaper_file;

    if ((type === 'local-video' || type === 'local-image') && id) {
      var localId = String(id).replace(/^local:/, '');
      if (type === 'local-video') {
        var lv = document.createElement('video'); lv.autoplay = true; lv.loop = true; lv.muted = cfg.muted !== false; lv.playsInline = true;
        lv.style.cssText = 'width:100%;height:100%;object-fit:cover;'; bgLayer.appendChild(lv); setLocalResource(lv, localId, generation);
      } else {
        var li = document.createElement('img'); li.style.cssText = 'width:100%;height:100%;object-fit:cover;'; bgLayer.appendChild(li); setLocalResource(li, localId, generation);
      }
    } else if (type === 'video' && file) {
      // 视频壁纸：<video> 循环播放
      var v = document.createElement('video');
      v.autoplay = true;
      v.loop = true;
      v.muted = cfg.muted !== false;
      v.playsInline = true;
      v.style.cssText = 'width:100%;height:100%;object-fit:cover;object-position:center;';
      bgLayer.appendChild(v);
      setResource(v, mediaUrl(id, file), generation);
    } else if (type === 'web' && file) {
      // 网页壁纸：<iframe sandbox> 隔离
      var ifr = document.createElement('iframe');
      ifr.sandbox = 'allow-scripts';
      ifr.style.cssText = 'width:100%;height:100%;border:none;display:block;';
      bgLayer.appendChild(ifr);
      setResource(ifr, mediaUrl(id, file), generation);
    } else if (type === 'scene' && id) {
      var scene = document.createElement('div');
      scene.className = 'wp-scene-stage';
      bgLayer.appendChild(scene);
      mountScene(scene, id, generation);
    } else {
      // Unsupported types are explicitly preview-only and never claim live playback.
      var img = document.createElement('img');
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;object-position:center;';
      bgLayer.appendChild(img);
      setResource(img, previewUrl(id));
    }

    if (!visibilityHandler) {
      visibilityHandler = function () {
        if (!sceneFrameEl) return;
        var activeStage = bgLayer.querySelector('.wp-scene-stage');
        if (document.hidden) {
          tellScene('pause');
          if (activeStage) activeStage.dataset.paused = 'true';
        } else if (currentConfig && currentConfig.enabled) {
          tellScene('resume');
          if (activeStage) activeStage.dataset.paused = 'false';
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);
    }

  }

  // ========== 加载配置 & 壁纸库 ==========
  function loadConfig() {
    return apiGet('/api/plugin/wallpaper/config').then(function (r) {
      if (disposed) return;
      if (r && r.ok) {
        currentConfig = r.config;
        wePath = r.config.we_path;
        applyWallpaper(currentConfig);
      } else {
        console.error('[wallpaper] 配置读取失败:', (r && r.err) || '未知错误');
      }
    });
  }
  function loadLibrary(force) {
    return Promise.all([apiGet('/api/plugin/wallpaper/we/library' + (force ? '?refresh=1' : '')),
      window.vigil && window.vigil.wallpaperImports ? window.vigil.wallpaperImports.list() : Promise.resolve({ok:true,items:[]})]).then(function (values) {
      var r = values[0];
      customLibrary = values[1] && values[1].ok ? values[1].items || [] : [];
      if (r && r.ok) {
        libraryError = '';
        library = r.wallpapers || [];
        wePath = r.we_path;
      } else {
        libraryError = (r && r.err) || '读取壁纸库失败';
        console.error('[wallpaper] 壁纸库读取失败:', (r && r.err) || '未知错误');
      }
      return library;
    });
  }
  function saveConfig(partial) {
    if (!currentConfig) currentConfig = {};
    Object.assign(currentConfig, partial);
    apiPost('/api/plugin/wallpaper/config', partial).then(function (r) {
      if (r && r.ok) { currentConfig = r.config; applyWallpaper(currentConfig); }
      else console.error('[wallpaper] 配置保存失败:', (r && r.err) || '未知错误');
    });
  }

  // ========== 设置页渲染 ==========
  function renderSettings(ctx) {
    ctx.view.innerHTML = '<div class="wp-empty">正在读取壁纸配置和壁纸库…</div>';
    return ready.then(function () {
      if (ctx.view.isConnected) drawSettings(ctx);
    });
  }
  function drawSettings(ctx) {
    var cfg = currentConfig || {};
    var html = '<div class="wp-settings">';

    // 标题 + WE 路径
    html += '<div class="wp-header"><h2>壁纸 (Wallpaper Engine)</h2>'
      + '<span class="wp-path">' + esc(wePath ? 'WE: ' + wePath : '未检测到 Wallpaper Engine') + '</span></div>';

    // 启用开关
    html += '<div class="wp-row"><label>启用壁纸</label>'
      + '<input type="checkbox" id="wp-enabled" ' + (cfg.enabled ? 'checked' : '') + '></div>';

    // 壁纸库网格
    html += '<div class="wp-section"><div class="wp-section-title">壁纸库 (' + (library.length + customLibrary.length) + ')</div>'
      + '<div class="wp-library" id="wp-library">';
    if (library.length === 0) {
      html += '<div class="wp-empty">' + esc(libraryError || (wePath ? '壁纸库为空，订阅壁纸后重新扫描。' : '未找到 Wallpaper Engine 创意工坊目录。')) + '</div>';
    }
    html += '</div><div class="wp-row"><label>搜索</label><input id="wp-search" type="search" placeholder="按名称搜索"></div>'
      + '<div class="wp-row"><label>类型</label><select id="wp-filter"><option value="">全部类型</option><option value="video">视频</option><option value="web">网页</option><option value="scene">Scene</option><option value="local-image">导入图片</option><option value="local-video">导入视频</option></select></div>'
      + '<div class="wp-row"><button id="wp-import">导入图片/视频</button></div>'
      + '<div class="wp-row"><label>播放列表</label><button id="wp-prev">上一张</button><button id="wp-next">下一张</button></div>'
      + '<div class="wp-section-title">播放列表顺序（点击加入/移出）</div><ol id="wp-playlist"></ol></div>';

    // 当前选中
    if (cfg.wallpaper_id) {
      var cur = library.find(function (w) { return w.id === cfg.wallpaper_id; });
      html += '<div class="wp-current">当前: ' + esc(cur ? cur.title : cfg.wallpaper_id)
        + ' [' + esc(cfg.wallpaper_type || '?') + ']</div>';
    }

    // 调节滑块
    html += '<div class="wp-section"><div class="wp-section-title">效果调节</div>';
    html += '<div class="wp-row"><label>壁纸不透明度 <span id="wp-opacity-val">' + Math.round((cfg.opacity != null ? cfg.opacity : 0.7) * 100) + '%</span></label>'
      + '<input type="range" id="wp-opacity" min="0" max="100" value="' + Math.round((cfg.opacity != null ? cfg.opacity : 0.7) * 100) + '"></div>';
    html += '<div class="wp-row"><label>遮罩不透明度 <span id="wp-scrim-val">' + Math.round((cfg.scrim != null ? cfg.scrim : 0.4) * 100) + '%</span></label>'
      + '<input type="range" id="wp-scrim" min="0" max="95" value="' + Math.round((cfg.scrim != null ? cfg.scrim : 0.4) * 100) + '"></div>';
    html += '<div class="wp-row"><label>毛玻璃模糊 <span id="wp-blur-val">' + (cfg.blur || 0) + 'px</span></label>'
      + '<input type="range" id="wp-blur" min="0" max="40" value="' + (cfg.blur || 0) + '"></div>';
    html += '<div class="wp-row"><label>视频静音</label>'
      + '<input type="checkbox" id="wp-muted" ' + (cfg.muted !== false ? 'checked' : '') + '></div>';
    html += '</div>';

    // 关闭按钮
    html += '<div class="wp-actions"><button id="wp-close">关闭壁纸</button>';
    html += '<button id="wp-refresh">重新扫描库</button>';
    html += '</div>';

    html += '</div>';
    ctx.view.innerHTML = html;

    // 绑定事件
    function bind(id, ev, fn) { var el = document.getElementById(id); if (el) el.addEventListener(ev, fn); }

    bind('wp-enabled', 'change', function (e) { saveConfig({ enabled: e.target.checked }); });
    bind('wp-muted', 'change', function (e) { saveConfig({ muted: e.target.checked }); });
    bind('wp-close', 'click', function () { saveConfig({ enabled: false, wallpaper_id: null }); });
    bind('wp-refresh', 'click', function () { loadLibrary(true).then(function () { renderSettings(ctx); }); });
    bind('wp-search', 'input', filterCards);
    bind('wp-filter', 'change', filterCards);
    bind('wp-prev', 'click', function () { stepPlaylist(-1); });
    bind('wp-next', 'click', function () { stepPlaylist(1); });
    bind('wp-import', 'click', function () { window.vigil.wallpaperImports.add().then(function (r) { if (r && r.ok && r.item) { customLibrary.push(r.item); renderSettings(ctx); } else if (r && !r.canceled) alert(r && r.err || '导入失败'); }); });

    // 滑块实时预览
    function bindSlider(id, valId, key, scale) {
      var el = document.getElementById(id), valEl = document.getElementById(valId);
      if (!el) return;
      el.addEventListener('input', function () {
        var v = parseInt(el.value) / (scale || 1);
        valEl.textContent = el.value + (key === 'blur' ? 'px' : '%');
        currentConfig[key] = v;
        applyWallpaper(currentConfig);
      });
      el.addEventListener('change', function () {
        var v = parseInt(el.value) / (scale || 1);
        var o = {}; o[key] = v; saveConfig(o);
      });
    }
    bindSlider('wp-opacity', 'wp-opacity-val', 'opacity', 100);
    bindSlider('wp-scrim', 'wp-scrim-val', 'scrim', 100);
    bindSlider('wp-blur', 'wp-blur-val', 'blur', 1);

    function filterCards() {
      var q = (document.getElementById('wp-search').value || '').toLocaleLowerCase();
      var type = document.getElementById('wp-filter').value;
      libEl.querySelectorAll('.wp-card').forEach(function (card) {
        var w = library.concat(customLibrary.map(function(item){return {id:'local:'+item.id,title:item.name,type:item.kind==='video'?'local-video':'local-image'};})).find(function (item) { return String(item.id) === card.dataset.id; });
        card.hidden = !!((type && card.dataset.type !== type) || (q && !(w && String(w.title || '').toLocaleLowerCase().includes(q))));
      });
    }
    function playlist() { return Array.isArray(currentConfig.playlist) ? currentConfig.playlist.map(String) : []; }
    function stepPlaylist(direction) {
      var all = library.concat(customLibrary.map(function(item){return {id:'local:'+item.id,title:item.name,type:item.kind==='video'?'local-video':'local-image',file:item.name};}));
      var ids = playlist().filter(function (id) { return all.some(function (w) { return String(w.id) === id; }); });
      if (!ids.length) return;
      var index = ids.indexOf(String(currentConfig.wallpaper_id));
      index = (index + direction + ids.length) % ids.length;
      var w = all.find(function (item) { return String(item.id) === ids[index]; });
      if (w) saveConfig({ enabled: true, wallpaper_id: w.id, wallpaper_type: w.type, wallpaper_file: w.file || '' });
    }
    var listEl = document.getElementById('wp-playlist');
    playlist().forEach(function (id, index) {
      var w = library.concat(customLibrary.map(function(item){return {id:'local:'+item.id,title:item.name,type:item.kind==='video'?'local-video':'local-image',file:item.name};})).find(function (item) { return String(item.id) === id; });
      var li = document.createElement('li'); li.textContent = w ? w.title : id + '（已删除或不可访问）';
      [-1, 1].forEach(function (delta) { var b = document.createElement('button'); b.textContent = delta < 0 ? '↑' : '↓'; b.disabled = index + delta < 0 || index + delta >= playlist().length; b.onclick = function () { var p = playlist(), n = index + delta; var t = p[index]; p[index] = p[n]; p[n] = t; saveConfig({ playlist: p }); renderSettings(ctx); }; li.appendChild(b); });
      var remove = document.createElement('button'); remove.textContent = '移出'; remove.onclick = function () { var p = playlist().filter(function (entry) { return entry !== id; }); saveConfig({ playlist: p }); renderSettings(ctx); }; li.appendChild(remove);
      listEl.appendChild(li);
    });

    // 渲染壁纸库网格
    var libEl = document.getElementById('wp-library');
    if (libEl && library.length > 0) {
      var grid = '';
      library.forEach(function (w) {
        var active = cfg.wallpaper_id === w.id ? ' active' : '';
        var typeLabel = { video: '视频', web: '网页', scene: '场景' }[w.type] || w.type;
        grid += '<div class="wp-card' + active + '" data-id="' + esc(w.id) + '" data-type="' + esc(w.type) + '" data-file="' + esc(w.file || '') + '">'
          + '<div class="wp-thumb"><img data-resource="' + esc(previewUrl(w.id)) + '" loading="lazy" alt=""></div>'
          + '<div class="wp-info"><div class="wp-title">' + esc(w.title) + '</div>'
          + '<div class="wp-type">' + esc(typeLabel) + '</div></div></div>';
      });
      libEl.innerHTML = grid;
      libEl.querySelectorAll('img[data-resource]').forEach(function (img) {
        setResource(img, img.dataset.resource);
      });

      // 点击选择
      var cards = libEl.querySelectorAll('.wp-card');
      for (var i = 0; i < cards.length; i++) {
        cards[i].addEventListener('click', function (e) {
          var card = e.currentTarget;
          var id = card.getAttribute('data-id');
          var type = card.getAttribute('data-type');
          var file = card.getAttribute('data-file');
          // 更新 active 状态
          for (var j = 0; j < cards.length; j++) cards[j].classList.remove('active');
          card.classList.add('active');
          var nextPlaylist = playlist();
          if (!nextPlaylist.includes(String(id))) nextPlaylist.push(String(id));
          saveConfig({ enabled: true, wallpaper_id: id, wallpaper_type: type, wallpaper_file: file, playlist: nextPlaylist });
          renderSettings(ctx);
        });
      }
    }
    if (libEl && customLibrary.length) {
      customLibrary.forEach(function (item) {
        var id='local:'+item.id, type=item.kind==='video'?'local-video':'local-image';
        var card=document.createElement('div'); card.className='wp-card'; card.dataset.id=id; card.dataset.type=type; card.dataset.file=item.name;
        card.innerHTML='<div class="wp-thumb"></div><div class="wp-info"><div class="wp-title"></div><div class="wp-type"></div><button class="wp-delete">删除导入素材</button></div>';
        card.querySelector('.wp-title').textContent=item.name; card.querySelector('.wp-type').textContent=(item.kind==='video'?'视频':'图片')+' · '+Math.ceil(item.size/1024)+' KB';
        libEl.appendChild(card);
        if(type==='local-image'){var thumb=document.createElement('img'); thumb.loading='lazy'; card.querySelector('.wp-thumb').appendChild(thumb); setLocalResource(thumb,item.id);}
        card.querySelector('.wp-delete').addEventListener('click',function(e){e.stopPropagation(); if(!confirm('删除此导入素材？'))return; window.vigil.wallpaperImports.delete(item.id).then(function(r){if(r&&r.ok){customLibrary=customLibrary.filter(function(x){return x.id!==item.id;}); var update={playlist:playlist().filter(function(id){return id!=='local:'+item.id;})}; if(String(currentConfig.wallpaper_id)==='local:'+item.id)Object.assign(update,{enabled:false,wallpaper_id:null,wallpaper_type:null,wallpaper_file:null}); saveConfig(update); renderSettings(ctx);}else alert(r&&r.err||'删除失败');});});
        card.addEventListener('click',function(e){if(e.target.closest('.wp-delete'))return; var p=playlist(); if(!p.includes(id))p.push(id); saveConfig({enabled:true,wallpaper_id:id,wallpaper_type:type,wallpaper_file:item.name,playlist:p}); renderSettings(ctx);});
      });
    }
  }

  // ========== 注册页面 ==========
  function registerPage() {
    if (window.VigilPlugin && typeof window.VigilPlugin.registerPage === 'function') {
      // after: 导航栏按钮多，push 到末尾会被滚动区吞掉；插在插件市场后面保证看得见
      window.VigilPlugin.registerPage({ id: 'wallpaper', name: '壁纸', icon: 'i-img', render: renderSettings, after: 'market' });
      window.VigilPlugin.registerCleanup('wallpaper', disposeWallpaper);
    }
  }

  // ========== 启动 ==========
  function init() {
    disposed = false;
    window.__vigilWallpaperDispose = disposeWallpaper;
    // 渲染页跨源回报首帧/错误，整页只挂一次监听。
    if (!sceneMessageHandler) {
      sceneMessageHandler = onSceneMessage;
      window.addEventListener('message', sceneMessageHandler);
    }
    ready = Promise.all([loadConfig(), loadLibrary()]);
    registerPage();
    if (window.matchMedia) {
      themeChangeHandler = function () {
        if (currentConfig) applyWallpaper(currentConfig);
      };
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChangeHandler);
    }
    console.log('[wallpaper v3] Wallpaper Engine 接入已加载');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
