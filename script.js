/* ===== PWA: تسجيل service worker (شبكة-أولاً) ===== */
/* الكاش شبكة-أولاً فلا تظهر نسخة قديمة، والتسجيل ضروري لتثبيت التطبيق على أندرويد */
if('serviceWorker'in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){});});}

/* ===== Auth & Login ===== */
    // ── شاشة "جارٍ التحقق" تمنع ظهور أي واجهة قبل اكتمال التحقق ──
    var _verifyFallbackTimer = null;
    // لا صفحة دخول — شاشة الدخول مخفية دائماً والتطبيق يفتح مباشرةً
    function showVerifying() { var ov = document.getElementById('loginOverlay'); if (ov) ov.style.display = 'none'; }
    function showLoginForm(msg) { var ov = document.getElementById('loginOverlay'); if (ov) ov.style.display = 'none'; }
    showLoginForm();

    // ── تسجيل الدخول عبر Firebase Auth + التحقق من الدور ──
    function doLocalLogin() {
      var email = document.getElementById('loginUser').value.trim();
      var pass  = document.getElementById('loginPassword').value.trim();
      var err   = document.getElementById('loginError');
      var btn   = document.getElementById('loginBtn');

      if (!email || !pass) {
        err.style.display = 'block';
        err.textContent = 'الرجاء إدخال البريد الإلكتروني وكلمة المرور';
        return;
      }
      err.style.display = 'none';
      btn.disabled = true; btn.textContent = 'جارٍ التحقق...';
      showVerifying();

      function tryLogin() {
        window._fb.signIn(email, pass)
          .then(function(cred) {
            return _ensureRole(cred.user).then(function(role) {
              if (role !== 'doctor') {
                return window._fb.signOut().then(function() {
                  btn.disabled = false; btn.textContent = 'تسجيل الدخول';
                  showLoginForm('هذا الحساب غير مصرح له بالدخول هنا');
                });
              }
              btn.disabled = false; btn.textContent = 'تسجيل الدخول';
              // النجاح: onAuth سيكشف اللوحة بعد تأكيد الدور
            });
          })
          .catch(function(e) {
            btn.disabled = false; btn.textContent = 'تسجيل الدخول';
            var c = (e && e.code) || (e && e.message) || 'unknown';
            console.error('[Login]', c, e);
            showLoginForm('رمز الخطأ: ' + c);   // وضع تشخيص — يعرض السبب الدقيق
          });
      }
      if (window._fbReady) tryLogin();
      else window.addEventListener('fbReady', tryLogin, { once: true });
    }

    document.getElementById('loginPassword').addEventListener('keydown', function(e){ if(e.key==='Enter') doLocalLogin(); });
    document.getElementById('loginUser').addEventListener('keydown', function(e){ if(e.key==='Enter') doLocalLogin(); });

    // مراقبة حالة تسجيل الدخول

    var _dataLoaded = false;

    // يقرأ دور المستخدم، وإن لم يوجد مستند الدور يُنشئه تلقائياً للحساب المخوّل لهذا التطبيق (الطبيب)
    function _ensureRole(user) {
      // الدور يُحدَّد من البريد عبر config.js مباشرةً — بلا أي قراءة من Firestore (يلغي خطأ الصلاحيات وسباق التوكن ويمنع تسجيل الخروج عند Refresh، ولا يستهلك حصّة القراءات). الأمان الحقيقي محفوظ بقواعد الخادم في firestore.rules.
      var role = (window.DOCBOOK_ROLE_OF ? window.DOCBOOK_ROLE_OF(user && user.email) : null);
      return Promise.resolve(role);
    }

    function initAuthWatch() {
      var ov = document.getElementById('loginOverlay');

      function revealApp() {
        clearTimeout(_verifyFallbackTimer);
        ov.style.transition = 'opacity .3s';
        ov.style.opacity = '0';
        setTimeout(function(){ ov.style.display = 'none'; }, 300);
      }

      window._fb.onAuth(function(user) {
        if (!user) { location.replace('index.html'); return; }   // لا جلسة → صفحة الدخول
        var role = (window.DOCBOOK_ROLE_OF ? window.DOCBOOK_ROLE_OF(user.email) : null);
        if (role !== 'doctor') { location.replace('index.html'); return; }   // ليس طبيباً → صفحة الدخول تتولّى التوجيه
        // طبيب مصرّح → افتح اللوحة وحمّل البيانات
        if (_dataLoaded) { revealApp(); return; }
        _dataLoaded = true;
        revealApp();
        if (typeof loadData === 'function') loadData();
      });
    }
    if (window._fbReady) initAuthWatch();
    else window.addEventListener('fbReady', initAuthWatch, { once: true });

/* ===== Main App ===== */
    // ==================== التخزين والمتغيرات ====================
    // مفاتيح مشتركة مع ملف الممرضة
    const STORAGE_KEY          = 'doctorAppointments';
    const PATIENTS_STORAGE_KEY = 'doctorPatients';
    const CLOSED_DAYS_KEY      = 'closedDays';
    const NOTES_KEY            = 'sharedNotes';

    // ── Confirm Bottom-Sheet (global) ──
    var _confirmResolve = null;
    window.appConfirm = function(msg, dangerLabel) {
      return new Promise(function(resolve) {
        _confirmResolve = resolve;
        var sheet = document.getElementById('confirmSheet');
        var msgEl = document.getElementById('confirmSheetMsg');
        var okEl  = document.getElementById('confirmSheetOk');
        if (!sheet || !msgEl || !okEl) { resolve(window.confirm(msg)); return; }
        msgEl.textContent = msg;
        okEl.textContent  = dangerLabel || 'تأكيد';
        sheet.classList.add('show');
      });
    };
    window._confirmSheetOk = function() {
      var sheet = document.getElementById('confirmSheet');
      if (sheet) sheet.classList.remove('show');
      if (_confirmResolve) { _confirmResolve(true);  _confirmResolve = null; }
    };
    window._confirmSheetCancel = function() {
      var sheet = document.getElementById('confirmSheet');
      if (sheet) sheet.classList.remove('show');
      if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
    };

    // ── lsGet/lsSet للقيم المحلية UI فقط (FAB position) ──
    function lsGet(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch(e) { return fallback; }
    }
    function lsSet(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {}
    }
    function notifyOtherTab(key) {
      // لم تعد ضرورية — onSnapshot يُزامن تلقائياً
    }

    const daysAr = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const monthsAr = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = toLocalISODate(today);
    const maxFutureDate = new Date(); maxFutureDate.setMonth(maxFutureDate.getMonth() + 3); maxFutureDate.setHours(23,59,59,999);
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30); thirtyDaysAgo.setHours(0,0,0,0);
    const thirtyDaysAgoStr = toLocalISODate(thirtyDaysAgo);

    let allRecords = [];
    let allPatients = {};
    let closedDays  = [];
    let currentDate = new Date();
    let selectedDayStr = todayStr;
    let currentSection = 'home';
    window._dayChartAnimate = true; // أول رسم لمخطط توزيع الأيام يكون متحرّكاً (تصاعدي)
    let currentPatientIdForVisit = null;
    let currentChartPeriod = 'monthly';

    // ==================== دوال مساعدة ====================
    function toLocalISODate(date) { const y=date.getFullYear(); const m=String(date.getMonth()+1).padStart(2,'0'); const d=String(date.getDate()).padStart(2,'0'); return `${y}-${m}-${d}`; }
    function parseLocalISODate(s) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
    function formatDateAr(s) { if(!s) return '-'; const d=parseLocalISODate(s); return d.toLocaleDateString('ar-EG',{year:'numeric',month:'long',day:'numeric'}); }

    // تنسيق "آخر تعديل" — يعرض "اليوم 3:25م" / "أمس 9:10ص" / "قبل 3 أيام" / تاريخ كامل
    function formatRelativeTime(ts) {
      if (!ts) return '';
      const now = new Date();
      const d   = new Date(ts);
      const diffMs   = now - d;
      const diffMin  = Math.floor(diffMs / 60000);
      const diffHr   = Math.floor(diffMs / 3600000);
      const today0   = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const dDay0    = new Date(d.getFullYear(),   d.getMonth(),   d.getDate()).getTime();
      const dayDiff  = Math.round((today0 - dDay0) / 86400000);

      // الوقت بصيغة 3:25م
      const time = d.toLocaleTimeString('ar-EG', { hour:'numeric', minute:'2-digit', hour12:true });

      if (diffMin < 1)   return 'الآن';
      if (diffMin < 60)  return `قبل ${diffMin} دقيقة`;
      if (dayDiff === 0) return `اليوم ${time}`;
      if (dayDiff === 1) return `أمس ${time}`;
      if (dayDiff < 7)   return `قبل ${dayDiff} أيام`;
      return d.toLocaleDateString('ar-EG', { year:'numeric', month:'short', day:'numeric' }) + ` ${time}`;
    }
    function calculateAge(b) { if(!b) return null; const birth=new Date(b); let age=today.getFullYear()-birth.getFullYear(); const m=today.getMonth()-birth.getMonth(); if(m<0 || (m===0 && today.getDate()<birth.getDate())) age--; return age; }
    function showToast(msg, type='info') { const toast=document.getElementById('toast'); const content=document.getElementById('toastContent'); content.innerHTML = `<i class="fas fa-${type==='success'?'check-circle':'info-circle'}"></i> ${msg}`; toast.classList.remove('hidden'); setTimeout(()=>toast.classList.add('hidden'),3000); }
    function normalizeDate(d) { if (!d) return ''; if (d && d.toDate) d = d.toDate(); if (d instanceof Date) return toLocalISODate(d); return String(d).slice(0,10); }
    function isDayClosed(dateStr) { return Array.isArray(closedDays) && closedDays.indexOf(dateStr) !== -1; }

    // ── Web Audio API — AudioContext مشترك مع keepalive ──
    var _docAudioCtx = null;
    function _getDocCtx() {
      if (!_docAudioCtx || _docAudioCtx.state === 'closed') {
        try { _docAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { return null; }
      }
      return _docAudioCtx;
    }
    function _primeDocAudio() {
      var ctx = _getDocCtx();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      document.removeEventListener('click',      _primeDocAudio);
      document.removeEventListener('touchstart', _primeDocAudio);
      document.removeEventListener('keydown',    _primeDocAudio);
    }
    document.addEventListener('click',      _primeDocAudio);
    document.addEventListener('touchstart', _primeDocAudio);
    document.addEventListener('keydown',    _primeDocAudio);
    // keepalive: نبضة صامتة كل 30 ثانية
    setInterval(function() {
      var ctx = _getDocCtx();
      if (ctx && ctx.state === 'running') {
        try { var o=ctx.createOscillator(),g=ctx.createGain(); g.gain.value=0; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime+0.001); } catch(e) {}
      }
    }, 30000);

    function playDocNotifSound() {
      var ctx = _getDocCtx(); if (!ctx) return;
      function _play() {
        try {
          var now = ctx.currentTime;
          [0, 0.18, 0.36].forEach(function(t) {
            var o=ctx.createOscillator(), g=ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.type='sine'; o.frequency.value=880;
            g.gain.setValueAtTime(0.35, now+t);
            g.gain.exponentialRampToValueAtTime(0.001, now+t+0.22);
            o.start(now+t); o.stop(now+t+0.22);
          });
        } catch(e) {}
      }
      if (ctx.state === 'suspended') ctx.resume().then(_play); else _play();
    }

    // ── نظام إشعارات متعددة متراكمة للطبيب ──
    var _docNotifContainer = null;
    function _getDocNotifContainer() {
      if (!_docNotifContainer) {
        _docNotifContainer = document.createElement('div');
        _docNotifContainer.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9998;display:flex;flex-direction:column-reverse;gap:10px;';
        document.body.appendChild(_docNotifContainer);
      }
      return _docNotifContainer;
    }

    function showDocNotifToast(msg) {
      // ── مُعطّل: أُوقف نظام تنبيهات الممرضة → الطبيب بناءً على الطلب ──
      return;
      /* eslint-disable no-unreachable */
      var el = document.createElement('div');
      el.style.cssText = 'background:var(--primary);color:white;font-weight:800;font-size:.92rem;padding:13px 22px;border-radius:12px;box-shadow:0 4px 20px rgba(13,148,136,.35);opacity:0;transform:translateX(20px);transition:opacity .25s,transform .25s;white-space:nowrap;max-width:280px;cursor:pointer;';
      el.textContent = msg;
      _getDocNotifContainer().appendChild(el);
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          el.style.opacity = '1'; el.style.transform = 'translateX(0)';
        });
      });
      var dismiss = function() {
        clearTimeout(el._t);
        el.style.opacity = '0'; el.style.transform = 'translateX(20px)';
        setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 280);
      };
      el.onclick = dismiss;
      el._t = setTimeout(dismiss, 8000);
      playDocNotifSound();
    }
    var _docAudioCtx = null;
    function getDocAudioCtx() {
      if (!_docAudioCtx || _docAudioCtx.state === 'closed') {
        try { _docAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { return null; }
      }
      return _docAudioCtx;
    }
    function primeDocAudio() {
      var ctx = getDocAudioCtx();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      document.removeEventListener('click',      primeDocAudio);
      document.removeEventListener('touchstart', primeDocAudio);
      document.removeEventListener('keydown',    primeDocAudio);
    }
    document.addEventListener('click',      primeDocAudio);
    document.addEventListener('touchstart', primeDocAudio);
    document.addEventListener('keydown',    primeDocAudio);
    // keepalive: نبضة صامتة كل 30 ثانية
    setInterval(function() {
      var ctx = getDocAudioCtx();
      if (ctx && ctx.state === 'running') {
        try {
          var o = ctx.createOscillator(), g = ctx.createGain();
          g.gain.value = 0;
          o.connect(g); g.connect(ctx.destination);
          o.start(); o.stop(ctx.currentTime + 0.001);
        } catch(e) {}
      }
    }, 30000);

    function playDocNotifSound() {
      var ctx = getDocAudioCtx(); if (!ctx) return;
      function _doPlay() {
        try {
          var now = ctx.currentTime;
          [0, 0.18, 0.36].forEach(function(t) {
            var o = ctx.createOscillator(), g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.type = 'sine'; o.frequency.value = 880;
            g.gain.setValueAtTime(0.35, now + t);
            g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.22);
            o.start(now + t); o.stop(now + t + 0.22);
          });
        } catch(e) {}
      }
      if (ctx.state === 'suspended') ctx.resume().then(_doPlay); else _doPlay();
    }

    function normalizePhone(p) { return (p||'').replace(/[^\d+]/g,''); }
    function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }

    // ==================== تحميل البيانات ====================
    // ── ترحيل localStorage القديم إلى Firestore ──
    function migrateLocalStorageToFirestore() {
      // مسح البيانات القديمة من localStorage — Firestore هو المصدر الوحيد
      try {
        localStorage.removeItem('doctorAppointments');
        localStorage.removeItem('doctorPatients');
        localStorage.removeItem('closedDays');
        localStorage.removeItem('doctorSettings');
        localStorage.removeItem('nurseSettings');
        localStorage.removeItem('sharedNotes');
      } catch(e) {}
    }

    // ── مستمعو Firestore ──
    var _unsubAppt = null, _unsubPat = null, _unsubClosed = null, _unsubAlerts = null, _unsubNowServing = null;
    var _alertSeenAt = 0;
    var _shownAlertIds = new Set(); // منع التكرار بدلاً من _lastAcceptedAlertId

    // ── فحص التنبيهات الفائتة عند فتح اللوحة ──
    // ── فحص الطلبات الجديدة الفائتة عند فتح لوحة الممرضة ──
    function checkMissedNewRequests() {
      var SEEN_KEY = 'docbook_nur_apptSeen';
      var lastSeen = parseInt(localStorage.getItem(SEEN_KEY) || '0', 10);
      var nowTs = Date.now();
      localStorage.setItem(SEEN_KEY, String(nowTs));
      if (lastSeen === 0) return;
      var pending = allRecords.filter(function(r) {
        if (r.Status !== 'Pending') return false;
        var ts = r.createdAt && r.createdAt.toMillis ? r.createdAt.toMillis()
               : r.createdAt ? new Date(r.createdAt).getTime() : 0;
        return ts > lastSeen && ts <= nowTs;
      });
      if (pending.length === 0) return;
      var msg = pending.length === 1
        ? 'طلب جديد: ' + (pending[0].PatientName || 'مريض')
        : pending.length + ' طلبات جديدة';
      if (typeof showNotifToast === 'function') showNotifToast(msg);
    }

    // ── فحص الإجراءات الفائتة عند فتح لوحة الطبيب ──
    function checkMissedAlerts() {
      var SEEN_KEY = 'docbook_doc_alertSeen';
      var lastSeen = parseInt(localStorage.getItem(SEEN_KEY) || '0', 10);
      var nowTs = Date.now();
      localStorage.setItem(SEEN_KEY, String(nowTs));
      if (lastSeen === 0) return; // أول مرة — لا إشعار
      // جلب مرة واحدة ثم إلغاء الاستماع
      var unsub = window._fb.onSnapshot(window._fb.query(window._fb.col('alerts'), window._fb.orderBy('createdAt','desc'), window._fb.limit(50)), function(snap) {
        if (unsub) { unsub(); unsub = null; }
        var missed = snap.docs
          .map(function(d) { return Object.assign({ id: d.id }, d.data()); })
          .filter(function(a) {
            var ts = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis()
                   : a.createdAt ? new Date(a.createdAt).getTime() : 0;
            // فقط nurseToDoctor — مستثنى استدعاء الممرضة وأدخل المريض
            return a.direction === 'nurseToDoctor' && ts > lastSeen && ts <= nowTs;
          });
        if (missed.length === 0) return;
        var msg = missed.length === 1
          ? (missed[missed.length-1].message || 'تم قبول موعد')
          : missed.length + ' إجراءات فائتة';
        if (typeof showDocNotifToast === 'function') showDocNotifToast(msg);
      }, function() {});
    }

    function loadData() {
      migrateLocalStorageToFirestore();
      _alertSeenAt = Date.now();

      // ── تنظيف تلقائي للتنبيهات القديمة (بديل TTL يعمل على الخطة المجانية، بلا فوترة) ──
      // مرّة كل ٢٤ ساعة فقط: يحذف التنبيهات التي تجاوزت expireAt (أقدم من ٣٠ يوماً).
      (function pruneOldAlerts() {
        try {
          var KEY = 'alertsPrunedAt';
          if (Date.now() - (+localStorage.getItem(KEY) || 0) < 24*60*60*1000) return;
          localStorage.setItem(KEY, String(Date.now()));
          window._fb.getDocs(window._fb.query(
            window._fb.col('alerts'),
            window._fb.where('expireAt', '<', new Date()),
            window._fb.limit(200)
          )).then(function(snap) {
            if (!snap || snap.empty) return;
            var batch = window._fb.batch();
            snap.docs.forEach(function(d) { batch.delete(d.ref); });
            return batch.commit();
          }).catch(function() {});
        } catch (e) {}
      })();

      // المواعيد
      if (_unsubAppt) _unsubAppt();
      var _nurseApptFirstLoad = true;
      // [أقصى توفير] المواعيد: آخر 30 يوماً وما بعدها فقط
      var _apptWinStart = (function(){ var d=new Date(); d.setDate(d.getDate()-30); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();
      _unsubAppt = window._fb.onSnapshot(window._fb.query(window._fb.col('appointments'), window._fb.where('Date','>=',_apptWinStart)),
        function(snap) {
          allRecords = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
          window._allRecords = allRecords;

          // ====== تحويل المواعيد المؤكدة الماضية تلقائياً إلى "لم يحضر" ======
          (function autoMarkNoShow() {
            var todayStr = new Date().toISOString().slice(0, 10);
            var toMark = allRecords.filter(function(r) {
              return r.Status === 'Accepted' && r.Date && r.Date < todayStr;
            });
            if (!toMark.length) return;
            try {
              var batch = window._fb.batch();
              toMark.forEach(function(r) {
                batch.update(window._fb.docRef('appointments', r.id), { Status: 'NoShow' });
              });
              batch.commit().catch(function(e) { console.error('[autoNoShow]', e); });
            } catch(e) {
              // fallback واحد واحد
              toMark.forEach(function(r) {
                window._fb.updateDoc(window._fb.docRef('appointments', r.id), { Status: 'NoShow' })
                  .catch(function(err) { console.error('[autoNoShow]', err); });
              });
            }
          })();
          // ================================================================

          renderCalendar();
          if (selectedDayStr) renderAgendaForDay(selectedDayStr);
          if (typeof renderScheduleGrid === 'function') renderScheduleGrid();
          if (currentSection === 'stats') calculateStatsFromPatients();
          updateHomeSummaryStats();
          renderHomeWidgets();
          renderHomeCalendar();
          // فحص الطلبات الفائتة عند أول تحميل فقط
          if (_nurseApptFirstLoad) {
            _nurseApptFirstLoad = false;
            setTimeout(checkMissedNewRequests, 1000);
          }
        },
        function(e) { console.error('[appointments]', e); }
      );

      // المرضى — [أقصى توفير] لحظي لأول 40 بالاسم (يقرأ 40 مرّة واحدة ثم التغييرات فقط)، والبحث يجلب من الخادم
      if (_unsubPat) _unsubPat();
      _unsubPat = window._fb.onSnapshot(window._fb.query(window._fb.col('patients'), window._fb.orderBy('name'), window._fb.limit(40)),
        function(snap) {
          allPatients = {};
          snap.forEach(function(d) { allPatients[d.id] = Object.assign({ id: d.id }, d.data()); });
          document.getElementById('totalPatientsCount').textContent = Object.keys(allPatients).length + '+';
          if (currentSection === 'patients') renderPatientBook();
        },
        function(e) { console.error('[patients]', e); });

      // الأيام المغلقة
      if (_unsubClosed) _unsubClosed();
      _unsubClosed = window._fb.onSnapshot(window._fb.docRef('config', 'closedDays'),
        function(snap) {
          closedDays = snap.exists() ? (snap.data().list || []) : [];
          renderCalendar();
          if (selectedDayStr) renderAgendaForDay(selectedDayStr);
          if (typeof renderScheduleGrid === 'function') renderScheduleGrid();
        }
      );

      // ── تنبيهات الممرضة → الطبيب: مُعطّلة بناءً على الطلب ──
      // أُوقف نظام التنبيهات القادمة من الممرضة (تنبيهات المواعيد / إضافة موعد).
      // لم يَعُد يُنشأ مُستمع alerts ولا قناة البثّ — توفيراً للـ reads وإيقافاً للإشعارات.
      if (_unsubAlerts) { _unsubAlerts(); _unsubAlerts = null; }

      // ── الممرّضة → الطبيب: إشعار «المريض التالي جاهز» (مستمع وثيقة واحدة، رخيص) ──
      // عند تسجيل الممرّضة زيارةً تكتب config/nowServing؛ يظهر عند الطبيب إشعار دائم حتى يفتح أو يُخفي.
      if (_unsubNowServing) _unsubNowServing();
      var _nsInit = true, _nsLastTs = 0;
      _unsubNowServing = window._fb.onSnapshot(window._fb.docRef('config', 'nowServing'), function(snap) {
        // تجاهل أوّل لقطة فقط (القيمة الموجودة وقت الإقلاع، أو عدم وجود الوثيقة) — لا نبتلع إشارة الممرّضة
        if (_nsInit) { _nsInit = false; if (snap.exists()) _nsLastTs = (snap.data() || {}).ts || 0; return; }
        if (!snap.exists()) return;
        var d = snap.data() || {}, ts = d.ts || 0;
        console.log('[nowServing] وصلت إشارة:', d);
        if (ts === _nsLastTs || !d.patientId) return;   // نفس الإشارة (إعادة اتصال) → تجاهل
        _nsLastTs = ts;
        showNextPatientNotif(d.patientId, d.name);
      }, function(e){ console.error('[nowServing] خطأ في المستمع (قد تكون قاعدة الأمان تمنع قراءة config):', e); });

      // الإعدادات (يدمج مع المحفوظ محلياً ويحدّثه)
      window._fb.getDoc('settings', 'doctor').then(function(snap) {
        if (snap.exists()) {
          settings = Object.assign({}, settings, snap.data());
          try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
          applySettings();
        }
        // حساب جديد بلا تخصّص ولا علامة onboarded ⇒ تُعرض شاشة الإعداد مرّة واحدة
        if (typeof maybeStartOnboarding === 'function') maybeStartOnboarding();
      }).catch(function(){});

      // التنبيه المخصص
      window._fb.getDoc('config', 'customAlert').then(function(snap) {
        if (snap.exists()) {
          customAlertData = snap.data();
          if (typeof updateCustomLabels === 'function') updateCustomLabels(customAlertData.label);
        }
      }).catch(function(){});
    }

    // ==================== دوال الإحصائيات ====================
    function calculateStatsFromPatients() {
      let totalVisits = 0;
      let activeCount = 0;
      let morningCount = 0;
      let eveningCount = 0;
      let repeatPatients = 0;
      const totalPatients = Object.keys(allPatients).length;
      let allVisits = [];

      Object.values(allPatients).forEach(patient => {
        totalVisits += patient.totalVisits || 0;
        if (patient.totalVisits > 1) repeatPatients++;
        if (patient.lastVisit && patient.lastVisit >= thirtyDaysAgoStr) activeCount++;
        if (patient.appointments) {
          patient.appointments.forEach(v => {
            if (v.slot === 'Morning') morningCount++;
            else if (v.slot === 'Evening') eveningCount++;
            allVisits.push({ patientId: patient.id, patientName: patient.name, date: v.date, visitType: v.visitType });
          });
        }
      });

      allVisits.sort((a,b) => (b.date||'').localeCompare(a.date||''));
      const recentVisits = allVisits.slice(0, 30);
      const repeatRate = totalPatients ? ((repeatPatients / totalPatients) * 100).toFixed(1) : 0;

      // إحصائيات جديدة
      const accepted = allRecords.filter(r => r.Status === 'Accepted');
      const noShow   = allRecords.filter(r => r.Status === 'NoShow').length;

      // زيارات هذا الشهر
      const nowM = new Date();
      const thisMonthPrefix = `${nowM.getFullYear()}-${String(nowM.getMonth()+1).padStart(2,'0')}`;
      const thisMonth = accepted.filter(r => r.Date && r.Date.startsWith(thisMonthPrefix)).length;

      // متوسط الزيارات اليومي (على أيام العمل التي بها مواعيد)
      const dayMap = {};
      accepted.forEach(r => { if (r.Date) { const d = r.Date.substring(0,10); dayMap[d] = (dayMap[d]||0)+1; } });
      const activeDays = Object.keys(dayMap).length;
      const avgDaily = activeDays ? (accepted.length / activeDays).toFixed(1) : '0';

      // توزيع الأيام (الأسبوع الحالي فقط)
      const weekdayCounts = Array(7).fill(0);
      const _sToday = new Date();
      const _sStart = new Date(_sToday);
      _sStart.setDate(_sToday.getDate() - _sToday.getDay());
      _sStart.setHours(0,0,0,0);
      const _sEnd = new Date(_sStart);
      _sEnd.setDate(_sStart.getDate() + 6);
      const _sStartStr = toLocalISODate(_sStart);
      const _sEndStr   = toLocalISODate(_sEnd);
      allRecords.forEach(r => {
        if (!r.Date || r.Status === 'Pending') return;
        const dateStr = normalizeDate(r.Date);
        if (!dateStr || dateStr < _sStartStr || dateStr > _sEndStr) return;
        const parts = dateStr.split('-').map(Number);
        const d = new Date(parts[0], parts[1]-1, parts[2]);
        weekdayCounts[d.getDay()]++;
      });
      const busyIdx = weekdayCounts.indexOf(Math.max(...weekdayCounts));
      const busyDay = Math.max(...weekdayCounts) > 0 ? daysAr[busyIdx] : '—';

      return { totalVisits, activeCount, repeatRate, morningCount, eveningCount, recentVisits, noShow, thisMonth, avgDaily, busyDay, weekdayCounts };
    }

    function calculateCancelledAppointments() {
      return allRecords.filter(r => r.Status === 'Cancelled' || r.Status === 'Rejected').length;
    }

    function renderWeekdayBars(weekdayCounts) {
      const wrap   = document.getElementById('weekdayBarsWrap');
      const labels = document.getElementById('weekdayBarsLabels');
      if (!wrap || !labels) return;

      const dayNames = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
      const max    = Math.max(...weekdayCounts, 1);
      const maxIdx = weekdayCounts.indexOf(Math.max(...weekdayCounts));

      const W = 700, H = 150;
      const padY = 28, padXl = 52, padXr = 52;
      const chartW = W - padXl - padXr;
      const chartH = H - padY - 24;
      const base   = padY + chartH;

      const pts = weekdayCounts.map((v, i) => ({
        x: padXl + (i / 6) * chartW,
        y: padY + chartH - (v / max) * chartH,
        v
      }));

      // ── Smooth Cubic Bezier ──
      function smoothPath(p) {
        if (p.length < 2) return '';
        let d = 'M' + p[0].x.toFixed(1) + ',' + p[0].y.toFixed(1);
        for (let i = 0; i < p.length - 1; i++) {
          const cp = (p[i + 1].x - p[i].x) * 0.42;
          d += ' C' + (p[i].x + cp).toFixed(1) + ',' + p[i].y.toFixed(1) +
               ' ' + (p[i + 1].x - cp).toFixed(1) + ',' + p[i + 1].y.toFixed(1) +
               ' ' + p[i + 1].x.toFixed(1) + ',' + p[i + 1].y.toFixed(1);
        }
        return d;
      }

      const linePath = smoothPath(pts);
      const areaPath = linePath +
        ' L' + pts[6].x.toFixed(1) + ',' + base +
        ' L' + pts[0].x.toFixed(1) + ',' + base + ' Z';

      // خطوط شبكة أفقية
      const gridLines = [0, 0.5, 1].map(r => {
        const y = (padY + chartH - r * chartH).toFixed(1);
        const v = Math.round(r * max);
        return '<line x1="' + padXl + '" y1="' + y + '" x2="' + (W - padXr) + '" y2="' + y +
               '" stroke="rgba(148,163,184,0.12)" stroke-width="1"/>' +
               (v > 0 ? '<text x="' + (padXl - 6) + '" y="' + (parseFloat(y) + 4) +
               '" text-anchor="end" font-size="9" fill="rgba(148,163,184,0.7)">' + v + '</text>' : '');
      }).join('');

      // أعمدة شفافة للـ hover (hit area)
      const colW = chartW / 7;
      const hitAreas = pts.map((p, i) =>
        '<rect class="whit" x="' + (p.x - colW / 2).toFixed(1) + '" y="' + padY +
        '" width="' + colW.toFixed(1) + '" height="' + chartH +
        '" fill="transparent" data-v="' + p.v + '" data-i="' + i + '" style="cursor:pointer;"/>'
      ).join('');

      // خطوط رأسية دقيقة عند hover
      const vLines = pts.map((p, i) =>
        '<line class="cvl" x1="' + p.x.toFixed(1) + '" y1="' + padY +
        '" x2="' + p.x.toFixed(1) + '" y2="' + base +
        '" stroke="rgba(99,102,241,0.22)" stroke-width="1" stroke-dasharray="4,3" opacity="0"/>'
      ).join('');

      // نقاط مع glow للأعلى
      const dots = pts.map((p, i) => {
        const isMax = i === maxIdx;
        const r = isMax ? 6 : 4.5;
        const glow = isMax ? '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="11" fill="#6366f1" opacity="0.15"/>' : '';
        return glow + '<circle class="cdot"' +
          ' cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '"' +
          ' r="' + r + '"' +
          ' fill="' + (isMax ? '#6366f1' : 'white') + '"' +
          ' stroke="' + (isMax ? '#4f46e5' : '#6366f1') + '" stroke-width="2.5"' +
          ' data-v="' + p.v + '" data-i="' + i + '"' +
          ' style="cursor:pointer;filter:' + (isMax ? 'drop-shadow(0 2px 6px rgba(99,102,241,0.5))' : 'none') + ';"/>';
      }).join('');

      // أرقام فوق كل نقطة مباشرة
      const valueLabels = pts.map((p, i) => {
        if (p.v === 0) return '';
        const isMax = i === maxIdx;
        const yPos  = (p.y - 13).toFixed(1);
        return '<text x="' + p.x.toFixed(1) + '" y="' + yPos +
          '" text-anchor="middle" font-size="' + (isMax ? '12' : '10.5') + '"' +
          ' font-weight="' + (isMax ? '800' : '700') + '"' +
          ' fill="' + (isMax ? '#6366f1' : 'rgba(100,116,139,0.9)') + '">' +
          p.v + '</text>';
      }).join('');

      wrap.style.cssText = 'display:block;width:100%;height:165px;position:relative;';
      wrap.innerHTML =
        '<div id="wTip" style="position:absolute;background:rgba(15,23,42,0.92);color:white;padding:6px 13px;border-radius:10px;font-size:.76rem;font-weight:700;pointer-events:none;opacity:0;transition:opacity .15s;white-space:nowrap;z-index:10;box-shadow:0 4px 16px rgba(0,0,0,.25);"></div>' +
        '<svg id="wChart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:100%;height:100%;display:block;overflow:visible;">' +
        '<defs>' +
          '<linearGradient id="wAreaG" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#6366f1" stop-opacity="0.18"/>' +
            '<stop offset="60%" stop-color="#6366f1" stop-opacity="0.06"/>' +
            '<stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>' +
          '</linearGradient>' +
          '<linearGradient id="wLineG" x1="0" y1="0" x2="1" y2="0">' +
            '<stop offset="0%" stop-color="#a5b4fc"/>' +
            '<stop offset="50%" stop-color="#6366f1"/>' +
            '<stop offset="100%" stop-color="#4f46e5"/>' +
          '</linearGradient>' +
          '<clipPath id="wClip"><rect id="wClipRect" x="0" y="0" width="0" height="' + H + '"/></clipPath>' +
        '</defs>' +
        gridLines + vLines + hitAreas +
        '<path id="wArea" d="' + areaPath + '" fill="url(#wAreaG)" clip-path="url(#wClip)" style="opacity:0;"/>' +
        '<path id="wLine" d="' + linePath + '" fill="none" stroke="url(#wLineG)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<g id="wDots" style="opacity:0;">' + dots + '</g>' +
        '<g id="wVals" style="opacity:0;">' + valueLabels + '</g>' +
        '</svg>';

      // Labels تحت كل نقطة
      labels.style.cssText = 'position:relative;width:100%;height:20px;margin-top:4px;direction:ltr;display:block;';
      labels.innerHTML = pts.map((p, i) => {
        const leftPct = ((p.x / W) * 100).toFixed(2);
        const isMax   = i === maxIdx;
        return '<span style="position:absolute;left:' + leftPct + '%;transform:translateX(-50%);' +
          'font-size:.68rem;font-weight:' + (isMax ? '800' : '600') + ';' +
          'color:' + (isMax ? '#6366f1' : 'var(--text-muted)') + ';white-space:nowrap;' +
          (isMax ? 'background:rgba(99,102,241,0.08);padding:1px 6px;border-radius:6px;' : '') + '">' +
          dayNames[i] + '</span>';
      }).join('');

      // ===== أنيميشن =====
      requestAnimationFrame(function() {
        const lineEl   = document.getElementById('wLine');
        const clipRect = document.getElementById('wClipRect');
        const areaEl   = document.getElementById('wArea');
        const dotsEl   = document.getElementById('wDots');
        const valsEl   = document.getElementById('wVals');
        if (!lineEl) return;

        const len = lineEl.getTotalLength ? lineEl.getTotalLength() : 900;
        lineEl.style.strokeDasharray  = len;
        lineEl.style.strokeDashoffset = len;

        const dur = 1100;
        let start = null;
        function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

        requestAnimationFrame(function animate(ts) {
          if (!start) start = ts;
          const t = Math.min((ts - start) / dur, 1);
          const e = easeOut(t);

          lineEl.style.strokeDashoffset = (len * (1 - e)).toFixed(1);
          if (clipRect) clipRect.setAttribute('width', (e * W).toFixed(1));
          if (areaEl)   areaEl.style.opacity = (e * 1).toFixed(3);

          if (t < 1) {
            requestAnimationFrame(animate);
          } else {
            if (dotsEl) { dotsEl.style.transition = 'opacity 0.3s ease'; dotsEl.style.opacity = '1'; }
            if (valsEl) { setTimeout(function(){ valsEl.style.transition = 'opacity 0.4s ease'; valsEl.style.opacity = '1'; }, 150); }
          }
        });
      });

      // ===== Hover على hit areas =====
      const svg = document.getElementById('wChart');
      const tip = document.getElementById('wTip');
      if (!svg || !tip) return;

      svg.querySelectorAll('.whit').forEach(function(hit) {
        const i  = parseInt(hit.getAttribute('data-i'));
        const v  = parseInt(hit.getAttribute('data-v'));
        const vl = svg.querySelectorAll('.cvl')[i];
        const dot = svg.querySelectorAll('.cdot')[i];
        const isMax = i === maxIdx;
        const r0 = isMax ? 6 : 4.5;

        hit.addEventListener('mouseenter', function() {
          tip.textContent = dayNames[i] + ': ' + v + ' موعد';
          tip.style.opacity = '1';
          if (dot) dot.setAttribute('r', r0 + 2);
          if (vl)  vl.setAttribute('opacity', '1');
        });
        hit.addEventListener('mousemove', function(e) {
          const rect = wrap.getBoundingClientRect();
          const tx = e.clientX - rect.left - tip.offsetWidth / 2;
          const ty = e.clientY - rect.top - 50;
          tip.style.left = Math.max(0, Math.min(tx, rect.width - tip.offsetWidth)) + 'px';
          tip.style.top  = ty + 'px';
        });
        hit.addEventListener('mouseleave', function() {
          tip.style.opacity = '0';
          if (dot) dot.setAttribute('r', r0);
          if (vl)  vl.setAttribute('opacity', '0');
        });
      });
    }


    function updateStats(useAnimation = true) {
      const stats = calculateStatsFromPatients();
      const cancelled = calculateCancelledAppointments();

      const activeEl    = document.getElementById('statActiveUsers');
      const totalEl     = document.getElementById('statTotalVisits');
      const cancelledEl = document.getElementById('statCancelled');
      const repeatEl    = document.getElementById('statConversion');
      const noShowEl    = document.getElementById('statNoShow');
      const thisMonthEl = document.getElementById('statThisMonth');
      const avgDailyEl  = document.getElementById('statAvgDaily');
      const busyDayEl   = document.getElementById('statBusyDay');

      if (useAnimation) {
        animateNumber(activeEl, stats.activeCount);
        animateNumber(totalEl, stats.totalVisits);
        animateNumber(cancelledEl, cancelled);
        animateNumber(repeatEl, stats.repeatRate, '%');
        animateNumber(noShowEl, stats.noShow);
        animateNumber(thisMonthEl, stats.thisMonth);
      } else {
        activeEl.textContent    = stats.activeCount;
        totalEl.textContent     = stats.totalVisits;
        cancelledEl.textContent = cancelled;
        repeatEl.textContent    = stats.repeatRate + '%';
        noShowEl.textContent    = stats.noShow;
        thisMonthEl.textContent = stats.thisMonth;
      }
      if (avgDailyEl)  avgDailyEl.textContent  = stats.avgDaily;
      if (busyDayEl)   busyDayEl.textContent    = stats.busyDay;

      // دائرة الصباح/المساء — يُحدَّث عبر updateDonutChart حسب الفلتر المحدد
      updateDonutChart();

      // جدول أحدث الزيارات
      const tbody = document.getElementById('recentAppointmentsTable');
      if (stats.recentVisits.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:16px 0;color:var(--text-muted)">لا توجد زيارات</td></tr>';
      } else {
        tbody.innerHTML = stats.recentVisits.map(v =>
          `<tr style="cursor:pointer;" onclick="openPatientDetailsModal('${v.patientId}')">` +
          `<td style="color:var(--primary);font-weight:700;">${escapeHtml(v.patientName)}</td>` +
          `<td>${v.visitType||'-'}</td><td>${formatDateAr(v.date)}</td></tr>`
        ).join('');
      }

      renderWeekdayBars(stats.weekdayCounts);
      renderChart();
    }

    function animateNumber(element, target, suffix = '', duration = 500) {
      if (!element) return;
      const start = 0;
      const increment = target / (duration / 16);
      let current = start;
      const step = () => {
        current += increment;
        if (current >= target) {
          element.textContent = target + suffix;
          return;
        }
        element.textContent = Math.floor(current) + suffix;
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    // ==================== مخطط تحليلات المواعيد مع إمكانية النقر ====================
    function renderChart() {
      const chartContainer = document.getElementById('appointmentsChart');
      const yAxis = document.getElementById('chartYAxis');
      if (!chartContainer) return;

      const months = monthsAr;
      const weeks = ['الأسبوع 1', 'الأسبوع 2', 'الأسبوع 3', 'الأسبوع 4'];
      const days = daysAr;
      
      let labels = months;
      let data = Array(12).fill(0);
      let periods = [];
      
      const accepted = allRecords.filter(r => r.Status === 'Accepted');

      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
      const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);
      const daysInMonth = lastDayOfMonth.getDate();

      if (currentChartPeriod === 'weekly') {
        labels = weeks;
        data = Array(4).fill(0);
        periods = [];
        
        for (let week = 0; week < 4; week++) {
          const startDay = week * 7 + 1;
          const endDay = Math.min((week + 1) * 7, daysInMonth);
          const startDate = toLocalISODate(new Date(currentYear, currentMonth, startDay));
          const endDate = toLocalISODate(new Date(currentYear, currentMonth, endDay));
          periods.push({ label: `الأسبوع ${week + 1}`, start: startDate, end: endDate });
        }

        accepted.forEach(record => {
          if (!record.Date) return;
          const recStr = record.Date.substring(0, 10);
          if (recStr >= toLocalISODate(firstDayOfMonth) && recStr <= toLocalISODate(lastDayOfMonth)) {
            const day = parseInt(recStr.substring(8, 10), 10);
            const weekNum = Math.floor((day - 1) / 7);
            if (weekNum >= 0 && weekNum < 4) data[weekNum]++;
          }
        });
      } else if (currentChartPeriod === 'daily') {
        labels = days;
        data = Array(7).fill(0);
        periods = [];
        
        const firstDayOfWeek = new Date(now);
        firstDayOfWeek.setDate(now.getDate() - now.getDay());
        firstDayOfWeek.setHours(0, 0, 0, 0);
        
        for (let d = 0; d < 7; d++) {
          const dayDate = new Date(firstDayOfWeek);
          dayDate.setDate(firstDayOfWeek.getDate() + d);
          periods.push({ label: daysAr[d], date: toLocalISODate(dayDate) });
        }

        const weekStart = toLocalISODate(firstDayOfWeek);
        accepted.forEach(record => {
          if (!record.Date) return;
          const recStr = record.Date.substring(0, 10);
          const idx = periods.findIndex(p => p.date === recStr);
          if (idx >= 0) data[idx]++;
        });
      } else { // monthly
        labels = months;
        data = Array(12).fill(0);
        periods = months.map((m, idx) => ({ label: m, month: idx }));

        accepted.forEach(record => {
          if (!record.Date) return;
          const month = parseInt(record.Date.substring(5, 7), 10) - 1;
          if (month >= 0 && month < 12) data[month]++;
        });
      }
      
      const maxValue = Math.max(...data, 1);
      
      yAxis.innerHTML = '';
      for (let i = 5; i >= 0; i--) {
        const value = Math.round((maxValue / 5) * i);
        yAxis.innerHTML += `<span class="y-value">${value}</span>`;
      }

      chartContainer.innerHTML = labels.map((label, index) => {
        const height = (data[index] / maxValue) * 200;
        return `<div class="chart-bar-group" onclick="showColumnDetails(${index})">
                  <div class="chart-bar" style="height: ${height}px;"></div>
                  <span class="chart-label">${label.substring(0, 3)}</span>
                </div>`;
      }).join('');

      window.__chartData = { periods, data, currentChartPeriod };
    }

    window.showColumnDetails = function(index) {
      const chartData = window.__chartData;
      if (!chartData) return;
      const period = chartData.periods[index];
      if (!period) return;

      let total = 0, morning = 0, evening = 0, cancelledCount = 0;
      const accepted = allRecords.filter(r => r.Status === 'Accepted');
      const cancelled = allRecords.filter(r => r.Status === 'Cancelled' || r.Status === 'Rejected');

      if (chartData.currentChartPeriod === 'monthly') {
        const month = period.month;
        total = accepted.filter(r => new Date(r.Date).getMonth() === month).length;
        morning = accepted.filter(r => new Date(r.Date).getMonth() === month && (r.Slot||'Morning') === 'Morning').length;
        evening = accepted.filter(r => new Date(r.Date).getMonth() === month && (r.Slot||'Evening') === 'Evening').length;
        cancelledCount = cancelled.filter(r => new Date(r.Date).getMonth() === month).length;
        var title = `تفاصيل شهر ${period.label}`;
      } else if (chartData.currentChartPeriod === 'weekly') {
        const start = period.start, end = period.end;
        total = accepted.filter(r => r.Date >= start && r.Date <= end).length;
        morning = accepted.filter(r => r.Date >= start && r.Date <= end && (r.Slot||'Morning') === 'Morning').length;
        evening = accepted.filter(r => r.Date >= start && r.Date <= end && (r.Slot||'Evening') === 'Evening').length;
        cancelledCount = cancelled.filter(r => r.Date >= start && r.Date <= end).length;
        var title = `تفاصيل ${period.label}`;
      } else if (chartData.currentChartPeriod === 'daily') {
        const date = period.date;
        total = accepted.filter(r => r.Date === date).length;
        morning = accepted.filter(r => r.Date === date && (r.Slot||'Morning') === 'Morning').length;
        evening = accepted.filter(r => r.Date === date && (r.Slot||'Evening') === 'Evening').length;
        cancelledCount = cancelled.filter(r => r.Date === date).length;
        var title = `تفاصيل ${period.label} ${formatDateAr(date)}`;
      }

      document.getElementById('dayDetailsTitle').textContent = title;
      document.getElementById('dayDetailsContent').innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div style="background:var(--primary-light);border-radius:var(--radius-sm);padding:14px;text-align:center;">
            <p style="font-size:.82rem;color:var(--text-muted);">إجمالي المواعيد</p>
            <p style="font-size:2rem;font-weight:800;font-family:'DM Mono',monospace;">${total}</p>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div style="background:var(--amber-light);border-radius:var(--radius-sm);padding:12px;text-align:center;">
              <p style="font-size:.78rem;color:var(--text-muted);">صباحاً</p>
              <p style="font-size:1.6rem;font-weight:800;font-family:'DM Mono',monospace;">${morning}</p>
            </div>
            <div style="background:#eff6ff;border-radius:var(--radius-sm);padding:12px;text-align:center;">
              <p style="font-size:.78rem;color:var(--text-muted);">مساءً</p>
              <p style="font-size:1.6rem;font-weight:800;font-family:'DM Mono',monospace;">${evening}</p>
            </div>
          </div>
          <div style="background:var(--red-light);border-radius:var(--radius-sm);padding:12px;text-align:center;">
            <p style="font-size:.78rem;color:var(--text-muted);">الملغاة / المرفوضة</p>
            <p style="font-size:1.6rem;font-weight:800;color:var(--red);font-family:'DM Mono',monospace;">${cancelledCount}</p>
          </div>
        </div>`;
      document.getElementById('dayDetailsModal').classList.remove('hidden');
    };

    window.updateChartPeriod = function(period) {
      currentChartPeriod = period;
      document.querySelectorAll('#statsSection .card-actions .card-btn').forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');
      renderChart();
    };

    // showStatInfo is now replaced by openStatDrawer (drawer system)
    window.showStatInfo = function(type) { openStatDrawer(type); };

    window.closeStatInfoModal = function() { document.getElementById('statInfoModal').classList.add('hidden'); };
    
    document.getElementById('statInfoModal')?.addEventListener('click', function(e) {
      if (e.target === this) this.classList.add('hidden');
    });

    // ==================== Stat Drawer System ====================
    let _drawerRows = [];    // all rows for current drawer type
    let _drawerType = '';
    let _donutFilter = 'week'; // week | month | all
    let _donutDrawerSlot = ''; // morning | evening

    window.closeStatDrawer = function() {
      document.getElementById('statDrawerOverlay').classList.remove('open');
      document.getElementById('statDrawerPanel').classList.remove('open');
    };

    // ESC key closes drawer
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeStatDrawer();
    });

    function _getFilteredRecordsForPeriod(filter) {
      const now = new Date();
      if (filter === 'week') {
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0,0,0,0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        const s = toLocalISODate(startOfWeek), e = toLocalISODate(endOfWeek);
        return allRecords.filter(r => r.Date >= s && r.Date <= e);
      } else if (filter === 'month') {
        const prefix = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        return allRecords.filter(r => r.Date && r.Date.startsWith(prefix));
      }
      return allRecords; // all
    }

    window.setDonutFilter = function(filter, btn) {
      _donutFilter = filter;
      document.querySelectorAll('.donut-filter-btn').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      updateDonutChart();
    };

    function updateDonutChart() {
      const records = _getFilteredRecordsForPeriod(_donutFilter);
      const accepted = records.filter(r => ['Accepted','Visited','NoShow'].includes(r.Status));
      const morningCount = accepted.filter(r => (r.Slot||'Morning') === 'Morning').length;
      const eveningCount = accepted.filter(r => r.Slot === 'Evening').length;
      const totalSlot = morningCount + eveningCount;
      const morningAngle = totalSlot ? (morningCount / totalSlot) * 339.3 : 0;
      const eveningAngle = totalSlot ? (eveningCount / totalSlot) * 339.3 : 0;
      document.getElementById('sourceSegment1').setAttribute('stroke-dasharray', `${morningAngle} 339.3`);
      document.getElementById('sourceSegment2').setAttribute('stroke-dasharray', `${eveningAngle} 339.3`);
      document.getElementById('sourceSegment2').setAttribute('stroke-dashoffset', -morningAngle);
      document.getElementById('sourceTotal').textContent = totalSlot;
      const morningPct = totalSlot ? ((morningCount / totalSlot) * 100).toFixed(1) : '0.0';
      const eveningPct = totalSlot ? ((eveningCount / totalSlot) * 100).toFixed(1) : '0.0';
      document.getElementById('sourceLegend').innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;cursor:pointer;" onclick="openDonutDrawer('morning')">
          <span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#fbbf24;flex-shrink:0;"></span>
          <span>صباحي (${morningPct}%)</span>
          <i class="fas fa-chevron-left" style="font-size:.6rem;color:var(--text-muted);margin-right:2px;"></i>
        </div>
        <div style="display:flex;align-items:center;gap:6px;cursor:pointer;" onclick="openDonutDrawer('evening')">
          <span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#3b82f6;flex-shrink:0;"></span>
          <span>مسائي (${eveningPct}%)</span>
          <i class="fas fa-chevron-left" style="font-size:.6rem;color:var(--text-muted);margin-right:2px;"></i>
        </div>
      `;
    }

    window.openDonutDrawer = function(slot) {
      _donutDrawerSlot = slot;
      const filterLabel = { week: 'هذا الأسبوع', month: 'هذا الشهر', all: 'كل الوقت' }[_donutFilter];
      const isM = slot === 'morning';
      const records = _getFilteredRecordsForPeriod(_donutFilter);
      const filtered = records.filter(r =>
        ['Accepted','Visited','NoShow'].includes(r.Status) &&
        (isM ? (r.Slot||'Morning') === 'Morning' : r.Slot === 'Evening')
      ).sort((a,b) => (b.Date||'').localeCompare(a.Date||''));

      _drawerRows = filtered;
      _drawerType = 'donut_' + slot;

      const icon = isM ? 'fa-sun' : 'fa-moon';
      const color = isM ? '#fbbf24' : '#3b82f6';
      const title = isM ? 'المواعيد الصباحية' : 'المواعيد المسائية';

      _openDrawer({
        icon, color, title,
        count: filtered.length,
        filterLabel,
        rows: filtered,
        columns: [],
        rowBuilder: (r) => {
          const statusMap = {
            Accepted: { label: 'مؤكد', bg: 'var(--primary-light)', color: 'var(--primary)', icon: 'fa-calendar-check', accent: 'var(--primary)', accentLight: 'var(--primary-light)' },
            Visited:  { label: 'تمت الزيارة', bg: '#dcfce7', color: '#16a34a', icon: 'fa-check-circle', accent: '#16a34a', accentLight: '#dcfce7' },
            NoShow:   { label: 'لم يحضر', bg: '#fee2e2', color: '#dc2626', icon: 'fa-user-times', accent: '#dc2626', accentLight: '#fee2e2' },
          };
          const s = statusMap[r.Status] || statusMap.Accepted;
          const initials = (r.PatientName||'؟').split(' ').map(w=>w[0]).slice(0,2).join('');
          const slotIcon = isM ? '<span class="dpc-meta-chip" style="background:#fef3c7;color:#d97706;border-color:#fde68a;"><i class="fas fa-sun" style="color:#d97706;"></i>صباحاً</span>' : '<span class="dpc-meta-chip" style="background:#ede9fe;color:#7c3aed;border-color:#ddd6fe;"><i class="fas fa-moon" style="color:#7c3aed;"></i>مساءً</span>';
          return `<div class="drawer-patient-card" style="--card-accent:${s.accent};--card-accent-light:${s.accentLight};">
            <div class="dpc-top">
              <div class="dpc-avatar">${initials}</div>
              <div class="dpc-name-wrap">
                <div class="dpc-name">${escapeHtml(r.PatientName||'-')}</div>
              </div>
              <span class="dpc-badge" style="background:${s.bg};color:${s.color};">
                <i class="fas ${s.icon}"></i>${s.label}
              </span>
            </div>
            <div class="dpc-meta">
              <span class="dpc-meta-chip"><i class="fas fa-calendar"></i>${formatDateAr(r.Date)}</span>
              ${slotIcon}
              ${r.VisitType ? `<span class="dpc-meta-chip"><i class="fas fa-stethoscope"></i>${escapeHtml(r.VisitType)}</span>` : ''}
            </div>
          </div>`;
        }
      });
    };

    window.openStatDrawer = function(type) {
      _drawerType = type;
      document.getElementById('drawerSearchInput').value = '';

      const configs = {
        total: {
          icon: 'fa-clipboard-list', color: 'var(--primary)',
          title: 'إجمالي الزيارات',
          getData: () => allRecords.filter(r => ['Accepted','Visited','NoShow'].includes(r.Status))
            .sort((a,b) => (b.Date||'').localeCompare(a.Date||'')),
          columns: [],
          rowBuilder: (r) => {
            const statusMap = {
              Accepted: { label: 'مؤكد', bg: 'var(--primary-light)', color: 'var(--primary)', icon: 'fa-calendar-check', accent: 'var(--primary)', accentLight: 'var(--primary-light)' },
              Visited:  { label: 'تمت الزيارة', bg: '#dcfce7', color: '#16a34a', icon: 'fa-check-circle', accent: '#16a34a', accentLight: '#dcfce7' },
              NoShow:   { label: 'لم يحضر', bg: '#fee2e2', color: '#dc2626', icon: 'fa-user-times', accent: '#dc2626', accentLight: '#fee2e2' },
            };
            const s = statusMap[r.Status] || statusMap.Accepted;
            const initials = (r.PatientName||'؟').split(' ').map(w=>w[0]).slice(0,2).join('');
            const slotLabel = r.Slot==='Evening' ? '<span class="dpc-meta-chip"><i class="fas fa-moon"></i>مساءً</span>' : '<span class="dpc-meta-chip"><i class="fas fa-sun"></i>صباحاً</span>';
            return `<div class="drawer-patient-card" style="--card-accent:${s.accent};--card-accent-light:${s.accentLight};">
              <div class="dpc-top">
                <div class="dpc-avatar">${initials}</div>
                <div class="dpc-name-wrap">
                  <div class="dpc-name">${escapeHtml(r.PatientName||'-')}</div>
                  ${r.Phone ? `<div class="dpc-phone"><i class="fas fa-phone"></i>${escapeHtml(r.Phone)}</div>` : ''}
                </div>
                <span class="dpc-badge" style="background:${s.bg};color:${s.color};">
                  <i class="fas ${s.icon}"></i>${s.label}
                </span>
              </div>
              <div class="dpc-meta">
                <span class="dpc-meta-chip"><i class="fas fa-calendar"></i>${formatDateAr(r.Date)}</span>
                ${slotLabel}
              </div>
            </div>`;
          }
        },
        cancelled: {
          icon: 'fa-ban', color: '#dc2626',
          title: 'المواعيد الملغاة',
          getData: () => allRecords.filter(r => r.Status === 'Cancelled' || r.Status === 'Rejected')
            .sort((a,b) => (b.Date||'').localeCompare(a.Date||'')),
          columns: [],
          rowBuilder: (r) => {
            const initials = (r.PatientName||'؟').split(' ').map(w=>w[0]).slice(0,2).join('');
            const slotLabel = r.Slot==='Evening' ? '<span class="dpc-meta-chip"><i class="fas fa-moon"></i>مساءً</span>' : '<span class="dpc-meta-chip"><i class="fas fa-sun"></i>صباحاً</span>';
            return `<div class="drawer-patient-card" style="--card-accent:#dc2626;--card-accent-light:#fee2e2;">
              <div class="dpc-top">
                <div class="dpc-avatar">${initials}</div>
                <div class="dpc-name-wrap">
                  <div class="dpc-name">${escapeHtml(r.PatientName||'-')}</div>
                  ${r.Phone ? `<div class="dpc-phone"><i class="fas fa-phone"></i>${escapeHtml(r.Phone)}</div>` : ''}
                </div>
                <span class="dpc-badge" style="background:#fee2e2;color:#dc2626;">
                  <i class="fas fa-ban"></i>ملغى
                </span>
              </div>
              <div class="dpc-meta">
                <span class="dpc-meta-chip"><i class="fas fa-calendar-xmark"></i>${formatDateAr(r.Date)}</span>
                ${slotLabel}
              </div>
            </div>`;
          }
        },
        noshow: {
          icon: 'fa-user-slash', color: '#ea580c',
          title: 'سجل الغياب — لم يحضر',
          getData: () => allRecords.filter(r => r.Status === 'NoShow')
            .sort((a,b) => (b.Date||'').localeCompare(a.Date||'')),
          columns: [],
          rowBuilder: (r) => {
            const initials = (r.PatientName||'؟').split(' ').map(w=>w[0]).slice(0,2).join('');
            const slotLabel = r.Slot==='Evening' ? '<span class="dpc-meta-chip"><i class="fas fa-moon"></i>مساءً</span>' : '<span class="dpc-meta-chip"><i class="fas fa-sun"></i>صباحاً</span>';
            return `<div class="drawer-patient-card" style="--card-accent:#ea580c;--card-accent-light:#ffedd5;">
              <div class="dpc-top">
                <div class="dpc-avatar">${initials}</div>
                <div class="dpc-name-wrap">
                  <div class="dpc-name">${escapeHtml(r.PatientName||'-')}</div>
                  ${r.Phone ? `<div class="dpc-phone"><i class="fas fa-phone"></i>${escapeHtml(r.Phone)}</div>` : ''}
                </div>
                <span class="dpc-badge" style="background:#ffedd5;color:#ea580c;">
                  <i class="fas fa-user-slash"></i>غائب
                </span>
              </div>
              <div class="dpc-meta">
                <span class="dpc-meta-chip"><i class="fas fa-calendar"></i>${formatDateAr(r.Date)}</span>
                ${slotLabel}
                ${r.VisitType ? `<span class="dpc-meta-chip"><i class="fas fa-stethoscope"></i>${escapeHtml(r.VisitType)}</span>` : ''}
              </div>
            </div>`;
          }
        },
        repeat: {
          icon: 'fa-arrow-trend-up', color: '#16a34a',
          title: 'المرضى المتكررون',
          getData: () => {
            const map = {};
            allRecords.filter(r => ['Accepted','Visited'].includes(r.Status)).forEach(r => {
              const k = r.PatientName||'';
              if (!map[k]) map[k] = { name: k, phone: r.Phone||'', count: 0, last: '' };
              map[k].count++;
              if (r.Date > map[k].last) map[k].last = r.Date;
            });
            return Object.values(map).filter(p => p.count > 1).sort((a,b) => b.count - a.count);
          },
          columns: [],
          rowBuilder: (r) => {
            const initials = (r.name||'؟').split(' ').map(w=>w[0]).slice(0,2).join('');
            return `<div class="drawer-patient-card" style="--card-accent:#16a34a;--card-accent-light:#dcfce7;">
              <div class="dpc-top">
                <div class="dpc-avatar">${initials}</div>
                <div class="dpc-name-wrap">
                  <div class="dpc-name">${escapeHtml(r.name||'-')}</div>
                  ${r.phone ? `<div class="dpc-phone"><i class="fas fa-phone"></i>${escapeHtml(r.phone)}</div>` : ''}
                </div>
                <div class="dpc-count-badge" style="background:#dcfce7;color:#16a34a;border-color:#bbf7d0;">${r.count}</div>
              </div>
              <div class="dpc-meta">
                <span class="dpc-meta-chip"><i class="fas fa-clock-rotate-left"></i>آخر زيارة: ${formatDateAr(r.last)}</span>
                <span class="dpc-meta-chip" style="background:#dcfce7;color:#16a34a;border-color:#bbf7d0;"><i class="fas fa-repeat" style="color:#16a34a;"></i>${r.count} زيارات</span>
              </div>
            </div>`;
          }
        },
        avgDaily: {
          icon: 'fa-chart-line', color: 'var(--primary)',
          title: 'توزيع الزيارات اليومي',
          getData: () => {
            const dayMap = {};
            allRecords.filter(r => ['Accepted','Visited'].includes(r.Status)).forEach(r => {
              if (!r.Date) return;
              const d = r.Date.substring(0,10);
              if (!dayMap[d]) dayMap[d] = { date: d, count: 0, morning: 0, evening: 0 };
              dayMap[d].count++;
              if ((r.Slot||'Morning') === 'Morning') dayMap[d].morning++;
              else dayMap[d].evening++;
            });
            return Object.values(dayMap).sort((a,b) => b.date.localeCompare(a.date));
          },
          columns: [],
          rowBuilder: (r) => {
            const dateParts = r.date ? r.date.split('-') : [];
            const dayNum = dateParts[2] ? parseInt(dateParts[2]) : '--';
            const monthsArShort = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
            const monthLabel = dateParts[1] ? monthsArShort[parseInt(dateParts[1])-1] : '';
            return `<div class="drawer-day-card">
              <div class="ddc-date-box">
                <div class="ddc-date-day">${dayNum}</div>
                <div class="ddc-date-month">${monthLabel}</div>
              </div>
              <div class="ddc-info">
                <div class="ddc-total">إجمالي الزيارات: <span class="ddc-total-num">${r.count}</span></div>
                <div class="ddc-slots">
                  <span class="ddc-slot morning"><i class="fas fa-sun"></i>صباح: ${r.morning}</span>
                  <span class="ddc-slot evening"><i class="fas fa-moon"></i>مساء: ${r.evening}</span>
                </div>
              </div>
            </div>`;
          }
        },
        thismonth: {
          icon: 'fa-calendar-check', color: '#2563eb',
          title: 'زيارات هذا الشهر',
          getData: () => {
            const now = new Date();
            const prefix = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
            return allRecords.filter(r => ['Accepted','Visited','NoShow'].includes(r.Status) && r.Date && r.Date.startsWith(prefix))
              .sort((a,b) => (b.Date||'').localeCompare(a.Date||''));
          },
          columns: [],
          rowBuilder: (r) => {
            const statusMap = {
              Accepted: { label: 'مؤكد', bg: 'var(--primary-light)', color: 'var(--primary)', icon: 'fa-calendar-check', accent: 'var(--primary)', accentLight: 'var(--primary-light)' },
              Visited:  { label: 'تمت الزيارة', bg: '#dcfce7', color: '#16a34a', icon: 'fa-check-circle', accent: '#16a34a', accentLight: '#dcfce7' },
              NoShow:   { label: 'لم يحضر', bg: '#fee2e2', color: '#dc2626', icon: 'fa-user-times', accent: '#dc2626', accentLight: '#fee2e2' },
            };
            const s = statusMap[r.Status] || statusMap.Accepted;
            const initials = (r.PatientName||'؟').split(' ').map(w=>w[0]).slice(0,2).join('');
            const slotLabel = r.Slot==='Evening' ? '<span class="dpc-meta-chip"><i class="fas fa-moon"></i>مساءً</span>' : '<span class="dpc-meta-chip"><i class="fas fa-sun"></i>صباحاً</span>';
            return `<div class="drawer-patient-card" style="--card-accent:${s.accent};--card-accent-light:${s.accentLight};">
              <div class="dpc-top">
                <div class="dpc-avatar">${initials}</div>
                <div class="dpc-name-wrap">
                  <div class="dpc-name">${escapeHtml(r.PatientName||'-')}</div>
                </div>
                <span class="dpc-badge" style="background:${s.bg};color:${s.color};">
                  <i class="fas ${s.icon}"></i>${s.label}
                </span>
              </div>
              <div class="dpc-meta">
                <span class="dpc-meta-chip"><i class="fas fa-calendar"></i>${formatDateAr(r.Date)}</span>
                ${slotLabel}
                ${r.VisitType ? `<span class="dpc-meta-chip"><i class="fas fa-stethoscope"></i>${escapeHtml(r.VisitType)}</span>` : ''}
              </div>
            </div>`;
          }
        },
      };

      const cfg = configs[type];
      if (!cfg) return;
      const rows = cfg.getData();
      _drawerRows = rows;

      _openDrawer({
        icon: cfg.icon, color: cfg.color, title: cfg.title,
        count: rows.length, rows, columns: cfg.columns, rowBuilder: cfg.rowBuilder
      });
    };

    function _openDrawer({ icon, color, title, count, rows, columns, rowBuilder }) {
      const iconWrap = document.getElementById('drawerIconWrap');
      iconWrap.style.background = color + '22';
      iconWrap.style.border = '1.5px solid ' + color + '44';
      const drawerIcon = document.getElementById('drawerIcon');
      drawerIcon.className = 'fas ' + icon;
      drawerIcon.style.color = color;

      document.getElementById('drawerTitle').textContent = title;
      document.getElementById('drawerCount').textContent = count;
      document.getElementById('drawerCount').style.color = color;
      document.getElementById('drawerFilters').innerHTML = '';

      _renderDrawerTable(rows, columns, rowBuilder);

      // store for search
      window._drawerCfg = { rows, columns, rowBuilder };

      document.getElementById('statDrawerOverlay').classList.add('open');
      document.getElementById('statDrawerPanel').classList.add('open');
    }

    function _renderDrawerTable(rows, columns, rowBuilder) {
      const body = document.getElementById('drawerBody');
      if (!rows.length) {
        body.innerHTML = `<div class="drawer-empty"><i class="fas fa-inbox"></i><p>لا توجد بيانات</p></div>`;
        return;
      }
      const cards = rows.map((r, i) => `<div class="drawer-card-item" data-idx="${i}">${rowBuilder(r)}</div>`).join('');
      body.innerHTML = `<div class="drawer-cards-list">${cards}</div>`;
    }

    window.filterDrawerRows = function(query) {
      const cfg = window._drawerCfg;
      if (!cfg) return;
      const q = query.trim().toLowerCase();
      if (!q) {
        _renderDrawerTable(cfg.rows, cfg.columns, cfg.rowBuilder);
        document.getElementById('drawerCount').textContent = cfg.rows.length;
        return;
      }
      // Search by serializing the row to text
      const filtered = cfg.rows.filter(r => {
        const text = JSON.stringify(r).toLowerCase();
        return text.includes(q);
      });
      _renderDrawerTable(filtered, cfg.columns, cfg.rowBuilder);
      document.getElementById('drawerCount').textContent = filtered.length;
    };

    // ==================== التقويم ====================
    function renderCalendar() {
      const grid = document.getElementById('calendarGrid');
      if (!grid) return;
      grid.innerHTML = '';
      const year = currentDate.getFullYear(), month = currentDate.getMonth();
      document.getElementById('currentMonth').textContent = `${monthsAr[month]} ${year}`;
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      let startOffset = (firstDay + 2) % 7;
      for (let i = startOffset - 1; i >= 0; i--) { 
        const d = document.createElement('div'); 
        d.className = 'compact-calendar-day other-month'; 
        d.textContent = ''; 
        grid.appendChild(d); 
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, month, d); dateObj.setHours(0,0,0,0);
        const dateStr = toLocalISODate(dateObj);
        const dayDiv = document.createElement('div'); 
        dayDiv.className = 'compact-calendar-day'; 
        dayDiv.textContent = d;
        
        if (dateObj < today) dayDiv.classList.add('past-day');
        if (dateObj.getTime() === today.getTime()) dayDiv.classList.add('today');
        if (selectedDayStr === dateStr) dayDiv.classList.add('selected');
        
        // تمكين الضغط على جميع الأيام بما فيها الماضية
        dayDiv.addEventListener('click', () => selectDay(dateStr));
        
        // عرض نقاط المواعيد لجميع الأيام (الماضية والمستقبلية)
        const dayRecords = allRecords.filter(r => 
          ['Accepted', 'Visited', 'NoShow'].includes(r.Status) && r.Date === dateStr
        );
        const acceptedCount = dayRecords.length;
        
        if (acceptedCount > 0) {
          const dot = document.createElement('div');
          dot.className = `compact-appointment-dot ${acceptedCount <=2 ? 'compact-dot-low' : acceptedCount <=4 ? 'compact-dot-medium' : 'compact-dot-high'}`;
          dayDiv.appendChild(dot);
        }
        grid.appendChild(dayDiv);
      }
    }

    function selectDay(dateStr) {
      selectedDayStr = dateStr;
      // افتح اليوم المختار تلقائياً في جدول الأسبوع
      var _p = dateStr.split('-');
      schedRefDate = new Date(+_p[0], (+_p[1]) - 1, +_p[2]);
      renderCalendar();
      renderAgendaForDay(dateStr);
      renderCalMobileAgenda(dateStr);
      if (typeof setScheduleView === 'function') setScheduleView('week');
      else if (typeof renderScheduleGrid === 'function') renderScheduleGrid();
    }

    // قائمة مواعيد اليوم المختار في قسم الروزنامة (الموبايل)
    function renderCalMobileAgenda(dateStr) {
      var box = document.getElementById('calMobileAgenda'); if (!box) return;
      dateStr = dateStr || selectedDayStr || todayStr;
      var isPast  = parseLocalISODate(dateStr) < today;
      var isToday = dateStr === todayStr;
      var recs;
      if (isPast)       recs = allRecords.filter(function(r){ return ['Accepted','Visited','NoShow','Cancelled','Rejected'].includes(r.Status) && normalizeDate(r.Date) === dateStr; });
      else if (isToday) recs = allRecords.filter(function(r){ return ['Accepted','Visited','NoShow'].includes(r.Status) && normalizeDate(r.Date) === dateStr; });
      else              recs = allRecords.filter(function(r){ return r.Status === 'Accepted' && normalizeDate(r.Date) === dateStr; });
      recs = recs.slice().sort(function(a,b){ return slotMinutes(slotTimeOf(a)) - slotMinutes(slotTimeOf(b)); });
      var head = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
        + '<h3 style="font-weight:800;font-size:.85rem;color:var(--text-primary);margin:0;">' + daysAr[parseLocalISODate(dateStr).getDay()] + ' — ' + formatDateAr(dateStr) + '</h3>'
        + '<span style="font-size:.7rem;color:var(--text-muted);font-weight:600;">' + recs.length + ' موعد</span></div>';
      var body = recs.length
        ? '<div style="display:flex;flex-direction:column;gap:8px;">' + recs.map(homeApptCard).join('') + '</div>'
        : '<div style="text-align:center;padding:18px 0;color:var(--text-muted);font-size:.85rem;"><i class="far fa-calendar-check" style="font-size:1.4rem;display:block;margin-bottom:8px;opacity:.4;"></i>لا مواعيد في هذا اليوم</div>';
      box.innerHTML = head + body;
    }

    // ================== Slot Helpers (تحويل صباحي/مسائي → ساعات) ==================
    function convertLegacySlotToTime(slot) {
      if (slot === 'Morning') return '09:00';
      if (slot === 'Evening') return '14:00';
      if (!slot || slot === 'Unknown') return '09:00';
      return slot; // أصلاً وقت مثل "09:00"
    }
    function slotTimeOf(record) {
      if (!record) return '09:00';
      const raw = (record.Slot != null && record.Slot !== '') ? record.Slot
                : (record.slot != null && record.slot !== '') ? record.slot : '';
      return convertLegacySlotToTime(raw);
    }
    function slotMinutes(t) {
      const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
      return m ? (parseInt(m[1],10) * 60 + parseInt(m[2],10)) : 0;
    }
    function slotLabelOf(record) { return slotTimeOf(record); }

    // ================== Schedule Grid (شبكة ساعات يومي/أسبوعي) — قراءة فقط ==================
    const SCHED_START_HOUR = 6, SCHED_END_HOUR = 24;
    let   SCHED_HOUR_PX    = 56;
    const SCHED_HOUR_PX_MIN = 34, SCHED_HOUR_PX_MAX = 120;
    window.schedZoom = function(dir) {
      SCHED_HOUR_PX = Math.max(SCHED_HOUR_PX_MIN, Math.min(SCHED_HOUR_PX_MAX, SCHED_HOUR_PX + dir * 12));
      renderScheduleGrid();
    };
    const SCHED_EN_DAYS   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    const SCHED_EN_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    let scheduleView = (window.innerWidth < 820) ? 'day' : 'week';
    let schedRefDate = new Date(today);

    function weekStartSun(d) { const x = new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate() - x.getDay()); return x; }
    function fmtSchedHour(h) { const h24 = h % 24; const ap = h24 < 12 ? 'AM' : 'PM'; let hh = h24 % 12; if (hh === 0) hh = 12; return ap + ' ' + hh; }
    function schedFmtRange(days) {
      const M = SCHED_EN_MONTHS;
      if (days.length === 1) { const d = days[0]; return M[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
      const a = days[0], b = days[days.length - 1];
      return M[a.getMonth()] + ' ' + a.getDate() + ' - ' + M[b.getMonth()] + ' ' + b.getDate() + ', ' + b.getFullYear();
    }
    function schedStatusColor(r) {
      if (r.Status === 'NoShow')  return { bg:'#fee2e2', bd:'#ef4444', tx:'#991b1b' };
      if (r.Status === 'Visited') return { bg:'#dcfce7', bd:'#16a34a', tx:'#166534' };
      const t = r.VisitType || '';
      if (t.indexOf('تحاليل') !== -1 || t.indexOf('تحليل') !== -1) return { bg:'#dbeafe', bd:'#2563eb', tx:'#1e40af' };
      if (t.indexOf('مراجعة') !== -1)                              return { bg:'#fef9c3', bd:'#f59e0b', tx:'#92400e' };
      if (t.indexOf('كشف') !== -1 || t.indexOf('جديد') !== -1)     return { bg:'#ede9fe', bd:'#7c3aed', tx:'#5b21b6' };
      return { bg:'#f1f5f9', bd:'#94a3b8', tx:'#475569' };
    }
    window.setScheduleView = function(v) {
      scheduleView = v;
      document.getElementById('schedDayBtn').classList.toggle('active', v === 'day');
      document.getElementById('schedWeekBtn').classList.toggle('active', v === 'week');
      renderScheduleGrid();
    };
    window.schedNav = function(dir) {
      const step = scheduleView === 'week' ? 7 : 1;
      schedRefDate.setDate(schedRefDate.getDate() + dir * step);
      renderScheduleGrid();
    };
    window.schedToday = function() {
      schedRefDate = new Date(today); selectedDayStr = todayStr;
      renderScheduleGrid(); renderCalendar();
    };
    window.schedPickDay = function(ds) { selectDay(ds); };
    // قراءة فقط: النقر على البطاقة يفتح التفاصيل فقط (لا تعديل/حجز)
    window.schedCardClick = function(id) { openAppointmentDetailsModal(id); };

    function renderScheduleGrid() {
      const host = document.getElementById('scheduleGrid'); if (!host) return;
      let days = [];
      if (scheduleView === 'week') {
        const start = weekStartSun(schedRefDate);
        for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(d.getDate() + i); d.setHours(0,0,0,0); days.push(d); }
      } else { const d = new Date(schedRefDate); d.setHours(0,0,0,0); days = [d]; }
      const lbl = document.getElementById('schedRangeLabel');
      if (lbl) lbl.textContent = schedFmtRange(days);
      const visDays = days;
      const totalH = SCHED_END_HOUR - SCHED_START_HOUR;
      const bodyH  = totalH * SCHED_HOUR_PX;
      const nCols  = visDays.length;
      const colMin = (scheduleView === 'week') ? 88 : 0;
      const colsTemplate = '56px repeat(' + nCols + ',minmax(' + colMin + 'px,1fr))';
      const nowMins = (new Date()).getHours() * 60 + (new Date()).getMinutes();

      let head = '<div class="sched-head-row" style="display:grid;grid-template-columns:' + colsTemplate + ';">';
      head += '<div class="sched-head-cell" style="font-size:.52rem;letter-spacing:1px;color:var(--text-muted);display:flex;align-items:flex-end;justify-content:center;padding-bottom:8px;font-family:var(--font-num);">GMT+3</div>';
      visDays.forEach(function(d) {
        const ds = toLocalISODate(d);
        const isToday = d.getTime() === today.getTime();
        const numCls  = isToday ? 'sched-head-num today' : 'sched-head-num';
        const cellCls = isToday ? 'sched-head-cell clickable is-today' : 'sched-head-cell clickable';
        head += '<div class="' + cellCls + '" onclick="schedPickDay(\'' + ds + '\')">'
              + '<div class="sched-head-name">' + SCHED_EN_DAYS[d.getDay()] + '</div>'
              + '<div class="' + numCls + '">' + d.getDate() + '</div></div>';
      });
      head += '</div>';

      let body = '<div style="display:grid;grid-template-columns:' + colsTemplate + ';padding:11px 0;">';
      let gutter = '<div style="position:relative;height:' + bodyH + 'px;">';
      for (let h = SCHED_START_HOUR; h <= SCHED_END_HOUR; h++) {
        const h24 = h % 24, ap = h24 < 12 ? 'AM' : 'PM';
        let hh = h24 % 12; if (hh === 0) hh = 12;
        gutter += '<div class="sched-gutter-lbl" style="top:' + ((h - SCHED_START_HOUR) * SCHED_HOUR_PX) + 'px;">' + hh + '<span class="sched-mer">' + ap + '</span></div>';
      }
      gutter += '</div>';
      body += gutter;
      visDays.forEach(function(d) {
        const ds = toLocalISODate(d);
        const closed = isDayClosed(ds);
        const recs = (allRecords || []).filter(function(r) {
          return (r.Status === 'Accepted' || r.Status === 'InProgress' || r.Status === 'Pending' || r.Status === 'Visited' || r.Status === 'NoShow')
                 && normalizeDate(r.Date) === ds;
        });
        const groups = {};
        recs.forEach(function(r) { const m = slotMinutes(slotTimeOf(r)); (groups[m] = groups[m] || []).push(r); });
        let cells = '';
        Object.keys(groups).forEach(function(mk) {
          const list = groups[mk]; const m = parseInt(mk, 10);
          const top = (m - SCHED_START_HOUR * 60) / 60 * SCHED_HOUR_PX;
          if (top < 0 || top > bodyH) return;
          const cardH = Math.max(SCHED_HOUR_PX * 0.5 - 3, 24);
          list.forEach(function(r, i) {
            const w = 100 / list.length, left = i * w;
            const c = schedStatusColor(r);
            cells += '<div class="sched-appt" style="top:' + top + 'px;height:' + cardH + 'px;left:calc(' + left + '% + 2px);width:calc(' + w + '% - 4px);background:' + c.bg + ';border-color:' + c.bd + ';color:' + c.tx + ';" onclick="schedCardClick(\'' + r.id + '\')" oncontextmenu="event.preventDefault();openChartFromAppt(\'' + r.id + '\');return false;" title="كليك يمين: فتح إضبارة المريض">'
                  + '<div class="sched-appt-name">' + escapeHtml(r.PatientName || '') + '</div>'
                  + '<div class="sched-appt-time">' + slotLabelOf(r) + '</div></div>';
          });
        });
        let nowLine = '';
        const isTodayCol = d.getTime() === today.getTime();
        if (isTodayCol && nowMins >= SCHED_START_HOUR * 60 && nowMins <= SCHED_END_HOUR * 60) {
          nowLine = '<div class="sched-now-line" style="top:' + ((nowMins - SCHED_START_HOUR * 60) / 60 * SCHED_HOUR_PX) + 'px;"></div>';
        }
        const halfPx = SCHED_HOUR_PX / 2;
        const hourGrad = 'repeating-linear-gradient(180deg,var(--grid-line) 0,var(--grid-line) 1px,transparent 1px,transparent ' + SCHED_HOUR_PX + 'px)';
        const halfGrad = 'repeating-linear-gradient(180deg,transparent 0,transparent ' + (halfPx - 1) + 'px,var(--grid-line-soft) ' + (halfPx - 1) + 'px,var(--grid-line-soft) ' + halfPx + 'px,transparent ' + halfPx + 'px,transparent ' + SCHED_HOUR_PX + 'px)';
        let bg = hourGrad + ',' + halfGrad;
        if (closed) bg += ',repeating-linear-gradient(45deg,rgba(239,68,68,.09),rgba(239,68,68,.09) 7px,transparent 7px,transparent 14px)';
        const colCls = isTodayCol ? 'sched-daycol today-col' : 'sched-daycol';
        body += '<div class="' + colCls + '" data-ds="' + ds + '" style="height:' + bodyH + 'px;background-image:' + bg + ';">' + cells + nowLine + '</div>';
      });
      body += '</div>';
      host.innerHTML = head + body;
    }
    
    window.goToToday = function() {
      currentDate = new Date(today);
      const todayStr = toLocalISODate(today);
      selectedDayStr = todayStr;
      setActiveSection('calendar');
      renderCalendar();
      renderAgendaForDay(todayStr);
    };
    
    window.showDayDetails = function() {
      if (!selectedDayStr) return;
      const dateStr = selectedDayStr;
      const normDate = (d) => (d||'').toString().trim().substring(0,10);
      
      // جلب جميع المواعيد الفعالة (مقبولة، تمت الزيارة، أو لم يحضر)
      const activeRecords = allRecords.filter(r => 
        ['Accepted', 'Visited', 'NoShow'].includes(r.Status) && normDate(r.Date) === dateStr
      );
      
      // جلب المواعيد الملغاة أو المرفوضة
      const cancelled = allRecords.filter(r => 
        (r.Status === 'Cancelled' || r.Status === 'Rejected') && normDate(r.Date) === dateStr
      );
      
      const total = activeRecords.length + cancelled.length;
      const morning = activeRecords.filter(r => (r.Slot||'Morning') === 'Morning').length;
      const evening = activeRecords.filter(r => (r.Slot||'Evening') === 'Evening').length;
      const cancelledCount = cancelled.length;

      document.getElementById('dayDetailsTitle').textContent = `تفاصيل ${formatDateAr(dateStr)}`;
      document.getElementById('dayDetailsContent').innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div style="background:var(--primary-light);border-radius:var(--radius-sm);padding:14px;text-align:center;">
            <p style="font-size:.82rem;color:var(--text-muted);">إجمالي المواعيد</p>
            <p style="font-size:2rem;font-weight:800;font-family:'DM Mono',monospace;">${total}</p>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div style="background:var(--amber-light);border-radius:var(--radius-sm);padding:12px;text-align:center;">
              <p style="font-size:.78rem;color:var(--text-muted);">صباحاً</p>
              <p style="font-size:1.6rem;font-weight:800;font-family:'DM Mono',monospace;">${morning}</p>
            </div>
            <div style="background:#eff6ff;border-radius:var(--radius-sm);padding:12px;text-align:center;">
              <p style="font-size:.78rem;color:var(--text-muted);">مساءً</p>
              <p style="font-size:1.6rem;font-weight:800;font-family:'DM Mono',monospace;">${evening}</p>
            </div>
          </div>
          <div style="background:var(--red-light);border-radius:var(--radius-sm);padding:12px;text-align:center;">
            <p style="font-size:.78rem;color:var(--text-muted);">الملغاة / المرفوضة</p>
            <p style="font-size:1.6rem;font-weight:800;color:var(--red);font-family:'DM Mono',monospace;">${cancelledCount}</p>
          </div>
        </div>`;
      document.getElementById('dayDetailsModal').classList.remove('hidden');
    };
    window.closeDayDetailsModal = function() { document.getElementById('dayDetailsModal').classList.add('hidden'); };
    function renderAgendaForDay(dateStr) {
      renderCalMobileAgenda(dateStr); // مواعيد اليوم على الموبايل
      const isPast = parseLocalISODate(dateStr) < today;
      document.getElementById('agendaTitle').textContent = `${daysAr[parseLocalISODate(dateStr).getDay()]} — ${formatDateAr(dateStr)}`;

      // إحصائيات اليوم المختار (تتبع الروزنامة): مواعيد اليوم / متبقية / زاروا / لم يحضروا
      (function() {
        const dayRecs = (allRecords || []).filter(r => r.Date === dateStr);
        const acc = dayRecs.filter(r => r.Status === 'Accepted').length;
        const vis = dayRecs.filter(r => r.Status === 'Visited').length;
        const abs = dayRecs.filter(r => r.Status === 'NoShow').length;
        const setS = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        setS('calStatTotal', acc + vis + abs);
        setS('calStatRem',   acc);
        setS('calStatVis',   vis);
        setS('calStatAbs',   abs);
      })();

      const emptyMsg = (slot) => `<div style="text-align:center; padding:16px 0; color:var(--text-muted); font-size:.85rem; font-weight:500;">لا توجد مواعيد ${slot}</div>`;

      if (isPast) {
        // الأيام السابقة: عرض جميع الحالات (حضر، لم يحضر، ملغاة)
        const accepted   = allRecords.filter(r => r.Status === 'Accepted'  && r.Date === dateStr);
        const visited    = allRecords.filter(r => r.Status === 'Visited'   && r.Date === dateStr);
        const noShow     = allRecords.filter(r => r.Status === 'NoShow'    && r.Date === dateStr);
        const cancelled  = allRecords.filter(r => (r.Status === 'Cancelled' || r.Status === 'Rejected') && r.Date === dateStr);

        const allDayRecords = [...accepted, ...visited, ...noShow, ...cancelled];
        const morning = allDayRecords.filter(r => (r.Slot || 'Morning') === 'Morning');
        const evening = allDayRecords.filter(r =>  r.Slot === 'Evening');

        const totalShown = visited.length + accepted.length;
        const summary = `زيارات: ${totalShown}${noShow.length ? ' · لم يحضر: ' + noShow.length : ''}${cancelled.length ? ' · ملغاة: ' + cancelled.length : ''}`;
        document.getElementById('agendaCount').textContent = summary;
        document.getElementById('agendaMorningCount').textContent = morning.length;
        document.getElementById('agendaEveningCount').textContent = evening.length;

        const pastAgendaCard = (r) => {
          let badgeBg, badgeColor, badgeBorder, badgeIcon, badgeText;
          if (r.Status === 'Visited') {
            badgeBg = '#dcfce7'; badgeColor = '#16a34a'; badgeBorder = '#86efac';
            badgeIcon = 'fa-check-circle'; badgeText = 'تمت الزيارة';
          } else if (r.Status === 'NoShow') {
            badgeBg = '#fee2e2'; badgeColor = '#dc2626'; badgeBorder = '#fca5a5';
            badgeIcon = 'fa-user-times'; badgeText = 'لم يحضر';
          } else if (r.Status === 'Cancelled' || r.Status === 'Rejected') {
            badgeBg = '#fef3c7'; badgeColor = '#d97706'; badgeBorder = '#fde68a';
            badgeIcon = 'fa-ban'; badgeText = 'تم الإلغاء';
          } else {
            // Accepted but past (لم يُغلق اليوم) — نعرضه كموعد مؤكد قديم
            badgeBg = 'var(--primary-light)'; badgeColor = 'var(--primary)'; badgeBorder = 'var(--border-strong)';
            badgeIcon = 'fa-calendar-check'; badgeText = 'مؤكد';
          }
          return `<div style="background:var(--primary-faint);border:1.5px solid ${badgeBorder};border-radius:12px;padding:12px;margin-bottom:8px;opacity:.88;">
            <div class="flex justify-between items-start">
              <div>
                <p class="font-bold" style="color:var(--text-primary)">${r.PatientName}</p>
                <p class="text-xs mt-1" style="color:var(--primary)">${r.Phone}</p>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                <span style="font-size:.72rem;padding:3px 10px;border-radius:20px;font-weight:700;background:${badgeBg};color:${badgeColor};border:1px solid ${badgeBorder};">
                  <i class="fas ${badgeIcon}" style="margin-left:3px;font-size:.65rem;"></i>${badgeText}
                </span>
                <span style="font-size:.7rem;color:var(--text-muted);">${r.VisitType || ''} · ${r.Slot === 'Evening' ? 'مساءً' : 'صباحاً'}</span>
              </div>
            </div>
          </div>`;
        };

        document.getElementById('agendaMorning').innerHTML = morning.length ? morning.map(pastAgendaCard).join('') : emptyMsg('صباحية');
        document.getElementById('agendaEvening').innerHTML = evening.length ? evening.map(pastAgendaCard).join('') : emptyMsg('مسائية');

      } else {
        // اليوم الحالي أو المستقبل: عرض المواعيد المؤكدة والمكتملة (تمت الزيارة)
        const accepted = allRecords.filter(r => r.Status === 'Accepted' && r.Date === dateStr);
        const visited  = allRecords.filter(r => r.Status === 'Visited'  && r.Date === dateStr);
        const noShow   = allRecords.filter(r => r.Status === 'NoShow'   && r.Date === dateStr);
        
        const activeRecords = [...accepted, ...visited, ...noShow];
        const morning = activeRecords.filter(r => (r.Slot || 'Morning') === 'Morning');
        const evening = activeRecords.filter(r =>  r.Slot === 'Evening');
        
        document.getElementById('agendaCount').textContent = `عدد المواعيد: ${activeRecords.length}`;
        document.getElementById('agendaMorningCount').textContent = morning.length;
        document.getElementById('agendaEveningCount').textContent = evening.length;
        
        const currentAgendaCard = (r) => {
          if (r.Status === 'Visited' || r.Status === 'NoShow') {
            // إذا كانت الزيارة تمت أو لم يحضر، نستخدم نفس شكل البطاقة القديمة (Past Card) لتمييزها
            let badgeBg, badgeColor, badgeBorder, badgeIcon, badgeText;
            if (r.Status === 'Visited') {
              badgeBg = '#dcfce7'; badgeColor = '#16a34a'; badgeBorder = '#86efac';
              badgeIcon = 'fa-check-circle'; badgeText = 'تمت الزيارة';
            } else {
              badgeBg = '#fee2e2'; badgeColor = '#dc2626'; badgeBorder = '#fca5a5';
              badgeIcon = 'fa-user-times'; badgeText = 'لم يحضر';
            }
            return `<div style="background:var(--primary-faint);border:1.5px solid ${badgeBorder};border-radius:12px;padding:12px;margin-bottom:8px;opacity:.88;">
              <div class="flex justify-between items-start">
                <div>
                  <p class="font-bold" style="color:var(--text-primary)">${r.PatientName}</p>
                  <p class="text-xs mt-1" style="color:var(--primary)">${r.Phone}</p>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                  <span style="font-size:.72rem;padding:3px 10px;border-radius:20px;font-weight:700;background:${badgeBg};color:${badgeColor};border:1px solid ${badgeBorder};">
                    <i class="fas ${badgeIcon}" style="margin-left:3px;font-size:.65rem;"></i>${badgeText}
                  </span>
                  <span style="font-size:.7rem;color:var(--text-muted);">${r.VisitType || ''} · ${r.Slot === 'Evening' ? 'مساءً' : 'صباحاً'}</span>
                </div>
              </div>
            </div>`;
          }
          // إذا كان الموعد مؤكد فقط، نستخدم الشكل العادي
          return agendaCardHTML(r);
        };

        document.getElementById('agendaMorning').innerHTML = morning.length ? morning.map(currentAgendaCard).join('') : emptyMsg('صباحية');
        document.getElementById('agendaEvening').innerHTML = evening.length ? evening.map(currentAgendaCard).join('') : emptyMsg('مسائية');
      }
    }

    function agendaCardHTML(record) {
      return `<div style="background:var(--primary-faint);border:1.5px solid var(--border);border-radius:12px;padding:12px;margin-bottom:8px;">
        <div class="flex justify-between items-start">
          <div><p class="font-bold" style="color:var(--text-primary)">${record.PatientName}</p><p class="text-xs mt-1" style="color:var(--primary)">${record.Phone}</p></div>
          <div class="flex gap-1">
            <a href="tel:${normalizePhone(record.Phone)}" style="width:36px;height:36px;border-radius:9px;background:#2563eb;color:white;display:flex;align-items:center;justify-content:center;font-size:.8rem;flex-shrink:0;"><i class="fas fa-phone"></i></a>
            <button class="appt-card-btn appt-card-btn--details" onclick="openAppointmentDetailsModal('${record.id}')"><i class="fas fa-eye"></i></button>
          </div>
        </div>
        <div class="mt-2 text-xs" style="color:var(--text-muted)">${record.VisitType} · ${record.Slot==='Morning'?'صباحاً':'مساءً'}</div>
      </div>`;
    }

    // ==================== مودال تفاصيل الموعد (معدل) ====================
    window.openAppointmentDetailsModal = function(id) {
      const record = allRecords.find(r => r.id === id);
      if (!record) return;

      const phone = record.Phone || record.phone || '-';
      const slotAr = slotTimeOf(record);
      const dateStr = record.Date ? formatDateAr(record.Date) : '-';

      // Header
      document.getElementById('modalAgendaTitle').textContent = dateStr;

      // Badges
      document.getElementById('slotBadge').textContent = slotAr;
      document.getElementById('visitTypeBadge').textContent = record.VisitType || '-';

      // Info grid
      document.getElementById('appDetailsName').textContent = record.PatientName || '-';
      document.getElementById('appDetailsBirthDate').textContent = record.BirthDate ? formatDateAr(record.BirthDate) : '-';
      document.getElementById('appDetailsAddress').textContent = record.Address || '-';
      document.getElementById('appDetailsPhone').textContent = phone;
      const age = record.BirthDate ? calculateAge(record.BirthDate) : '-';
      document.getElementById('appDetailsAge').textContent = age !== '-' ? age + ' سنة' : '-';

      // WhatsApp button
      document.getElementById('appDetailsWhatsappBtn').href = phone !== '-' ? `https://wa.me/${normalizePhone(phone)}` : '#';

      // Hidden fields
      document.getElementById('appDetailsVisitType').textContent = record.VisitType || '-';
      document.getElementById('appDetailsSlot').textContent = slotAr;
      document.getElementById('appDetailsDate').textContent = dateStr;
      document.getElementById('appDetailsPhoneInfo').textContent = phone;

      document.getElementById('appointmentDetailsModal').classList.remove('hidden');
    };

    window.closeAppointmentDetailsModal = function() { document.getElementById('appointmentDetailsModal').classList.add('hidden'); };

    // ==================== دفتر المرضى ====================
    var _pbTimer = null;
    function renderPatientBook() {
      const grid = document.getElementById('patientsGrid');
      const search = document.getElementById('patientBookSearch').value.trim();
      if (search) {
        // [أقصى توفير] بحث من الخادم ببادئة الاسم (بدل البحث المحلي)
        grid.innerHTML = '<div style="text-align:center;padding:32px 0;color:var(--text-muted)"><i class="fas fa-circle-notch fa-spin"></i> جارٍ البحث في الخادم...</div>';
        clearTimeout(_pbTimer);
        _pbTimer = setTimeout(function() {
          window._fb.getDocs(window._fb.query(window._fb.col('patients'), window._fb.orderBy('name'),
              window._fb.where('name','>=',search), window._fb.where('name','<=', search+''), window._fb.limit(25)))
            .then(function(snap) {
              var list = []; snap.forEach(function(d){ var o = Object.assign({id:d.id}, d.data()); allPatients[d.id]=o; list.push(o); });
              _pbRenderRows(list);
            }).catch(function(e){ console.error(e); grid.innerHTML = '<div style="text-align:center;padding:32px 0;color:#dc2626">تعذّر البحث</div>'; });
        }, 350);
        return;
      }
      _pbRenderRows(Object.values(allPatients));
    }
    function _pbRenderRows(patients) {
      const grid = document.getElementById('patientsGrid');
      if (!patients.length) { grid.innerHTML = '<div style="text-align:center;padding:32px 0;color:var(--text-muted)">لا يوجد مرضى</div>'; return; }
      grid.innerHTML = patients.map(p => {
        const phone = normalizePhone(p.phone);
        return `<div class="patient-row" title="كليك يمين: فتح إضبارة المريض" oncontextmenu="event.preventDefault();openPatientDetailsModal('${p.id}');return false;">
          <div class="pr-name">
            <div class="pr-name-t">${escapeHtml(p.name)}</div>
            <div class="pr-phone-sub" dir="ltr">${escapeHtml(p.phone||'')}</div>
          </div>
          <div class="pr-visits"><i class="fas fa-calendar-check" style="font-size:.72rem;"></i> ${p.totalVisits||0} زيارة</div>
          <div class="pr-actions">
            <button class="pr-btn primary"   title="إضافة زيارة" onclick="addNewVisit('${p.id}')"><i class="fas fa-plus"></i></button>
            <button class="pr-btn secondary" title="تفاصيل / الإضبارة" onclick="openPatientDetailsModal('${p.id}')"><i class="fas fa-eye"></i></button>
            <a class="pr-btn whatsapp" href="https://wa.me/${phone}" target="_blank" title="واتساب"><i class="fab fa-whatsapp"></i></a>
            <a class="pr-btn call" href="tel:${phone}" title="اتصال"><i class="fas fa-phone"></i></a>
          </div>
        </div>`;
      }).join('');
    }

    window.openPatientDetailsModal = function(patientId) {
      const p = allPatients[patientId];
      if (!p) return;
      currentPatientIdForVisit = patientId;
      document.getElementById('modalPatientName').textContent = p.name;
      document.getElementById('modalPatientPhone').textContent = p.phone;
      document.getElementById('modalWhatsappBtn').href = `https://wa.me/${normalizePhone(p.phone)}`;
      document.getElementById('modalCallBtn').href = `tel:${normalizePhone(p.phone)}`;
      document.getElementById('modalPatientBirthDate').textContent = p.birthDate ? formatDateAr(p.birthDate) : '-';
      const age = p.birthDate ? calculateAge(p.birthDate) : '-';
      document.getElementById('modalPatientAge').textContent = age !== '-' ? age+' سنة' : '-';
      document.getElementById('modalPatientTotalVisits').textContent = p.totalVisits||0;
      document.getElementById('modalPatientAddress').textContent = p.address||'-';
      const visits = p.appointments || [];
      visits.sort((a,b) => (b.date||'').localeCompare(a.date||''));
      let html = '';
      visits.forEach((v, idx) => {
        const hasNote = v.note && v.note.trim().length > 0;
        const hasContent = hasNote;
        const prescription = v.prescription || '';
        html += `<tr>
          <td class="py-1">${idx+1}</td>
          <td>${formatDateAr(v.date)}</td>
          <td>${v.visitType||'-'}</td>
          <td>${v.slot==='Morning'?'صباحاً':'مساءً'}</td>
          <td>${hasContent || prescription ? `<button class="view-note-btn"
            data-note="${escapeHtml(v.note||'')}"
            data-prescription="${escapeHtml(prescription)}"
            data-date="${formatDateAr(v.date)}"
            data-type="${v.visitType}"
            data-updated-at="${v.noteUpdatedAt || ''}"
            title="عرض الملاحظة" style="font-size:.75rem;color:var(--primary);text-decoration:underline;cursor:pointer;background:none;border:none;padding:0;font-family:inherit">
            <i class="fas fa-eye"></i> عرض</button>` : '<span style="color:var(--text-muted);font-size:.75rem">-</span>'}</td>
          <td><button class="edit-note-btn" data-patient-id="${patientId}" data-visit-idx="${idx}" title="تعديل الملاحظة" style="font-size:.75rem;color:var(--primary);text-decoration:underline;cursor:pointer;background:none;border:none;padding:0;font-family:inherit"><i class="fas fa-pen"></i></button></td>
        </tr>`;
      });
      if (!visits.length) html = '<tr><td colspan="6" style="text-align:center;padding:16px 0;color:var(--text-muted)">لا توجد زيارات</td></tr>';
      document.getElementById('modalVisitsTableBody').innerHTML = html;
      
      // إضافة event listeners للأزرار الجديدة
      document.querySelectorAll('.view-note-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          const visitData = {
            note: this.dataset.note,
            prescription: this.dataset.prescription,
            dateFormatted: this.dataset.date,
            visitType: this.dataset.type,
            noteUpdatedAt: this.dataset.updatedAt ? parseInt(this.dataset.updatedAt, 10) : 0
          };
          showNote(visitData);
        });
      });
      
      document.querySelectorAll('.edit-note-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          const patientId = this.dataset.patientId;
          const visitIdx = parseInt(this.dataset.visitIdx);
          openAddNoteModal(patientId, visitIdx);
        });
      });
      
      document.getElementById('patientDetailsModal').classList.remove('hidden');
      var _rail = document.getElementById('mainRail'); if (_rail) _rail.style.display = 'none';   // إخفاء السايدبار أثناء فتح الإضبارة
    };

    window.closePatientDetailsModal = () => { document.getElementById('patientDetailsModal').classList.add('hidden'); var _rail = document.getElementById('mainRail'); if (_rail) _rail.style.display = ''; };   // إعادة إظهار السايدبار
    document.getElementById('closePatientDetailsModalBtn')?.addEventListener('click', closePatientDetailsModal);

    window.showNote = function(visitData) {
      document.getElementById('noteContent').textContent = visitData.note || 'لا توجد ملاحظة';
      document.getElementById('noteVisitInfo').textContent = `تاريخ: ${visitData.dateFormatted} | نوع: ${visitData.visitType}`;

      // عرض "آخر تعديل"
      const updatedAtEl = document.getElementById('noteUpdatedAt');
      const updatedAtVal = document.getElementById('noteUpdatedAtValue');
      if (visitData.noteUpdatedAt) {
        updatedAtEl.style.display = 'flex';
        updatedAtVal.textContent = formatRelativeTime(visitData.noteUpdatedAt);
      } else {
        updatedAtEl.style.display = 'none';
      }
      
      // عرض الوصفة الطبية
      const prescriptionSection = document.getElementById('prescriptionSection');
      const prescriptionContent = document.getElementById('prescriptionContent');
      if (visitData.prescription && visitData.prescription.trim()) {
        prescriptionSection.style.display = 'block';
        prescriptionContent.textContent = visitData.prescription;
      } else {
        prescriptionSection.style.display = 'none';
      }

      // تهيئة حقل واتساب (دمج الملاحظة والوصفة)
      let whatsappMsg = '';
      if (visitData.prescription && visitData.prescription.trim()) whatsappMsg += `*الوصفة الطبية:*\n${visitData.prescription}\n\n`;
      if (visitData.note && visitData.note.trim()) whatsappMsg += `*الملاحظات:*\n${visitData.note}`;
      document.getElementById('whatsappMsgInput').value = whatsappMsg.trim();

      // إعداد زر الإرسال
      const sendBtn = document.getElementById('sendToWhatsappBtn');
      sendBtn.onclick = () => {
        const msg = document.getElementById('whatsappMsgInput').value;
        const phone = normalizePhone(document.getElementById('modalPatientPhone').textContent);
        const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
        window.open(whatsappUrl, '_blank');
      };

      const noteModal = document.getElementById('noteModal');
      noteModal.classList.remove('modal-hidden');
      noteModal.classList.add('modal-visible');
    };

    window.closeNoteModal = function() {
      const noteModal = document.getElementById('noteModal');
      noteModal.classList.remove('modal-visible');
      noteModal.classList.add('modal-hidden');
    };

    // ==================== ملاحظات ====================

    window.openAddNoteModal = function(patientId, visitIndex) {
      document.getElementById('notePatientId').value = patientId;
      document.getElementById('noteVisitIndex').value = visitIndex;
      const p = allPatients[patientId];
      const visit = p && p.appointments && p.appointments[visitIndex];
      document.getElementById('noteText').value = (visit && visit.note) ? visit.note : '';
      document.getElementById('prescriptionText').value = (visit && visit.prescription) ? visit.prescription : '';

      const addNoteModal = document.getElementById('addNoteModal');
      addNoteModal.classList.remove('modal-hidden');
      addNoteModal.classList.add('modal-visible');
    };

    window.closeAddNoteModal = function() {
      const addNoteModal = document.getElementById('addNoteModal');
      addNoteModal.classList.remove('modal-visible');
      addNoteModal.classList.add('modal-hidden');
      document.body.classList.remove('editor-open');
    };

    function handleSaveNote(sendToWhatsapp = false) {
      const patientId = document.getElementById('notePatientId').value;
      const visitIndex = parseInt(document.getElementById('noteVisitIndex').value);
      const note = document.getElementById('noteText').value.trim();
      const prescription = document.getElementById('prescriptionText').value.trim();
      
      if (patientId && allPatients[patientId] && allPatients[patientId].appointments && allPatients[patientId].appointments[visitIndex]) {
        const p = allPatients[patientId];
        p.appointments[visitIndex].note = note;
        p.appointments[visitIndex].prescription = prescription;
        p.appointments[visitIndex].noteUpdatedAt = Date.now();
        
        // حفظ في Firestore
        window._fb.setDoc(window._fb.docRef('patients', patientId), p, { merge: true })
          .then(function() { showToast('تم حفظ البيانات بنجاح', 'success'); })
          .catch(function(e) { showToast('فشل الحفظ', 'error'); console.error(e); });
        
        if (sendToWhatsapp) {
          const phone = normalizePhone(p.phone);
          let fullMsg = '';
          if (prescription) fullMsg += `*الوصفة الطبية:*\n${prescription}\n\n`;
          if (note) fullMsg += `*الملاحظات:*\n${note}`;

          const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(fullMsg.trim())}`;
          window.open(whatsappUrl, '_blank');
        }
        
        closeAddNoteModal();
        openPatientDetailsModal(patientId);
      }
    }

    document.getElementById('saveOnlyBtn')?.addEventListener('click', () => handleSaveNote(false));
    document.getElementById('saveAndWhatsappBtn')?.addEventListener('click', () => handleSaveNote(true));

    // ==================== التنقل بين الأقسام ====================
    var _histNav = false;
    function setActiveSection(section) {
      currentSection = section;
      if (!_histNav) history.pushState({ section }, '', '#' + section);
      document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
      document.getElementById(`sidebar${section.charAt(0).toUpperCase()+section.slice(1)}`)?.classList.add('active');
      document.querySelectorAll('.bottom-nav-item').forEach(el => el.classList.remove('active'));
      document.getElementById(`mobile${section.charAt(0).toUpperCase()+section.slice(1)}`)?.classList.add('active');
      document.querySelectorAll('section').forEach(el => el.classList.add('hidden'));
      if (section === 'home') {
        document.getElementById('homeSection').classList.remove('hidden');
        window._dayChartAnimate = true; // شغّل تأثير تصاعد الخط عند فتح الرئيسية
        renderHomeSection();
      }
      else if (section === 'calendar') { document.getElementById('calendarSection').classList.remove('hidden'); if (typeof setScheduleView === 'function') setScheduleView(scheduleView); }
      else if (section === 'patients') { 
        document.getElementById('patientBookSection').classList.remove('hidden'); 
        renderPatientBook(); 
      }
      else if (section === 'stats') { 
        document.getElementById('statsSection').classList.remove('hidden'); 
        document.querySelectorAll('#statsSection .stat-card').forEach(card => {
          card.classList.add('fade-in');
          setTimeout(() => card.classList.remove('fade-in'), 500);
        });
        updateStats(true); 
      }
    }

    // ==================== تحديث تلقائي كل 5 ثوان ====================
    function autoRefresh() {
      // onSnapshot يُحدّث البيانات تلقائياً — نكتفي برسم الواجهة فقط
      if (currentSection === 'stats') updateStats(false);
      if (currentSection === 'patients') renderPatientBook();
      if (currentSection === 'calendar') { renderCalendar(); if (selectedDayStr) renderAgendaForDay(selectedDayStr); if (typeof renderScheduleGrid === 'function') renderScheduleGrid(); }
      if (currentSection === 'home') renderHomeSection();
    }

    // ربط الأحداث
    document.getElementById('sidebarHome')?.addEventListener('click', () => setActiveSection('home'));
    document.getElementById('mobileHome')?.addEventListener('click', () => setActiveSection('home'));
    document.getElementById('sidebarCalendar')?.addEventListener('click', () => setActiveSection('calendar'));
    document.getElementById('sidebarPatients')?.addEventListener('click', () => setActiveSection('patients'));
    document.getElementById('sidebarStats')?.addEventListener('click', () => setActiveSection('stats'));
    document.getElementById('mobileCalendar')?.addEventListener('click', () => setActiveSection('calendar'));
    document.getElementById('mobilePatients')?.addEventListener('click', () => setActiveSection('patients'));
    document.getElementById('mobileStats')?.addEventListener('click', () => setActiveSection('stats'));

    document.getElementById('prevMonthBtn')?.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth()-1); renderCalendar(); });
    document.getElementById('nextMonthBtn')?.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth()+1); renderCalendar(); });
    document.getElementById('showDayDetailsBtn')?.addEventListener('click', showDayDetails);

    // ── Manual Appointment Overlay (Doctor) ──
    var _docManualData = {};
    var _docOCalDate = new Date(); _docOCalDate.setHours(0,0,0,0);

    // ── ساعات الدوام (مصدر موحّد مع تطبيق الحجز والممرضة: config/booking → slots) ──
    var DOC_DEFAULT_SLOTS = ["08:00","08:30","09:00","09:30","10:00","10:30","11:00","11:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00"];
    window._docBookingSlots = null;
    // قراءة واحدة فقط عند فتح النموذج (توفيراً للـ reads) — تُخزَّن مؤقتاً ولا تتكرر
    function docEnsureSlotsLoaded(cb) {
      if (Array.isArray(window._docBookingSlots)) { if (cb) cb(); return; }
      if (!window._fbReady) { window._docBookingSlots = DOC_DEFAULT_SLOTS.slice(); if (cb) cb(); return; }
      window._fb.getDoc('config', 'booking').then(function(snap) {
        var data = snap.exists() ? (snap.data() || {}) : {};
        window._docBookingSlots = (Array.isArray(data.slots) && data.slots.length) ? data.slots.slice() : DOC_DEFAULT_SLOTS.slice();
      }).catch(function() {
        window._docBookingSlots = DOC_DEFAULT_SLOTS.slice();
      }).finally(function() { if (cb) cb(); });
    }
    function docSlots() { return Array.isArray(window._docBookingSlots) && window._docBookingSlots.length ? window._docBookingSlots : DOC_DEFAULT_SLOTS; }

    // مُعرّف قفل الساعة (موحّد مع الممرضة وتطبيق الحجز: تاريخ مطبَّع + ساعة بلا نقطتين)
    function docSlotLockId(dateStr, time) {
      var s = (dateStr + '').trim().substring(0, 10);
      var p = s.split('-').map(Number);
      if (p[0] && p[1] && p[2]) s = p[0] + '-' + String(p[1]).padStart(2, '0') + '-' + String(p[2]).padStart(2, '0');
      return s + '_' + String(time).replace(':', '');
    }
    // الساعات المحجوزة ليوم معيّن — تُحسب من السجلات الموجودة في الذاكرة (allRecords) بلا أي reads إضافية
    function docTakenHoursForDate(dateStr) {
      var taken = {};
      (allRecords || []).forEach(function(r) {
        if (!r) return;
        if (r.Status === 'Cancelled' || r.Status === 'NoShow') return;
        if (normalizeDate(r.Date) !== dateStr) return;
        var t = slotTimeOf(r); // يحوّل القيم القديمة (Morning/Evening) إلى وقت أيضاً
        if (t) taken[t] = true;
      });
      // دمج أقفال الحجز إن كانت محمَّلة (مصدر تطبيق المرضى) دون قراءات إضافية
      var bs = window._bookedSlots || {};
      Object.keys(bs).forEach(function(id) {
        if (bs[id] && bs[id].date === dateStr && bs[id].time) taken[bs[id].time] = true;
      });
      return taken;
    }
    // تنسيق الساعة بصيغة 12 ساعة عربية: "09:30" → "9:30 ص"
    function docFmtHour12(t) {
      if (!t || String(t).indexOf(':') < 0) return t || '';
      var p = String(t).split(':'); var h = parseInt(p[0], 10); var m = p[1];
      var ap = h < 12 ? 'ص' : 'م';
      var h12 = h % 12; if (h12 === 0) h12 = 12;
      return h12 + ':' + m + ' ' + ap;
    }

    function openDocManualFormOverlay() {
      var preDate = selectedDayStr || todayStr;
      _docManualData = { patientName:'', phone:'', birthDate:'', address:'', visitType:'', selectedDate: preDate, selectedSlot:'', currentStep:1 };
      // Reset fields
      ['docManualPatientName','docManualPhone','docManualBirthDate','docManualAddress'].forEach(function(id) {
        var el = document.getElementById(id); if (el) el.value = '';
      });
      var vt = document.getElementById('docManualVisitType'); if (vt) vt.value = '';
      document.getElementById('docManualDateInput').value = preDate;
      var bd = document.getElementById('docManualBirthDate');
      if (bd) bd.max = todayStr;
      // Show preselected day badge
      var badge = document.getElementById('docPreselectedDayBadge');
      var lbl   = document.getElementById('docPreselectedDayLabel');
      if (badge && lbl) {
        var dateObj = parseLocalISODate(preDate);
        lbl.textContent = (daysAr ? daysAr[dateObj.getDay()] + ' — ' : '') + formatDateAr(preDate);
        badge.style.display = 'flex';
      }
      // Show slot selector since day is pre-selected
      var closedWarn = document.getElementById('docOClosedDayWarning');
      var slotWrap   = document.getElementById('docOSlotSelectorWrapper');
      var isClosed = typeof isDayClosed === 'function' && isDayClosed(preDate);
      if (closedWarn) closedWarn.classList.toggle('hidden', !isClosed);
      if (slotWrap)   slotWrap.classList.toggle('hidden', isClosed);
      docEnsureSlotsLoaded(function() { docORenderHours(preDate); });
      _docOCalDate = parseLocalISODate(preDate); _docOCalDate.setHours(0,0,0,0);
      docOUpdateSummary();
      docOGoToStep(1);
      docORenderCalendar();
      document.getElementById('docManualFormOverlay').classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    window.closeDocManualFormOverlay = function() {
      document.getElementById('docManualFormOverlay').classList.remove('active');
      document.body.style.overflow = '';
    };

    window.docHandleOverlayClick = function(e) {
      if (e.target.id === 'docManualFormOverlay') closeDocManualFormOverlay();
    };

    function docOGoToStep(step) {
      _docManualData.currentStep = step;
      document.querySelectorAll('#docManualFormPanel .doc-form-step').forEach(function(s) { s.classList.remove('active'); });
      var el = document.getElementById('docOverlayStep' + step); if (el) el.classList.add('active');
      // Update dots
      [1,2,3].forEach(function(n) {
        var dot = document.getElementById('docStep' + n + 'Dot');
        var wrap = document.getElementById('docStep' + n + 'Wrapper');
        var conn1 = document.getElementById('docConnector1');
        var conn2 = document.getElementById('docConnector2');
        if (!dot) return;
        dot.style.background = ''; dot.style.borderColor = ''; dot.style.color = '';
        dot.innerHTML = n;
        if (n < step) {
          dot.style.background = 'var(--green)'; dot.style.borderColor = 'var(--green)'; dot.style.color = 'white';
          dot.innerHTML = '<i class="fas fa-check" style="font-size:.75rem;"></i>';
          if (wrap) { var sp = wrap.querySelector('span'); if(sp) sp.style.color = 'var(--green)'; }
        } else if (n === step) {
          dot.style.background = 'var(--primary)'; dot.style.borderColor = 'var(--primary)'; dot.style.color = 'white';
          if (wrap) { var sp = wrap.querySelector('span'); if(sp) sp.style.color = 'var(--primary)'; }
        } else {
          dot.style.background = 'var(--bg)'; dot.style.borderColor = 'var(--border)'; dot.style.color = 'var(--text-muted)';
          if (wrap) { var sp = wrap.querySelector('span'); if(sp) sp.style.color = 'var(--text-muted)'; }
        }
        if (conn1) conn1.style.background = step > 1 ? 'var(--green)' : 'var(--border)';
        if (conn2) conn2.style.background = step > 2 ? 'var(--green)' : 'var(--border)';
      });
    }

    function docOUpdateSummary() {
      // اقرأ مباشرة من الحقول لضمان التزامن على desktop
      var name      = (document.getElementById('docManualPatientName')?.value.trim()) || _docManualData.patientName || '-';
      var phone     = (document.getElementById('docManualPhone')?.value.trim())       || _docManualData.phone       || '-';
      var visitType = (document.getElementById('docManualVisitType')?.value)          || _docManualData.visitType   || '-';
      var birthDate = (document.getElementById('docManualBirthDate')?.value)          || _docManualData.birthDate;
      var age       = birthDate ? (calculateAge(birthDate) + ' سنة') : '-';
      var date      = _docManualData.selectedDate ? formatDateAr(_docManualData.selectedDate) : '-';
      var slot      = _docManualData.selectedSlot ? docFmtHour12(_docManualData.selectedSlot) : '-';
      var el;
      el = document.getElementById('docOSummaryPatientName'); if (el) el.textContent = name;
      el = document.getElementById('docOSummaryAge');         if (el) el.textContent = age;
      el = document.getElementById('docOConfirmPatientName'); if (el) el.textContent = name;
      el = document.getElementById('docOConfirmPhone');       if (el) el.textContent = phone;
      el = document.getElementById('docOConfirmVisitType');   if (el) el.textContent = visitType;
      el = document.getElementById('docOConfirmDate');        if (el) el.textContent = date;
      el = document.getElementById('docOConfirmSlot');        if (el) el.textContent = slot;
    }

    function docORenderCalendar() {
      var grid = document.getElementById('docOCalGrid'); if (!grid) return;
      grid.innerHTML = '';
      var year = _docOCalDate.getFullYear(), month = _docOCalDate.getMonth();
      var monthEl = document.getElementById('docOCalMonth');
      if (monthEl) monthEl.textContent = (typeof monthsAr !== 'undefined' ? monthsAr[month] : month) + ' ' + year;
      var today2 = new Date(); today2.setHours(0,0,0,0);
      var maxDate = new Date(today2); maxDate.setMonth(maxDate.getMonth() + 3);
      var firstDay = new Date(year, month, 1).getDay();
      var daysInMonth = new Date(year, month+1, 0).getDate();
      var startOffset = (firstDay + 2) % 7;
      for (var i = startOffset-1; i >= 0; i--) {
        var emp = document.createElement('div'); emp.className = 'compact-calendar-day other-month'; grid.appendChild(emp);
      }
      for (var d = 1; d <= daysInMonth; d++) {
        (function(day) {
          var dateObj = new Date(year, month, day); dateObj.setHours(0,0,0,0);
          var dateStr = toLocalISODate(dateObj);
          var isClosed = typeof isDayClosed === 'function' && isDayClosed(dateStr);
          var isFutureTooFar = dateObj > maxDate;
          var isSelected = _docManualData.selectedDate === dateStr;
          var isToday = dateObj.getTime() === today2.getTime();
          var recs = (allRecords || []).filter(function(r) {
            return (r.Status === 'Accepted' || r.Status === 'Pending' || r.Status === 'InProgress') && normalizeDate(r.Date) === dateStr;
          });
          var total = recs.length;
          var el = document.createElement('div');
          el.className = 'compact-calendar-day';
          if (isToday)   el.classList.add('today');
          if (isSelected) el.classList.add('selected');
          if (isClosed)  el.classList.add('closed-day');
          if (isFutureTooFar) { el.classList.add('past-day'); el.style.cursor = 'default'; }
          el.textContent = day;
          if (!isFutureTooFar && total > 0) {
            var dot = document.createElement('div');
            dot.className = 'compact-appointment-dot ' + (total <= 2 ? 'compact-dot-low' : total <= 4 ? 'compact-dot-medium' : 'compact-dot-high');
            el.appendChild(dot);
          }
          if (!isClosed && !isFutureTooFar) {
            el.addEventListener('click', function() { docOSelectDay(dateStr); });
          }
          grid.appendChild(el);
        })(d);
      }
    }

    function docOSelectDay(dateStr) {
      _docManualData.selectedDate = dateStr;
      document.getElementById('docManualDateInput').value = dateStr;
      var isClosed = typeof isDayClosed === 'function' && isDayClosed(dateStr);
      var closedWarn = document.getElementById('docOClosedDayWarning');
      var slotWrap   = document.getElementById('docOSlotSelectorWrapper');
      if (closedWarn) closedWarn.classList.toggle('hidden', !isClosed);
      if (slotWrap)   slotWrap.classList.toggle('hidden', isClosed);
      // الساعات المتاحة تختلف من يوم لآخر — أعد البناء وامسح الاختيار السابق
      _docManualData.selectedSlot = '';
      if (!isClosed) docEnsureSlotsLoaded(function() { docORenderHours(dateStr); });
      // Update badge label
      var lbl = document.getElementById('docPreselectedDayLabel');
      if (lbl) {
        var dateObj = parseLocalISODate(dateStr);
        lbl.textContent = (daysAr ? daysAr[dateObj.getDay()] + ' — ' : '') + formatDateAr(dateStr);
      }
      docOUpdateSummary();
      docORenderCalendar();
    }

    // ── اختيار الوقت: قائمة <select> موحّدة تماماً مع ملف الممرضة ──
    // بناء خيارات <option> لقائمة السلوتات (يُدرج القيمة المختارة حتى لو لم تكن ضمن القائمة)
    function docBuildTimeOptions(selected) {
      var opts = docSlots().slice();
      if (selected && opts.indexOf(selected) === -1) opts = [selected].concat(opts);
      var sel = selected || docSlots()[0];
      return opts.map(function(t) {
        return '<option value="' + t + '"' + (t === sel ? ' selected' : '') + '>' + t + '</option>';
      }).join('');
    }
    // تعبئة عنصر <select> بقائمة السلوتات
    function docFillTimeSelect(selected) {
      var el = document.getElementById('docOSlotSelect');
      if (el) el.innerHTML = docBuildTimeOptions(selected || docSlots()[0]);
    }
    // تعطيل الأوقات المحجوزة في القائمة، وإرجاع أول وقت متاح
    function docMarkTakenOptions(dateStr) {
      var el = document.getElementById('docOSlotSelect'); if (!el) return '';
      var taken = docTakenHoursForDate(dateStr);
      var firstFree = '';
      Array.prototype.forEach.call(el.options, function(o) {
        if (!o.value) return;
        if (taken[o.value]) { o.disabled = true; o.textContent = o.value + ' — محجوز'; }
        else { o.disabled = false; o.textContent = o.value; if (!firstFree) firstFree = o.value; }
      });
      if ((!el.value || taken[el.value]) && firstFree) el.value = firstFree;
      return firstFree;
    }
    // تعبئة قائمة الأوقات لليوم المحدد وضبط الاختيار على أول وقت متاح
    function docORenderHours(dateStr) {
      docFillTimeSelect(_docManualData.selectedSlot || docSlots()[0]);
      docMarkTakenOptions(dateStr);
      var el = document.getElementById('docOSlotSelect');
      if (el) _docManualData.selectedSlot = el.value;
      docOUpdateSummary();
    }

    window.docOSelectSlot = function(slot) {
      _docManualData.selectedSlot = slot;
      var sel = document.getElementById('docOSlotSelect');
      if (sel && sel.value !== slot) sel.value = slot;
      docOUpdateSummary(); // حدّث التأكيد فوراً
    };

    window.docOPrevMonth = function() { _docOCalDate.setMonth(_docOCalDate.getMonth()-1); docORenderCalendar(); };
    window.docONextMonth = function() { _docOCalDate.setMonth(_docOCalDate.getMonth()+1); docORenderCalendar(); };

    // ── Manual Appointment Overlay (Doctor) — Event Bindings ──
    document.addEventListener('DOMContentLoaded', function() {

    // Bind + button
    document.getElementById('addManualApptBtn')?.addEventListener('click', function() {
      openDocManualFormOverlay();
    });

    // Live input → update summary instantly (مهم على desktop حيث الخطوات كلها ظاهرة)
    ['docManualPatientName','docManualPhone','docManualBirthDate','docManualAddress'].forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', function(e) {
        var map = { docManualPatientName:'patientName', docManualPhone:'phone', docManualBirthDate:'birthDate', docManualAddress:'address' };
        _docManualData[map[id]] = e.target.value;
        docOUpdateSummary();
      });
    });
    var vtEl = document.getElementById('docManualVisitType');
    if (vtEl) vtEl.addEventListener('change', function(e) { _docManualData.visitType = e.target.value; docOUpdateSummary(); });

    document.getElementById('docNextToStep2')?.addEventListener('click', function() {
      _docManualData.patientName = document.getElementById('docManualPatientName').value.trim();
      _docManualData.phone       = document.getElementById('docManualPhone').value.trim();
      _docManualData.birthDate   = document.getElementById('docManualBirthDate').value;
      _docManualData.address     = document.getElementById('docManualAddress').value.trim();
      _docManualData.visitType   = document.getElementById('docManualVisitType').value;
      if (!_docManualData.patientName || !_docManualData.phone || !_docManualData.birthDate || !_docManualData.visitType) {
        showToast('املأ جميع الحقول المطلوبة', 'error'); return;
      }
      docOUpdateSummary(); docORenderCalendar(); docOGoToStep(2);
    });
    document.getElementById('docBackToStep1')?.addEventListener('click', function() { docOGoToStep(1); });
    document.getElementById('docNextToStep3')?.addEventListener('click', function() {
      _docManualData.selectedDate = document.getElementById('docManualDateInput').value;
      if (!_docManualData.selectedDate) { showToast('اختر تاريخ الموعد', 'error'); return; }
      if (isDayClosed(_docManualData.selectedDate)) { showToast('هذا اليوم مغلق للحجز', 'error'); return; }
      if (!_docManualData.selectedSlot) { showToast('اختر ساعة الموعد', 'error'); return; }
      docOUpdateSummary(); docOGoToStep(3);
    });
    document.getElementById('docBackToStep2')?.addEventListener('click', function() { docOGoToStep(2); });

    document.getElementById('docSubmitManualAppointment')?.addEventListener('click', function() {
      // اقرأ القيم مباشرة من الحقول (أضمن من الـ state)
      var patientName = document.getElementById('docManualPatientName').value.trim();
      var phone       = document.getElementById('docManualPhone').value.trim();
      var birthDate   = document.getElementById('docManualBirthDate').value;
      var address     = document.getElementById('docManualAddress').value.trim();
      var visitType   = document.getElementById('docManualVisitType').value;
      var selectedDate = document.getElementById('docManualDateInput').value;
      var selectedSlot = _docManualData.selectedSlot;

      if (!patientName) { showToast('أدخل اسم المريض', 'error'); return; }
      if (!phone)       { showToast('أدخل رقم الهاتف', 'error'); return; }
      if (!visitType)   { showToast('اختر نوع الزيارة', 'error'); return; }
      if (!selectedDate){ showToast('اختر تاريخ الموعد', 'error'); return; }
      if (isDayClosed(selectedDate)) { showToast('هذا اليوم مغلق للحجز', 'error'); return; }
      if (!selectedSlot){ showToast('اختر ساعة الموعد', 'error'); return; }
      // تحقّق أخير من توفّر الساعة (يُحسب من الذاكرة بلا reads إضافية) لتفادي الحجز المزدوج
      if (docTakenHoursForDate(selectedDate)[selectedSlot]) {
        showToast('هذه الساعة لم تعد متاحة، اختر ساعة أخرى', 'error');
        docORenderHours(selectedDate); docOGoToStep(2);
        return;
      }

      var btn = document.getElementById('docSubmitManualAppointment');
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ...'; }

      var appointment = {
        PatientName: patientName,
        Phone:       phone,
        BirthDate:   birthDate,
        Address:     address,
        VisitType:   visitType,
        Date:        selectedDate,
        Slot:        selectedSlot,
        Status:      'Accepted',
        createdAt:   new Date().toISOString(),
        source:      'manual'
      };

      window._fb.addDoc(window._fb.col('appointments'), appointment)
        .then(function(apptRef) {
          // ── قفل الساعة (مصدر موحّد مع تطبيق الحجز) لمنع الحجز المزدوج — كتابة واحدة ──
          try {
            var lockId = docSlotLockId(selectedDate, selectedSlot);
            window._fb.setDoc(window._fb.docRef('bookedSlots', lockId),
              { date: selectedDate, time: selectedSlot, apptId: apptRef.id, status: 'booked', source: 'manual', createdAt: window._fb.serverTimestamp() })
              .catch(function(){});
          } catch (e) {}
          // ── إرسال إشعار للممرضة ──
          var alertPayload = {
            type:      'newManualAppt',
            direction: 'doctorToNurse',
            message:   'موعد جديد: ' + patientName,
            read:      false,
            createdAt: window._fb.serverTimestamp(),
            expireAt:  new Date(Date.now() + 30*24*60*60*1000) // حذف تلقائي بعد ٣٠ يوماً (TTL)
          };
          window._fb.addDoc(window._fb.col('alerts'), alertPayload)
            .then(function(alertRef) {
              var bc = { type:'newManualAppt', direction:'doctorToNurse',
                         message:'موعد جديد: ' + patientName,
                         ts: Date.now(), docId: alertRef.id };
              try { new BroadcastChannel('nurseAlerts').postMessage(bc); } catch(e) {}
            }).catch(function(){});
          closeDocManualFormOverlay();
          showToast('تم تسجيل الموعد بنجاح ✓', 'success');
          setActiveSection('calendar');
          if (typeof selectDay === 'function') selectDay(selectedDate);
        })
        .catch(function(e) {
          showToast('فشل الحفظ: ' + (e.code || e.message), 'error');
          console.error(e);
        })
        .finally(function() {
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> تسجيل الموعد'; }
        });
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeDocManualFormOverlay();
    });

    }); // end DOMContentLoaded
    document.getElementById('patientBookSearch')?.addEventListener('input', renderPatientBook);

    // ==================== البحث العالمي ====================
    (function() {
      const inp = document.getElementById('globalSearchInput');
      const res = document.getElementById('globalSearchResults');
      if (!inp || !res) return;

      function escH(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

      function highlight(text, q) {
        if (!q) return escH(text);
        const idx = (text||'').toLowerCase().indexOf(q.toLowerCase());
        if (idx < 0) return escH(text);
        return escH(text.slice(0, idx)) + '<mark style="background:#d1fae5;color:#065f46;border-radius:3px;padding:0 2px;">' + escH(text.slice(idx, idx+q.length)) + '</mark>' + escH(text.slice(idx+q.length));
      }

      function doSearch(q) {
        if (!q || q.trim().length < 1) { res.style.display = 'none'; return; }
        q = q.trim();
        const allData = window._allRecords || [];
        const results = [];

        // البحث في المواعيد المستقبلية فقط (اليوم وما بعده، وغير الملغاة)
        allData.filter(r => {
          const name = (r.PatientName||r.patientName||'').toLowerCase();
          const type = (r.VisitType||r.visitType||'').toLowerCase();
          const date = normalizeDate(r.Date||r.date||'');
          const status = r.Status||r.status||'';
          if (!date || date < todayStr) return false;                 // مستقبلية فقط
          if (['Cancelled','Rejected'].includes(status)) return false; // تجاهل الملغاة/المرفوضة
          return name.includes(q.toLowerCase()) || type.includes(q.toLowerCase()) || date.includes(q);
        }).sort((a,b)=> normalizeDate(a.Date||a.date) .localeCompare(normalizeDate(b.Date||b.date)))
          .slice(0,6).forEach(r => results.push({
          id: r.id,
          name: r.PatientName||r.patientName||'—',
          date: r.Date||r.date||'',
          type: r.VisitType||r.visitType||'',
          status: r.Status||r.status||'',
          resultType: 'appointment'
        }));

        if (results.length === 0) {
          res.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:.83rem;">لا توجد نتائج</div>';
          res.style.display = 'block';
          return;
        }

        res.innerHTML = results.map(r => {
          if (r.type === 'patient') {
            return `<div class="gsearch-item" onclick="setActiveSection('patients');document.getElementById('patientBookSearch').value='${escH(r.name)}';renderPatientBook();document.getElementById('globalSearchResults').style.display='none';document.getElementById('globalSearchInput').value='';"
              style="display:flex;align-items:center;gap:12px;padding:11px 16px;cursor:pointer;transition:background .15s;border-bottom:1px solid var(--border);"
              onmouseover="this.style.background='var(--primary-faint)'" onmouseout="this.style.background=''">
              <div style="width:34px;height:34px;border-radius:50%;background:var(--primary-faint);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <div>
                <div style="font-size:.84rem;font-weight:700;color:var(--text-primary);">${highlight(r.name, q)}</div>
                <div style="font-size:.73rem;color:var(--text-muted);margin-top:2px;">مريض ${r.phone ? '· ' + escH(r.phone) : ''}</div>
              </div>
            </div>`;
          } else {
            const statusColor = r.status==='Visited'?'#10b981':r.status==='Accepted'?'#3b82f6':r.status==='Cancelled'?'#ef4444':'#6b7280';
            return `<div class="gsearch-item" onclick="openAppointmentDetailsModal('${r.id}');document.getElementById('globalSearchResults').style.display='none';document.getElementById('globalSearchInput').value='';"
              style="display:flex;align-items:center;gap:12px;padding:11px 16px;cursor:pointer;transition:background .15s;border-bottom:1px solid var(--border);"
              onmouseover="this.style.background='var(--primary-faint)'" onmouseout="this.style.background=''">
              <div style="width:34px;height:34px;border-radius:50%;background:#ede9fe;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:.84rem;font-weight:700;color:var(--text-primary);">${highlight(r.name, q)}</div>
                <div style="font-size:.73rem;color:var(--text-muted);margin-top:2px;">${escH(r.date)} ${r.type ? '· '+escH(r.type) : ''}</div>
              </div>
              <span style="font-size:.7rem;font-weight:700;color:${statusColor};background:${statusColor}18;padding:2px 8px;border-radius:20px;flex-shrink:0;">${r.status==='Visited'?'تمت الزيارة':r.status==='Accepted'?'مقبول':r.status==='Cancelled'?'ملغي':escH(r.status)}</span>
            </div>`;
          }
        }).join('');

        res.style.display = 'block';
      }

      inp.addEventListener('input', function() { doSearch(this.value); });
      inp.addEventListener('focus', function() { if (this.value.trim()) doSearch(this.value); });
      document.addEventListener('click', function(e) {
        if (!inp.contains(e.target) && !res.contains(e.target)) res.style.display = 'none';
      });
      inp.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { res.style.display = 'none'; inp.blur(); }
      });

      // تخزين السجلات عالمياً
      window.addEventListener('recordsUpdated', function() {
        if (window._allRecords) return;
      });
    })();

    // زر البحث في هيدر الموبايل: ينتقل للرئيسية ويركّز خانة البحث
    window.mobileHeaderSearch = function() {
      if (typeof setActiveSection === 'function') setActiveSection('home');
      setTimeout(function() {
        var i = document.getElementById('globalSearchInput');
        if (i) { i.scrollIntoView({ behavior: 'smooth', block: 'center' }); i.focus(); }
      }, 150);
    };

    document.getElementById('dayDetailsModal')?.addEventListener('click', function(e) {
      if (e.target === this) closeDayDetailsModal();
    });

    document.getElementById('noteModal')?.addEventListener('click', function(e) {
      if (e.target === this) closeNoteModal();
    });

    document.getElementById('addNoteModal')?.addEventListener('click', function(e) {
      if (e.target === this) closeAddNoteModal();
    });

    // URL / History routing
    window.addEventListener('popstate', function(e) {
      var s = (e.state && e.state.section) || location.hash.slice(1);
      var valid = ['home','calendar','patients','stats'];
      if (valid.includes(s)) { _histNav = true; setActiveSection(s); _histNav = false; }
    });

    // تهيئة
    document.addEventListener('DOMContentLoaded', () => {
      // loadData() تُستدعى من onAuth بعد التحقق من تسجيل الدخول
      var _h = location.hash.slice(1);
      var _validDoc = ['home','calendar','patients','stats'];
      var _initDoc = _validDoc.includes(_h) ? _h : 'home';
      _histNav = true; setActiveSection(_initDoc); _histNav = false;
      history.replaceState({ section: _initDoc }, '', '#' + _initDoc);
      const _dateStr = today.toLocaleDateString('ar-EG', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
      const sidebarDate = document.getElementById('sidebarDoctorDate');
      if (sidebarDate) sidebarDate.textContent = _dateStr;
      const mtbDate = document.getElementById('mtbDate');
      if (mtbDate) mtbDate.textContent = _dateStr;
    });

    // ==================== الصفحة الرئيسية ====================
    function updateHomeSummaryStats() { renderHomeSection(); }
    function renderHomeSection() {
      var now = new Date();
      var h = now.getHours();
      var greet, svgIcon;
      var sunSVG = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:6px;flex-shrink:0;"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/></svg>';
      var moonSVG = '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="#6366f1" stroke="#6366f1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:6px;flex-shrink:0;"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/></svg>';
      var partCloudSVG = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:6px;flex-shrink:0;"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="2" y1="12" x2="5" y2="12"/><path d="M17 14a3 3 0 1 1 0 6H8a4 4 0 1 1 .87-7.9A4.5 4.5 0 0 1 17 14z" stroke="#94a3b8" fill="rgba(148,163,184,0.18)"/></svg>';
      if (h >= 5 && h < 12)       { greet = 'صباح الخير';  svgIcon = sunSVG; }
      else if (h >= 12 && h < 17) { greet = 'مساء الخير';  svgIcon = partCloudSVG; }
      else if (h >= 17 && h < 21) { greet = 'مساء النور';  svgIcon = moonSVG; }
      else                         { greet = 'مساء الخير'; svgIcon = moonSVG; }

      var nameEl = document.getElementById('profileDisplayName');
      var name = (nameEl && nameEl.textContent && nameEl.textContent.trim()) ? nameEl.textContent.trim() : '';
      var displayName = name.replace(/^لوحة\s*الطبيب\s*$/, '').replace(/^لوحة\s*/, '').replace(/^دكتور\s*/, '').replace(/^د\.?\s*/i, '').trim();
      var firstName = displayName ? displayName.split(/\s+/)[0] : '';
      var titlePrefix = firstName ? ('د. ' + firstName) : 'دكتور';

      var g = document.getElementById('homeGreeting');
      if (g) g.innerHTML = '<span style="display:inline-flex;align-items:center;gap:4px;">' + svgIcon + greet + '، ' + titlePrefix + '</span>';
      var d = document.getElementById('homeDateLabel');
      if (d) d.textContent = 'إليك ملخص عيادتك ليوم ' + now.toLocaleDateString('ar-EG', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
      try {
        var records = (typeof allRecords !== 'undefined' && allRecords) ? allRecords : [];
        var todays = records.filter(function(r){ return r.Date === todayStr; });
        // تعديل: حساب كافة المواعيد المقبولة بغض النظر عن حالة الحضور
        var accepted = todays.filter(function(r){ return r.Status === 'Accepted'; });
        var visited  = todays.filter(function(r){ return r.Status === 'Visited'; });
        var noShow   = todays.filter(function(r){ return r.Status === 'NoShow'; });
        
        // إجمالي المواعيد المقبولة لليوم
        var totalToday = accepted.length + visited.length + noShow.length;

        setText('homeStatTotal', totalToday);
        setText('homeStatRemaining', accepted.length);
        setText('homeStatVisited', visited.length);
        setText('homeStatNoShow', noShow.length);
        // بطاقات الموبايل (نفس شكل الممرضة)
        setText('msTotal', totalToday);
        setText('msRem', accepted.length);
        setText('msVis', visited.length);
        setText('msAbs', noShow.length);
        // بطاقات قسم المواعيد المؤكدة (أسفل الروزنامة) — تُحدَّث الآن من renderAgendaForDay حسب اليوم المختار في الروزنامة

        // ── شريط إنجاز اليوم ──
        var progressPct = totalToday > 0 ? Math.round((visited.length / totalToday) * 100) : 0;
        var pb = document.getElementById('homeProgressBar');
        var pl = document.getElementById('homeProgressLabel');
        var ps = document.getElementById('homeProgressSub');
        var pst = document.getElementById('homeProgressStatus');
        if (pb) setTimeout(function(){ pb.style.width = progressPct + '%'; }, 80);
        if (pl) pl.textContent = progressPct + '%';
        if (ps) ps.textContent = visited.length + ' من ' + totalToday + ' موعد مكتمل';
        if (pst) {
          if (totalToday === 0) { pst.textContent = 'لا مواعيد اليوم'; pst.style.background='var(--border)'; pst.style.color='var(--text-muted)'; }
          else if (progressPct === 100) { pst.textContent = '🎉 أنجزت يومك!'; pst.style.background='var(--green-light)'; pst.style.color='var(--green)'; }
          else if (progressPct >= 50) { pst.textContent = 'في المسار الصحيح'; pst.style.background='var(--primary-light)'; pst.style.color='var(--primary)'; }
          else { pst.textContent = 'بداية اليوم'; pst.style.background='var(--primary-faint)'; pst.style.color='var(--primary)'; }
        }

        // ── مقارنة الأسبوع الحالي بالماضي ──
        var thisWeekStart = new Date(today);
        var dowT = thisWeekStart.getDay();
        var diffFri = (dowT - 5 + 7) % 7;
        thisWeekStart.setDate(thisWeekStart.getDate() - diffFri);
        var lastWeekStart = new Date(thisWeekStart); lastWeekStart.setDate(thisWeekStart.getDate() - 7);
        var thisWeekTotal = 0, lastWeekTotal = 0;
        for (var wi = 0; wi < 7; wi++) {
          var wd1 = new Date(thisWeekStart); wd1.setDate(thisWeekStart.getDate() + wi);
          var wd2 = new Date(lastWeekStart);  wd2.setDate(lastWeekStart.getDate() + wi);
          var ds1 = toLocalISODate(wd1), ds2 = toLocalISODate(wd2);
          thisWeekTotal += records.filter(function(r){ return r.Date===ds1 && (r.Status==='Accepted'||r.Status==='Visited'||r.Status==='NoShow'); }).length;
          lastWeekTotal += records.filter(function(r){ return r.Date===ds2 && (r.Status==='Accepted'||r.Status==='Visited'||r.Status==='NoShow'); }).length;
        }
        setText('homeWeekCurrent', thisWeekTotal);
        setText('homeWeekLast', lastWeekTotal);
        var diffIcon = document.getElementById('homeWeekDiffIcon');
        var diffLabel = document.getElementById('homeWeekDiffLabel');
        var barCur = document.getElementById('homeWeekBarCurrent');
        var barLst = document.getElementById('homeWeekBarLast');
        var wDiff = thisWeekTotal - lastWeekTotal;
        if (diffIcon && diffLabel) {
          if (wDiff > 0) {
            diffIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>';
            diffLabel.textContent = '+' + wDiff;
            diffLabel.style.color = 'var(--green)';
          } else if (wDiff < 0) {
            diffIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
            diffLabel.textContent = wDiff;
            diffLabel.style.color = 'var(--red)';
          } else {
            diffIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="9" x2="19" y2="9"/><line x1="5" y1="15" x2="19" y2="15"/></svg>';
            diffLabel.textContent = 'لا فرق'; diffLabel.style.color = 'var(--text-muted)';
          }
        }
        var wMax = Math.max(thisWeekTotal + lastWeekTotal, 1);
        if (barCur) setTimeout(function(){ barCur.style.width = Math.round((thisWeekTotal/wMax)*100) + '%'; }, 100);
        if (barLst) setTimeout(function(){ barLst.style.width = Math.round((lastWeekTotal/wMax)*100) + '%'; }, 100);


        var upcoming = accepted.slice().sort(function(a,b){
          var sa = (a.Slot === 'Morning' ? 0 : 1);
          var sb = (b.Slot === 'Morning' ? 0 : 1);
          return sa - sb;
        }).slice(0, 5);
        var ul = document.getElementById('homeUpcomingList');
        setText('homeUpcomingCount', upcoming.length);
        if (ul) {
          if (!upcoming.length) {
            ul.innerHTML = '<div style="text-align:center;padding:18px;color:var(--text-muted);font-size:.82rem;">لا توجد مواعيد قادمة اليوم</div>';
          } else {
            ul.innerHTML = upcoming.map(function(r){
              var slotAr = r.Slot === 'Evening' ? 'مساءً' : 'صباحاً';
              return '<div onclick="openAppointmentDetailsModal(\''+r.id+'\')" style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--primary-faint);border:1.5px solid var(--border);border-radius:10px;cursor:pointer;transition:all .15s;">'
                + '<div style="width:36px;height:36px;border-radius:10px;background:var(--primary-light);color:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0;"><i class="fas fa-user"></i></div>'
                + '<div style="flex:1;min-width:0;">'
                + '<div style="font-weight:700;font-size:.85rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+(r.PatientName||'-')+'</div>'
                + '<div style="font-size:.7rem;color:var(--text-muted);margin-top:2px;">'+(r.VisitType||'-')+' · '+slotAr+'</div>'
                + '</div>'
                + '<i class="fas fa-chevron-left" style="color:var(--text-muted);font-size:.75rem;"></i>'
                + '</div>';
            }).join('');
          }
        }

        // تنبيهات الرئيسية مُزالة بناءً على الطلب
        var aw = document.getElementById('homeAlertsWrap');
        if (aw) { aw.style.display = 'none'; aw.innerHTML = ''; }

        // آخر المرضى المُزارين
        var rp = document.getElementById('homeRecentPatients');
        if (rp) {
          var recent = [];
          if (typeof allPatients !== 'undefined' && allPatients) {
            Object.values(allPatients).forEach(function(p){
              var lastTs = 0, lastVisit = null;
              (p.appointments||[]).forEach(function(v){
                var ts = v.noteUpdatedAt || (v.date ? new Date(v.date).getTime() : 0);
                if (ts > lastTs) { lastTs = ts; lastVisit = v; }
              });
              if (lastTs > 0) recent.push({patient:p, ts:lastTs, visit:lastVisit});
            });
            recent.sort(function(a,b){ return b.ts - a.ts; });
            recent = recent.slice(0, 4);
          }
          if (!recent.length) {
            rp.innerHTML = '<div style="text-align:center;padding:18px;color:var(--text-muted);font-size:.82rem;">لا توجد زيارات حديثة</div>';
          } else {
            rp.innerHTML = recent.map(function(it){
              var p = it.patient;
              var rel = formatRelativeTime ? formatRelativeTime(it.ts) : '';
              return '<div onclick="openPatientDetailsModal(\''+p.id+'\')" style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--primary-faint);border:1.5px solid var(--border);border-radius:10px;cursor:pointer;">'
                + '<div style="width:36px;height:36px;border-radius:50%;background:var(--primary-light);color:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0;">'+(p.name?p.name.charAt(0):'?')+'</div>'
                + '<div style="flex:1;min-width:0;">'
                + '<div style="font-weight:700;font-size:.85rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+(p.name||'-')+'</div>'
                + '<div style="font-size:.7rem;color:var(--text-muted);margin-top:2px;">آخر زيارة: '+rel+'</div>'
                + '</div>'
                + '<i class="fas fa-chevron-left" style="color:var(--text-muted);font-size:.75rem;"></i>'
                + '</div>';
            }).join('');
          }
        }

        // مؤشر الأسبوع — نبدأ من الجمعة (يوم 5)
        var wb = document.getElementById('homeWeekBars');
        if (wb) {
          var weekStart = new Date(today);
          var dow = weekStart.getDay(); // الأحد=0 .. السبت=6 ، الجمعة=5
          var diffToFri = (dow - 5 + 7) % 7;
          weekStart.setDate(weekStart.getDate() - diffToFri);
          var dayNames = ['الجمعة','السبت','الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس'];
          var counts = [];
          var max = 1;
          for (var i=0;i<7;i++){
            var dd = new Date(weekStart); dd.setDate(weekStart.getDate()+i);
            var ds = toLocalISODate(dd);
            var c = records.filter(function(r){ return r.Date === ds && (r.Status==='Accepted'||r.Status==='Visited'); }).length;
            counts.push({ds:ds, count:c, isToday: ds===todayStr});
            if (c > max) max = c;
          }
          wb.innerHTML = counts.map(function(c,i){
            var pct = Math.max(6, Math.round((c.count/max)*100));
            var bg = c.isToday ? 'var(--primary)' : (c.count===0 ? 'var(--border)' : 'var(--primary-3)');
            return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:6px;">'
              + '<div style="font-size:.7rem;font-weight:800;color:'+(c.isToday?'var(--primary)':'var(--text-primary)')+';">'+c.count+'</div>'
              + '<div title="'+c.count+' موعد" style="width:100%;background:'+bg+';height:'+pct+'%;border-radius:6px 6px 4px 4px;transition:height .3s;"></div>'
              + '<div style="font-size:.65rem;color:'+(c.isToday?'var(--primary)':'var(--text-muted)')+';font-weight:'+(c.isToday?'800':'600')+';">'+dayNames[i]+'</div>'
              + '</div>';
          }).join('');
          var endDate = new Date(weekStart); endDate.setDate(weekStart.getDate()+6);
          setText('homeWeekRange', formatDateAr(toLocalISODate(weekStart)) + ' — ' + formatDateAr(toLocalISODate(endDate)));
        }
      } catch(e) { console.warn('renderHomeSection error', e); }

      // تحميل الملاحظات السريعة
      loadQuickNote();

      function setText(id, val){ var el = document.getElementById(id); if (el) el.textContent = val; }
    }
    // ================== ملاحظات سريعة ==================
    var _noteChanged = false;

    function loadQuickNote() {
      try {
        window._fb.getDoc('notes', 'quick').then(function(snap) {
          if (snap.exists()) {
            var d = snap.data();
            var ta = document.getElementById('homeQuickNote');
            if (ta && d.text) ta.value = d.text;
            var nd = document.getElementById('homeNoteDate');
            if (nd && d.savedAt) {
              var dt = new Date(d.savedAt);
              nd.textContent = 'آخر تعديل: ' + dt.toLocaleDateString('ar-EG', {day:'numeric',month:'short'}) + ' ' + dt.toLocaleTimeString('ar-EG', {hour:'2-digit',minute:'2-digit'});
            }
          }
        }).catch(function(){
          // fallback to localStorage
          var saved = localStorage.getItem('docQuickNote');
          if (saved) {
            try { var obj = JSON.parse(saved);
              var ta = document.getElementById('homeQuickNote'); if (ta) ta.value = obj.text || '';
            } catch(e) {}
          }
        });
      } catch(e) {}
    }

    function saveQuickNote() {
      var ta = document.getElementById('homeQuickNote');
      if (!ta) return;
      var text = ta.value;
      var payload = { text: text, savedAt: Date.now() };
      var savedEl = document.getElementById('homeNoteSaved');
      try {
        window._fb.setDoc(window._fb.docRef('notes', 'quick'), payload).then(function() {
          if (savedEl) { savedEl.style.display='inline'; setTimeout(function(){ savedEl.style.display='none'; }, 2000); }
        }).catch(function() {
          localStorage.setItem('docQuickNote', JSON.stringify(payload));
          if (savedEl) { savedEl.style.display='inline'; setTimeout(function(){ savedEl.style.display='none'; }, 2000); }
        });
      } catch(e) {
        localStorage.setItem('docQuickNote', JSON.stringify(payload));
      }
      _noteChanged = false;
    }

    function clearQuickNote() {
      var ta = document.getElementById('homeQuickNote');
      if (ta) ta.value = '';
      var nd = document.getElementById('homeNoteDate'); if (nd) nd.textContent = '-';
      saveQuickNote();
    }

    function onQuickNoteChange() {
      _noteChanged = true;
      // حفظ تلقائي بعد 3 ثواني من التوقف عن الكتابة
      clearTimeout(window._noteAutoSaveTimer);
      window._noteAutoSaveTimer = setTimeout(function(){ if (_noteChanged) saveQuickNote(); }, 3000);
    }


    // ===== Rail collapse / expand =====
    var RAIL_KEY = 'doctorRailExpanded';
    window.toggleRail = function() {
      const rail = document.getElementById('mainRail');
      if (!rail) return;
      const expanding = !rail.classList.contains('expanded');
      rail.classList.toggle('expanded', expanding);
      document.body.classList.toggle('rail-expanded', expanding);
      const arrow = document.getElementById('railArrowIcon');
      if (arrow) arrow.style.transform = expanding ? 'rotate(180deg)' : 'rotate(0deg)';
      try { localStorage.setItem(RAIL_KEY, expanding ? '1' : '0'); } catch (e) {}
      setTimeout(function() { if (typeof renderScheduleGrid === 'function') renderScheduleGrid(); }, 320);
    };
    (function() {
      try {
        if (localStorage.getItem(RAIL_KEY) === '1') {
          const rail = document.getElementById('mainRail');
          if (rail) {
            rail.classList.add('expanded');
            document.body.classList.add('rail-expanded');
            const arrow = document.getElementById('railArrowIcon');
            if (arrow) arrow.style.transform = 'rotate(180deg)';
          }
        }
      } catch (e) {}
    })();

    // ===== الوضع الليلي =====
    const THEME_KEY = 'doctorTheme';
    function syncThemeToggle(dark) {
      const btn = document.getElementById('themeToggleBtn'), knob = document.getElementById('themeToggleKnob');
      if (btn)  { btn.setAttribute('aria-checked', dark ? 'true' : 'false'); btn.style.background = dark ? 'var(--primary)' : 'var(--border-strong)'; }
      if (knob) { knob.style.transform = dark ? 'translateX(-22px)' : 'translateX(0)'; }
    }
    window.toggleTheme = function() {
      const dark = document.body.classList.toggle('theme-dark');
      try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch (e) {}
      syncThemeToggle(dark);
    };
    (function() { try { if (localStorage.getItem(THEME_KEY) === 'dark') document.body.classList.add('theme-dark'); } catch (e) {} })();
    document.addEventListener('DOMContentLoaded', function() { syncThemeToggle(document.body.classList.contains('theme-dark')); });

    const SETTINGS_KEY = 'doctorSettings';
    let settings = {};
    // تحميل فوري من التخزين المحلي حتى لا تختفي المعلومات عند تحديث الصفحة
    (function() { try { var raw = localStorage.getItem(SETTINGS_KEY); if (raw) settings = JSON.parse(raw) || {}; } catch (e) {} })();

    function applySettings() {
      const title = settings.title || 'لوحة الطبيب';
      document.title = title;
      // مزامنة بطاقة الطبيب في الشريط الجانبي
      const sidebarName = document.getElementById('sidebarDoctorName');
      if (sidebarName) sidebarName.textContent = title;
      // مزامنة profileDisplayName حتى تظهر التحية بالاسم الصحيح
      const profileName = document.getElementById('profileDisplayName');
      if (profileName) profileName.textContent = title;
      const sidebarAvatar = document.getElementById('sidebarDoctorAvatar');
      if (sidebarAvatar) {
        sidebarAvatar.innerHTML = settings.logo
          ? `<img src="${settings.logo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
          : `<i class="fas fa-user-md"></i>`;
      }
      // هيدر الموبايل: صورة الطبيب + اسمه
      const mtbAvatar = document.getElementById('mtbAvatar');
      if (mtbAvatar) mtbAvatar.innerHTML = settings.logo ? `<img src="${settings.logo}">` : `<i class="fas fa-user-md"></i>`;
      const mtbName = document.getElementById('mtbName');
      if (mtbName) {
        let hn = (settings.title || '').trim();
        if (hn && hn !== 'لوحة الطبيب' && !/^(د\.?\s|دكتور)/.test(hn)) hn = 'د. ' + hn;
        mtbName.textContent = hn || 'لوحة الطبيب';
      }
      // تحديث التحية فوراً بالاسم الجديد
      if (typeof renderHomeSection === 'function') renderHomeSection();
    }

    function saveSettingsToLocal(s) {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
      window._fb.setDoc(window._fb.docRef('settings', 'doctor'), s, { merge: true })
        .catch(function(e) { console.error('settings save error', e); });
    }

    window.switchSettingsPanel = function(panel) {
      document.querySelectorAll('.spanel').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.sni, .stab').forEach(el => el.classList.remove('active'));
      const p = document.getElementById('spanel-' + panel);
      if (p) p.classList.add('active');
      document.querySelectorAll('[data-panel="' + panel + '"]').forEach(el => el.classList.add('active'));
    };
    window.autoSaveSettings = function() {
      const t = (document.getElementById('settingsTitleInput') || {}).value || '';
      if (t.trim()) settings.title = t.trim();
      settings.specialty = (document.getElementById('settingsSpecialtyInput') || {}).value || '';
      settings.address   = (document.getElementById('settingsAddressInput') || {}).value || '';
      settings.mobile    = (document.getElementById('settingsMobileInput') || {}).value || '';
      settings.landline  = (document.getElementById('settingsLandlineInput') || {}).value || '';
      saveSettingsToLocal(settings);
      applySettings();
    };
    window.openSettingsModal = function() {
      switchSettingsPanel('profile');
      syncThemeToggle(document.body.classList.contains('theme-dark'));
      document.getElementById('settingsTitleInput').value = settings.title || 'لوحة الطبيب';
      document.getElementById('profileDisplayName').textContent = settings.title || 'لوحة الطبيب';
      if (document.getElementById('profileSubtitle')) document.getElementById('profileSubtitle').textContent = settings.specialty || 'طبيب';
      document.getElementById('settingsSpecialtyInput').value = settings.specialty || '';
      document.getElementById('settingsAddressInput').value = settings.address || '';
      document.getElementById('settingsMobileInput').value = settings.mobile || '';
      document.getElementById('settingsLandlineInput').value = settings.landline || '';
      const previewImg  = document.getElementById('logoPreviewImg');
      const previewIcon = document.getElementById('logoPreviewIcon');
      const removeBtn   = document.getElementById('removeLogoBtn');
      if (settings.logo) {
        previewImg.src = settings.logo; previewImg.classList.remove('hidden');
        previewIcon.classList.add('hidden'); removeBtn.classList.remove('hidden');
      } else {
        previewImg.classList.add('hidden'); previewIcon.classList.remove('hidden'); removeBtn.classList.add('hidden');
      }
      document.getElementById('settingsModal').classList.remove('hidden');
    };
    window.closeSettingsModal = function() {
      document.getElementById('settingsModal').classList.add('hidden');
    };
    window.saveSettings = function() { autoSaveSettings(); closeSettingsModal(); };

    window.removeLogo = function() {
      settings.logo = null;
      document.getElementById('logoPreviewImg').classList.add('hidden');
      document.getElementById('logoPreviewIcon').classList.remove('hidden');
      document.getElementById('removeLogoBtn').classList.add('hidden');
      document.getElementById('logoFileInput').value = '';
      saveSettingsToLocal(settings);
      applySettings();
    };

    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('logoFileInput').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { showToast('الرجاء اختيار ملف صورة','error'); return; }
        if (file.size > 5*1024*1024) { showToast('حجم الصورة يجب أن يكون أقل من 5 ميغابايت','error'); return; }
        showToast('جاري رفع الصورة…','');
        window._fb.uploadLogo('doctor', file).then(function(url) {
          settings.logo = url;
          const previewImg  = document.getElementById('logoPreviewImg');
          const previewIcon = document.getElementById('logoPreviewIcon');
          const removeBtn   = document.getElementById('removeLogoBtn');
          previewImg.src = url; previewImg.classList.remove('hidden');
          previewIcon.classList.add('hidden'); removeBtn.classList.remove('hidden');
          saveSettingsToLocal(settings);
          applySettings();
          showToast('تم رفع الصورة بنجاح','success');
        }).catch(function(err) { showToast('فشل رفع الصورة','error'); console.error(err); });
      });
      applySettings();
    });

    // إغلاق مودال الإعدادات بالضغط خارجه
    document.getElementById('settingsModal')?.addEventListener('click', function(e) {
      if (e.target === this) closeSettingsModal();
    });


/* ===== FAB Speed Dial ===== */
    // ── مفاتيح localStorage ──
    const NURSE_ALERT_KEY    = 'nurseAlert';
    const CUSTOM_ALERT_KEY   = 'nurseCustomAlert';

    let customAlertData = { label: 'تنبيه مخصص', desc: 'تنبيه من الدكتور' };
    function updateCustomLabels(label) {
      document.querySelectorAll('#customAlertLabel, #customAlertLabelDesk').forEach(el => el.textContent = label);
    }
    updateCustomLabels(customAlertData.label);

    // ── إنشاء الأصوات بـ Web Audio API ──
    function createAudioCtx() { return new (window.AudioContext || window.webkitAudioContext)(); }

    function playSound(type) {
      try {
        const ctx = createAudioCtx();
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.6, ctx.currentTime);

        if (type === 'next') {
          // نغمة صاعدة مبهجة — ثلاث نبضات
          [0, 0.18, 0.36].forEach((t, i) => {
            const o = ctx.createOscillator();
            o.connect(gain);
            o.type = 'sine';
            o.frequency.setValueAtTime([520, 660, 780][i], ctx.currentTime + t);
            o.start(ctx.currentTime + t);
            o.stop(ctx.currentTime + t + 0.15);
          });

        } else if (type === 'enter') {
          // نبضتان قصيرتان — تنبيه رسمي
          [0, 0.25].forEach((t) => {
            const o = ctx.createOscillator();
            o.connect(gain);
            o.type = 'square';
            o.frequency.setValueAtTime(440, ctx.currentTime + t);
            gain.gain.setValueAtTime(0.3, ctx.currentTime + t);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + t + 0.2);
            o.start(ctx.currentTime + t);
            o.stop(ctx.currentTime + t + 0.22);
          });

        } else if (type === 'custom') {
          // صوت منخفض هادئ — مختلف تماماً
          const o = ctx.createOscillator();
          o.connect(gain);
          o.type = 'triangle';
          o.frequency.setValueAtTime(300, ctx.currentTime);
          o.frequency.linearRampToValueAtTime(500, ctx.currentTime + 0.3);
          gain.gain.setValueAtTime(0.5, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
          o.start(ctx.currentTime);
          o.stop(ctx.currentTime + 0.6);
        }

        setTimeout(() => ctx.close(), 1500);
      } catch(e) { console.warn('Audio error:', e); }
    }


    // ── FAB دوال زر الزائد (لوحة الطبيب) ──
    function toggleMobDocFab() {
      var trigger  = document.getElementById('mobDocFabTrigger');
      var pills    = document.getElementById('mobDocPills');
      var isOpen   = trigger && trigger.classList.contains('open');
      if (isOpen) { closeMobDocFab(); return; }
      if (trigger)  trigger.classList.add('open');
      if (pills)    pills.classList.add('active');
    }
    function closeMobDocFab() {
      var trigger  = document.getElementById('mobDocFabTrigger');
      var pills    = document.getElementById('mobDocPills');
      if (trigger)  trigger.classList.remove('open');
      if (pills)    pills.classList.remove('active');
    }
    // ── Draggable Desktop FAB (Doctor) ──
    (function() {
      var FAB_KEY = 'docFabPos';
      var fabEl, pillsEl, _docWasDragged = false;
      window._docWasDragged = function() { return _docWasDragged; };
      window._docResetDragged = function() { _docWasDragged = false; };

      function getFabPos() {
        try { var s = localStorage.getItem(FAB_KEY); if (s) { var p = JSON.parse(s); return clampPos(p); } } catch(e) {}
        return { right: 36, bottom: 36 };
      }
      function saveFabPos(pos) {
        try { localStorage.setItem(FAB_KEY, JSON.stringify(pos)); } catch(e) {}
      }

      function clampPos(pos) {
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var size = 56;
        var margin = 8;
        return {
          right:  Math.max(margin, Math.min(vw  - size - margin, pos.right)),
          bottom: Math.max(margin, Math.min(vh  - size - margin, pos.bottom))
        };
      }

      function applyFabPos(pos) {
        var clamped = clampPos(pos);
        fabEl.style.left   = '';
        fabEl.style.top    = '';
        fabEl.style.right  = clamped.right  + 'px';
        fabEl.style.bottom = clamped.bottom + 'px';
      }

      function positionPills() {
        if (!pillsEl || !fabEl) return;
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var fr = parseFloat(fabEl.style.right)  || 36;
        var fb = parseFloat(fabEl.style.bottom) || 36;
        var fabSize = 56;
        var gap = 8;

        var pillH  = 52;
        var pillGap = 10;
        var count  = pillsEl.querySelectorAll('.doc-fab-pill').length;
        var totalH = count * pillH + (count - 1) * pillGap;

        // Space available above FAB top edge and below FAB bottom edge
        var spaceAbove = vh - fb - fabSize; // from FAB top to screen top
        var spaceBelow = fb;                // from FAB bottom to screen bottom

        var openUp = spaceAbove >= spaceBelow;

        pillsEl.style.flexDirection = openUp ? 'column-reverse' : 'column';
        pillsEl.style.top    = '';
        pillsEl.style.bottom = '';

        if (openUp) {
          // pills sit above the FAB — anchor by bottom
          pillsEl.style.bottom = (fb + fabSize + gap) + 'px';
        } else {
          // pills sit below the FAB — anchor by bottom (negative offset below FAB)
          pillsEl.style.bottom = (fb - totalH - gap) + 'px';
        }

        // Horizontal alignment
        var fabLeftEdge = vw - fr - fabSize;
        var isRight = fr < vw / 2;

        if (isRight) {
          pillsEl.style.right      = fr + 'px';
          pillsEl.style.left       = '';
          pillsEl.style.alignItems = 'flex-end';
        } else {
          pillsEl.style.left       = fabLeftEdge + 'px';
          pillsEl.style.right      = '';
          pillsEl.style.alignItems = 'flex-start';
        }
      }

      function initDraggableFab() {
        fabEl   = document.getElementById('docDesktopSpeedDial');
        pillsEl = document.getElementById('docDesktopPills');
        if (!fabEl) return;

        // Apply saved position THEN show — prevents flash at default CSS position
        var pos = getFabPos();
        applyFabPos(pos);
        requestAnimationFrame(function() {
          fabEl.style.opacity = '1';
        });

        var startX, startY, startRight, startBottom, dragging = false;

        function onPointerDown(e) {
          if (e.target.closest('button.doc-fab-trigger') === null) return;
          dragging       = false;
          _docWasDragged = false;
          startX         = e.clientX;
          startY         = e.clientY;
          startRight     = parseFloat(fabEl.style.right)  || 36;
          startBottom    = parseFloat(fabEl.style.bottom) || 36;
          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup',   onPointerUp);
          e.preventDefault();
        }

        function onPointerMove(e) {
          var dx = e.clientX - startX;
          var dy = e.clientY - startY;
          if (!dragging && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
          if (!dragging) { closeDocFabDial(); } // أغلق pills عند بدء السحب
          dragging = true;
          _docWasDragged = true;
          fabEl.classList.add('dragging');

          // right decreases when moving right (dx positive), increases when moving left
          // bottom increases when moving up (dy negative), decreases when moving down
          var newRight  = startRight  - dx;
          var newBottom = startBottom - dy;

          applyFabPos({ right: newRight, bottom: newBottom });
          if (pillsEl) positionPills();
        }

        function onPointerUp(e) {
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup',   onPointerUp);
          fabEl.classList.remove('dragging');
          if (dragging) {
            saveFabPos({ right: parseFloat(fabEl.style.right)||36, bottom: parseFloat(fabEl.style.bottom)||36 });
          }
          dragging = false;
        }

        fabEl.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('resize', function() {
          // Re-clamp on resize in case window shrunk
          var cur = { right: parseFloat(fabEl.style.right)||36, bottom: parseFloat(fabEl.style.bottom)||36 };
          applyFabPos(cur);
          positionPills();
        });
      }

      window._docPositionPills = positionPills;

      document.addEventListener('DOMContentLoaded', initDraggableFab);
    })();

    function toggleDocFabDial() {
      var trigger  = document.getElementById('docDesktopFabMain');
      if (!trigger || (window._docWasDragged && window._docWasDragged())) { if(window._docResetDragged) window._docResetDragged(); return; }
      var isOpen   = trigger.classList.contains('open');
      if (isOpen) { closeDocFabDial(); return; }
      if (window._docPositionPills) window._docPositionPills();
      trigger.classList.add('open');
      document.querySelectorAll('#docDesktopPills .doc-fab-pill').forEach(function(p){ p.classList.add('visible'); });
      // إغلاق عند الضغط خارج الـ FAB
      setTimeout(function() {
        document.addEventListener('click', _docOutsideHandler);
      }, 0);
    }
    function _docOutsideHandler(e) {
      var fab   = document.getElementById('docDesktopSpeedDial');
      var pills = document.getElementById('docDesktopPills');
      if ((fab && fab.contains(e.target)) || (pills && pills.contains(e.target))) return;
      closeDocFabDial();
      document.removeEventListener('click', _docOutsideHandler);
    }
    function closeDocFabDial() {
      var trigger  = document.getElementById('docDesktopFabMain');
      var pills    = document.getElementById('docDesktopPills');
      if (trigger)  trigger.classList.remove('open');
      if (pills)    document.querySelectorAll('#docDesktopPills .doc-fab-pill').forEach(function(p){ p.classList.remove('visible'); });
      document.removeEventListener('click', _docOutsideHandler);
    }

    // ── إرسال التنبيه (من ملف الدكتور) ──
    window.sendNurseAlert = function(type) {
      var label = type === 'next'  ? 'أدخل المريض التالي' :
                  type === 'enter' ? 'استدعاء الممرضة' :
                  (customAlertData.label || 'تنبيه مخصص');
      // ١. Firestore أولاً للحصول على doc ID
      window._fb.addDoc(window._fb.col('alerts'), {
        type:      type,
        direction: 'doctorToNurse',
        message:   label,
        read:      false,
        createdAt: window._fb.serverTimestamp(),
        expireAt:  new Date(Date.now() + 30*24*60*60*1000) // حذف تلقائي بعد ٣٠ يوماً (TTL)
      }).then(function(docRef) {
        // ٢. BroadcastChannel مع نفس doc ID
        var payload = { type: type, direction: 'doctorToNurse', message: label, ts: Date.now(), docId: docRef.id };
        try { new BroadcastChannel('nurseAlerts').postMessage(payload); } catch(e) {}
      }).catch(function(e) { console.error('alert send', e); });
    };

    // ── تخصيص الزر الثالث ──
    window.openCustomAlertEdit = function() {
      document.getElementById('customAlertTextInput').value = customAlertData.label;
      document.getElementById('customAlertDescInput').value = customAlertData.desc;
      document.getElementById('customAlertModal').classList.remove('hidden');
    };
    window.closeCustomAlertEdit = function() {
      document.getElementById('customAlertModal').classList.add('hidden');
    };
    window.saveCustomAlert = function() {
      const label = document.getElementById('customAlertTextInput').value.trim() || 'تنبيه مخصص';
      const desc  = document.getElementById('customAlertDescInput').value.trim() || 'تنبيه من الدكتور';
      customAlertData = { label, desc };
      window._fb.setDoc(window._fb.docRef('config', 'customAlert'), customAlertData)
        .catch(function(e) { console.error(e); });
      updateCustomLabels(label);
      closeCustomAlertEdit();
    };




/* ===== Custom Alert & Contacts ===== */

  // ── تسجيل الخروج عبر Firebase ──
  // زر تسجيل الخروج للعرض فقط — معطّل (لا يسجّل خروجاً)
  window.docbookSignOut = function() {
    function go(){ location.replace('index.html'); }
    try { window._fb.signOut().then(go).catch(go); } catch(e){ go(); }
  };
  

/* ===== Alert Banner ===== */
    function showDoctorAlert(title, sub) {
      var banner = document.getElementById('doctorAlertBanner');
      if (!banner) return;
      if (title) document.getElementById('alertBannerTitle').textContent = title;
      if (sub)   document.getElementById('alertBannerSub').textContent   = sub;
      banner.classList.add('show');
      if (window._alertBannerTimer) clearTimeout(window._alertBannerTimer);
      window._alertBannerTimer = setTimeout(function() { closeDoctorAlert(); }, 8000);
    }
    function closeDoctorAlert() {
      var banner = document.getElementById('doctorAlertBanner');
      if (banner) banner.classList.remove('show');
      if (window._alertBannerTimer) clearTimeout(window._alertBannerTimer);
    }

/* ===== Patient Chart & Print ===== */
    // ══════════════════════════════════════════════
    // نظام جهات التواصل — صيدليات ومختبرات
    // ══════════════════════════════════════════════

    var _contacts = [];
    var _editingContactId = null;
    var _CONTACTS_KEY = 'docbook_contacts';
    function _contactTypeLabel(t) { return t === 'lab' ? 'مختبر' : (t === 'imaging' ? 'مركز أشعة' : 'صيدلية'); }
    function _contactTypeClass(t) { return t === 'lab' ? 'contact-type-lab' : (t === 'imaging' ? 'contact-type-imaging' : 'contact-type-pharmacy'); }

    // ── تحميل وحفظ من Firestore ──
    function loadContacts(cb) {
      if (window._fbReady) {
        window._fb.getDoc('config', 'contacts').then(function(snap) {
          _contacts = snap.exists() ? (snap.data().list || []) : [];
          if (cb) cb();
        }).catch(function() { _contacts = []; if (cb) cb(); });
      } else {
        window.addEventListener('fbReady', function() { loadContacts(cb); }, { once: true });
      }
    }

    function saveContactsToFirestore() {
      if (!window._fbReady) return;
      window._fb.setDoc(window._fb.docRef('config', 'contacts'), { list: _contacts }, { merge: true })
        .catch(function(e) { console.error('contacts save', e); });
    }

    // ── النسخة الاحتياطية: تنزيل كل بيانات العيادة كملف JSON ──
    window.downloadBackup = async function() {
      if (!window._fbReady) { showToast('الاتصال بقاعدة البيانات لم يكتمل بعد', 'error'); return; }
      var btn = document.getElementById('backupBtn');
      var oldHtml = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جارٍ التحضير...'; }
      try {
        var fb = window._fb;
        // جلب كل البيانات كاملةً (بلا حدود — النسخة في الذاكرة محدودة بـ limit)
        var patientsSnap = await fb.getDocs(fb.col('patients'));
        var apptSnap     = await fb.getDocs(fb.col('appointments'));
        var alertsSnap   = await fb.getDocs(fb.col('alerts'));
        var settingsSnap = await fb.getDoc('settings', 'doctor');
        var contactsSnap = await fb.getDoc('config', 'contacts');
        var closedSnap   = await fb.getDoc('config', 'closedDays');
        var alertCfgSnap = await fb.getDoc('config', 'customAlert');
        var mapDocs = function(snap) { return snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); }); };

        var backup = {
          _meta: {
            app: 'DocBook',
            clinicType: (typeof CLINIC_TYPE !== 'undefined' ? CLINIC_TYPE : 'doctor'),
            schema: 1,
            exportedAt: new Date().toISOString(),
            exportedBy: (fb.auth.currentUser && fb.auth.currentUser.email) || null
          },
          patients:     mapDocs(patientsSnap),
          appointments: mapDocs(apptSnap),
          alerts:       mapDocs(alertsSnap),
          settings:     settingsSnap.exists() ? settingsSnap.data() : null,
          contacts:     contactsSnap.exists() ? contactsSnap.data() : null,
          closedDays:   closedSnap.exists()   ? closedSnap.data()   : null,
          customAlert:  alertCfgSnap.exists()  ? alertCfgSnap.data()  : null
        };
        backup._meta.counts = {
          patients: backup.patients.length,
          appointments: backup.appointments.length,
          alerts: backup.alerts.length
        };

        var json = JSON.stringify(backup, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'docbook-backup-' + backup._meta.clinicType + '-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(url); }, 2000);
        showToast('تم تنزيل النسخة الاحتياطية (' + backup._meta.counts.patients + ' مريض، ' + backup._meta.counts.appointments + ' موعد)', 'success');
      } catch (e) {
        console.error('backup', e);
        showToast('تعذّر إنشاء النسخة الاحتياطية', 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; }
      }
    };

    // ── فتح مدير جهات التواصل ──
    window.openContactsManager = function() {
      document.getElementById('contactsModal').classList.remove('hidden');
      _editingContactId = null;
      document.getElementById('contactSaveBtnText').textContent = '+ إضافة';
      document.getElementById('contactNameInput').value = '';
      document.getElementById('contactPhoneInput').value = '';
      loadContacts(renderContactsList);
    };

    window.closeContactsManager = function() {
      document.getElementById('contactsModal').classList.add('hidden');
    };

    function renderContactsList() {
      var list = document.getElementById('contactsList');
      if (!list) return;
      if (!_contacts.length) {
        list.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:.85rem;padding:20px;">لا توجد جهات تواصل بعد</div>';
        return;
      }
      list.innerHTML = _contacts.map(function(ct) {
        var typeLabel = _contactTypeLabel(ct.type);
        var typeIcon  = ct.type === 'lab' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v11l-4 4a2 2 0 0 0 1.41 3.41H17.6A2 2 0 0 0 19 18l-4-4V3"/></svg>' : (ct.type === 'imaging' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7v10M12 7v10M17 7v10"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/><line x1="12" y1="6" x2="12" y2="10"/><line x1="10" y1="8" x2="14" y2="8"/></svg>');
        var typeClass = _contactTypeClass(ct.type);
        return '<div class="contact-card">' +
          '<div class="contact-card-info">' +
          '<div style="display:flex;align-items:center;gap:6px;">' +
          '<span class="contact-card-name">' + ct.name + '</span>' +
          '<span class="contact-card-type ' + typeClass + '" style="display:flex;align-items:center;gap:3px;">' + typeIcon + ' ' + typeLabel + '</span>' +
          '</div>' +
          '<span class="contact-card-phone">' + ct.phone + '</span>' +
          '</div>' +
          '<div style="display:flex;gap:6px;">' +
          '<button onclick="editContact(' + JSON.stringify(ct.id) + ')" style="background:var(--primary-light);border:none;border-radius:8px;padding:6px 10px;cursor:pointer;color:var(--primary);">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
          '</button>' +
          '<button onclick="deleteContact(' + JSON.stringify(ct.id) + ')" style="background:#fee2e2;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;color:#dc2626;">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>' +
          '</button>' +
          '</div>' +
          '</div>';
      }).join('');
    }

    window.saveContact = function() {
      var name  = document.getElementById('contactNameInput').value.trim();
      var phone = document.getElementById('contactPhoneInput').value.trim().replace(/[^0-9+]/g,'');
      var type  = document.getElementById('contactTypeInput').value;
      if (!name || !phone) { showToast('أدخل الاسم ورقم الهاتف', 'error'); return; }
      if (_editingContactId) {
        var idx = _contacts.findIndex(function(c) { return c.id === _editingContactId; });
        if (idx !== -1) { _contacts[idx].name = name; _contacts[idx].phone = phone; _contacts[idx].type = type; }
        _editingContactId = null;
        document.getElementById('contactSaveBtnText').textContent = '+ إضافة';
      } else {
        _contacts.push({ id: Date.now(), name: name, phone: phone, type: type });
      }
      document.getElementById('contactNameInput').value = '';
      document.getElementById('contactPhoneInput').value = '';
      saveContactsToFirestore();
      renderContactsList();
      showToast('تم الحفظ', 'success');
    };

    window.editContact = function(id) {
      var ct = _contacts.find(function(c) { return c.id === id; });
      if (!ct) return;
      _editingContactId = id;
      document.getElementById('contactNameInput').value  = ct.name;
      document.getElementById('contactPhoneInput').value = ct.phone;
      document.getElementById('contactTypeInput').value  = ct.type;
      document.getElementById('contactSaveBtnText').textContent = '💾 تحديث';
      document.getElementById('contactNameInput').focus();
    };

    window.deleteContact = function(id) {
      _contacts = _contacts.filter(function(c) { return c.id !== id; });
      saveContactsToFirestore();
      renderContactsList();
    };

    // ── فتح مودال الإرسال للصيدلية/مختبر ──
    window.openSendToContact = function() {
      // اجمع النص من حقول الكتابة
      var prescription = (document.getElementById('prescriptionText')?.value || '').trim();
      var note         = (document.getElementById('noteText')?.value || '').trim();
      var msg = '';
      if (prescription) msg += 'الوصفة الطبية:\n' + prescription;
      if (note) msg += (msg ? '\n\n' : '') + 'الملاحظات:\n' + note;
      // fallback لمودال العرض
      if (!msg) msg = (document.getElementById('whatsappMsgInput')?.value || '').trim();
      if (!msg) { showToast('أكتب الوصفة أو الملاحظة أولاً', 'error'); return; }
      document.getElementById('sendToContactModal').classList.remove('hidden');
      renderSendContactList(msg);
    };

    window.closeSendToContact = function() {
      document.getElementById('sendToContactModal').classList.add('hidden');
    };

    function renderSendContactList(msg) {
      var list  = document.getElementById('sendContactList');
      var empty = document.getElementById('sendContactEmpty');
      loadContacts(function() {
        if (!_contacts.length) {
          list.style.display = 'none';
          empty.style.display = 'block';
          return;
        }
        empty.style.display = 'none';
        list.style.display  = 'block';
        list.innerHTML = _contacts.map(function(ct) {
          var typeLabel = _contactTypeLabel(ct.type);
        var typeIcon  = ct.type === 'lab' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v11l-4 4a2 2 0 0 0 1.41 3.41H17.6A2 2 0 0 0 19 18l-4-4V3"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/><line x1="12" y1="6" x2="12" y2="10"/><line x1="10" y1="8" x2="14" y2="8"/></svg>';
          var typeClass = _contactTypeClass(ct.type);
          return '<div class="contact-card" style="margin-bottom:8px;">' +
            '<div class="contact-card-info">' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
            '<span class="contact-card-name">' + ct.name + '</span>' +
            '<span class="contact-card-type ' + typeClass + '" style="display:flex;align-items:center;gap:3px;">' + typeIcon + ' ' + typeLabel + '</span>' +
            '</div>' +
            '<span class="contact-card-phone">' + ct.phone + '</span>' +
            '</div>' +
            '<button class="btn-send-contact" onclick="sendToContactWhatsApp(' + JSON.stringify(ct.phone) + ',' + JSON.stringify(msg) + ')">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.126.556 4.121 1.524 5.855L0 24l6.336-1.504A11.955 11.955 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.652-.516-5.168-1.416l-.371-.22-3.762.893.951-3.66-.24-.387A9.956 9.956 0 0 1 2 12C2 6.478 6.478 2 12 2s10 4.478 10 10-4.478 10-10 10z"/></svg> إرسال' +
            '</button>' +
            '</div>';
        }).join('');
      });
    }

    window.sendToContactWhatsApp = function(phone, msg) {
      var cleaned = phone.replace(/[^0-9+]/g, '');
      if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
      var url = 'https://wa.me/' + cleaned + '?text=' + encodeURIComponent(msg);
      window.open(url, '_blank');
      closeSendToContact();
    };

    // ==================== الروزنامة في الصفحة الرئيسية ====================
    let homeCalDate = new Date(currentDate);

    function renderHomeCalendar() {
      const grid = document.getElementById('homeCalGrid');
      if (!grid) return;
      grid.innerHTML = '';
      const year = homeCalDate.getFullYear(), month = homeCalDate.getMonth();
      document.getElementById('homeCurrentMonth').textContent = `${monthsAr[month]} ${year}`;
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      let startOffset = (firstDay + 2) % 7;
      for (let i = startOffset - 1; i >= 0; i--) {
        const d = document.createElement('div');
        d.className = 'compact-calendar-day other-month';
        d.textContent = '';
        grid.appendChild(d);
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, month, d); dateObj.setHours(0,0,0,0);
        const dateStr = toLocalISODate(dateObj);
        const dayDiv = document.createElement('div');
        dayDiv.className = 'compact-calendar-day';
        dayDiv.textContent = d;
        if (dateObj < today) dayDiv.classList.add('past-day');
        if (dateObj.getTime() === today.getTime()) dayDiv.classList.add('today');
        if (selectedDayStr === dateStr) dayDiv.classList.add('selected');
        const dayRecords = allRecords.filter(r =>
          ['Accepted', 'Visited', 'NoShow'].includes(r.Status) && r.Date === dateStr
        );
        if (dayRecords.length > 0) {
          const dot = document.createElement('div');
          dot.className = `compact-appointment-dot ${dayRecords.length <= 2 ? 'compact-dot-low' : dayRecords.length <= 4 ? 'compact-dot-medium' : 'compact-dot-high'}`;
          dayDiv.appendChild(dot);
        }
        dayDiv.addEventListener('click', () => selectHomeDay(dateStr));
        grid.appendChild(dayDiv);
      }
      // تحديث لوحة اليوم دائماً (تظهر اليوم الحالي افتراضياً وتنعش عند وصول البيانات)
      const panel = document.getElementById('homeDayPanel');
      if (panel) {
        renderHomeDayPanel(selectedDayStr || todayStr);
        panel.style.display = 'block';
      }
    }

    function selectHomeDay(dateStr) {
      selectedDayStr = dateStr;
      renderHomeCalendar();
      renderCalendar(); // sync with calendar section
      renderHomeDayPanel(dateStr);
      const panel = document.getElementById('homeDayPanel');
      if (panel) panel.style.display = 'block';
    }

    function homeApptCard(r) {
      const c = schedStatusColor(r);
      const t = slotTimeOf(r);
      let right;
      if (r.Status === 'Visited') right = '<span style="font-size:.7rem;padding:3px 10px;border-radius:20px;font-weight:700;background:#dcfce7;color:#16a34a;white-space:nowrap;flex-shrink:0;"><i class="fas fa-check-circle"></i> تمت</span>';
      else if (r.Status === 'NoShow') right = '<span style="font-size:.7rem;padding:3px 10px;border-radius:20px;font-weight:700;background:#fee2e2;color:#dc2626;white-space:nowrap;flex-shrink:0;"><i class="fas fa-user-times"></i> لم يحضر</span>';
      else if (['Cancelled','Rejected'].includes(r.Status)) right = '<span style="font-size:.7rem;padding:3px 10px;border-radius:20px;font-weight:700;background:#fef3c7;color:#d97706;white-space:nowrap;flex-shrink:0;"><i class="fas fa-ban"></i> ملغاة</span>';
      else right = '<div style="display:flex;gap:4px;flex-shrink:0;"><a href="tel:' + normalizePhone(r.Phone) + '" onclick="event.stopPropagation();" style="width:32px;height:32px;border-radius:8px;background:#2563eb;color:white;display:flex;align-items:center;justify-content:center;font-size:.75rem;"><i class="fas fa-phone"></i></a><button onclick="event.stopPropagation();openAppointmentDetailsModal(\'' + r.id + '\')" style="width:32px;height:32px;border-radius:8px;background:var(--primary-light);color:var(--primary);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.75rem;"><i class="fas fa-eye"></i></button></div>';
      return '<div data-appt-id="' + r.id + '" onclick="openAppointmentDetailsModal(\'' + r.id + '\')" style="display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--primary-faint);border:1.5px solid var(--border);border-right:4px solid ' + c.bd + ';border-radius:12px;padding:9px 11px;cursor:pointer;">'
        + '<div style="display:flex;align-items:center;gap:10px;min-width:0;">'
          + '<div style="display:flex;align-items:center;justify-content:center;background:var(--primary-light);color:var(--primary);border-radius:9px;padding:5px 9px;min-width:56px;flex-shrink:0;font-family:\'DM Mono\',monospace;font-weight:800;font-size:.82rem;"><i class="far fa-clock" style="font-size:.62rem;margin-left:4px;"></i>' + t + '</div>'
          + '<div style="min-width:0;"><p style="font-weight:700;font-size:.88rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(r.PatientName || '') + '</p><p style="font-size:.7rem;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (r.VisitType || '') + '</p></div>'
        + '</div>'
        + right + '</div>';
    }

    // ضغط طويل على كرت الموعد (موبايل) → فتح إضبارة المريض
    (function() {
      var lpTimer = null, lpFired = false, sx = 0, sy = 0;
      document.addEventListener('touchstart', function(e) {
        var card = e.target.closest && e.target.closest('[data-appt-id]');
        if (!card) return;
        lpFired = false;
        var t = e.touches[0]; sx = t.clientX; sy = t.clientY;
        lpTimer = setTimeout(function() {
          lpFired = true;
          try { if (navigator.vibrate) navigator.vibrate(18); } catch (e) {}
          var id = card.getAttribute('data-appt-id');
          if (id && typeof openChartFromAppt === 'function') openChartFromAppt(id);
        }, 500);
      }, { passive: true });
      document.addEventListener('touchmove', function(e) {
        if (!lpTimer) return;
        var t = e.touches[0];
        if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) { clearTimeout(lpTimer); lpTimer = null; }
      }, { passive: true });
      document.addEventListener('touchend', function() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } });
      // امنع فتح تفاصيل الموعد بعد الضغط الطويل
      document.addEventListener('click', function(e) {
        if (lpFired) { lpFired = false; if (e.target.closest && e.target.closest('[data-appt-id]')) { e.stopPropagation(); e.preventDefault(); } }
      }, true);
    })();
    function renderHomeDayPanel(dateStr) {
      const box = document.getElementById('homeDayAgenda'); if (!box) return;
      const isPast  = parseLocalISODate(dateStr) < today;
      const isToday = dateStr === todayStr;
      document.getElementById('homePanelTitle').textContent = `${daysAr[parseLocalISODate(dateStr).getDay()]} — ${formatDateAr(dateStr)}`;

      let recs;
      if (isPast) {
        recs = allRecords.filter(r => ['Accepted','Visited','NoShow','Cancelled','Rejected'].includes(r.Status) && normalizeDate(r.Date) === dateStr);
        const vis = recs.filter(r=>r.Status==='Visited').length;
        const ns  = recs.filter(r=>r.Status==='NoShow').length;
        const canc= recs.filter(r=>['Cancelled','Rejected'].includes(r.Status)).length;
        document.getElementById('homePanelCount').textContent = `زيارات: ${vis}${ns?' · لم يحضر: '+ns:''}${canc?' · ملغاة: '+canc:''}`;
      } else if (isToday) {
        // اليوم: تُعرض كل مواعيد اليوم (المؤكدة + التي تمّت + التي لم تحضر)
        recs = allRecords.filter(r => ['Accepted','Visited','NoShow'].includes(r.Status) && normalizeDate(r.Date) === dateStr);
        document.getElementById('homePanelCount').textContent = `عدد مواعيد اليوم: ${recs.length}`;
      } else {
        recs = allRecords.filter(r => r.Status === 'Accepted' && normalizeDate(r.Date) === dateStr);
        document.getElementById('homePanelCount').textContent = `عدد المواعيد المؤكدة: ${recs.length}`;
      }
      // ترتيب من الأبكر للمتأخّر
      recs = recs.slice().sort((a,b)=> slotMinutes(slotTimeOf(a)) - slotMinutes(slotTimeOf(b)));

      if (!recs.length) {
        box.innerHTML = '<div style="text-align:center;padding:22px 0;color:var(--text-muted);font-size:.85rem;"><i class="far fa-calendar-check" style="font-size:1.5rem;display:block;margin-bottom:8px;opacity:.4;"></i>لا توجد مواعيد في هذا اليوم</div>';
        return;
      }
      // قائمة مسطّحة مرتّبة — الوقت داخل كل كرت
      box.innerHTML = recs.map(homeApptCard).join('');
    }

    // تهيئة الروزنامة الرئيسية عند فتح الصفحة الرئيسية
    document.getElementById('homePrevMonthBtn')?.addEventListener('click', () => {
      homeCalDate.setMonth(homeCalDate.getMonth() - 1);
      renderHomeCalendar();
    });
    document.getElementById('homeNextMonthBtn')?.addEventListener('click', () => {
      homeCalDate.setMonth(homeCalDate.getMonth() + 1);
      renderHomeCalendar();
    });

    // Hook into section changes
    const _origSetActive = window.setActiveSection;
    window.setActiveSection = function(section) {
      if (_origSetActive) _origSetActive(section);
      if (section === 'home') {
        homeCalDate = new Date(currentDate);
        selectedDayStr = todayStr;            // افتح دائماً على اليوم الحالي
        renderHomeCalendar();
        renderHomeDayPanel(todayStr);
        var panel = document.getElementById('homeDayPanel');
        if (panel) panel.style.display = 'block';
      }
    };

    // Initial render if home is default
    setTimeout(() => {
      renderHomeCalendar();
      renderHomeWidgets();
    }, 400);

    // ==================== ويدجتس الصفحة الرئيسية الجديدة ====================
    function renderHomeWidgets() {
      if (!allRecords || allRecords.length === 0) return;

      // --- توزيع الأيام (الأسبوع الحالي فقط) ---
      const weekdayCounts = Array(7).fill(0);
      // حساب بداية الأسبوع الحالي (الأحد)
      const _wToday = new Date();
      const _wStart = new Date(_wToday);
      _wStart.setDate(_wToday.getDate() - _wToday.getDay());
      _wStart.setHours(0,0,0,0);
      const _wEnd = new Date(_wStart);
      _wEnd.setDate(_wStart.getDate() + 6);
      const _wStartStr = toLocalISODate(_wStart);
      const _wEndStr   = toLocalISODate(_wEnd);
      const _wSeen = {};
      allRecords.forEach(r => {
        if (!r.Date) return;
        // مواعيد فعلية فقط (لا Pending/ملغاة) ومنع العدّ المضاعف للموعد نفسه
        if (!['Accepted','Visited','NoShow'].includes(r.Status)) return;
        const dateStr = normalizeDate(r.Date);
        if (!dateStr || dateStr < _wStartStr || dateStr > _wEndStr) return;
        const key = dateStr + '|' + slotTimeOf(r) + '|' + normalizePhone(r.Phone || '') + '|' + (r.PatientName || '');
        if (_wSeen[key]) return; _wSeen[key] = 1;
        const parts = dateStr.split('-').map(Number);
        weekdayCounts[new Date(parts[0], parts[1]-1, parts[2]).getDay()]++;
      });

      const wWrap   = document.getElementById('homeWeekdayBarsWrap');
      const wLabels = document.getElementById('homeWeekdayBarsLabels');
      if (wWrap && wLabels) {
        const dayNames = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
        const dayShort = ['أحد','إثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'];
        const max      = Math.max(...weekdayCounts, 1);
        const todayIdx = (new Date()).getDay();

        // ── توزيع الأيام: خط متصاعد (نيون أخضر) بدل الأعمدة البيانية ──
        const W = 300, H = 150;
        const padX = 14, padTop = 26, padBot = 26;
        const innerW = W - padX * 2, innerH = H - padTop - padBot;
        const nPts = weekdayCounts.length;
        // RTL: الأحد (i=0) على اليمين
        const pts = weekdayCounts.map(function(v, i) {
          const x = padX + ((nPts - 1 - i) / (nPts - 1)) * innerW;
          const y = padTop + innerH - (v / max) * innerH;
          return { x: x, y: y, v: v, i: i };
        });
        function _homeSmoothPath(p) {
          if (!p.length) return '';
          if (p.length === 1) return 'M ' + p[0].x + ' ' + p[0].y;
          let d = 'M ' + p[0].x.toFixed(1) + ' ' + p[0].y.toFixed(1);
          for (let i = 0; i < p.length - 1; i++) {
            const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
            const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
            const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
            d += ' C ' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ', ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ', ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1);
          }
          return d;
        }
        const linePath = _homeSmoothPath(pts);
        const lastP = pts[pts.length - 1], firstP = pts[0];
        const areaPath = linePath + ' L ' + lastP.x.toFixed(1) + ' ' + H + ' L ' + firstP.x.toFixed(1) + ' ' + H + ' Z';

        // تأثير تصاعدي سريع وسلس: كشف الخط من اليمين إلى اليسار (clip wipe)
        const animate = (window._dayChartAnimate === true);
        window._dayChartAnimate = false;
        const WIPE_DUR = 1.05; // ثوانٍ — سريع وسلس (أبطأ قليلاً)
        const svgAnim = animate ? 'clip-path:inset(0 0 0 100%);animation:homeWipe ' + WIPE_DUR + 's cubic-bezier(.22,.61,.36,1) forwards;' : '';

        wWrap.style.cssText = 'position:relative;width:100%;height:160px;direction:ltr;';
        let _html = ''
          + '<style>@keyframes homeWipe{to{clip-path:inset(0 0 0 0);}}@keyframes homeFadeIn{to{opacity:1;}}</style>'
          + '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="100%" preserveAspectRatio="none" style="position:absolute;inset:0;overflow:visible;' + svgAnim + '">'
          +   '<defs>'
          +     '<filter id="homeLineGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b1"/><feGaussianBlur in="SourceGraphic" stdDeviation="7" result="b2"/><feMerge><feMergeNode in="b2"/><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
          +     '<linearGradient id="homeAreaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style="stop-color:var(--day-line);stop-opacity:.28"/><stop offset="60%" style="stop-color:var(--day-line);stop-opacity:.06"/><stop offset="100%" style="stop-color:var(--day-line);stop-opacity:0"/></linearGradient>'
          +   '</defs>'
          +   '<path d="' + areaPath + '" fill="url(#homeAreaFill)"></path>'
          +   '<path d="' + linePath + '" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" filter="url(#homeLineGlow)" vector-effect="non-scaling-stroke" style="stroke:var(--day-line);"></path>'
          +   '<path d="' + linePath + '" fill="none" stroke="#ffffff" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" vector-effect="non-scaling-stroke"></path>'
          + '</svg>';
        // النقاط + الأرقام (HTML لتبقى دائرية وحادّة) — تظهر تباعاً مع مرور الكشف من اليمين لليسار
        _html += pts.map(function(p) {
          const leftPct = (p.x / W) * 100, topPct = (p.y / H) * 100;
          const isToday = (p.i === todayIdx);
          const color = isToday ? 'var(--primary)' : 'var(--day-line)';
          const size = isToday ? 12 : 8;
          // تأخير الظهور = وقت وصول الكشف لهذا الموضع (يمين أولاً)
          const fadeCss = animate ? 'opacity:0;animation:homeFadeIn .28s ease-out forwards;animation-delay:' + (((100 - leftPct) / 100) * WIPE_DUR).toFixed(2) + 's;' : '';
          const numEl = '<div style="position:absolute;left:' + leftPct + '%;top:' + topPct + '%;transform:translate(-50%,-165%);font-size:.72rem;font-weight:800;color:' + (isToday ? 'var(--primary)' : 'var(--text-primary)') + ';white-space:nowrap;' + fadeCss + '">' + (p.v > 0 ? p.v : '') + '</div>';
          const dotEl = '<div title="' + dayNames[p.i] + ': ' + p.v + ' موعد" style="position:absolute;left:' + leftPct + '%;top:' + topPct + '%;transform:translate(-50%,-50%);width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + color + ';box-shadow:0 0 0 2px var(--surface),0 0 9px ' + color + ';' + fadeCss + '"></div>';
          return numEl + dotEl;
        }).join('');
        // أسماء الأيام أسفل الرسم بنفس مواضع النقاط
        _html += pts.map(function(p) {
          const leftPct = (p.x / W) * 100;
          const isToday = (p.i === todayIdx);
          return '<div style="position:absolute;left:' + leftPct + '%;bottom:2px;transform:translateX(-50%);font-size:.66rem;font-weight:' + (isToday ? '800' : '600') + ';color:' + (isToday ? '#0d9488' : 'var(--text-muted)') + ';white-space:nowrap;' + (isToday ? 'background:var(--primary-light);padding:1px 7px;border-radius:6px;' : '') + '">' + dayShort[p.i] + '</div>';
        }).join('');
        wWrap.innerHTML = _html;
        wLabels.style.display = 'none';
      }

      // --- أحدث 10 زيارات ---
      const tbody = document.getElementById('homeRecentVisitsTable');
      if (tbody) {
        const visits = allRecords
          .filter(r => r.Status === 'Visited' && r.Date)
          .sort((a,b) => b.Date.localeCompare(a.Date))
          .slice(0, 10);
        if (visits.length === 0) {
          tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:16px 0;color:var(--text-muted);font-size:.82rem;">لا توجد زيارات</td></tr>';
        } else {
          tbody.innerHTML = visits.map((v,i) => `
            <tr style="border-top:${i>0?'1px solid var(--border)':'none'};">
              <td style="padding:7px 0;font-weight:700;color:var(--text-primary);font-size:.8rem;">${v.PatientName||'-'}</td>
              <td style="padding:7px 4px;color:var(--text-muted);font-size:.75rem;">${v.VisitType||'-'}</td>
              <td style="padding:7px 0;color:var(--primary);font-size:.75rem;font-weight:600;white-space:nowrap;">${formatDateAr(v.Date)}</td>
            </tr>`).join('');
        }
      }
    }

    // تحديث الويدجتس عند تحميل البيانات
    const _origRenderStats = typeof renderStats === 'function' ? renderStats : null;
    window.addEventListener('recordsUpdated', () => { renderHomeWidgets(); renderHomeCalendar(); });



    // ===== فتح الإضبارة =====
    // فتح إضبارة المريض من بطاقة الموعد (كليك يمين على الجدول)
    window.openChartFromAppt = function(apptId) {
      var r = (allRecords || []).find(function(x) { return x.id === apptId; });
      if (!r) { showToast('الموعد غير موجود', 'error'); return; }
      var ph = normalizePhone(r.Phone || r.phone || '');
      var pid = Object.keys(allPatients).find(function(k) {
        return ph && normalizePhone(allPatients[k].phone || '') === ph;
      });
      if (pid) { openPatientDetailsModal(pid); return; }
      // لا توجد إضبارة لهذا المريض — أنشئها من بيانات الموعد
      var newP = {
        name: r.PatientName || '-', phone: r.Phone || '', address: r.Address || '',
        bloodType: '', chronicDiseases: '', birthDate: '', appointments: [], totalVisits: 0
      };
      window._fb.addDoc(window._fb.col('patients'), newP)
        .then(function(ref) {
          allPatients[ref.id] = Object.assign({ id: ref.id }, newP);
          showToast('تم إنشاء إضبارة جديدة لهذا المريض', 'success');
          openPatientDetailsModal(ref.id);
        })
        .catch(function(e) { console.error(e); showToast('تعذّر إنشاء الإضبارة', 'error'); });
    };


    // فتح إضبارة المريض الذي أرسلته الممرّضة (يجلبه من Firestore إن لم يكن محمّلاً)
    function _openServedPatient(pid, name) {
      if (!pid) return;
      if (allPatients[pid]) { openPatientDetailsModal(pid); return; }
      window._fb.getDoc('patients', pid).then(function(s) {
        if (s.exists()) { allPatients[pid] = Object.assign({ id: pid }, s.data()); openPatientDetailsModal(pid); }
        else { showToast('تعذّر فتح إضبارة ' + (name || 'المريض'), 'error'); }
      }).catch(function(e){ console.error(e); });
    }
    // إشعار «المريض التالي جاهز» — يبقى حتى يفتح الطبيب الإضبارة أو يضغط «إخفاء»
    var _nextPatientNotifEl = null;
    function showNextPatientNotif(pid, name) {
      if (_nextPatientNotifEl && _nextPatientNotifEl.parentNode) _nextPatientNotifEl.parentNode.removeChild(_nextPatientNotifEl);
      var el = document.createElement('div');
      el.className = 'next-patient-notif';
      el.innerHTML =
          '<div class="npn-body"><span class="npn-ic"><i class="fas fa-user-check"></i></span>'
        + '<div class="npn-txt"><div class="npn-title">تم حضور المريض</div><div class="npn-name">' + escapeHtml(name || 'مريض') + '</div></div></div>'
        + '<div class="npn-actions"><button type="button" class="npn-open"><i class="fas fa-folder-open"></i> فتح الإضبارة</button>'
        + '<button type="button" class="npn-dismiss">إخفاء</button></div>';
      _getDocNotifContainer().appendChild(el);
      _nextPatientNotifEl = el;
      requestAnimationFrame(function(){ requestAnimationFrame(function(){ el.classList.add('show'); }); });
      function remove() { el.classList.remove('show'); setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); if (_nextPatientNotifEl === el) _nextPatientNotifEl = null; }, 260); }
      el.querySelector('.npn-open').onclick = function(){ remove(); _openServedPatient(pid, name); };
      el.querySelector('.npn-dismiss').onclick = remove;
      try { if (typeof playDocNotifSound === 'function') playDocNotifSound(); } catch(e){}
    }

    // 🦷 هل تخصص الأسنان مُفعَّل؟ (اختصاص أسنان أو قالب الأسنان مطبّق)
    function _dentalEnabled() {
      var sp = (typeof settings !== 'undefined' && settings && settings.specialty) || '';
      return /أسنان|اسنان|dental/i.test(sp) || !!(settings && settings.chartTemplate && settings.chartTemplate.dental);
    }
    window.openPatientDetailsModal = function(pid) {
      var p = allPatients[pid]; if (!p) return;
      currentPatientIdForVisit = pid;
      document.getElementById('modalPatientName').textContent = p.name || '-';
      document.getElementById('modalPatientPhone').textContent = p.phone || '';
      document.getElementById('modalWhatsappBtn').href = 'https://wa.me/' + normalizePhone(p.phone || '');
      document.getElementById('modalCallBtn').href = 'tel:' + normalizePhone(p.phone || '');
      document.getElementById('chartAvatar').textContent = ((p.name || '؟').trim().charAt(0)) || '؟';
      var _pills = document.getElementById('chartHeaderPills'); if (_pills) _pills.innerHTML = renderChartHeaderPills(p);
      document.getElementById('chartInfoGrid').innerHTML = renderChartInfoTiles(p);
      renderChartVisits(pid);
      // 🦷 زر مخطط الأسنان في رأس الأرشيف: يظهر عند تفعيل الأسنان
      var _dbtn = document.getElementById('dentalArchiveBtn');
      if (_dbtn) _dbtn.style.display = _dentalEnabled() ? 'inline-flex' : 'none';
      if (typeof chartResetBooking === 'function') chartResetBooking(pid);
      document.getElementById('patientDetailsModal').classList.remove('hidden');
      var _rail = document.getElementById('mainRail'); if (_rail) _rail.style.display = 'none';   // إخفاء السايدبار أثناء فتح الإضبارة
    };

    function _visitSection(title, icon, text) {
      text = (text || '').trim();
      return '<div style="margin-top:12px;"><div style="font-size:.76rem;font-weight:800;color:var(--primary);margin-bottom:5px;"><i class="fas ' + icon + '" style="margin-left:5px;"></i>' + title + '</div>'
        + '<div style="font-size:.84rem;color:var(--text-primary);line-height:1.7;white-space:pre-wrap;word-break:break-word;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px;">'
        + (text ? escapeHtml(text) : '<span style="color:var(--text-muted)">— لا يوجد —</span>') + '</div></div>';
    }
    function renderChartVisits(pid) {
      var p = allPatients[pid]; var box = document.getElementById('chartVisitsList');
      var visits = (p.appointments || []).map(function(v, i) { return { v: v, i: i }; });
      visits.sort(function(a, b) { var d = (b.v.date || '').localeCompare(a.v.date || ''); return d !== 0 ? d : (slotMinutes(slotTimeOf(b.v)) - slotMinutes(slotTimeOf(a.v))); });
      document.getElementById('chartVisitsCount').textContent = '(' + visits.length + ')';
      if (!visits.length) { box.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:.85rem;"><i class="far fa-folder-open" style="font-size:1.6rem;display:block;margin-bottom:8px;opacity:.4;"></i>لا توجد زيارات بعد</div>'; return; }
      box.innerHTML = visits.map(function(o) {
        var v = o.v, i = o.i, c = schedStatusColor(v);
        var hasLab = !!(v.labTest && v.labTest.trim());
        var hasImg = !!(v.imagingTest && v.imagingTest.trim());
        return '<div class="chart-visit" style="border:1.5px solid var(--border);border-right:4px solid ' + c.bd + ';border-radius:12px;overflow:hidden;background:var(--surface);">'
          + '<div onclick="var b=this.parentNode.querySelector(\'.chart-visit-body\');var o=b.style.display===\'none\';b.style.display=o?\'block\':\'none\';this.querySelector(\'.chart-visit-caret\').style.transform=o?\'rotate(180deg)\':\'\';" oncontextmenu="event.preventDefault();openAddNoteModal(\'' + pid + '\',' + i + ');return false;" title="كليك يمين: فتح التعديل" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;cursor:pointer;">'
            + '<div style="min-width:0;"><div style="font-weight:800;font-size:.88rem;color:var(--text-primary);">' + escapeHtml(v.visitType || 'زيارة') + '</div>'
            + '<div style="font-size:.74rem;color:var(--text-muted);margin-top:2px;"><i class="far fa-calendar" style="font-size:.68rem;"></i> ' + formatDateAr(v.date) + ' · ' + slotTimeOf(v) + '</div></div>'
            + '<i class="fas fa-chevron-down chart-visit-caret" style="color:var(--text-muted);transition:transform .2s;flex-shrink:0;"></i>'
          + '</div>'
          + '<div class="chart-visit-body" style="display:none;padding:0 13px 13px;border-top:1px dashed var(--border);">'
            + renderVisitCustomHtml(v.custom)   // حقول الزيارة المخصّصة (قياسات حسب التخصص)
            + ((v.clinicalExam && v.clinicalExam.trim()) ? _visitSection('الفحص السريري', 'fa-stethoscope', v.clinicalExam) : '')
            + _visitSection('التشخيص', 'fa-notes-medical', v.diagnosis || v.note)
            + _visitSection('الوصفة الطبية', 'fa-prescription', v.prescription)
            + (hasLab ? _visitSection('التحاليل المطلوبة', 'fa-vials', v.labTest) : '')
            + (hasImg ? _visitSection('الأشعة المطلوبة', 'fa-x-ray', v.imagingTest) : '')
            + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">'
              + '<button onclick="openAddNoteModal(\'' + pid + '\',' + i + ')" class="btn-primary" style="padding:6px 12px;font-size:.76rem;"><i class="fas fa-pen"></i> تعديل</button>'
              + '<button onclick="deleteVisit(\'' + pid + '\',' + i + ')" style="padding:6px 12px;font-size:.76rem;background:#fef2f2;color:#dc2626;border:1.5px solid #fecaca;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:700;"><i class="fas fa-trash"></i> حذف الزيارة</button>'
              + '<button onclick="printPrescription(\'' + pid + '\',' + i + ')" style="padding:6px 12px;font-size:.76rem;background:var(--primary-light);color:var(--primary);border:1.5px solid var(--border-strong);border-radius:8px;cursor:pointer;font-family:inherit;font-weight:700;"><i class="fas fa-print"></i> طباعة الوصفة</button>'
              + '<button onclick="sendVisitToContact(\'' + pid + '\',' + i + ',\'pharmacy\')" style="padding:6px 12px;font-size:.76rem;background:#16a34a;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:700;"><i class="fab fa-whatsapp"></i> صيدلية</button>'
              + (hasLab ? '<button onclick="sendVisitToContact(\'' + pid + '\',' + i + ',\'lab\')" style="padding:6px 12px;font-size:.76rem;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:700;"><i class="fab fa-whatsapp"></i> مخبر</button>' : '')
              + (hasImg ? '<button onclick="sendVisitToContact(\'' + pid + '\',' + i + ',\'imaging\')" style="padding:6px 12px;font-size:.76rem;background:#7c3aed;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:700;"><i class="fab fa-whatsapp"></i> مركز أشعة</button>' : '')
            + '</div></div></div>';
      }).join('');
    }

    // ===== حذف زيارة (خيار الطبيب) =====
    window.deleteVisit = function(pid, idx) {
      var p = allPatients[pid]; if (!p || !p.appointments || !p.appointments[idx]) return;
      var v = p.appointments[idx];
      if (!confirm('حذف هذه الزيارة نهائياً؟\n' + (v.visitType || 'زيارة') + ' — ' + formatDateAr(v.date) + '\nلا يمكن التراجع عن هذا الإجراء.')) return;
      p.appointments.splice(idx, 1);
      if (typeof p.totalVisits === 'number') p.totalVisits = Math.max(0, p.totalVisits - 1);
      window._fb.setDoc(window._fb.docRef('patients', pid), p, { merge: true })
        .then(function(){ showToast('تم حذف الزيارة', 'success'); })
        .catch(function(e){ showToast('فشل حذف الزيارة', 'error'); console.error(e); });
      renderChartVisits(pid);
    };

    // ===== حجز الموعد القادم من الإضبارة (خيار الطبيب) =====
    var _chartBookData = null;
    function _cbcRow(icon, label, valId) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;background:var(--surface);border:1.5px solid var(--border);border-radius:10px;padding:10px 13px;">'
        + '<span style="font-size:.78rem;font-weight:700;color:var(--text-secondary);"><i class="fas ' + icon + '" style="color:var(--primary);margin-left:6px;"></i>' + label + '</span>'
        + '<span id="' + valId + '" style="font-size:.84rem;font-weight:800;color:var(--text-primary);"></span></div>';
    }
    function chartEnsureBookModal() {
      if (document.getElementById('chartBookConfirmModal')) return;
      var m = document.createElement('div');
      m.id = 'chartBookConfirmModal';
      m.className = 'hidden fixed inset-0 z-[210] modal-overlay';
      m.setAttribute('onclick', 'if(event.target===this)closeChartBookConfirm()');
      m.innerHTML =
        '<div class="modal-content" style="max-width:400px;width:92%;border-radius:18px;overflow:hidden;">'
        + '<div style="display:flex;align-items:center;gap:11px;padding:15px 18px;background:linear-gradient(135deg,var(--primary),var(--primary-7,#0f766e));color:#fff;">'
        +   '<span style="width:40px;height:40px;border-radius:11px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:1.15rem;"><i class="far fa-calendar-check"></i></span>'
        +   '<div><h3 style="font-weight:900;font-size:1rem;">تأكيد حجز الموعد</h3><p style="font-size:.72rem;opacity:.9;">راجع التفاصيل قبل التأكيد</p></div>'
        + '</div>'
        + '<div style="padding:18px;background:var(--bg);display:flex;flex-direction:column;gap:10px;">'
        +   _cbcRow('fa-user','المريض','cbcName') + _cbcRow('fa-calendar','التاريخ','cbcDate') + _cbcRow('fa-clock','الساعة','cbcSlot')
        +   '<div style="font-size:.74rem;color:var(--text-muted);text-align:center;margin-top:2px;">سيُضاف الموعد للتقويم والجدول ويُشعَر الطاقم</div>'
        + '</div>'
        + '<div style="display:flex;gap:10px;padding:14px 18px;border-top:1.5px solid var(--border);background:var(--surface);">'
        +   '<button onclick="closeChartBookConfirm()" class="btn-secondary" style="flex:1;justify-content:center;">إلغاء</button>'
        +   '<button id="cbcConfirmBtn" onclick="chartConfirmBooking()" class="btn-primary" style="flex:2;justify-content:center;"><i class="fas fa-check"></i> تأكيد الحجز</button>'
        + '</div></div>';
      document.body.appendChild(m);
    }
    function chartResetBooking(pid) {
      chartEnsureBookModal();
      var de = document.getElementById('chartNextDate');
      if (de) { de.min = todayStr; de.value = ''; }
      var hint = document.getElementById('chartNextHint'); if (hint) hint.textContent = '';
      var sel = document.getElementById('chartNextSlot'); if (sel) sel.innerHTML = '<option value="">اختر التاريخ أولاً</option>';
    }
    function chartFillNextSlots() {
      var sel = document.getElementById('chartNextSlot'); if (!sel) return;
      var date = (document.getElementById('chartNextDate') || {}).value || '';
      var hint = document.getElementById('chartNextHint');
      if (!date) { sel.innerHTML = '<option value="">اختر التاريخ أولاً</option>'; if (hint) hint.textContent=''; return; }
      if (typeof isDayClosed === 'function' && isDayClosed(date)) {
        sel.innerHTML = '<option value="">—</option>';
        if (hint) hint.innerHTML = '<span style="color:#dc2626;font-weight:700;">هذا اليوم مغلق للحجز</span>'; return;
      }
      var taken = (typeof docTakenHoursForDate === 'function') ? docTakenHoursForDate(date) : {};
      var slots = (typeof docSlots === 'function') ? docSlots() : [];
      var avail = 0, frag = '';
      slots.forEach(function(s){ if (taken[s]) return; frag += '<option value="' + s + '">' + ((typeof docFmtHour12==='function')?docFmtHour12(s):s) + '</option>'; avail++; });
      if (!avail) { sel.innerHTML = '<option value="">لا ساعات متاحة</option>'; if (hint) hint.innerHTML = '<span style="color:#d97706;font-weight:700;">كل ساعات هذا اليوم محجوزة</span>'; }
      else { sel.innerHTML = frag; if (hint) hint.textContent = avail + ' ساعة متاحة'; }
    }
    window.chartNextDateChanged = function(){ chartFillNextSlots(); };
    window.chartBookNext = function() {
      var pid = currentPatientIdForVisit, p = allPatients[pid];
      if (!p) { showToast('لا يوجد مريض محدّد', 'error'); return; }
      var date = (document.getElementById('chartNextDate') || {}).value;
      var slot = (document.getElementById('chartNextSlot') || {}).value;
      if (!date) { showToast('اختر تاريخ الموعد', 'error'); return; }
      if (typeof isDayClosed === 'function' && isDayClosed(date)) { showToast('هذا اليوم مغلق للحجز', 'error'); return; }
      if (!slot) { showToast('اختر ساعة متاحة', 'error'); return; }
      _chartBookData = { pid: pid, date: date, slot: slot };
      chartEnsureBookModal();
      document.getElementById('cbcName').textContent = p.name || p.PatientName || '—';
      document.getElementById('cbcDate').textContent = formatDateAr(date);
      document.getElementById('cbcSlot').textContent = (typeof docFmtHour12==='function')?docFmtHour12(slot):slot;
      document.getElementById('chartBookConfirmModal').classList.remove('hidden');
    };
    window.closeChartBookConfirm = function(){ var m = document.getElementById('chartBookConfirmModal'); if (m) m.classList.add('hidden'); };
    window.chartConfirmBooking = function() {
      if (!_chartBookData) return;
      var pid = _chartBookData.pid, date = _chartBookData.date, slot = _chartBookData.slot, p = allPatients[pid];
      if (!p) return;
      if (typeof docTakenHoursForDate === 'function' && docTakenHoursForDate(date)[slot]) {
        showToast('هذه الساعة لم تعد متاحة، اختر غيرها', 'error'); closeChartBookConfirm(); chartFillNextSlots(); return;
      }
      var btn = document.getElementById('cbcConfirmBtn');
      function _reset(){ if (btn){ btn.disabled=false; btn.innerHTML='<i class="fas fa-check"></i> تأكيد الحجز'; } }
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحجز...'; }
      var appointment = {
        PatientName: p.name || p.PatientName || '', Phone: p.phone || p.Phone || '',
        BirthDate: p.birthDate || p.BirthDate || '', Address: p.address || p.Address || '',
        VisitType: 'مراجعة', Date: date, Slot: slot, Status: 'Accepted',
        createdAt: new Date().toISOString(), source: 'chart', patientId: pid
      };
      window._fb.addDoc(window._fb.col('appointments'), appointment)
        .then(function(apptRef) {
          try { var lockId = docSlotLockId(date, slot);
            window._fb.setDoc(window._fb.docRef('bookedSlots', lockId), { date: date, time: slot, apptId: apptRef.id, status: 'booked', source: 'chart', createdAt: window._fb.serverTimestamp() }).catch(function(){});
          } catch (e) {}
          try {
            window._fb.addDoc(window._fb.col('alerts'), { type:'newManualAppt', direction:'doctorToNurse', message:'موعد مراجعة: ' + (p.name || p.PatientName || ''), read:false, createdAt: window._fb.serverTimestamp(), expireAt: new Date(Date.now() + 30*24*60*60*1000) })
              .then(function(alertRef){ try { new BroadcastChannel('nurseAlerts').postMessage({ type:'newManualAppt', direction:'doctorToNurse', message:'موعد مراجعة: ' + (p.name||''), ts: Date.now(), docId: alertRef.id }); } catch(e){} }).catch(function(){});
          } catch (e) {}
          closeChartBookConfirm(); _reset();
          showToast('تم حجز الموعد بنجاح ✓', 'success');
          var de = document.getElementById('chartNextDate'); if (de) de.value = '';
          chartFillNextSlots(); _chartBookData = null;
        })
        .catch(function(e){ showToast('فشل الحجز: ' + (e.code || e.message), 'error'); console.error(e); _reset(); });
    };

    // ===== إضافة زيارة جديدة يدوياً =====
    window.addNewVisit = function(pid) {
      var p = allPatients[pid]; if (!p) return;
      if (!p.appointments) p.appointments = [];
      var now = new Date(); var hh = String(now.getHours()).padStart(2, '0'); var mm = String(now.getMinutes()).padStart(2, '0');
      p.appointments.push({ date: todayStr, slot: hh + ':' + mm, visitType: 'كشف جديد', diagnosis: '', prescription: '', labTest: '', noteUpdatedAt: Date.now(), source: 'chart' });
      p.totalVisits = (p.totalVisits || 0) + 1;
      window._fb.setDoc(window._fb.docRef('patients', pid), p, { merge: true }).catch(function(e){ console.error(e); });
      openAddNoteModal(pid, p.appointments.length - 1);
    };

    // ===== محرّر الزيارة =====
    // التحليل والأشعة لكل منهما نص مستقل تماماً
    var _testBuf = { lab: '', imaging: '' };
    var _curTestKind = 'lab';
    window.openAddNoteModal = function(pid, idx) {
      var p = allPatients[pid]; var v = (p && p.appointments && p.appointments[idx]) || {};
      document.getElementById('notePatientId').value = pid;
      document.getElementById('noteVisitIndex').value = idx;
      document.getElementById('diagnosisText').value = v.diagnosis || v.note || '';
      var _ceEl = document.getElementById('clinicalExamText'); if (_ceEl) _ceEl.value = v.clinicalExam || '';
      document.getElementById('prescriptionText').value = v.prescription || '';
      // نصوص مستقلة: نص التحليل في labTest، ونص الأشعة في imagingTest
      _testBuf = { lab: v.labTest || '', imaging: v.imagingTest || '' };
      var hasAny = !!((_testBuf.lab && _testBuf.lab.trim()) || (_testBuf.imaging && _testBuf.imaging.trim()));
      document.getElementById('labTestToggle').checked = hasAny;
      document.getElementById('labTestWrap').style.display = hasAny ? 'block' : 'none';
      _curTestKind = (v.testKind === 'imaging') ? 'imaging' : 'lab';
      document.getElementById('testKind').value = _curTestKind;
      document.getElementById('labTestText').value = _testBuf[_curTestKind] || '';
      _applyTestKindUI(_curTestKind);
      // حقول الزيارة المخصّصة (قياسات حسب التخصص)
      var _vf = getChartTemplate().visit;
      var _vcard = document.getElementById('noteCustomCard'); if (_vcard) _vcard.style.display = _vf.length ? '' : 'none';
      var _dbar = document.getElementById('dentalEditorBar'); if (_dbar) _dbar.style.display = _dentalEnabled() ? 'flex' : 'none';   // 🦷 شريط المخطط لكل زيارة
      buildCustomFieldInputs(document.getElementById('noteCustomFields'), _vf, v.custom, { variant: 'editor' });
      document.getElementById('visitEditorSub').textContent = (p ? (p.name || '') : '') + ' — ' + formatDateAr(v.date) + (v.slot ? ' · ' + slotTimeOf(v) : '');
      var m = document.getElementById('addNoteModal'); m.classList.remove('modal-hidden'); m.classList.add('modal-visible');
      document.body.classList.add('editor-open');
      loadContacts(renderEditorContacts);
    };

    window.toggleTestWrap = function(checked) {
      document.getElementById('labTestWrap').style.display = checked ? 'block' : 'none';
    };
    function _applyTestKindUI(kind) {
      var isImg = kind === 'imaging';
      document.getElementById('testKindLabBtn').classList.toggle('active', !isImg);
      document.getElementById('testKindImgBtn').classList.toggle('active', isImg);
      document.getElementById('labTestText').placeholder = isImg
        ? 'اكتب نوع الصورة الشعاعية المطلوبة (مثال: صورة صدر، إيكو قلب، CT دماغ، رنين مغناطيسي للركبة...)'
        : 'اكتب نوع التحليل المطلوب (مثال: صورة دم كاملة CBC، وظائف كلى، سكر صائم...)';
      var tl = document.getElementById('testListLabel'); if (tl) tl.textContent = isImg ? 'إرسال إلى مركز أشعة' : 'إرسال إلى مخبر';
      renderEditorContacts();
    }
    window.setTestKind = function(kind) {
      // احفظ نص الفئة الحالية قبل التبديل ثم استرجع نص الفئة الجديدة
      var ta = document.getElementById('labTestText');
      _testBuf[_curTestKind] = ta.value;
      _curTestKind = kind;
      document.getElementById('testKind').value = kind;
      ta.value = _testBuf[kind] || '';
      _applyTestKindUI(kind);
    };
    // يقرأ النصوص الحالية ويكتبها في كائن الزيارة (نصّان مستقلان)
    function _flushTestFields(v) {
      _testBuf[_curTestKind] = document.getElementById('labTestText').value;
      var on = document.getElementById('labTestToggle').checked;
      v.labTest     = on ? (_testBuf.lab || '').trim() : '';
      v.imagingTest = on ? (_testBuf.imaging || '').trim() : '';
      v.testKind    = _curTestKind;
    }

    // ===== قراءة جهات الاتصال مباشرة داخل المحرّر + إرسال واتساب/SMS =====
    function _editorContactRow(ct, kind) {
      var digits = String(ct.phone || '').replace(/[^0-9+]/g, '');
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--bg);border:1.5px solid var(--border);border-radius:10px;padding:8px 10px;margin-top:8px;">'
        + '<div style="min-width:0;"><div style="font-weight:700;font-size:.82rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(ct.name || '') + '</div>'
        + '<div dir="ltr" style="font-size:.72rem;color:var(--text-muted);text-align:right;">' + escapeHtml(ct.phone || '') + '</div></div>'
        + '<div style="display:flex;gap:6px;flex-shrink:0;">'
          + '<button title="إرسال واتساب" onclick="sendEditorTo(\'' + kind + '\',\'wa\',\'' + digits + '\')" style="width:34px;height:34px;border-radius:9px;border:none;background:#16a34a;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.95rem;"><i class="fab fa-whatsapp"></i></button>'
          + '<button title="إرسال SMS" onclick="sendEditorTo(\'' + kind + '\',\'sms\',\'' + digits + '\')" style="width:34px;height:34px;border-radius:9px;border:none;background:#2563eb;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.85rem;"><i class="fas fa-sms"></i></button>'
        + '</div></div>';
    }
    function _editorEmpty(t) {
      return '<div style="font-size:.74rem;color:var(--text-muted);text-align:center;padding:10px 6px;line-height:1.6;">' + t + '<br><button onclick="openContactsManager()" style="background:none;border:none;color:var(--primary);font-weight:700;cursor:pointer;font-family:inherit;"><i class="fas fa-plus"></i> إضافة جهة تواصل</button></div>';
    }
    window.renderEditorContacts = function() {
      var ph = document.getElementById('editorPharmacyList');
      var tl = document.getElementById('editorTestList');
      if (!ph || !tl) return;
      var kind = (document.getElementById('testKind') || {}).value || 'lab';
      var pharmacies = (_contacts || []).filter(function(c) { return c.type === 'pharmacy'; });
      var tests = (_contacts || []).filter(function(c) { return kind === 'imaging' ? c.type === 'imaging' : c.type === 'lab'; });
      ph.innerHTML = pharmacies.length ? pharmacies.map(function(c) { return _editorContactRow(c, 'pharmacy'); }).join('') : _editorEmpty('لا توجد صيدليات محفوظة');
      tl.innerHTML = tests.length ? tests.map(function(c) { return _editorContactRow(c, kind === 'imaging' ? 'imaging' : 'lab'); }).join('') : _editorEmpty(kind === 'imaging' ? 'لا توجد مراكز أشعة محفوظة' : 'لا توجد مخابر محفوظة');
    };
    window.sendEditorTo = function(kind, channel, phone) {
      var pid = document.getElementById('notePatientId').value;
      var idx = parseInt(document.getElementById('noteVisitIndex').value, 10);
      var p = allPatients[pid]; var v = p && p.appointments && p.appointments[idx]; if (!v) return;
      // اقرأ القيم الحالية من الحقول
      v.diagnosis    = document.getElementById('diagnosisText').value.trim();
      v.prescription = document.getElementById('prescriptionText').value.trim();
      var _ce = document.getElementById('clinicalExamText'); if (_ce) v.clinicalExam = _ce.value.trim();
      _flushTestFields(v);
      v.custom = readCustomFieldInputs(document.getElementById('noteCustomFields'));   // حقول الزيارة المخصّصة
      var testText = (kind === 'imaging') ? v.imagingTest : v.labTest;
      if (kind === 'pharmacy' && !v.prescription) { showToast('اكتب الوصفة أولاً', 'error'); return; }
      if (kind !== 'pharmacy' && !testText) { showToast('اكتب نوع ' + (kind === 'imaging' ? 'الأشعة' : 'التحليل') + ' أولاً', 'error'); return; }
      v.noteUpdatedAt = Date.now();
      window._fb.setDoc(window._fb.docRef('patients', pid), p, { merge: true }).catch(function(e) { console.error(e); });
      var msg = kind === 'pharmacy' ? _buildPrescriptionMsg(p, v) : _buildTestMsg(p, v, kind);
      var cleaned = String(phone).replace(/[^0-9+]/g, '');
      if (channel === 'wa') {
        var wa = cleaned; if (wa && wa.charAt(0) !== '+') wa = '+' + wa;
        window.open('https://wa.me/' + wa + '?text=' + encodeURIComponent(msg), '_blank');
      } else {
        window.location.href = 'sms:' + cleaned + '?body=' + encodeURIComponent(msg.replace(/\*/g, ''));
      }
    };

    function _patientLine(p) {
      var age = p.birthDate ? calculateAge(p.birthDate) + ' سنة' : '-';
      var s = 'المريض: ' + (p.name || '-') + '\nالعمر: ' + age;
      if (p.phone) s += '\nالهاتف: ' + p.phone;
      if (p.bloodType) s += '\nزمرة الدم: ' + p.bloodType;
      if (p.chronicDiseases) s += '\nأمراض مزمنة: ' + p.chronicDiseases;
      return s;
    }
    function _buildPrescriptionMsg(p, v) {
      return '*وصفة طبية*\n' + _patientLine(p) + '\nالتاريخ: ' + formatDateAr(v.date) + '\n\n*الأدوية:*\n' + (v.prescription || '(لا توجد وصفة)');
    }
    function _buildTestMsg(p, v, kind) {
      kind = kind || v.testKind || 'lab';
      var isImg = kind === 'imaging';
      var text = isImg ? (v.imagingTest || '') : (v.labTest || '');
      return (isImg ? '*طلب صورة شعاعية (أشعة)*' : '*طلب تحليل مخبري*') + '\n' + _patientLine(p)
        + '\nالتاريخ: ' + formatDateAr(v.date) + '\n\n' + (isImg ? 'الصور المطلوبة:' : 'التحاليل المطلوبة:') + '\n' + (text || '-');
    }
    function _buildLabMsg(p, v) { return _buildTestMsg(p, v); }
    function _buildPatientMsg(p, v) {
      var s = '';
      if (v.diagnosis) s += '*التشخيص:*\n' + v.diagnosis + '\n\n';
      if (v.prescription) s += '*الوصفة الطبية:*\n' + v.prescription + '\n\n';
      if (v.labTest) s += '*التحاليل المطلوبة:*\n' + v.labTest + '\n\n';
      if (v.imagingTest) s += '*الأشعة المطلوبة:*\n' + v.imagingTest;
      return s.trim() || 'مرحباً';
    }

    // حذف الزيارة من داخل المحرّر (تأكيد داخل النظام ثم إغلاق وإعادة فتح الاضبارة)
    window.deleteVisitCurrent = function() {
      var pid = document.getElementById('notePatientId').value;
      var idx = parseInt(document.getElementById('noteVisitIndex').value, 10);
      var p = allPatients[pid]; if (!p || !p.appointments || !p.appointments[idx]) return;
      var v = p.appointments[idx];
      appConfirm('حذف هذه الزيارة نهائياً؟\n' + (v.visitType || 'زيارة') + ' — ' + formatDateAr(v.date) + '\nلا يمكن التراجع.', 'حذف الزيارة').then(function(ok) {
        if (!ok) return;
        p.appointments.splice(idx, 1);
        if (typeof p.totalVisits === 'number') p.totalVisits = Math.max(0, p.totalVisits - 1);
        window._fb.setDoc(window._fb.docRef('patients', pid), p, { merge: true })
          .then(function() { showToast('تم حذف الزيارة', 'success'); })
          .catch(function(e) { showToast('فشل حذف الزيارة', 'error'); console.error(e); });
        closeAddNoteModal();
        openPatientDetailsModal(pid);
      });
    };
    window.saveVisit = function(sendWhatsapp, sendTo) {
      var pid = document.getElementById('notePatientId').value;
      var idx = parseInt(document.getElementById('noteVisitIndex').value, 10);
      var p = allPatients[pid]; if (!p || !p.appointments || !p.appointments[idx]) return;
      var v = p.appointments[idx];
      v.diagnosis    = document.getElementById('diagnosisText').value.trim();
      v.prescription = document.getElementById('prescriptionText').value.trim();
      var _ce = document.getElementById('clinicalExamText'); if (_ce) v.clinicalExam = _ce.value.trim();
      _flushTestFields(v);
      v.custom = readCustomFieldInputs(document.getElementById('noteCustomFields'));   // حقول الزيارة المخصّصة
      v.noteUpdatedAt = Date.now();
      window._fb.setDoc(window._fb.docRef('patients', pid), p, { merge: true })
        .then(function() { showToast('تم حفظ الزيارة', 'success'); })
        .catch(function(e) { showToast('فشل الحفظ', 'error'); console.error(e); });
      closeAddNoteModal();
      openPatientDetailsModal(pid);
    };

    window.printPrescriptionCurrent = function() {
      var pid = document.getElementById('notePatientId').value;
      var idx = parseInt(document.getElementById('noteVisitIndex').value, 10);
      var p = allPatients[pid], v = p && p.appointments && p.appointments[idx];
      if (v) { v.prescription = document.getElementById('prescriptionText').value.trim(); _flushTestFields(v); }
      printPrescription(pid, idx);
    };

    window.sendVisitToContact = function(pid, idx, type) {
      var p = allPatients[pid], v = p && p.appointments && p.appointments[idx]; if (!v) return;
      if (type === 'pharmacy') { openContactPicker(_buildPrescriptionMsg(p, v), 'pharmacy'); return; }
      // type هنا 'lab' أو 'imaging'
      openContactPicker(_buildTestMsg(p, v, type), type === 'imaging' ? 'imaging' : 'lab');
    };

    // ===== منتقي جهة الاتصال (صيدلية/مخبر) =====
    var _pickerMsg = '';
    window.sendPickerTo = function(phone) {
      var cleaned = String(phone).replace(/[^0-9+]/g, '');
      if (cleaned && !cleaned.startsWith('+')) cleaned = '+' + cleaned;
      window.open('https://wa.me/' + cleaned + '?text=' + encodeURIComponent(_pickerMsg), '_blank');
      closeSendToContact();
    };
    window.openContactPicker = function(msg, typeFilter) {
      _pickerMsg = msg || '';
      document.getElementById('sendToContactModal').classList.remove('hidden');
      var list = document.getElementById('sendContactList'), empty = document.getElementById('sendContactEmpty');
      loadContacts(function() {
        var items = (_contacts || []).filter(function(c) { return !typeFilter || c.type === typeFilter; });
        if (!items.length) { list.style.display = 'none'; empty.style.display = 'block'; return; }
        empty.style.display = 'none'; list.style.display = 'block';
        list.innerHTML = items.map(function(ct) {
          var typeLabel = _contactTypeLabel(ct.type);
          var typeClass = _contactTypeClass(ct.type);
          return '<div class="contact-card" style="margin-bottom:8px;"><div class="contact-card-info">'
            + '<div style="display:flex;align-items:center;gap:6px;"><span class="contact-card-name">' + escapeHtml(ct.name) + '</span>'
            + '<span class="contact-card-type ' + typeClass + '">' + typeLabel + '</span></div>'
            + '<span class="contact-card-phone">' + escapeHtml(ct.phone) + '</span></div>'
            + '<button class="btn-send-contact" onclick="sendPickerTo(\'' + String(ct.phone).replace(/[^0-9+]/g,'') + '\')"><i class="fab fa-whatsapp"></i> إرسال</button></div>';
        }).join('');
      });
    };

    // ===== تعديل معلومات المريض =====
    window.openPatientInfoEditor = function(pid) {
      var p = allPatients[pid]; if (!p) return;
      document.getElementById('piPatientId').value = pid;
      document.getElementById('piName').value = p.name || '';
      document.getElementById('piPhone').value = p.phone || '';
      document.getElementById('piBirth').value = p.birthDate || '';
      document.getElementById('piAddress').value = p.address || '';
      document.getElementById('piBlood').value = p.bloodType || '';
      document.getElementById('piChronic').value = p.chronicDiseases || '';
      buildCustomFieldInputs(document.getElementById('piCustomFields'), getChartTemplate().patient, p.custom, 'حقول مخصّصة');
      updatePiAge();
      document.getElementById('patientInfoModal').classList.remove('hidden');
    };
    window.updatePiAge = function() {
      var b = document.getElementById('piBirth').value;
      var el = document.getElementById('piAgeDisplay'); if (!el) return;
      var a = b ? calculateAge(b) : null;
      el.textContent = (a != null && a >= 0) ? '(' + a + ' سنة)' : '';
    };
    window.closePatientInfoEditor = function() { document.getElementById('patientInfoModal').classList.add('hidden'); };
    window.savePatientInfo = function() {
      var pid = document.getElementById('piPatientId').value; var p = allPatients[pid]; if (!p) return;
      p.name = document.getElementById('piName').value.trim() || p.name;
      p.phone = document.getElementById('piPhone').value.trim();
      p.birthDate = document.getElementById('piBirth').value;
      p.address = document.getElementById('piAddress').value.trim();
      p.bloodType = document.getElementById('piBlood').value;
      p.chronicDiseases = document.getElementById('piChronic').value.trim();
      p.custom = readCustomFieldInputs(document.getElementById('piCustomFields'));   // حقول المريض المخصّصة
      window._fb.setDoc(window._fb.docRef('patients', pid), p, { merge: true })
        .then(function() { showToast('تم حفظ المعلومات', 'success'); })
        .catch(function(e) { showToast('فشل الحفظ', 'error'); console.error(e); });
      closePatientInfoEditor();
      openPatientDetailsModal(pid);
    };

    // ===== طباعة PDF =====
    function _printWindow(title, bodyHtml) {
      var w = window.open('', '_blank'); if (!w) { showToast('اسمح بالنوافذ المنبثقة للطباعة', 'error'); return; }
      var clinic = (typeof settings !== 'undefined' && settings && settings.title) ? settings.title : 'لوحة الطبيب';
      w.document.write('<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>' + title + '</title>'
        + '<style>*{font-family:Tajawal,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}body{margin:0;padding:28px;color:#0f172a;}h1{font-size:20px;margin:0 0 2px;color:#0d9488;}.muted{color:#64748b;font-size:12px;}.hdr{border-bottom:2px solid #0d9488;padding-bottom:12px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-end;}table{width:100%;border-collapse:collapse;font-size:13px;}th,td{border:1px solid #e2e8f0;padding:7px 9px;text-align:right;}th{background:#f0fdfa;color:#0f766e;}.box{border:1.5px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:14px;}.rx{white-space:pre-wrap;line-height:1.9;font-size:15px;}.label{font-size:12px;color:#64748b;}.val{font-weight:700;}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}@media print{body{padding:14px;}}</style></head><body>'
        + '<div class="hdr"><div><h1>' + clinic + '</h1><div class="muted">' + title + '</div></div><div class="muted">' + new Date().toLocaleString('ar-EG') + '</div></div>'
        + bodyHtml
        + '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},250);}</scr' + 'ipt></body></html>');
      w.document.close();
    }
    // ===== قالب طباعة مشترك (نفس هوية الوصفة) =====
    function _printSheet(pillText, innerHtml) {
      var s = (typeof settings !== 'undefined' && settings) ? settings : {};
      var docName = s.title || 'الطبيب', specialty = s.specialty || '';
      var mobile = s.mobile || '', landline = s.landline || '', address = s.address || '';
      var _printBase = window.location.href.replace(/\/[^\/]*(\?.*)?$/, '/');
      var emblem = '<svg viewBox="0 0 100 100" width="100%" height="100%"><path d="M50 86 C22 64 9 46 9 31 A20 20 0 0 1 50 23 A20 20 0 0 1 91 31 C91 46 78 64 50 86 Z" fill="none" stroke="#0d9488" stroke-width="3.4"/><rect x="44" y="36" width="12" height="30" rx="2" fill="#0d9488"/><rect x="35" y="45" width="30" height="12" rx="2" fill="#0d9488"/></svg>';
      var brandHtml = '<img src="brand-logo.png" alt="DocBook" style="max-width:120px;max-height:88px;object-fit:contain;display:block;">';
      var css = '@page{size:A4;margin:0;}'
        + '*{font-family:Cairo,Tajawal,Arial,sans-serif;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
        + 'html,body{margin:0;padding:0;background:#fff;}'
        // الزخارف ثابتة فتتكرّر في كل صفحة عند الطباعة
        + '.wt,.wb{position:fixed;left:0;width:100%;height:150px;z-index:0;} .wt{top:0;} .wb{bottom:0;}'
        + '.pill{position:fixed;top:30px;right:46px;z-index:6;display:flex;align-items:center;gap:9px;background:rgba(255,255,255,.18);border:2px solid rgba(255,255,255,.85);color:#fff;border-radius:30px;padding:7px 18px 7px 8px;font-weight:800;font-size:15px;}'
        + '.pill .pc{width:24px;height:24px;border-radius:50%;background:#fff;color:#0d9488;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;}'
        + '.watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:300px;height:300px;opacity:.06;z-index:0;}'
        + '.contact{position:fixed;bottom:46px;left:0;width:100%;z-index:6;display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:18px;color:#fff;font-size:12.5px;font-weight:600;padding:0 30px;}'
        + '.contact .ct b{font-weight:800;} .contact .sep{opacity:.55;}'
        // جدول الصفحة: thead/tfoot يحجزان مساحة الترويسة/التذييل في كل صفحة فلا يتداخل المحتوى
        + '.page{width:100%;border-collapse:collapse;}'
        + '.page>thead>tr>td,.page>tfoot>tr>td,.page>tbody>tr>td{border:none;padding:0;vertical-align:top;}'
        + '.head-space{height:158px;} .foot-space{height:160px;}'
        + '.content{position:relative;z-index:3;padding:0 46px;}'
        + '.head{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:6px;}'
        + '.docinfo{text-align:right;min-width:0;}'
        + '.dname{font-size:30px;font-weight:900;color:#0f766e;line-height:1.1;}'
        + '.dspec{font-size:15px;font-weight:800;color:#0d9488;margin-top:6px;} .dspec .dash{color:#7fcabf;}'
        + '.logo{flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;}'
        + '.brand-emblem{width:96px;height:96px;}'
        + '.brand-text{font-weight:900;font-size:26px;letter-spacing:-.5px;line-height:1;} .brand-text .b1{color:#115e59;} .brand-text .b2{color:#0d9488;}'
        + '.divider{height:1.5px;background:#e2e8f0;margin:10px 0 22px;}'
        + '.sec-title{font-size:15px;font-weight:800;color:#0f766e;margin:18px 0 10px;}'
        + '.info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:8px;break-inside:avoid;}'
        + '.info-cell{border:1.5px solid #e2e8f0;border-radius:10px;padding:9px 12px;}'
        + '.info-cell.full{grid-column:1/-1;}'
        + '.info-cell .k{font-size:11.5px;color:#64748b;font-weight:600;margin-bottom:3px;}'
        + '.info-cell .vv{font-size:14px;color:#0f172a;font-weight:700;word-break:break-word;}'
        // جدول أرشيف الزيارات: يتكرّر رأسه في كل صفحة والصفوف لا تنقسم
        + '.atbl{width:100%;border-collapse:collapse;font-size:13.5px;}'
        + '.atbl th,.atbl td{border:1px solid #e2e8f0;padding:9px 10px;text-align:right;}'
        + '.atbl th{background:#f0fdfa;color:#0f766e;font-weight:800;}'
        + '.atbl thead{display:table-header-group;} .atbl tr{break-inside:avoid;}'
        // عناصر الوصفة
        + '.grid2{display:grid;grid-template-columns:1fr 1px 1fr;gap:30px;margin-bottom:26px;}'
        + '.vdiv{background:#d7e6e3;}'
        + '.r{display:flex;align-items:flex-end;gap:8px;margin-bottom:24px;}'
        + '.r .lb{font-weight:800;color:#0f766e;white-space:nowrap;font-size:13.5px;padding-bottom:2px;}'
        + '.r .vl{flex:1;border-bottom:1.6px dotted #5bb8af;min-height:20px;font-weight:700;color:#0f172a;font-size:13.5px;padding:0 4px 3px;text-align:center;}'
        + '.rx{display:flex;align-items:center;gap:10px;margin:6px 0 14px;}'
        + '.rxsym{font-size:42px;font-weight:900;color:#0f766e;font-family:Georgia,serif;line-height:1;} .rxsym sub{font-size:22px;}'
        + '.rxline{flex:1;height:2px;background:#0d9488;border-radius:2px;}'
        + '.rxbody{min-height:330px;white-space:pre-wrap;line-height:2.1;font-size:16px;color:#0f172a;padding:0 6px;}'
        + '.sig{margin-top:30px;display:flex;justify-content:flex-start;}'
        + '.sig .box-s{width:240px;text-align:center;} .sig .lb{font-weight:800;color:#0f766e;font-size:13.5px;} .sig .ln{margin-top:30px;border-top:1.6px dotted #5bb8af;}';
      var waveTop = '<svg class="wt" viewBox="0 0 1000 200" preserveAspectRatio="none"><path d="M0,0 H1000 V120 C835,200 700,150 500,162 C320,172 165,200 0,150 Z" fill="#0d9488"/><path d="M0,0 H1000 V92 C800,158 660,112 480,130 C300,148 150,150 0,122 Z" fill="#3bbcae" opacity="0.5"/></svg>';
      var waveBot = '<svg class="wb" viewBox="0 0 1000 200" preserveAspectRatio="none"><path d="M0,200 H1000 V92 C820,18 690,72 500,56 C320,40 160,12 0,72 Z" fill="#0d9488"/><path d="M0,200 H1000 V122 C800,58 650,102 470,86 C300,72 150,80 0,112 Z" fill="#3bbcae" opacity="0.5"/></svg>';
      var cps = [];
      if (address)  cps.push('<span class="ct"><b>العنوان:</b> ' + escapeHtml(address) + '</span>');
      if (mobile)   cps.push('<span class="ct"><b>موبايل:</b> ' + escapeHtml(mobile) + '</span>');
      if (landline) cps.push('<span class="ct"><b>الأرضي:</b> ' + escapeHtml(landline) + '</span>');
      var contactHtml = cps.join('<span class="sep">•</span>');
      var head = '<div class="head"><div class="docinfo"><div class="dname">' + escapeHtml(docName) + '</div>'
        + (specialty ? '<div class="dspec"><span class="dash">—</span> ' + escapeHtml(specialty) + ' <span class="dash">—</span></div>' : '')
        + '</div><div class="logo">' + brandHtml + '</div></div><div class="divider"></div>';
      var html = '<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><base href="' + _printBase + '"><title>' + pillText + '</title>'
        + '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
        + '<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">'
        + '<style>' + css + '</style></head><body>'
        + waveTop + waveBot
        + '<div class="pill"><span class="pc">+</span> ' + pillText + '</div>'
        + '<div class="watermark">' + emblem + '</div>'
        + (contactHtml ? '<div class="contact">' + contactHtml + '</div>' : '')
        + '<table class="page"><thead><tr><td><div class="head-space"></div></td></tr></thead>'
        + '<tfoot><tr><td><div class="foot-space"></div></td></tr></tfoot>'
        + '<tbody><tr><td><div class="content">' + head + innerHtml + '</div></td></tr></tbody></table>'
        + '</body></html>';
      _doPrint(html);
    }

    // ===== طباعة عبر iframe مخفي — لا نوافذ منبثقة ولا تعليق للتطبيق =====
    function _doPrint(html) {
      // على الموبايل/التابلت: الـ iframe المخفي يطبع صفحة الموقع — لذا نفتح تبويب طباعة مستقلاً
      var isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
        || (window.matchMedia && window.matchMedia('(max-width: 820px)').matches);
      if (isMobile) {
        var w = window.open('', '_blank');
        if (!w) { showToast('اسمح بالنوافذ المنبثقة للطباعة', 'error'); return; }
        var withPrint = html.replace('</body>',
          '<scr' + 'ipt>window.onload=function(){setTimeout(function(){try{window.focus();window.print();}catch(e){}},500);};<\/scr' + 'ipt></body>');
        w.document.open(); w.document.write(withPrint); w.document.close();
        return;
      }
      // الديسكتوب: iframe مخفي (لا تعليق للتطبيق)
      var old = document.getElementById('_printFrame');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var f = document.createElement('iframe');
      f.id = '_printFrame';
      f.setAttribute('aria-hidden', 'true');
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
      document.body.appendChild(f);
      var fired = false;
      function cleanup() { if (f && f.parentNode) f.parentNode.removeChild(f); }
      function fire() {
        if (fired) return; fired = true;
        try {
          var cw = f.contentWindow;
          cw.onafterprint = function() { setTimeout(cleanup, 200); };
          cw.focus();
          cw.print();
        } catch (e) { console.error('print error', e); }
        setTimeout(cleanup, 60000); // تنظيف احتياطي
      }
      f.onload = function() { setTimeout(fire, 450); };
      var d = f.contentWindow.document;
      d.open(); d.write(html); d.close();
      setTimeout(fire, 1600); // احتياطي إن لم يُطلق onload
    }

    window.printPatientChart = function(pid) {
      var p = allPatients[pid]; if (!p) return;
      var age = p.birthDate ? calculateAge(p.birthDate) : null;
      function cell(k, val, full) { return '<div class="info-cell' + (full ? ' full' : '') + '"><div class="k">' + k + '</div><div class="vv">' + (val || '-') + '</div></div>'; }
      // خلايا حقول المريض المخصّصة (تُطبع فقط الحقول التي لها قيمة)
      var pcustom = getChartTemplate().patient.map(function(f) {
        var d = _cfDisplayVal(f, (p.custom || {})[f.id]);
        return d === '' ? '' : cell(escapeHtml(f.label), escapeHtml(d));
      }).join('');
      var info = '<div class="sec-title">معلومات المريض</div><div class="info-grid">'
        + cell('الاسم', escapeHtml(p.name || '-'))
        + cell('الهاتف', escapeHtml(p.phone || '-'))
        + cell('تاريخ الميلاد', p.birthDate ? formatDateAr(p.birthDate) : '-')
        + cell('العمر', age != null ? age + ' سنة' : '-')
        + cell('زمرة الدم', escapeHtml(p.bloodType || '-'))
        + cell('العنوان', escapeHtml(p.address || '-'))
        + pcustom
        + cell('أمراض مزمنة', escapeHtml(p.chronicDiseases || 'لا يوجد'), true)
        + '</div>';
      // عمود إضافي لحقول الزيارة المخصّصة (يظهر فقط عند وجود حقول زيارة مُعرّفة)
      var vFields = getChartTemplate().visit;
      function _vCustomText(v) {
        var custom = (v && v.custom) || {};
        return vFields.map(function(f) {
          var d = _cfDisplayVal(f, custom[f.id]);
          return d === '' ? '' : (escapeHtml(f.label) + ': ' + escapeHtml(d));
        }).filter(Boolean).join(' · ');
      }
      var visits = (p.appointments || []).slice().sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });
      var rows = visits.map(function(v, i) { return '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(v.visitType || '-') + '</td><td>' + formatDateAr(v.date) + '</td><td>' + slotTimeOf(v) + '</td>' + (vFields.length ? ('<td>' + (_vCustomText(v) || '-') + '</td>') : '') + '</tr>'; }).join('');
      if (!rows) rows = '<tr><td colspan="' + (vFields.length ? 5 : 4) + '" style="text-align:center;color:#64748b;">لا توجد زيارات</td></tr>';
      var archive = '<div class="sec-title">أرشيف الزيارات</div><table class="atbl"><thead><tr><th style="width:42px;">#</th><th>نوع الزيارة</th><th>التاريخ</th><th>الوقت</th>' + (vFields.length ? '<th>القياسات / البيانات</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table>';
      _printSheet('إضبارة المريض', info + archive);
    };
    window.printPrescription = function(pid, idx) {
      var p = allPatients[pid]; var v = p && p.appointments && p.appointments[idx]; if (!v) return;
      function ic(path) {
        return '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#0d9488" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">' + path + '</svg>';
      }
      var icUser = ic('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>');
      var icPin  = ic('<path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/>');
      var icCal  = ic('<rect x="3" y="4" width="18" height="17" rx="2.5"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/>');
      function row(icon, label, val) {
        return '<div class="r">' + icon + '<span class="lb">' + label + '</span><span class="vl">' + (val ? escapeHtml(val) : '') + '</span></div>';
      }
      var rxText = v.prescription ? escapeHtml(v.prescription) : '';
      var inner = '<div class="grid2">'
          + '<div class="col">' + row(icUser, 'اسم المريض/ة :', p.name) + row(icPin, 'العنوان :', p.address) + '</div>'
          + '<div class="vdiv"></div>'
          + '<div class="col">' + row(icCal, 'التاريخ :', formatDateAr(v.date)) + '</div>'
        + '</div>'
        + '<div class="rx"><span class="rxsym">R<sub>x</sub></span><span class="rxline"></span></div>'
        + '<div class="rxbody">' + rxText + '</div>'
        + '<div class="sig"><div class="box-s"><div class="lb">توقيع الطبيب</div><div class="ln"></div></div></div>';
      _printSheet('وصفة طبية', inner);
    };

    /* ============================================================
       نظام تخصيص الاضبارة — حقول مخصّصة حسب تخصص الطبيب
       • تعريفات الحقول تُخزَّن في settings.chartTemplate = { patient:[], visit:[] }
         (تُحمَّل مع بقية الإعدادات من settings/doctor — بلا قراءة إضافية).
       • القيم تُخزَّن داخل مستند المريض: p.custom[fieldId] (مستوى المريض)
         وداخل كل زيارة: v.custom[fieldId] (مستوى الزيارة).
       • لا حاجة لتعديل قاعدة البيانات إطلاقاً: Firestore بلا مخطط ثابت،
         وقاعدة patients مفتوحة للكادر، والحفظ عبر setDoc(...,{merge:true}) القائم.
       ============================================================ */

    // أنواع الحقول المدعومة
    var CF_TYPES = [
      { v: 'text',     label: 'نص' },
      { v: 'textarea', label: 'نص طويل' },
      { v: 'number',   label: 'رقم' },
      { v: 'date',     label: 'تاريخ' },
      { v: 'select',   label: 'قائمة منسدلة' },
      { v: 'checkbox', label: 'نعم / لا' }
    ];

    // قوالب جاهزة حسب التخصص (وفق الممارسات السورية) — تُطبَّق ثم يعدّلها الطبيب
    // ملاحظة: أُسقطت الحقول المكرّرة للحقول المدمجة أصلاً (زمرة الدم، الأمراض المزمنة)،
    // وحقل رفع الصور (يحتاج تخزيناً خاصاً) — يمكن إضافتها يدوياً عند الحاجة.
    var CHART_PRESETS = {
      'نسائية': {
        patient: [
          { label: 'القصة التوليدية (GPA)', type: 'text' },
          { label: 'عدد مرات الحمل (Gravida)', type: 'number' },
          { label: 'عدد مرات الولادة (Parity)', type: 'number' },
          { label: 'عدد الإسقاطات', type: 'number' },
          { label: 'السوابق القيصرية', type: 'textarea' },
          { label: 'وسائل منع الحمل المستخدمة', type: 'text' }
        ],
        visit: [
          { label: 'تاريخ آخر طمث (LMP)', type: 'date' },
          { label: 'موعد الولادة المتوقع (EDD)', type: 'date' },
          { label: 'نتائج فحص عنق الرحم (Pap Smear)', type: 'textarea' },
          { label: 'الفحص بالصدى (Echo)', type: 'textarea' }
        ]
      },
      'أطفال': {
        patient: [
          { label: 'الوزن عند الولادة (كغ)', type: 'number' },
          { label: 'نوع الولادة', type: 'select', options: ['طبيعية', 'قيصرية', 'أخرى'] },
          { label: 'وجود اختناق ولادي', type: 'checkbox' },
          { label: 'نوع الإرضاع', type: 'select', options: ['طبيعي', 'صناعي', 'مختلط'] },
          { label: 'سجل اللقاحات', type: 'textarea' },
          { label: 'اسم ولي الأمر', type: 'text' },
          { label: 'رقم هاتف ولي الأمر', type: 'text' }
        ],
        visit: [
          { label: 'التطور الروحي الحركي', type: 'textarea' },
          { label: 'الوزن الحالي (كغ)', type: 'number' },
          { label: 'الطول الحالي (سم)', type: 'number' },
          { label: 'محيط الرأس (سم)', type: 'number' }
        ]
      },
      'باطنية': {
        patient: [
          { label: 'عوامل الخطورة', type: 'textarea' }
        ],
        visit: [
          { label: 'ضغط الدم', type: 'text' },
          { label: 'مستوى السكر في الدم', type: 'number' },
          { label: 'نتائج الفحوصات المخبرية', type: 'textarea' },
          { label: 'نتائج الفحوصات الشعاعية', type: 'textarea' }
        ]
      },
      'قلبية': {
        patient: [
          { label: 'تاريخ أمراض القلب', type: 'textarea' },
          { label: 'الأدوية القلبية', type: 'textarea' }
        ],
        visit: [
          { label: 'نتائج تخطيط القلب (ECG)', type: 'textarea' },
          { label: 'نتائج إيكو القلب (Echo)', type: 'textarea' },
          { label: 'اختبار الجهد', type: 'textarea' }
        ]
      },
      'جلدية': {
        patient: [
          { label: 'تاريخ الأمراض الجلدية', type: 'textarea' },
          { label: 'العلاجات الجلدية السابقة', type: 'textarea' },
          { label: 'تاريخ التعرض للشمس', type: 'textarea' }
        ],
        visit: [
          { label: 'وصف الآفة الجلدية', type: 'textarea' },
          { label: 'توزع الآفة', type: 'text' },
          { label: 'شكل الآفة الأولية', type: 'select', options: ['حطاطة', 'بثرة', 'حويصلة', 'فقاعة', 'بقعة', 'لويحة', 'عقدة', 'ورم'] },
          { label: 'الحكة', type: 'checkbox' }
        ]
      },
      'عظمية': {
        patient: [
          { label: 'تاريخ الإصابات العظمية', type: 'textarea' },
          { label: 'العمليات الجراحية العظمية', type: 'textarea' }
        ],
        visit: [
          { label: 'آلية الإصابة الحالية', type: 'textarea' },
          { label: 'وصف الألم', type: 'textarea' },
          { label: 'الوظيفة الحركية', type: 'textarea' },
          { label: 'نتائج الأشعة', type: 'textarea' },
          { label: 'العلاج الطبيعي', type: 'textarea' }
        ]
      },
      'أسنان': {
        patient: [
          { label: 'حساسية أدوية', type: 'text' }
        ],
        visit: [
          { label: 'الشكوى الرئيسية', type: 'text' },
          { label: 'موقع الألم', type: 'text' },
          { label: 'مدة الألم', type: 'text' },
          { label: 'شدة الألم', type: 'select', options: ['خفيف', 'متوسط', 'شديد'] },
          { label: 'الحساسية (حار/بارد/حلو)', type: 'text' },
          { label: 'حالة اللثة', type: 'select', options: ['طبيعية', 'التهاب', 'نزيف', 'انحسار'] },
          { label: 'وجود تسوّس', type: 'select', options: ['لا يوجد', 'بسيط', 'متعدد'] },
          { label: 'رائحة الفم', type: 'select', options: ['طبيعية', 'كريهة'] },
          { label: 'حركة الأسنان', type: 'checkbox' },
          { label: 'الإجراءات المنفّذة', type: 'textarea' },
          { label: 'ملاحظات الفحص', type: 'textarea' },
          { label: 'موعد المراجعة', type: 'date' }
        ]
      }
    };

    // يرجّع تعريف القالب الحالي بشكل سليم دائماً (يقرأ من الإعدادات المحمّلة)
    function getChartTemplate() {
      var t = (typeof settings !== 'undefined' && settings && settings.chartTemplate) || {};
      return {
        patient: Array.isArray(t.patient) ? t.patient : [],
        visit:   Array.isArray(t.visit)   ? t.visit   : []
      };
    }
    function _cfNewId() { return 'cf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    // تهريب قيمة سمة HTML (للاقتباس المزدوج)
    function _cfAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    // ===== توليد عناصر الإدخال من تعريف الحقول وملؤها بالقيم الحالية =====
    // opts: { heading, variant }  — variant: 'form' (بطاقة المريض) | 'editor' (محرّر الزيارة: صناديق كبيرة بحدود)
    function buildCustomFieldInputs(container, fields, values, opts) {
      if (!container) return;
      opts = (typeof opts === 'string') ? { heading: opts } : (opts || {});   // توافق خلفي مع توقيع (heading)
      var variant = opts.variant || 'form';
      container.innerHTML = '';
      if (!fields || !fields.length) { container.style.display = 'none'; return; }
      container.style.display = '';
      values = values || {};
      if (opts.heading) {
        var h = document.createElement('div');
        h.style.cssText = 'font-size:.8rem;font-weight:800;color:var(--primary);margin:2px 0 10px;';
        h.textContent = opts.heading;
        container.appendChild(h);
      }
      // شبكة مرنة: الحقول القصيرة بأعمدة تملأ العرض، الحقول الطويلة (textarea) بعرض كامل
      var grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;align-items:start;';
      var labelCss = (variant === 'editor')
        ? 'display:block;font-weight:700;font-size:.82rem;color:var(--text-primary);margin-bottom:6px;'
        : 'display:block;font-size:.8rem;font-weight:700;color:var(--text-secondary);margin-bottom:5px;';
      var boxCss = 'width:100%;padding:12px 13px;background:var(--bg);border:1.5px solid var(--border);border-radius:12px;color:var(--text-primary);font-family:inherit;font-size:.9rem;box-sizing:border-box;';
      function styleInput(el, extra) {
        if (variant === 'editor') {
          el.style.cssText = boxCss + (extra || '');
          el.addEventListener('focus', function() { el.style.borderColor = 'var(--primary)'; });
          el.addEventListener('blur', function() { el.style.borderColor = 'var(--border)'; });
        } else {
          el.className = 'form-input'; if (extra) el.style.cssText = extra;
        }
      }
      fields.forEach(function(f) {
        var cell = document.createElement('div');
        var val = values[f.id];
        var el;
        if (f.type === 'textarea') {
          cell.style.gridColumn = '1/-1';
          var lblt = document.createElement('label'); lblt.style.cssText = labelCss; lblt.textContent = f.label || '(حقل)'; cell.appendChild(lblt);
          el = document.createElement('textarea'); el.rows = (variant === 'editor') ? 3 : 2;
          styleInput(el, 'resize:vertical;line-height:1.7;min-height:' + (variant === 'editor' ? '84px' : '60px') + ';');
          el.value = (val != null ? val : '');
        } else if (f.type === 'checkbox') {
          // صندوق بحدود: عنوان + مفتاح
          cell.style.cssText = (variant === 'editor')
            ? 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;background:var(--bg);border:1.5px solid var(--border);border-radius:12px;'
            : 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:22px;';
          var lblc = document.createElement('span'); lblc.style.cssText = 'font-weight:700;font-size:.82rem;color:var(--text-primary);'; lblc.textContent = f.label || '(حقل)'; cell.appendChild(lblc);
          el = document.createElement('input'); el.type = 'checkbox';
          el.checked = (val === true || val === 'true' || val === 'نعم');
          el.style.cssText = 'width:20px;height:20px;accent-color:var(--primary);cursor:pointer;flex-shrink:0;';
        } else {
          var lbl = document.createElement('label'); lbl.style.cssText = labelCss; lbl.textContent = f.label || '(حقل)'; cell.appendChild(lbl);
          if (f.type === 'select') {
            el = document.createElement('select'); styleInput(el);
            var blank = document.createElement('option'); blank.value = ''; blank.textContent = '—'; el.appendChild(blank);
            (f.options || []).forEach(function(o) {
              var op = document.createElement('option'); op.value = o; op.textContent = o;
              if (String(val) === String(o)) op.selected = true; el.appendChild(op);
            });
          } else {
            el = document.createElement('input');
            el.type = (f.type === 'number') ? 'number' : (f.type === 'date' ? 'date' : 'text');
            styleInput(el); el.value = (val != null ? val : '');
          }
        }
        el.setAttribute('data-cfid', f.id);
        el.setAttribute('data-cftype', f.type);
        cell.appendChild(el);
        grid.appendChild(cell);
      });
      container.appendChild(grid);
    }

    // يقرأ القيم من الحاوية ويرجع كائن { fieldId: value } (يتجاهل الفارغ)
    function readCustomFieldInputs(container) {
      var out = {};
      if (!container) return out;
      Array.prototype.forEach.call(container.querySelectorAll('[data-cfid]'), function(el) {
        var id = el.getAttribute('data-cfid'), type = el.getAttribute('data-cftype');
        if (type === 'checkbox') { if (el.checked) out[id] = true; return; }
        var v = el.value;
        if (v != null && String(v).trim() !== '') out[id] = (type === 'number') ? Number(v) : v;
      });
      return out;
    }

    // ===== عرض القيم (قراءة فقط) =====
    function _cfDisplayVal(f, val) {
      if (f.type === 'checkbox') return val ? 'نعم' : '';       // لا نُظهر "لا" لتقليل الضجيج
      if (f.type === 'date' && val) return formatDateAr(val);
      return (val != null && String(val).trim() !== '') ? String(val) : '';
    }
    function _cfChip(label, valHtml, color) {
      return '<div style="background:var(--bg);border:1.5px solid var(--border);border-radius:10px;padding:8px 11px;min-width:0;overflow:hidden;">'
        + '<div style="font-size:.68rem;color:var(--text-muted);font-weight:600;margin-bottom:2px;">' + escapeHtml(label) + '</div>'
        + '<div style="font-size:.86rem;font-weight:700;word-break:break-word;overflow-wrap:anywhere;color:' + (color || 'var(--text-primary)') + ';">' + (valHtml || '-') + '</div></div>';
    }
    // بطاقات حقول المريض المخصّصة (في رأس الاضبارة) — تُعرض فقط الحقول التي لها قيمة
    function renderPatientCustomChips(custom) {
      custom = custom || {};
      return getChartTemplate().patient.map(function(f) {
        var d = _cfDisplayVal(f, custom[f.id]);
        return d === '' ? '' : _cfChip(f.label, escapeHtml(d));
      }).join('');
    }
    // ===== 🩺 عناصر تصميم البروفايل (اضبارة المريض) =====
    function _cfIsAllergy(f) { return /حساس|تحسس|allerg/i.test(f.label || ''); }
    function _cfTypeIcon(type) {
      return type === 'number' ? 'fa-hashtag' : type === 'date' ? 'fa-calendar-day'
        : type === 'select' ? 'fa-list-ul' : type === 'checkbox' ? 'fa-circle-check' : 'fa-notes-medical';
    }
    function _pfPill(k, v, dotColor) {
      return '<span class="pf-pill">' + (dotColor ? '<span class="dot" style="background:' + dotColor + '"></span>' : '')
        + '<span class="k">' + escapeHtml(k) + '</span><span class="val num">' + v + '</span></span>';
    }
    function _pfTile(label, valHtml, opts) {
      opts = opts || {};
      var icon = opts.icon ? '<i class="fas ' + opts.icon + '"' + (opts.iconColor ? ' style="color:' + opts.iconColor + '"' : '') + '></i>' : '';
      var vc = opts.valColor ? ' style="color:' + opts.valColor + '"' : '';
      return '<div class="pf-tile' + (opts.full ? ' full' : '') + '"><span class="lab">' + icon + escapeHtml(label) + '</span>'
        + '<span class="val"' + vc + '>' + (valHtml || '-') + '</span></div>';
    }
    function _pfAllergy(custom) {
      custom = custom || {};
      return getChartTemplate().patient.filter(_cfIsAllergy).map(function(f) {
        var d = _cfDisplayVal(f, custom[f.id]);
        return d === '' ? '' : '<div class="pf-alert"><div class="ic"><i class="fas fa-triangle-exclamation"></i></div>'
          + '<div><div class="t">' + escapeHtml(f.label) + '</div><div class="d">' + escapeHtml(d) + '</div></div></div>';
      }).join('');
    }
    function renderPatientCustomTiles(custom) {
      custom = custom || {};
      return getChartTemplate().patient.filter(function(f) { return !_cfIsAllergy(f); }).map(function(f) {
        var d = _cfDisplayVal(f, custom[f.id]);
        return d === '' ? '' : _pfTile(f.label, escapeHtml(d), { icon: _cfTypeIcon(f.type) });
      }).join('');
    }
    // شارات الرأس (العمر/الزمرة/الزيارات...) وبطاقات المعلومات — تُستخدم في openPatientDetailsModal
    function renderChartHeaderPills(p) {
      var age = p.birthDate ? calculateAge(p.birthDate) : null;
      var visits = String(p.totalVisits || (p.appointments ? p.appointments.length : 0));
      return _pfPill('العمر', age != null ? age + ' سنة' : '-')
        + (p.bloodType ? _pfPill('الزمرة', escapeHtml(p.bloodType), '#dc2626') : '')
        + _pfPill('الزيارات', visits)
        + (p.birthDate ? _pfPill('الميلاد', formatDateAr(p.birthDate)) : '')
        + (p.address ? _pfPill('العنوان', escapeHtml(p.address)) : '');
    }
    function renderChartInfoTiles(p) {
      var age = p.birthDate ? calculateAge(p.birthDate) : null;
      var visits = String(p.totalVisits || (p.appointments ? p.appointments.length : 0));
      return _pfAllergy(p.custom)
        + _pfTile('رقم الهاتف', '<span dir="ltr">' + escapeHtml(p.phone || '-') + '</span>', { icon: 'fa-phone' })
        + _pfTile('تاريخ الميلاد', p.birthDate ? formatDateAr(p.birthDate) : '-', { icon: 'fa-calendar-day' })
        + _pfTile('العمر', age != null ? age + ' سنة' : '-', { icon: 'fa-hourglass-half' })
        + _pfTile('زمرة الدم', p.bloodType ? escapeHtml(p.bloodType) : '-', { icon: 'fa-droplet', iconColor: '#dc2626', valColor: p.bloodType ? '#dc2626' : 'var(--text-muted)' })
        + _pfTile('العنوان', escapeHtml(p.address || '-'), { icon: 'fa-location-dot' })
        + _pfTile('إجمالي الزيارات', visits, { icon: 'fa-clock-rotate-left' })
        + renderPatientCustomTiles(p.custom)
        + _pfTile('أمراض مزمنة', escapeHtml(p.chronicDiseases || 'لا يوجد'), { full: true, icon: 'fa-heart-pulse', iconColor: '#d97706', valColor: p.chronicDiseases ? '#d97706' : 'var(--text-muted)' });
    }
    // شبكة حقول الزيارة المخصّصة (داخل بطاقة الزيارة في الأرشيف)
    function renderVisitCustomHtml(custom) {
      custom = custom || {};
      var items = getChartTemplate().visit.map(function(f) {
        var d = _cfDisplayVal(f, custom[f.id]);
        if (d === '') return '';
        return '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 9px;min-width:0;">'
          + '<div style="font-size:.66rem;color:var(--text-muted);font-weight:600;margin-bottom:2px;">' + escapeHtml(f.label) + '</div>'
          + '<div style="font-size:.82rem;font-weight:700;color:var(--text-primary);word-break:break-word;">' + escapeHtml(d) + '</div></div>';
      }).filter(Boolean);
      if (!items.length) return '';
      return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-top:12px;">' + items.join('') + '</div>';
    }

    /* ===== مُخصِّص الاضبارة (نافذة الإعدادات) ===== */
    var _cfDraft = { patient: [], visit: [] };
    function _cfClone(f) { return { id: f.id || _cfNewId(), label: f.label || '', type: f.type || 'text', options: (f.options || []).slice() }; }

    window.openChartCustomizer = function() {
      var t = getChartTemplate();
      _cfDraft = { patient: t.patient.map(_cfClone), visit: t.visit.map(_cfClone), dental: !!(settings && settings.chartTemplate && settings.chartTemplate.dental) };
      // ملء قائمة القوالب الجاهزة
      var sel = document.getElementById('cfPresetSelect');
      if (sel) {
        sel.innerHTML = '<option value="">— اختر تخصصاً —</option>'
          + Object.keys(CHART_PRESETS).map(function(k) { return '<option value="' + _cfAttr(k) + '">' + escapeHtml(k) + '</option>'; }).join('');
      }
      renderCustomizerRows();
      document.getElementById('chartCustomizerModal').classList.remove('hidden');
      var _rail = document.getElementById('mainRail'); if (_rail) _rail.style.display = 'none';   // إخفاء السايدبار (ملء الشاشة)
    };
    window.closeChartCustomizer = function() {
      document.getElementById('chartCustomizerModal').classList.add('hidden');
      var _rail = document.getElementById('mainRail'); if (_rail) _rail.style.display = '';   // إعادة إظهار السايدبار
    };

    function _cfRowHtml(scope, f, idx) {
      var typeOpts = CF_TYPES.map(function(t) { return '<option value="' + t.v + '"' + (t.v === f.type ? ' selected' : '') + '>' + t.label + '</option>'; }).join('');
      var showOpts = (f.type === 'select');
      var btn = 'width:32px;height:32px;border-radius:9px;border:1.5px solid var(--border);background:var(--bg);color:var(--text-muted);cursor:pointer;flex-shrink:0;font-size:.82rem;';
      var subLbl = 'font-size:.68rem;color:var(--text-muted);font-weight:600;margin-bottom:4px;';
      // بطاقة حقل — بنفس هوية بطاقات الاضبارة: عنوان بارز أعلى، النوع والخيارات أسفله
      return '<div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:10px;box-shadow:var(--shadow-sm);">'
        + '<div style="display:flex;gap:8px;align-items:center;">'
          + '<span style="width:32px;height:32px;border-radius:9px;background:var(--primary-light);color:var(--primary);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:.8rem;"><i class="fas fa-grip-vertical"></i></span>'
          + '<input class="form-input" style="flex:1;min-width:0;font-weight:700;" value="' + _cfAttr(f.label) + '" placeholder="اسم الحقل (مثال: ضغط الدم)" oninput="cfEdit(\'' + scope + '\',' + idx + ',\'label\',this.value)">'
          + '<button title="حذف الحقل" style="' + btn + 'color:#dc2626;border-color:#fecaca;background:#fef2f2;" onclick="cfDelete(\'' + scope + '\',' + idx + ')"><i class="fas fa-trash"></i></button>'
        + '</div>'
        + '<div style="display:flex;gap:10px;flex-wrap:wrap;padding-right:40px;">'
          + '<div style="flex:1;min-width:130px;"><div style="' + subLbl + '">نوع الحقل</div>'
            + '<select class="form-input" onchange="cfEdit(\'' + scope + '\',' + idx + ',\'type\',this.value)">' + typeOpts + '</select></div>'
          + '<div style="flex:2;min-width:150px;' + (showOpts ? '' : 'display:none;') + '"><div style="' + subLbl + '">الخيارات (افصل بفاصلة)</div>'
            + '<input class="form-input" value="' + _cfAttr((f.options || []).join('، ')) + '" placeholder="مثال: خيار 1، خيار 2، خيار 3" oninput="cfEdit(\'' + scope + '\',' + idx + ',\'options\',this.value)"></div>'
        + '</div>'
      + '</div>';
    }
    function _cfEmptyRows() {
      return '<div style="grid-column:1/-1;text-align:center;padding:22px 14px;color:var(--text-muted);font-size:.82rem;border:1.5px dashed var(--border);border-radius:14px;"><i class="fas fa-inbox" style="font-size:1.4rem;display:block;margin-bottom:8px;opacity:.4;"></i>لا توجد حقول بعد — اضغط «إضافة حقل» أو طبّق قالباً جاهزاً.</div>';
    }
    function renderCustomizerRows() {
      var pc = document.getElementById('cfPatientRows'), vc = document.getElementById('cfVisitRows');
      if (pc) pc.innerHTML = _cfDraft.patient.length ? _cfDraft.patient.map(function(f, i) { return _cfRowHtml('patient', f, i); }).join('') : _cfEmptyRows();
      if (vc) vc.innerHTML = _cfDraft.visit.length ? _cfDraft.visit.map(function(f, i) { return _cfRowHtml('visit', f, i); }).join('') : _cfEmptyRows();
    }
    window.cfEdit = function(scope, idx, key, val) {
      var f = _cfDraft[scope] && _cfDraft[scope][idx]; if (!f) return;
      if (key === 'options') { f.options = val.split(/[،,]/).map(function(s) { return s.trim(); }).filter(Boolean); }
      else if (key === 'type') { f.type = val; renderCustomizerRows(); }   // إعادة الرسم لإظهار/إخفاء حقل الخيارات
      else f[key] = val;
    };
    window.cfAdd = function(scope) {
      _cfDraft[scope].push({ id: _cfNewId(), label: '', type: 'text', options: [] });
      renderCustomizerRows();
    };
    window.cfDelete = function(scope, idx) {
      _cfDraft[scope].splice(idx, 1);
      renderCustomizerRows();
    };
    window.cfMove = function(scope, idx, dir) {
      var arr = _cfDraft[scope], j = idx + dir;
      if (j < 0 || j >= arr.length) return;
      var tmp = arr[idx]; arr[idx] = arr[j]; arr[j] = tmp;
      renderCustomizerRows();
    };
    window.cfApplyPreset = function(name) {
      var preset = CHART_PRESETS[name];
      if (!preset) { showToast('اختر تخصصاً أولاً', 'info'); return; }
      function apply() {
        _cfDraft = { patient: (preset.patient || []).map(_cfClone), visit: (preset.visit || []).map(_cfClone), dental: (name === 'أسنان') };
        renderCustomizerRows();
        showToast('تم تطبيق قالب «' + name + '»' + (name === 'أسنان' ? ' — سيظهر مخطط الأسنان في الاضبارة' : ''), 'success');
      }
      if (_cfDraft.patient.length || _cfDraft.visit.length) {
        // رسالة تأكيد داخل النظام (بدل نافذة المتصفح)
        appConfirm('سيتم استبدال الحقول الحالية بحقول قالب «' + name + '». متابعة؟', 'استبدال').then(function(ok) { if (ok) apply(); });
      } else {
        apply();
      }
    };
    window.saveChartTemplate = function() {
      function clean(arr) {
        return arr.filter(function(f) { return (f.label || '').trim(); }).map(function(f) {
          return { id: f.id || _cfNewId(), label: f.label.trim(), type: f.type || 'text', options: f.type === 'select' ? (f.options || []) : [] };
        });
      }
      if (typeof settings === 'undefined' || !settings) settings = {};
      settings.chartTemplate = { patient: clean(_cfDraft.patient), visit: clean(_cfDraft.visit), dental: !!_cfDraft.dental };
      saveSettingsToLocal(settings);
      closeChartCustomizer();
      showToast('تم حفظ تخصيص الاضبارة ✓', 'success');
    };

    /* ===== 🦷 نظام مخطط الأسنان (منقول من نسخة dental) — يُفتح عبر openDentalChart(pid) ===== */
    // ===== 🦷 مخطط الأسنان v2 — نموذج الأحداث (Events) + حالة مشتقة (Derived Status) =====
    // القاعدة: السن = مجموعة أحداث + حالة حالية تُحسب تلقائياً. المخطط عرض فقط.
    // ألوان الحالات (للأسطح وكامل السن واللوحة التوضيحية)
    var DC_STATUS = {
      healthy:   { label: 'سليم',      bg: '#ffffff', bd: '#cbd5e1' },
      caries:    { label: 'تسوّس',      bg: '#fca5a5', bd: '#ef4444' },
      sec_caries:{ label: 'تسوّس ثانوي',bg: '#f8b4b4', bd: '#b91c1c' },
      filled:    { label: 'حشوة',      bg: '#fde68a', bd: '#f59e0b' },
      root:      { label: 'علاج عصب',  bg: '#d9f99d', bd: '#65a30d' },
      crowned:   { label: 'تاج',       bg: '#bfdbfe', bd: '#3b82f6' },
      bridge:    { label: 'جسر',       bg: '#ddd6fe', bd: '#7c3aed' },
      implant:   { label: 'زرعة',      bg: '#a7f3d0', bd: '#059669' },
      extracted: { label: 'مقلوع',     bg: '#e2e8f0', bd: '#94a3b8' },
      missing:   { label: 'مفقود',     bg: '#f1f5f9', bd: '#cbd5e1' },
      impacted:  { label: 'منطمر',     bg: '#ede9fe', bd: '#8b5cf6' }
    };
    // أنواع الأحداث: موجودات (findings) ومعالجات (treatments).
    // layer = الطبقة التي يؤثر عليها الحدث:
    //   existence (وجود السن) | coverage (تغطية: تاج/جسر) | endo (عصب) | impacted (انطمار)
    //   | surface (سطح محدد: تسوّس/حشوة) | alert (تنبيه: ألم/كسر/لثة/حركة) | reset (سليم) | none (تنظيف)
    var DC_EVENTS = {
      // ── موجودات ──
      caries:     { label: 'تسوّس',        color: '#ef4444', kind: 'finding',   layer: 'surface',   surf: 'caries' },
      sec_caries: { label: 'تسوّس ثانوي',  color: '#b91c1c', kind: 'finding',   layer: 'surface',   surf: 'sec_caries' },
      pain:       { label: 'ألم',          color: '#f97316', kind: 'finding',   layer: 'alert' },
      fracture:   { label: 'كسر',          color: '#e11d48', kind: 'finding',   layer: 'alert' },
      gum:        { label: 'التهاب لثة',   color: '#f43f5e', kind: 'finding',   layer: 'alert' },
      mobility:   { label: 'حركة/قلقلة',   color: '#d946ef', kind: 'finding',   layer: 'alert' },
      impacted:   { label: 'منطمر',        color: '#8b5cf6', kind: 'finding',   layer: 'impacted' },
      missing:    { label: 'مفقود',        color: '#94a3b8', kind: 'finding',   layer: 'existence', exist: 'missing' },
      // ── معالجات ──
      filled:     { label: 'حشوة',         color: '#f59e0b', kind: 'treatment', layer: 'surface',   surf: 'filled' },
      root:       { label: 'علاج عصب',     color: '#65a30d', kind: 'treatment', layer: 'endo' },
      crowned:    { label: 'تاج',          color: '#3b82f6', kind: 'treatment', layer: 'coverage',  cover: 'crowned' },
      bridge:     { label: 'جسر',          color: '#7c3aed', kind: 'treatment', layer: 'coverage',  cover: 'bridge' },
      implant:    { label: 'زرعة',         color: '#059669', kind: 'treatment', layer: 'existence', exist: 'implant' },
      extracted:  { label: 'قلع',          color: '#64748b', kind: 'treatment', layer: 'existence', exist: 'extracted' },
      cleaning:   { label: 'تنظيف',        color: '#0ea5e9', kind: 'treatment', layer: 'none' },
      healthy:    { label: 'سليم',         color: '#10b981', kind: 'treatment', layer: 'reset' }
    };
    // ألوان حالات الأسطح
    var DC_SURF_COLORS = { caries: '#ef4444', sec_caries: '#b91c1c', filled: '#f59e0b' };
    var DC_FINDINGS = ['caries', 'sec_caries', 'pain', 'fracture', 'gum', 'mobility', 'impacted', 'missing'];
    var DC_TREATMENTS = ['filled', 'root', 'crowned', 'bridge', 'implant', 'extracted', 'cleaning', 'healthy'];
    var DC_UPPER = [28,27,26,25,24,23,22,21,11,12,13,14,15,16,17,18];
    var DC_LOWER = [38,37,36,35,34,33,32,31,41,42,43,44,45,46,47,48];
    // أرباع عرض القوس (Odontogram): يمين المريض = يسار الشاشة (العرف السريري)
    var DC_ARCH_QUADS = [
      { teeth: [11,12,13,14,15,16,17,18], sx: -1, jaw: 'up'  },
      { teeth: [21,22,23,24,25,26,27,28], sx:  1, jaw: 'up'  },
      { teeth: [41,42,43,44,45,46,47,48], sx: -1, jaw: 'low' },
      { teeth: [31,32,33,34,35,36,37,38], sx:  1, jaw: 'low' }
    ];
    function dcToothName(fdi) {
      var q = Math.floor(fdi / 10), pos = fdi % 10;
      var posNames = { 1: 'قاطع مركزي', 2: 'قاطع جانبي', 3: 'ناب', 4: 'ضاحك أول', 5: 'ضاحك ثاني', 6: 'طاحن أول', 7: 'طاحن ثاني', 8: 'طاحن ثالث' };
      return posNames[pos] + ' ' + (q <= 2 ? 'علوي' : 'سفلي') + ' ' + ((q === 1 || q === 4) ? 'أيمن' : 'أيسر');
    }
    function dcRootCount(fdi) {
      var q = Math.floor(fdi / 10), pos = fdi % 10;
      if (pos <= 3) return 1;
      if (pos <= 5) return 2;
      if (q <= 2) return 3;
      return pos === 6 ? 2 : 3;
    }
    function dcToothEvents(p, fdi) {
      return (p && p.dentalEvents || []).filter(function(e){ return String(e.tooth) === String(fdi); })
        .slice().sort(function(a, b) {
          var d = (a.date || '').localeCompare(b.date || '');
          return d !== 0 ? d : ((a.ts || 0) - (b.ts || 0));
        });
    }
    // تعريف الحدث (مع توافق للأحداث القديمة التي تحمل e.to)
    function dcDefOf(e) {
      if (DC_EVENTS[e.type]) return DC_EVENTS[e.type];
      var map = { healthy:'healthy', caries:'caries', filled:'filled', root:'root', crowned:'crowned', bridge:'bridge', implant:'implant', extracted:'extracted' };
      if (e && e.to && map[e.to]) return DC_EVENTS[map[e.to]];
      return null;
    }
    // اشتقاق الحالة الحالية تلقائياً من سلسلة الأحداث — نموذج طبقي + لكل سطح على حِدة
    function dcDerive(p, fdi) {
      var evs = dcToothEvents(p, fdi);
      var centerKey = dcSurfaceMap(fdi).center;
      var st = { existence: 'present', coverage: null, endo: false, impacted: false, surfaces: {}, alerts: {} };
      evs.forEach(function(e) {
        var def = dcDefOf(e); if (!def) return;
        switch (def.layer) {
          case 'reset': // «سليم»: يُصفّر كل الطبقات
            st.existence = 'present'; st.coverage = null; st.endo = false; st.impacted = false; st.surfaces = {}; st.alerts = {};
            break;
          case 'existence': // تغيّر هوية السن (قلع/مفقود/زرعة) يُصفّر الطبقات الأدنى
            st.existence = def.exist;
            st.coverage = null; st.endo = false; st.impacted = false; st.surfaces = {};
            break;
          case 'coverage':
            if (st.existence !== 'implant') st.existence = 'present';
            st.coverage = def.cover;
            break;
          case 'endo':
            if (st.existence !== 'implant') st.existence = 'present';
            st.endo = true;
            break;
          case 'impacted':
            st.impacted = true;
            break;
          case 'surface': // تسوّس/حشوة — لكل سطح على حِدة، آخر حدث يفوز على هذا السطح فقط
            if (st.existence !== 'implant') st.existence = 'present';
            var sfs = (e.surfaces && e.surfaces.length) ? e.surfaces : [centerKey];
            sfs.forEach(function(s) { st.surfaces[s] = def.surf; });
            break;
          case 'alert': // ألم/كسر/لثة/حركة — تنبيه بدون تغيير لون
            st.alerts[e.type] = { type: e.type, label: def.label, color: def.color };
            break;
          default: break; // none (تنظيف)
        }
        // أي معالجة لاحقة تُلغي التنبيهات المتراكمة على السن
        if (def.kind === 'treatment' && def.layer !== 'reset') st.alerts = {};
      });
      // توافق قديم: لا أحداث لكن توجد حالة مخزّنة في p.teeth
      if (!evs.length) {
        var t = (p && p.teeth || {})[fdi];
        if (t && t.status && t.status !== 'healthy') {
          if (t.status === 'extracted' || t.status === 'implant' || t.status === 'missing') st.existence = t.status;
          else if (t.status === 'crowned' || t.status === 'bridge') st.coverage = t.status;
          else if (t.status === 'root') st.endo = true;
          else if (t.status === 'caries' || t.status === 'filled') {
            var old = (t.surfaces && t.surfaces.length) ? t.surfaces : [centerKey];
            old.forEach(function(s) { st.surfaces[s] = t.status; });
          }
        }
      }
      var alerts = Object.keys(st.alerts).map(function(k) { return st.alerts[k]; });
      var hasCaries = Object.keys(st.surfaces).some(function(s) { return st.surfaces[s] === 'caries' || st.surfaces[s] === 'sec_caries'; });
      var hasFilling = Object.keys(st.surfaces).some(function(s) { return st.surfaces[s] === 'filled'; });
      var attention = (st.existence === 'present') && (hasCaries || alerts.length > 0);
      return {
        existence: st.existence, coverage: st.coverage, endo: st.endo, impacted: st.impacted,
        surfaces: st.surfaces, alerts: alerts, hasCaries: hasCaries, hasFilling: hasFilling,
        attention: attention, eventsCount: evs.length
      };
    }
    // الحالة الرئيسية للسن (لأغراض العنوان/الملخّص) — أولوية منطقية
    function dcPrimaryStatus(d) {
      if (d.existence === 'extracted') return 'extracted';
      if (d.existence === 'missing') return 'missing';
      if (d.existence === 'implant') return 'implant';
      if (d.coverage) return d.coverage;
      if (d.hasCaries) return 'caries';
      if (d.hasFilling) return 'filled';
      if (d.endo) return 'root';
      if (d.impacted) return 'impacted';
      return 'healthy';
    }
    function dcSurfaceMap(fdi) {
      var q = Math.floor(fdi / 10);
      var upper = q <= 2;
      var mesialOnLeft = (q === 2 || q === 3);
      return {
        top:    upper ? 'B' : 'L',
        bottom: upper ? 'L' : 'B',
        left:   mesialOnLeft ? 'M' : 'D',
        right:  mesialOnLeft ? 'D' : 'M',
        center: (fdi % 10) <= 3 ? 'I' : 'O'
      };
    }
    function dcCrownPath(pos) {
      if (pos <= 2) return 'M30,8 Q42,10 43,30 Q42,50 30,52 Q18,50 17,30 Q18,10 30,8 Z';
      if (pos === 3) return 'M30,5 Q45,13 44,30 Q45,47 30,55 Q15,47 16,30 Q15,13 30,5 Z';
      if (pos <= 5) return 'M30,7 Q48,10 49,30 Q48,50 30,53 Q12,50 11,30 Q12,10 30,7 Z';
      return 'M14,8 Q30,3 46,8 Q57,13 57,30 Q57,47 46,52 Q30,57 14,52 Q3,47 3,30 Q3,13 14,8 Z';
    }
    // بناء السن: viewBox 84×84 — التاج في المنتصف والأحرف M/D/B/L خارج السن دائماً
    // view = الكائن المشتق { existence, coverage, endo, impacted, surfaces:{حرف:حالة} }
    // plain = بدون أحرف الأسطح (لعرض القوس المصغّر)
    // مخطط السطوح المثمّن (Odontogram احترافي): مناطق بأحرف داخلية B/L/M/D/O
    function dcToothSVG(fdi, view, interactive, plain) {
      view = view || {};
      var surfaces  = view.surfaces || {};
      var existence = view.existence || 'present';
      var coverage  = view.coverage || null;
      var impacted  = view.impacted || false;
      var isImplant = existence === 'implant';
      var gone = existence === 'extracted' || existence === 'missing';
      var map = dcSurfaceMap(fdi);
      var OCT = 'M30,5 L70,5 L95,30 L95,70 L70,95 L30,95 L5,70 L5,30 Z';
      var zones = [
        { key: 'top',    d: 'M30,5 L70,5 L62,32 L38,32 Z',                lx: 50, ly: 24 },
        { key: 'bottom', d: 'M30,95 L70,95 L62,68 L38,68 Z',              lx: 50, ly: 86 },
        { key: 'left',   d: 'M30,5 L5,30 L5,70 L30,95 L38,68 L38,32 Z',   lx: 19, ly: 55 },
        { key: 'right',  d: 'M70,5 L95,30 L95,70 L70,95 L62,68 L62,32 Z', lx: 81, ly: 55 },
        { key: 'center', d: 'M44,32 h12 a6,6 0 0 1 6,6 v24 a6,6 0 0 1 -6,6 h-12 a6,6 0 0 1 -6,-6 v-24 a6,6 0 0 1 6,-6 Z', lx: 50, ly: 55 }
      ];
      // الناب: تاج مدبّب مميّز — الذروة نحو السطح القاطع (أسفل للعلوي، أعلى للسفلي)
      var posT = fdi % 10, upperT = Math.floor(fdi / 10) <= 2;
      if (posT === 3) {
        if (upperT) {
          OCT = 'M30,4 L70,4 L95,28 L95,54 L50,97 L5,54 L5,28 Z';
          zones = [
            { key: 'top',    d: 'M30,4 L70,4 L62,30 L38,30 Z',              lx: 50, ly: 22 },
            { key: 'bottom', d: 'M5,54 L38,58 L62,58 L95,54 L50,97 Z',      lx: 50, ly: 74 },
            { key: 'left',   d: 'M30,4 L5,28 L5,54 L38,58 L38,30 Z',        lx: 18, ly: 45 },
            { key: 'right',  d: 'M70,4 L95,28 L95,54 L62,58 L62,30 Z',      lx: 82, ly: 45 },
            { key: 'center', d: 'M44,30 h12 a6,6 0 0 1 6,6 v16 a6,6 0 0 1 -6,6 h-12 a6,6 0 0 1 -6,-6 v-16 a6,6 0 0 1 6,-6 Z', lx: 50, ly: 48 }
          ];
        } else {
          OCT = 'M50,3 L95,46 L95,72 L70,96 L30,96 L5,72 L5,46 Z';
          zones = [
            { key: 'top',    d: 'M5,46 L38,42 L62,42 L95,46 L50,3 Z',       lx: 50, ly: 28 },
            { key: 'bottom', d: 'M30,96 L70,96 L62,70 L38,70 Z',            lx: 50, ly: 88 },
            { key: 'left',   d: 'M5,46 L5,72 L30,96 L38,70 L38,42 Z',       lx: 18, ly: 58 },
            { key: 'right',  d: 'M95,46 L95,72 L70,96 L62,70 L62,42 Z',     lx: 82, ly: 58 },
            { key: 'center', d: 'M44,42 h12 a6,6 0 0 1 6,6 v16 a6,6 0 0 1 -6,6 h-12 a6,6 0 0 1 -6,-6 v-16 a6,6 0 0 1 6,-6 Z', lx: 50, ly: 55 }
          ];
        }
      }
      var body = '';
      zones.forEach(function(z) {
        var surf = map[z.key];
        var state = gone ? null : (surfaces[surf] || null);
        var fill = state ? (DC_SURF_COLORS[state] || '#ef4444') : '#ffffff';
        var fop  = state ? (coverage ? '.4' : '.92') : '1';
        var attrs = ' fill="' + fill + '" fill-opacity="' + fop + '" stroke="#d8dfe9" stroke-width="1.6" stroke-linejoin="round"';
        if (interactive && !gone) attrs += ' class="te-surface" data-surface="' + surf + '" onclick="dcToggleSurface(\'' + surf + '\')" style="pointer-events:all;cursor:pointer;"';
        body += '<path d="' + z.d + '"' + attrs + '/>';
        if (!plain) {
          var lFill = state ? '#ffffff' : (gone ? '#c9d2df' : '#9aa7ba');
          body += '<text x="' + z.lx + '" y="' + z.ly + '" text-anchor="middle" font-size="' + (interactive ? 14 : 13) + '" font-weight="800" fill="' + lFill + '" style="pointer-events:none;font-family:var(--font-num),sans-serif;">' + surf + '</text>';
        }
      });
      var outline = coverage === 'crowned' ? '#3b82f6' : (coverage === 'bridge' ? '#7c3aed' : (isImplant ? '#059669' : '#c9d2df'));
      var ow = coverage ? 5 : (isImplant ? 4 : 3);
      var g = '<g' + (impacted ? ' opacity=".55"' : '') + '>' + body
        + '<path d="' + OCT + '" fill="none" stroke="' + outline + '" stroke-width="' + ow + '" stroke-linejoin="round"/>';
      if (impacted) g += '<path d="' + OCT + '" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-dasharray="6,5" stroke-linejoin="round"/>';
      g += '</g>';
      if (existence === 'extracted') g += '<path d="M25,25 L75,75 M75,25 L25,75" stroke="#94a3b8" stroke-width="9" stroke-linecap="round"/>';
      if (existence === 'missing')   g += '<path d="M25,25 L75,75 M75,25 L25,75" stroke="#ef4444" stroke-width="9" stroke-linecap="round" stroke-opacity=".85"/>';
      return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' + g + '</svg>';
    }
    // جذور مثلثية بقناة متقطعة (تخضرّ مع علاج العصب) — أو برغي زرعة
    function dcRootsSVG(fdi, d, upper, w) {
      var gone = (d.existence === 'extracted' || d.existence === 'missing');
      if (gone) return '<svg class="dc-roots-svg" width="' + w + '" height="24" viewBox="0 0 64 24" style="visibility:hidden;"></svg>';
      var inner = '';
      if (d.existence === 'implant') {
        var thr = '';
        for (var t = 0; t < 3; t++) { var ty = upper ? (7 + t * 5.5) : (17 - t * 5.5); thr += '<line x1="27" y1="' + ty + '" x2="37" y2="' + (ty - 2) + '" stroke="#ecfdf5" stroke-width="1.4" stroke-opacity=".9"/>'; }
        inner = upper
          ? '<path d="M27,24 L29.5,3 Q32,0.8 34.5,3 L37,24 Z" fill="#059669"/>' + thr
          : '<path d="M27,0 L29.5,21 Q32,23.2 34.5,21 L37,0 Z" fill="#059669"/>' + thr;
      } else {
        var rc = dcRootCount(fdi);
        var rw = 13, gap = 3.5, total = rc * rw + (rc - 1) * gap, x0 = (64 - total) / 2;
        var fill = d.endo ? '#bbf7d0' : '#eef2f8', stroke = d.endo ? '#22c55e' : '#c8d2e0', canal = d.endo ? '#16a34a' : '#b8c4d6';
        for (var i = 0; i < rc; i++) {
          var x = x0 + i * (rw + gap), mx = x + rw / 2;
          if (upper) {
            inner += '<path d="M' + x + ',23 L' + (mx - 1.6) + ',3.5 Q' + mx + ',1.2 ' + (mx + 1.6) + ',3.5 L' + (x + rw) + ',23 Z" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.4" stroke-linejoin="round"/>'
                   + '<line x1="' + mx + '" y1="6" x2="' + mx + '" y2="20" stroke="' + canal + '" stroke-width="1.3" stroke-dasharray="2.5,2.2"/>';
          } else {
            inner += '<path d="M' + x + ',1 L' + (mx - 1.6) + ',20.5 Q' + mx + ',22.8 ' + (mx + 1.6) + ',20.5 L' + (x + rw) + ',1 Z" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.4" stroke-linejoin="round"/>'
                   + '<line x1="' + mx + '" y1="4" x2="' + mx + '" y2="18" stroke="' + canal + '" stroke-width="1.3" stroke-dasharray="2.5,2.2"/>';
          }
        }
      }
      return '<svg class="dc-roots-svg" width="' + w + '" height="24" viewBox="0 0 64 24">' + inner + '</svg>';
    }
    function dcBuildTooth(fdi, p) {
      var d = dcDerive(p, fdi);
      var pos = fdi % 10, upper = fdi < 30;
      var w = pos <= 2 ? 50 : (pos === 3 ? 54 : (pos <= 5 ? 58 : 68));
      var roots = dcRootsSVG(fdi, d, upper, Math.round(w * 0.78));
      var crown = '<div class="dc-crown" style="width:' + w + 'px;height:' + w + 'px;">' + dcToothSVG(fdi, d, false) + '</div>';
      var num = '<div class="dc-num">' + Math.floor(fdi / 10) + '.' + pos + '</div>';
      var parts = [DC_STATUS[dcPrimaryStatus(d)].label];
      if (d.endo && dcPrimaryStatus(d) !== 'root') parts.push('عصب');
      if (d.impacted && dcPrimaryStatus(d) !== 'impacted') parts.push('منطمر');
      var alertTxt = d.alerts.map(function(a){ return a.label; }).join('، ');
      var title = dcToothName(fdi) + ' — ' + parts.join(' + ')
        + (alertTxt ? ' ⚠ ' + alertTxt : '')
        + (d.eventsCount ? ' (' + d.eventsCount + ' حدث)' : '');
      var showDot = d.alerts.length > 0;
      return '<div class="dc-tooth" onclick="openToothEditor(' + fdi + ',event)" title="' + escapeHtml(title) + '">'
        + (showDot ? '<span class="dc-alert" title="' + escapeHtml(alertTxt) + '"></span>' : '')
        + (upper ? num + roots + crown : crown + roots + num)
        + '</div>';
    }
    // ===== عرض القوس (Odontogram بيضوي) — نفس محرك الاشتقاق، توزيع هندسي على قطع ناقص =====
    // ── سن ثلاثي الأبعاد لعرض القوس: تدرّجات مينا + ظل حوافّ + لمعة + شقوق إطباقية ──
    function dcTooth3D(fdi, d) {
      var pos = fdi % 10, uid = 'a3' + fdi;
      var isMolar = pos >= 6, isPre = (pos === 4 || pos === 5);
      var vbH = isMolar ? 66 : (isPre ? 74 : 80);
      var crown, fissure = '';
      if (isMolar) {
        crown = 'M20,7 C27,3 37,3 44,7 C54,11 58,20 58,33 C58,47 54,56 44,61 C37,65 27,65 20,61 C10,56 6,47 6,33 C6,20 10,11 20,7 Z';
        fissure = '<path d="M21,25 C28,31 36,31 43,25 M21,42 C28,36 36,36 43,42 M32,28 L32,39" stroke="#8f94a6" stroke-opacity=".42" stroke-width="2" fill="none" stroke-linecap="round"/>';
      } else if (isPre) {
        crown = 'M21,8 C27,5 37,5 43,8 C52,12 56,21 56,36 C56,51 52,59 43,64 C37,67 27,67 21,64 C12,59 8,51 8,36 C8,21 12,12 21,8 Z';
        fissure = '<path d="M18,37 C26,32 38,32 46,37" stroke="#8f94a6" stroke-opacity=".35" stroke-width="2" fill="none" stroke-linecap="round"/>';
      } else if (pos === 3) {
        crown = 'M32,2 C43,9 52,22 52,42 C52,62 44,74 32,76 C20,74 12,62 12,42 C12,22 21,9 32,2 Z';
        fissure = '<path d="M32,20 C31,33 33,47 32,57" stroke="#8f94a6" stroke-opacity=".22" stroke-width="2" fill="none" stroke-linecap="round"/>';
      } else {
        crown = 'M32,7 C46,7 54,17 54,36 C54,59 46,73 32,73 C18,73 10,59 10,36 C10,17 18,7 32,7 Z';
        fissure = '<path d="M25,20 C24,34 24,48 25,60 M39,20 C40,34 40,48 39,60" stroke="#8f94a6" stroke-opacity=".14" stroke-width="2" fill="none" stroke-linecap="round"/>';
      }
      var svgOpen = '<svg viewBox="0 0 64 ' + vbH + '" xmlns="http://www.w3.org/2000/svg">';
      // مفقود: مكان فارغ بحدود منقّطة
      if (d.existence === 'missing') {
        return svgOpen + '<path d="' + crown + '" fill="rgba(148,163,184,.07)" stroke="#cbd5e1" stroke-width="1.8" stroke-dasharray="5,4"/></svg>';
      }
      // مقلوع: سن باهت مطفي مع ✕
      if (d.existence === 'extracted') {
        return svgOpen + '<path d="' + crown + '" fill="#eef1f5" stroke="#c7cfda" stroke-width="1.5"/>'
          + '<path d="M22,' + (vbH * .3).toFixed(0) + ' L42,' + (vbH * .7).toFixed(0) + ' M42,' + (vbH * .3).toFixed(0) + ' L22,' + (vbH * .7).toFixed(0) + '" stroke="#94a3b8" stroke-width="4.6" stroke-linecap="round"/></svg>';
      }
      // زرعة: برغي تيتانيوم بتدرّج معدني (رأسه أزرق إن وُجد تاج فوقه)
      if (d.existence === 'implant') {
        var bodyLen = vbH - 26;
        var threads = '';
        for (var k = 0; k < 4; k++) {
          var ty = 22 + (k + 0.5) * (bodyLen - 4) / 4;
          threads += '<line x1="25.5" y1="' + ty.toFixed(1) + '" x2="38.5" y2="' + (ty - 3).toFixed(1) + '" stroke="#ecfdf5" stroke-opacity=".75" stroke-width="1.5"/>';
        }
        return svgOpen + '<defs><linearGradient id="gI' + uid + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#34d399"/><stop offset="50%" stop-color="#059669"/><stop offset="100%" stop-color="#047857"/></linearGradient></defs>'
          + '<path d="M23,7 h18 l-2.5,9 h-13 z" fill="' + (d.coverage ? '#3b82f6' : 'url(#gI' + uid + ')') + '"/>'
          + '<path d="M26.5,16 h11 l-2.8,' + bodyLen + ' h-5.4 z" fill="url(#gI' + uid + ')"/>'
          + threads
          + '<ellipse cx="28" cy="10.5" rx="4.5" ry="2" fill="#fff" opacity=".5"/></svg>';
      }
      // ── سن موجود: طبقات ثلاثية الأبعاد ──
      var defs = '<defs>'
        + '<radialGradient id="gE' + uid + '" cx="36%" cy="26%" r="95%"><stop offset="0%" stop-color="#ffffff"/><stop offset="38%" stop-color="#fbfaf7"/><stop offset="72%" stop-color="#eceae3"/><stop offset="100%" stop-color="#d7d6d0"/></radialGradient>'
        + '<radialGradient id="gS' + uid + '" cx="50%" cy="52%" r="62%"><stop offset="55%" stop-color="rgba(51,65,85,0)"/><stop offset="85%" stop-color="rgba(100,116,139,.13)"/><stop offset="100%" stop-color="rgba(51,65,85,.32)"/></radialGradient>'
        + '<clipPath id="c' + uid + '"><path d="' + crown + '"/></clipPath>'
        + '<filter id="f' + uid + '" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.3"/></filter>'
        + '</defs>';
      var tint = d.coverage === 'crowned' ? '#3b82f6' : (d.coverage === 'bridge' ? '#7c3aed' : (d.impacted ? '#8b5cf6' : null));
      // بقع الأسطح (تسوّس/حشوة) — إهليلجات ناعمة مموّهة داخل حدود التاج
      var map = dcSurfaceMap(fdi);
      var my = vbH * 0.49;
      var zones = {
        top:    { x: 32, y: vbH * .2,  rx: 15,   ry: vbH * .09 + 2 },
        bottom: { x: 32, y: vbH * .78, rx: 15,   ry: vbH * .09 + 2 },
        left:   { x: 14, y: my,        rx: 8.5,  ry: vbH * .17 },
        right:  { x: 50, y: my,        rx: 8.5,  ry: vbH * .17 },
        center: { x: 32, y: my,        rx: 11.5, ry: vbH * .11 }
      };
      var patches = '';
      Object.keys(zones).forEach(function(zk) {
        var stKey = d.surfaces[map[zk]];
        if (!stKey) return;
        var z = zones[zk];
        var col = stKey === 'filled' ? '#f59e0b' : (stKey === 'sec_caries' ? '#b91c1c' : '#ef4444');
        patches += '<ellipse cx="' + z.x + '" cy="' + z.y.toFixed(1) + '" rx="' + z.rx + '" ry="' + z.ry.toFixed(1) + '" fill="' + col + '" fill-opacity=".82" filter="url(#f' + uid + ')"/>';
      });
      var glossY = (vbH * .2).toFixed(1);
      var h = svgOpen + defs + '<g' + (d.impacted ? ' opacity=".62"' : '') + '>'
        + '<path d="' + crown + '" fill="url(#gE' + uid + ')"/>'
        + '<path d="' + crown + '" fill="url(#gS' + uid + ')"/>';
      if (tint) h += '<path d="' + crown + '" fill="' + tint + '" fill-opacity="' + (d.coverage ? '.42' : '.3') + '"/>';
      if (!d.coverage) h += fissure;
      if (patches) h += '<g clip-path="url(#c' + uid + ')">' + patches + '</g>';
      h += '<ellipse cx="23" cy="' + glossY + '" rx="12" ry="5.5" fill="#ffffff" opacity=".7" filter="url(#f' + uid + ')" transform="rotate(-18 23 ' + glossY + ')"/>';
      if (d.coverage) h += '<path d="' + crown + '" fill="none" stroke="' + tint + '" stroke-opacity=".55" stroke-width="2" transform="translate(32,' + (vbH / 2) + ') scale(.85) translate(-32,-' + (vbH / 2) + ')"/>';
      h += '<path d="' + crown + '" fill="none" stroke="rgba(100,116,139,.30)" stroke-width="1.3"/>';
      if (d.impacted) h += '<path d="' + crown + '" fill="none" stroke="#8b5cf6" stroke-width="1.6" stroke-dasharray="5,4"/>';
      h += '</g>';
      if (d.endo) h += '<circle cx="32" cy="8" r="4.4" fill="#65a30d" stroke="#fff" stroke-width="1.6"/>';
      return h + '</svg>';
    }
    function dcArchHTML(p) {
      // هندسة بكسلية على لوح افتراضي 380×540 — تراصّ متكيّف: عرض كل سن يُحسب من المسافة لجاريه
      var W = 380, H = 540, cx = W / 2;
      var rx = 0.362 * W, ry = 0.412 * H;
      var weights = [1, 0.94, 1, 1.05, 1.05, 1.26, 1.26, 1.14]; // قاطع مركزي → طاحن ثالث
      var tot = 0; weights.forEach(function(w) { tot += w; });
      var span = 87, start = 1.2, cum = 0, degs = [];
      for (var i = 0; i < 8; i++) { degs.push(start + (cum + weights[i] / 2) / tot * span); cum += weights[i]; }
      var base = degs.map(function(dg) {
        var a = dg * Math.PI / 180;
        return { deg: dg, bx: rx * Math.sin(a), by: ry * Math.cos(a), sinA: Math.sin(a), cosA: Math.cos(a) };
      });
      var dist = function(p1, p2) { return Math.sqrt(Math.pow(p1.bx - p2.bx, 2) + Math.pow(p1.by - p2.by, 2)); };
      var widths = base.map(function(b, i) {
        var dl = (i === 0) ? 2 * base[0].bx : dist(base[i], base[i - 1]);
        var dr = (i === 7) ? dl : dist(base[i], base[i + 1]);
        var vis = (i === 7) ? dr * 1.02 : (dl + dr) / 2 * 1.08;   // تلامس طفيف واقعي
        var pos = i + 1;
        var frac = pos >= 6 ? (52 / 64) : (pos >= 4 ? (48 / 64) : (pos === 3 ? (40 / 64) : (44 / 64))); // نسبة التاج من عرض الرسم
        return vis / frac / W * 100;
      });
      var h = '<div class="dc-arch-mid-h"></div><div class="dc-arch-mid-v"></div>'
        + '<div class="dc-arch-side" style="left:25%;top:50%;">يمين</div>'
        + '<div class="dc-arch-side" style="left:75%;top:50%;">يسار</div>';
      DC_ARCH_QUADS.forEach(function(q) {
        q.teeth.forEach(function(fdi, i) {
          var b = base[i];
          var x = (cx + q.sx * b.bx) / W * 100;
          var y = (q.jaw === 'up') ? (H / 2 - b.by) / H * 100 : (H / 2 + b.by) / H * 100;
          var xN = 50 + q.sx * 47.4 * b.sinA;
          var yN = (q.jaw === 'up') ? 50 - 48.8 * b.cosA : 50 + 48.8 * b.cosA;
          var rot = (q.jaw === 'up') ? q.sx * b.deg : -q.sx * b.deg;
          var pos = fdi % 10;
          var asp = pos >= 6 ? '64/66' : (pos >= 4 ? '64/74' : '64/80');
          var d = dcDerive(p, fdi);
          var prim = dcPrimaryStatus(d);
          var alertTxt = d.alerts.map(function(al){ return al.label; }).join('، ');
          var title = dcToothName(fdi) + ' — ' + DC_STATUS[prim].label + (alertTxt ? ' ⚠ ' + alertTxt : '');
          h += '<div class="dc-arch-tooth" style="width:' + widths[i].toFixed(2) + '%;aspect-ratio:' + asp + ';left:' + x.toFixed(2) + '%;top:' + y.toFixed(2) + '%;transform:translate(-50%,-50%) rotate(' + rot.toFixed(1) + 'deg);z-index:' + (8 - i) + ';" onclick="openToothEditor(' + fdi + ',event)" title="' + escapeHtml(title) + '">'
            + (d.alerts.length ? '<span class="dc-alert"></span>' : '')
            + dcTooth3D(fdi, d) + '</div>';
          var numStyle = (prim !== 'healthy') ? 'color:' + DC_STATUS[prim].bd + ';font-weight:700;' : '';
          h += '<div class="dc-arch-num" style="left:' + xN.toFixed(2) + '%;top:' + yN.toFixed(2) + '%;' + numStyle + '">' + fdi + '</div>';
        });
      });
      return h;
    }
    function dcRenderArch() {
      var p = allPatients[dcCurrentPid]; if (!p) return;
      var host = document.getElementById('dcArch'); if (!host) return;
      host.innerHTML = dcArchHTML(p);
    }
    var dcCurrentPid = null, teCurrentTooth = null, teEventTypes = [], teSurfaces = [];
    function dcRenderChart() {
      var p = allPatients[dcCurrentPid]; if (!p) return;
      document.getElementById('dcUpperRow').innerHTML = DC_UPPER.map(function(f){ return dcBuildTooth(f, p); }).join('');
      document.getElementById('dcLowerRow').innerHTML = DC_LOWER.map(function(f){ return dcBuildTooth(f, p); }).join('');
      dcRenderArch();
      dcRenderSummary();
    }
    // ── وضع العرض: الموبايل قوس دائماً، الشاشات الكبيرة زر تبديل (يُحفظ الاختيار) ──
    var dcViewMode = null;
    function dcIsMobile() { return window.innerWidth <= 700; }
    function dcGetView() {
      if (dcIsMobile()) return 'arch';
      if (dcViewMode) return dcViewMode;
      try { return localStorage.getItem('dcChartView') || 'rows'; } catch (e) { return 'rows'; }
    }
    window.dcSetView = function(m) {
      dcViewMode = m;
      try { localStorage.setItem('dcChartView', m); } catch (e) {}
      dcApplyView();
    };
    function dcApplyView() {
      var mode = dcGetView();
      var rows = document.getElementById('dcRowsView'), arch = document.getElementById('dcArchView');
      if (rows) rows.classList.toggle('hidden', mode !== 'rows');
      if (arch) arch.classList.toggle('hidden', mode !== 'arch');
      var wrap = document.getElementById('dcViewToggleWrap');
      if (wrap) wrap.style.display = dcIsMobile() ? 'none' : 'flex';
      var bR = document.getElementById('dcViewBtnRows'), bA = document.getElementById('dcViewBtnArch');
      if (bR) bR.classList.toggle('active', mode === 'rows');
      if (bA) bA.classList.toggle('active', mode === 'arch');
      dcRenderChart();
    }
    var _dcResizeT = null;
    window.addEventListener('resize', function() {
      var m = document.getElementById('dentalChartModal');
      if (!m || m.classList.contains('hidden')) return;
      clearTimeout(_dcResizeT); _dcResizeT = setTimeout(dcApplyView, 180);
    });
    function dcRenderSummary() {
      var p = allPatients[dcCurrentPid]; if (!p) return;
      var counts = { caries:0, filled:0, root:0, crowned:0, bridge:0, implant:0, extracted:0, missing:0, impacted:0 };
      var attention = 0;
      DC_UPPER.concat(DC_LOWER).forEach(function(f) {
        var d = dcDerive(p, f);
        if (d.existence === 'extracted') counts.extracted++;
        else if (d.existence === 'missing') counts.missing++;
        else {
          if (d.existence === 'implant') counts.implant++;
          if (d.coverage === 'crowned') counts.crowned++;
          if (d.coverage === 'bridge') counts.bridge++;
          if (d.endo) counts.root++;
          if (d.impacted) counts.impacted++;
          if (d.hasCaries) counts.caries++;
          if (d.hasFilling) counts.filled++;
        }
        if (d.attention) attention++;
      });
      var order = ['caries', 'filled', 'root', 'crowned', 'bridge', 'implant', 'extracted', 'missing', 'impacted'];
      var html = order.filter(function(k){ return counts[k]; }).map(function(k) {
        var st = DC_STATUS[k];
        return '<span class="dc-sum-chip" style="border-color:' + st.bd + '55;"><span class="dc-legend-dot" style="background:' + st.bg + ';border-color:' + st.bd + ';"></span>' + st.label + ' <b style="color:' + st.bd + ';">' + counts[k] + '</b></span>';
      }).join('');
      if (attention) html += '<span class="dc-sum-chip" style="border-color:#f9731655;color:#c2410c;"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#f97316" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg> يحتاج انتباه <b style="color:#f97316;">' + attention + '</b></span>';
      if (!html) html = '<span class="dc-sum-chip" style="border-color:#0d948855;color:#0f766e;"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#0d9488" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><path d="m8.5 12.5 2.5 2.5 4.5-5.5"/></svg> جميع الأسنان سليمة</span>';
      document.getElementById('dcSummary').innerHTML = html;
    }
    function dcRenderLegend() {
      function chip(k) {
        var ev = DC_EVENTS[k]; if (!ev) return '';
        var st = DC_STATUS[k];
        var bg = st ? st.bg : (ev.color + '22');
        var bd = st ? st.bd : ev.color;
        return '<span class="dc-legend-item"><span class="dc-legend-dot" style="background:' + bg + ';border-color:' + bd + ';"></span>' + ev.label + '</span>';
      }
      document.getElementById('dcLegend').innerHTML =
          '<div class="dc-legend-group"><span class="dc-legend-gt">موجودات</span><div class="dc-legend-row">' + DC_FINDINGS.map(chip).join('') + '</div></div>'
        + '<div class="dc-legend-group"><span class="dc-legend-gt">معالجات</span><div class="dc-legend-row">' + DC_TREATMENTS.map(chip).join('') + '</div></div>';
    }
    function dcEventDef(e) {
      return DC_EVENTS[e.type] || (e.to && DC_STATUS[e.to] ? { label: e.action || DC_STATUS[e.to].label, color: DC_STATUS[e.to].bd, kind: 'legacy' } : { label: e.action || 'حدث', color: '#64748b', kind: 'legacy' });
    }
    function dcRenderEvents() {
      var p = allPatients[dcCurrentPid]; if (!p) return;
      var evs = (p.dentalEvents || []).slice().sort(function(a, b) {
        var d = (b.date || '').localeCompare(a.date || '');
        return d !== 0 ? d : ((b.ts || 0) - (a.ts || 0));
      }).slice(0, 40);
      document.getElementById('dcEventsCount').textContent = '(' + ((p.dentalEvents || []).length) + ')';
      var box = document.getElementById('dcEventsList');
      if (!evs.length) { box.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:16px;color:var(--text-muted);font-size:.8rem;">لا توجد أحداث بعد — اضغط على أي سن لتسجيل أول حدث</div>'; return; }
      box.innerHTML = evs.map(function(e) {
        var def = dcEventDef(e);
        return '<div style="display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:7px 10px;font-size:.8rem;flex-wrap:wrap;">'
          + '<span style="background:var(--primary);color:#fff;border-radius:6px;padding:2px 9px;font-weight:900;font-size:.75rem;flex-shrink:0;">' + escapeHtml(String(e.tooth)) + '</span>'
          + '<span style="width:9px;height:9px;border-radius:3px;background:' + def.color + ';flex-shrink:0;"></span>'
          + '<span style="font-weight:800;color:var(--text-primary);flex:1;min-width:110px;">' + escapeHtml(def.label)
          + (e.surfaces && e.surfaces.length ? ' <span style="font-weight:700;color:' + def.color + ';font-size:.7rem;">[' + e.surfaces.join('،') + ']</span>' : '')
          + (e.note ? '<span style="color:var(--text-muted);font-weight:600;font-size:.74rem;"> — ' + escapeHtml(e.note) + '</span>' : '') + '</span>'
          + '<span style="font-size:.7rem;color:var(--text-muted);flex-shrink:0;"><i class="far fa-calendar" style="font-size:.62rem;"></i> ' + formatDateAr(e.date) + '</span>'
          + (e.ts ? '<button class="dc-tl-del" onclick="event.stopPropagation();dcDeleteEvent(' + e.ts + ')" title="حذف الحدث"><i class="fas fa-trash"></i></button>' : '')
          + '</div>';
      }).join('');
    }
    window.openDentalChart = function(pid) {
      var p = allPatients[pid]; if (!p) { showToast('اختر مريضاً أولاً', 'error'); return; }
      dcCurrentPid = pid;
      // ضمان معرّف ts لكل حدث قديم حتى يكون قابلاً للحذف
      (p.dentalEvents || []).forEach(function(e, i) { if (!e.ts) e.ts = ((new Date(e.date || 0).getTime()) || 0) + i + 1; });
      document.getElementById('dcPatientName').textContent = (p.name || '') + ' — اضغط على السن لعرض تاريخه وتسجيل حدث';
      dcRenderLegend(); dcApplyView(); dcRenderEvents();
      document.getElementById('dentalChartModal').classList.remove('hidden');
    };
    window.closeDentalChart = function() { document.getElementById('dentalChartModal').classList.add('hidden'); };
    window.openDentalChartFromEditor = function() {
      var pid = document.getElementById('notePatientId').value;
      if (pid) openDentalChart(pid);
    };
    // ── محرر السن: تسجيل الأحداث ──
    function teEventBtn(k) {
      var def = DC_EVENTS[k];
      var sel = teEventTypes.indexOf(k) !== -1;
      return '<button class="te-event-btn' + (sel ? ' sel' : '') + '" onclick="teSelectEvent(\'' + k + '\')"'
        + ' style="' + (sel ? 'border-color:' + def.color + ';background:' + def.color + '14;color:' + def.color + ';' : '') + '">'
        + '<span class="te-check"><i class="fas fa-check"></i></span>'
        + '<span class="te-dot" style="background:' + def.color + '22;border-color:' + def.color + ';"></span>'
        + def.label + '</button>';
    }
    function teRenderEventGrids() {
      document.getElementById('teEventsFindings').innerHTML = DC_FINDINGS.map(teEventBtn).join('');
      document.getElementById('teEventsTreatments').innerHTML = DC_TREATMENTS.map(teEventBtn).join('');
      teUpdateBadges();
    }
    // عدّاد المختار في كل قائمة منسدلة
    function teUpdateBadges() {
      var f = 0, t = 0;
      teEventTypes.forEach(function(k){ if (DC_FINDINGS.indexOf(k) > -1) f++; else if (DC_TREATMENTS.indexOf(k) > -1) t++; });
      var fb = document.getElementById('teFindBadge'), tb = document.getElementById('teTreatBadge');
      if (fb) fb.textContent = f ? String(f) : '';
      if (tb) tb.textContent = t ? String(t) : '';
    }
    // فتح/طي القائمة المنسدلة + إعادة تموضع الـ Popover بعد تغيّر الارتفاع
    window.teToggleDd = function(id) {
      var dd = document.getElementById(id); if (!dd) return;
      dd.classList.toggle('open');
      if (typeof _repositionToothPopover === 'function') { _repositionToothPopover(); setTimeout(function(){ _repositionToothPopover(); }, 280); }
    };
    // معاينة السن = الحالة الحالية + الحدث المُختار مطبَّقاً فوقها (بدون حفظ)
    function teBuildPreview() {
      var p = allPatients[dcCurrentPid];
      var d = dcDerive(p, teCurrentTooth);
      var surfaces = {}; Object.keys(d.surfaces).forEach(function(s){ surfaces[s] = d.surfaces[s]; });
      var view = { existence: d.existence, coverage: d.coverage, endo: d.endo, impacted: d.impacted, surfaces: surfaces };
      // معاينة كل الحالات المختارة مطبَّقة فوق الحالة الحالية (تحديد متعدّد)
      teEventTypes.forEach(function(k) {
        var def = DC_EVENTS[k]; if (!def) return;
        switch (def.layer) {
          case 'reset':     view = { existence:'present', coverage:null, endo:false, impacted:false, surfaces:{} }; break;
          case 'existence': view.existence = def.exist; view.coverage = null; view.endo = false; view.impacted = false; view.surfaces = {}; break;
          case 'coverage':  if (view.existence !== 'implant') view.existence = 'present'; view.coverage = def.cover; break;
          case 'endo':      if (view.existence !== 'implant') view.existence = 'present'; view.endo = true; break;
          case 'impacted':  view.impacted = true; break;
          case 'surface':   if (view.existence !== 'implant') view.existence = 'present'; teSurfaces.forEach(function(s){ view.surfaces[s] = def.surf; }); break;
          default: break; // alert / none: لا تغيير بصري
        }
      });
      return view;
    }
    function teRenderBigTooth() {
      var p = allPatients[dcCurrentPid]; if (!p || teCurrentTooth == null) return;
      document.getElementById('teBigTooth').innerHTML = dcToothSVG(teCurrentTooth, teBuildPreview(), true);
      // بطاقة السطوح تظهر فقط عند اختيار حالة سطح (تسوّس/حشوة) — قائمة مبسّطة
      var surfaceActive = teEventTypes.some(function(k){ return DC_EVENTS[k].layer === 'surface'; });
      var card = document.getElementById('teSurfaceCard');
      if (card) card.style.display = surfaceActive ? '' : 'none';
      var hint = document.getElementById('teSurfaceHint');
      if (hint) hint.textContent = 'اضغط على السطح المصاب — O مضغ · M أنسي · D وحشي · B شدقي · L لساني';
    }
    function teRenderCurrentChip() {
      var p = allPatients[dcCurrentPid]; if (!p || teCurrentTooth == null) return;
      var d = dcDerive(p, teCurrentTooth);
      var st = DC_STATUS[dcPrimaryStatus(d)];
      var extra = '';
      if (d.endo && dcPrimaryStatus(d) !== 'root') extra += '<span style="color:#65a30d;">+عصب</span>';
      if (d.impacted && dcPrimaryStatus(d) !== 'impacted') extra += '<span style="color:#8b5cf6;">+منطمر</span>';
      document.getElementById('teCurrentChip').innerHTML =
        '<span style="width:10px;height:10px;border-radius:3px;background:' + st.bg + ';border:2px solid ' + st.bd + ';"></span>'
        + '<span style="color:' + st.bd + ';">' + st.label + '</span>'
        + extra
        + (d.alerts.length ? '<span style="color:#f97316;">⚠</span>' : '');
      document.getElementById('teSub').textContent = 'الحالة الحالية مشتقة تلقائياً من ' + (d.eventsCount || 0) + ' حدث';
    }
    function teRenderHistory() {
      var p = allPatients[dcCurrentPid]; if (!p) return;
      var evs = dcToothEvents(p, teCurrentTooth).slice().reverse();
      document.getElementById('teTlCount').textContent = evs.length ? '(' + evs.length + ')' : '';
      var box = document.getElementById('teHistory');
      if (!evs.length) { box.innerHTML = '<div style="color:var(--text-muted);font-size:.78rem;padding:4px 0;">لا يوجد تاريخ مسجل لهذا السن بعد</div>'; return; }
      box.innerHTML = evs.map(function(e) {
        var def = dcEventDef(e);
        return '<div class="dc-tl-item">'
          + '<span class="dc-tl-dot" style="border-color:' + def.color + ';"></span>'
          + '<div class="dc-tl-body">'
            + '<div class="dc-tl-action"><span style="color:' + def.color + ';">' + escapeHtml(def.label) + '</span>'
            + (e.surfaces && e.surfaces.length ? '<span style="font-size:.68rem;font-weight:800;background:' + def.color + '18;color:' + def.color + ';border-radius:6px;padding:1px 7px;">' + e.surfaces.join('،') + '</span>' : '')
            + '</div>'
            + (e.note ? '<div style="font-size:.73rem;color:var(--text-secondary);margin-top:2px;">' + escapeHtml(e.note) + '</div>' : '')
            + '<div class="dc-tl-meta">' + formatDateAr(e.date) + '</div>'
          + '</div>'
          + ((e.ts) ? '<button class="dc-tl-del" onclick="dcDeleteEvent(' + e.ts + ')" title="حذف الحدث"><i class="fas fa-trash"></i></button>' : '')
          + '</div>';
      }).join('');
    }
    window.openToothEditor = function(fdi, ev) {
      var p = allPatients[dcCurrentPid]; if (!p) return;
      teCurrentTooth = fdi;
      teEventTypes = []; teSurfaces = [];
      document.getElementById('teTitle').textContent = 'السن ' + fdi + ' — ' + dcToothName(fdi);
      _setVal('teNote', '');
      _setVal('teDate', toLocalISODate(new Date()));
      teRenderEventGrids(); teRenderBigTooth(); teRenderCurrentChip(); teRenderHistory();
      // إظهار لوحة الإجراءات في العمود الأيمن (بدل الطفو فوق الأسنان)
      var emp = document.getElementById('teEmpty'), ed = document.getElementById('teEditor');
      if (emp) emp.style.display = 'none';
      if (ed) { ed.style.display = ''; ed.style.animation = 'none'; requestAnimationFrame(function(){ ed.style.animation = ''; }); ed.scrollTop = 0; }
      // على الشاشات الضيّقة: اللوحة أسفل المخطط — انزل إليها
      if (window.innerWidth < 1024) { var tp = document.getElementById('toothPanel'); if (tp && tp.scrollIntoView) tp.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    };
    window.closeToothEditor = function() {
      var emp = document.getElementById('teEmpty'), ed = document.getElementById('teEditor');
      if (ed) ed.style.display = 'none';
      if (emp) emp.style.display = '';
      teCurrentTooth = null; teEventTypes = []; teSurfaces = [];
    };
    window.teSelectEvent = function(k) {
      // تحديد متعدّد: تؤشّر عدّة حالات معاً. حالات الوجود (قلع/مفقود/زرعة/سليم) حصرية.
      var def = DC_EVENTS[k];
      var exclusive = (def.layer === 'existence' || def.layer === 'reset');
      var i = teEventTypes.indexOf(k);
      if (i !== -1) { teEventTypes.splice(i, 1); }               // إلغاء التحديد
      else if (exclusive) { teEventTypes = [k]; }                // حالة وجود: حصرية وحدها
      else {
        // إضافة حالة عادية: أزِل أي حالة وجود/تصفير سابقة (تناقض)
        teEventTypes = teEventTypes.filter(function(t){ var d = DC_EVENTS[t]; return !(d.layer === 'existence' || d.layer === 'reset'); });
        teEventTypes.push(k);
      }
      // السطوح تخصّ فقط أحداث الأسطح (تسوّس/حشوة)
      if (!teEventTypes.some(function(t){ return DC_EVENTS[t].layer === 'surface'; })) teSurfaces = [];
      teRenderEventGrids(); teRenderBigTooth();
    };
    window.dcToggleSurface = function(sf) {
      if (!teEventTypes.some(function(k){ return DC_EVENTS[k].layer === 'surface'; })) return;
      var i = teSurfaces.indexOf(sf);
      if (i === -1) teSurfaces.push(sf); else teSurfaces.splice(i, 1);
      teRenderBigTooth();
    };
    function dcRecomputeTooth(p, fdi) {
      if (dcToothEvents(p, fdi).length === 0) {
        p.teeth = p.teeth || {};
        p.teeth[fdi] = { status: 'healthy', surfaces: [], notes: '' };   // لا أحداث = سن سليم
      } else {
        dcCacheDerived(p, fdi);
      }
    }
    function dcCacheDerived(p, fdi) {
      var d = dcDerive(p, fdi);
      p.teeth = p.teeth || {};
      p.teeth[fdi] = {
        status: dcPrimaryStatus(d),
        surfaces: Object.keys(d.surfaces),
        existence: d.existence, coverage: d.coverage, endo: d.endo, impacted: d.impacted,
        attention: d.attention,
        notes: (p.teeth[fdi] && p.teeth[fdi].notes) || ''
      };
    }
    function dcPersist(p, okMsg) {
      window._fb.setDoc(window._fb.docRef('patients', dcCurrentPid), p, { merge: true })
        .then(function() { if (okMsg) showToast(okMsg, 'success'); })
        .catch(function(e) { showToast('فشل الحفظ', 'error'); console.error(e); });
    }
    window.saveToothEdit = function() {
      var p = allPatients[dcCurrentPid]; if (!p || teCurrentTooth == null) return;
      if (!teEventTypes.length) { showToast('اختر حالة واحدة على الأقل', 'error'); return; }
      var fdi = teCurrentTooth;
      // أحداث الأسطح (تسوّس/حشوة) تتطلّب تحديد سطح واحد على الأقل
      var needsSurface = teEventTypes.some(function(k){ return DC_EVENTS[k].layer === 'surface'; });
      if (needsSurface && !teSurfaces.length) { showToast('حدّد السطح المصاب على الرسمة أولاً', 'error'); return; }
      var note = _getVal('teNote');
      var date = _getVal('teDate') || toLocalISODate(new Date());
      var base = Date.now();
      p.dentalEvents = p.dentalEvents || [];
      // حدث مستقل لكل حالة مختارة (ts متتابع يحافظ على ترتيب التطبيق)
      teEventTypes.forEach(function(k, idx) {
        var def = DC_EVENTS[k];
        p.dentalEvents.unshift({
          tooth: fdi,
          type: k,
          action: def.label,
          surfaces: (def.layer === 'surface') ? teSurfaces.slice() : [],
          note: note,
          date: date,
          ts: base + idx
        });
      });
      if (p.dentalEvents.length > 500) p.dentalEvents = p.dentalEvents.slice(0, 500);
      dcCacheDerived(p, fdi);
      var cnt = teEventTypes.length;
      dcPersist(p, 'السن ' + fdi + ': حُفظت ' + cnt + (cnt === 1 ? ' حالة' : ' حالات'));
      // إبقاء المحرر مفتوحاً لتسجيل حالات إضافية
      teEventTypes = []; teSurfaces = []; _setVal('teNote', '');
      teRenderEventGrids(); teRenderBigTooth(); teRenderCurrentChip(); teRenderHistory();
      dcRenderChart(); dcRenderEvents();
    };
    // ── Confirm Modal مخصص (Promise + لوحة مفاتيح) ──
    var _dcCfResolve = null, _dcCfLastFocus = null;
    window.dcConfirm = function(opts) {
      opts = opts || {};
      return new Promise(function(resolve) {
        var m = document.getElementById('dcConfirmModal');
        if (!m) { resolve(window.confirm(opts.message || '')); return; }
        _dcCfResolve = resolve;
        _dcCfLastFocus = document.activeElement;
        document.getElementById('dcConfirmTitle').textContent = opts.title || 'تأكيد الإجراء';
        document.getElementById('dcConfirmMsg').textContent = opts.message || '';
        var ok = document.getElementById('dcConfirmOk');
        ok.textContent = opts.confirmLabel || 'حذف';
        ok.className = 'dc-cf-btn ' + (opts.danger === false ? 'dc-cf-primary' : 'dc-cf-danger');
        m.classList.add('show');
        setTimeout(function(){ ok.focus(); }, 70);
      });
    };
    window._dcCfClose = function(val) {
      var m = document.getElementById('dcConfirmModal'); if (m) m.classList.remove('show');
      if (_dcCfResolve) { _dcCfResolve(val); _dcCfResolve = null; }
      if (_dcCfLastFocus && _dcCfLastFocus.focus) { try { _dcCfLastFocus.focus(); } catch (e) {} }
    };
    document.addEventListener('keydown', function(e) {
      var m = document.getElementById('dcConfirmModal');
      if (!m || !m.classList.contains('show')) return;
      if (e.key === 'Escape') { e.preventDefault(); _dcCfClose(false); }
      else if (e.key === 'Enter') { e.preventDefault(); _dcCfClose(true); }
    });
    window.dcDeleteEvent = function(ts) {
      var p = allPatients[dcCurrentPid]; if (!p) return;
      var ev = (p.dentalEvents || []).find(function(e){ return e.ts === ts; });
      if (!ev) return;
      var def = dcEventDef(ev);
      dcConfirm({ title: 'حذف حالة السن', message: 'سيتم حذف "' + def.label + '" من السن ' + ev.tooth + '، وإعادة حساب حالة السن تلقائياً. لا يمكن التراجع.', confirmLabel: 'حذف الحدث', danger: true }).then(function(ok) {
        if (!ok) return;
        p.dentalEvents = (p.dentalEvents || []).filter(function(e){ return e.ts !== ts; });
        dcRecomputeTooth(p, ev.tooth);
        dcPersist(p, 'تم حذف الحدث — أُعيد حساب حالة السن ' + ev.tooth);
        dcRenderChart(); dcRenderEvents();
        if (teCurrentTooth != null && !document.getElementById('toothEditModal').classList.contains('hidden')) {
          teRenderBigTooth(); teRenderCurrentChip(); teRenderHistory();
        }
      });
    };
    // مسح كل أحداث السن الحالي — يعيده سليماً
    window.dcClearToothEvents = function() {
      var p = allPatients[dcCurrentPid]; if (!p || teCurrentTooth == null) return;
      var evs = dcToothEvents(p, teCurrentTooth);
      if (!evs.length) { showToast('لا توجد أحداث لهذا السن', 'info'); return; }
      var tooth = teCurrentTooth;
      dcConfirm({ title: 'مسح كل أحداث السن', message: 'سيتم مسح ' + evs.length + ' حدث من السن ' + tooth + '، وإعادته إلى الحالة السليمة. لا يمكن التراجع.', confirmLabel: 'مسح الكل', danger: true }).then(function(ok) {
        if (!ok) return;
        p.dentalEvents = (p.dentalEvents || []).filter(function(e){ return String(e.tooth) !== String(tooth); });
        dcRecomputeTooth(p, tooth);
        dcPersist(p, 'السن ' + tooth + ' عاد سليماً');
        teRenderBigTooth(); teRenderCurrentChip(); teRenderHistory();
        dcRenderChart(); dcRenderEvents();
      });
    };

    // ===== أدوات عامة للنماذج =====
    function _setVal(id, v){ var el = document.getElementById(id); if (el) el.value = v || ''; }
    function _getVal(id){ var el = document.getElementById(id); return el ? el.value.trim() : ''; }

    /* =====================================================================
       شاشة إعداد العيادة لأول تسجيل دخول (Onboarding)
       ---------------------------------------------------------------------
       متى تظهر؟ عند الإقلاع بعد تحميل settings، إن لم تكن هناك علامة
       settings.onboarded ولا settings.specialty (أي حساب جديد تماماً).
       الحسابات القائمة — وفيها تخصّص أصلاً — تُعتبر مُعدّة فلا تظهر لها.

       ماذا تحفظ؟ في وثيقة settings/doctor نفسها عبر saveSettingsToLocal:
         title · specialty · address · mobile · landline · logo
         chartTemplate {patient,visit} · onboarded:true · onboardedAt
       لا قواعد أمان جديدة ولا ترحيل بيانات — نفس الوثيقة ونفس دالة الحفظ.

       للمعاينة وقتما شئت من الـConsole:  resetOnboarding()
       وزر «خصّص اضبارتك» يبقى في الإعدادات كما هو.
       ===================================================================== */

    var _obState = null;
    var _obAR = ['١', '٢', '٣', '٤'];
    var _obICONS = { text: 'أ', textarea: '¶', number: '#', date: '📅', select: '▾', checkbox: '☑' };

    // تسميات الأنواع وترتيبها — مشتقّة من CF_TYPES نفسها فلا تفترقان أبداً
    function _obTypeList() {
      return (typeof CF_TYPES !== 'undefined' && CF_TYPES.length)
        ? CF_TYPES
        : [{ v: 'text', label: 'نص' }];
    }
    function _obTypeLabel(t) {
      var l = _obTypeList().filter(function(x) { return x.v === t; })[0];
      return l ? l.label : 'نص';
    }

    function _obEsc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // هل هذا حساب لم يُعدّ بعد؟
    function _obNeedsSetup() {
      var s = (typeof settings !== 'undefined' && settings) || {};
      return !s.onboarded && !(s.specialty || '').trim();
    }

    // يُستدعى بعد تحميل الإعدادات عند الإقلاع
    function maybeStartOnboarding() {
      if (!_obNeedsSetup()) return;
      openOnboarding();
    }

    window.resetOnboarding = function() {
      openOnboarding();
      console.log('[onboarding] فُتحت شاشة الإعداد للمعاينة — الإنهاء يحفظ الإعدادات من جديد.');
    };

    function openOnboarding() {
      var s = (typeof settings !== 'undefined' && settings) || {};
      var t = (s.chartTemplate && typeof s.chartTemplate === 'object') ? s.chartTemplate : {};
      _obState = {
        step: 0,
        title: (s.title && s.title !== 'لوحة الطبيب') ? s.title : '',
        specialty: s.specialty || '',
        address: s.address || '',
        mobile: s.mobile || '',
        landline: s.landline || '',
        logo: s.logo || null,
        preset: '',
        fields: {
          patient: Array.isArray(t.patient) ? t.patient.map(_obCloneField) : [],
          visit: Array.isArray(t.visit) ? t.visit.map(_obCloneField) : []
        }
      };
      var ov = document.getElementById('onboardOverlay');
      if (!ov) { console.error('[onboarding] عنصر #onboardOverlay غير موجود في app.html'); return; }
      ov.classList.add('show');
      document.body.style.overflow = 'hidden';
      _obRender();
    }

    function _obCloneField(f) {
      return { id: f.id, label: f.label || '', type: f.type || 'text', options: (f.options || []).slice() };
    }

    function closeOnboarding() {
      var ov = document.getElementById('onboardOverlay');
      if (ov) ov.classList.remove('show');
      document.body.style.overflow = '';
    }

    function _obApplyPreset(name) {
      var p = (typeof CHART_PRESETS !== 'undefined' && CHART_PRESETS[name]) || { patient: [], visit: [] };
      _obState.preset = name;
      _obState.fields = {
        patient: (p.patient || []).map(_obCloneField),
        visit: (p.visit || []).map(_obCloneField)
      };
    }

    // إلغاء تمييز القالب بعد تعديل يدوي — بلا إعادة رسم حتى لا يُفقد التركيز
    function _obUnmarkPreset() {
      if (!_obState.preset) return;
      _obState.preset = '';
      Array.prototype.forEach.call(document.querySelectorAll('#onboardOverlay .ob-chip.on'), function(b) {
        b.classList.remove('on');
      });
    }

    function _obSyncChrome() {
      Array.prototype.forEach.call(document.querySelectorAll('#onboardOverlay .ob-step'), function(li) {
        var i = +li.getAttribute('data-step');
        li.classList.toggle('current', i === _obState.step);
        li.classList.toggle('done', i < _obState.step);
      });
      var prog = document.getElementById('obProg');
      if (prog) prog.style.width = ((_obState.step + 1) / 4 * 100) + '%';

      var back = document.getElementById('obBack'), next = document.getElementById('obNext'),
          foot = document.getElementById('obFoot');
      if (back) back.style.visibility = _obState.step === 0 ? 'hidden' : 'visible';
      if (next) {
        next.innerHTML = (_obState.step === 2 ? 'إنهاء الإعداد' : 'التالي') + ' <span aria-hidden="true">←</span>';
        // لا يمكن تجاوز الخطوة الأولى بلا اسم وتخصّص
        next.disabled = (_obState.step === 0 && !(_obState.title.trim() && _obState.specialty));
      }
      if (foot) foot.style.display = _obState.step === 3 ? 'none' : 'flex';
    }

    function _obHead(n, title, lede) {
      return '<p class="ob-stepno">الخطوة ' + _obAR[n] + ' من ٤</p>' +
        '<h2 class="ob-h' + (lede ? ' tight' : '') + '">' + title + '</h2>' +
        (lede ? '<p class="ob-lede">' + lede + '</p>' : '');
    }
    function _obTip(t, b) {
      return '<div class="ob-tip"><span class="i">i</span><p><b>' + t + '</b>' + b + '</p></div>';
    }

    function _obRender(focusScope, focusIdx) {
      var body = document.getElementById('obBody');
      if (!body) return;
      var st = _obState;

      if (st.step === 0) {
        var names = (typeof CHART_PRESETS !== 'undefined') ? Object.keys(CHART_PRESETS) : [];
        var opts = names.map(function(s) {
          return '<option' + (s === st.specialty ? ' selected' : '') + '>' + _obEsc(s) + '</option>';
        }).join('');
        body.innerHTML = '<div class="ob-pane ob-body">' +
          _obHead(0, 'معلومات الطبيب') +
          '<div class="ob-grid">' +
            '<div class="ob-f"><label for="obName">الاسم الكامل</label>' +
              '<input id="obName" type="text" placeholder="مثال: د. أحمد الخالدي" value="' + _obEsc(st.title) + '">' +
              '<span class="help">كما تريده أن يظهر للمرضى وفي ترويسة الوصفات.</span></div>' +
            '<div class="ob-f"><label for="obSpec">التخصّص</label>' +
              '<select id="obSpec"><option value="" disabled' + (st.specialty ? '' : ' selected') + '>اختر تخصّصك</option>' + opts + '</select>' +
              '<span class="help accent">عليه تُبنى خانات الاضبارة الجاهزة.</span></div>' +
          '</div>' +
          _obTip('تنويه: ', 'اختيار التخصّص يجهّز خانات الاضبارة المناسبة له. تستطيع تعديل الخانات في أي وقت لاحقاً من الإعدادات ← «خصّص اضبارتك».') +
        '</div>';

        document.getElementById('obName').oninput = function() { st.title = this.value; _obSyncChrome(); };
        document.getElementById('obSpec').onchange = function() {
          st.specialty = this.value;
          _obApplyPreset(this.value);
          _obSyncChrome();
        };
      }

      else if (st.step === 1) {
        body.innerHTML = '<div class="ob-pane ob-body">' +
          _obHead(1, 'بيانات العيادة') +
          '<div class="ob-grid">' +
            '<div class="ob-f wide"><label for="obAddr">العنوان</label>' +
              '<input id="obAddr" type="text" placeholder="المدينة، المنطقة، أقرب نقطة دالّة" value="' + _obEsc(st.address) + '">' +
              '<span class="help">يظهر في صفحة الحجز وفي رسائل التذكير.</span></div>' +
            '<div class="ob-f"><label for="obMob">رقم الجوال</label>' +
              '<input id="obMob" type="tel" dir="ltr" placeholder="07XX XXX XXXX" value="' + _obEsc(st.mobile) + '">' +
              '<span class="help accent">يُستخدم لإشعارات واتساب.</span></div>' +
            '<div class="ob-f"><label for="obTel">الهاتف الأرضي <span class="opt">(اختياري)</span></label>' +
              '<input id="obTel" type="tel" dir="ltr" placeholder="0XX XXX XXXX" value="' + _obEsc(st.landline) + '">' +
              '<span class="help">للمرضى الذين يفضّلون الاتصال الأرضي.</span></div>' +
            '<div class="ob-f wide"><label>صورة الطبيب <span class="opt">(اختياري)</span></label>' +
              '<div class="ob-photo">' +
                '<div class="ob-ph' + (st.logo ? ' filled' : '') + '" id="obPhotoBox">' +
                  (st.logo ? '<img src="' + _obEsc(st.logo) + '" alt="صورة الطبيب">' : '<i class="fas fa-user-md"></i>') +
                '</div>' +
                '<div><button class="ob-photo-btn" type="button" id="obPhotoBtn">' +
                  (st.logo ? 'تغيير الصورة' : 'اختيار صورة') + '</button>' +
                  '<span class="help">تظهر في ترويسة الطباعة وفي أعلى لوحتك. PNG أو JPG.</span></div>' +
              '</div>' +
              '<input type="file" id="obPhotoInput" accept="image/*" style="display:none">' +
            '</div>' +
          '</div>' +
          _obTip('نصيحة: ', 'أدخل العنوان كما يعرفه المرضى لا كما هو رسمياً — أقرب نقطة دالّة تختصر عليهم الطريق أكثر من اسم الشارع.') +
        '</div>';

        document.getElementById('obAddr').oninput = function() { st.address = this.value; };
        document.getElementById('obMob').oninput  = function() { st.mobile  = this.value; };
        document.getElementById('obTel').oninput  = function() { st.landline = this.value; };

        var fileInput = document.getElementById('obPhotoInput');
        document.getElementById('obPhotoBtn').onclick = function() { fileInput.click(); };
        fileInput.onchange = function(e) {
          var file = e.target.files[0];
          if (!file) return;
          if (!file.type.startsWith('image/')) { showToast('الرجاء اختيار ملف صورة', 'error'); return; }
          if (file.size > 5 * 1024 * 1024) { showToast('حجم الصورة يجب أن يكون أقل من 5 ميغابايت', 'error'); return; }
          var btn = document.getElementById('obPhotoBtn');
          btn.disabled = true; btn.textContent = 'جارٍ الرفع…';
          window._fb.uploadLogo('doctor', file).then(function(url) {
            st.logo = url;
            var box = document.getElementById('obPhotoBox');
            box.innerHTML = '<img src="' + _obEsc(url) + '" alt="صورة الطبيب">';
            box.classList.add('filled');
            btn.disabled = false; btn.textContent = 'تغيير الصورة';
            showToast('تم رفع الصورة بنجاح', 'success');
          }).catch(function(err) {
            btn.disabled = false; btn.textContent = 'اختيار صورة';
            showToast('فشل رفع الصورة', 'error');
            console.error('[onboarding] فشل رفع الصورة', err);
          });
        };
      }

      else if (st.step === 2) {
        var pnames = (typeof CHART_PRESETS !== 'undefined') ? Object.keys(CHART_PRESETS) : [];
        var chips = pnames.map(function(s) {
          return '<button class="ob-chip' + (s === st.preset ? ' on' : '') + '" type="button" data-p="' + _obEsc(s) + '">' +
            _obEsc(s) + (s === st.specialty ? '<span class="tag">مقترح</span>' : '') + '</button>';
        }).join('');

        function grp(scope, title, note) {
          var arr = st.fields[scope];
          var rows = arr.length
            ? arr.map(function(f, i) {
                var o = _obTypeList().map(function(t) {
                  return '<option value="' + t.v + '"' + (t.v === f.type ? ' selected' : '') + '>' + t.label + '</option>';
                }).join('');
                return '<div class="ob-cfrow" data-s="' + scope + '" data-i="' + i + '">' +
                  '<div class="ob-cftype" aria-hidden="true">' + (_obICONS[f.type] || 'أ') + '</div>' +
                  '<input class="ob-cfin" type="text" value="' + _obEsc(f.label) + '" placeholder="اسم الخانة" aria-label="اسم الخانة">' +
                  '<button class="ob-cfdel" type="button" aria-label="حذف خانة">✕</button>' +
                  '<select class="ob-cfsel" aria-label="نوع الخانة">' + o + '</select>' +
                  ((f.options && f.options.length) ? '<div class="ob-cfopts">الخيارات: ' + _obEsc(f.options.join('، ')) + '</div>' : '') +
                '</div>';
              }).join('')
            : '<div class="ob-cfempty">لا توجد خانات هنا بعد.</div>';
          return '<div class="ob-cfsec"><p class="ob-cfhead">' + title +
              (arr.length ? ' <span style="font-weight:400;opacity:.6;">(' + arr.length + ')</span>' : '') + '</p>' +
            '<p class="ob-cfnote">' + note + '</p>' +
            '<div class="ob-cflist">' + rows +
              '<button class="ob-cfadd" type="button" data-add="' + scope + '">＋ إضافة خانة</button>' +
            '</div></div>';
        }

        body.innerHTML = '<div class="ob-pane ob-body">' +
          _obHead(2, 'تخصيص الاضبارة', 'ابدأ من قالب جاهز ثم عدّله كما تشاء — القالب نقطة انطلاق، لا قيد.') +
          '<div class="ob-f"><label>القوالب الجاهزة</label>' +
            '<div class="ob-chips">' + chips + '</div>' +
            '<span class="help">اختيار قالب يستبدل الخانات الحالية بخانات ذلك التخصّص.</span></div>' +
          grp('patient', 'خانات المريض', 'تُملأ مرّة واحدة وتبقى في ملفه — كالسوابق والقصة المرضية.') +
          grp('visit', 'خانات الزيارة', 'تُملأ في كل زيارة على حدة — كالفحوص والقياسات.') +
          _obTip('ملاحظة: ', 'الخانات المدمجة (الاسم، العمر، الهاتف، زمرة الدم، الأمراض المزمنة) موجودة أصلاً — أضف هنا ما يخصّ تخصّصك فقط.') +
        '</div>';

        Array.prototype.forEach.call(body.querySelectorAll('.ob-chip'), function(b) {
          b.onclick = function() { _obApplyPreset(this.getAttribute('data-p')); _obRender(); };
        });
        Array.prototype.forEach.call(body.querySelectorAll('.ob-cfadd'), function(b) {
          b.onclick = function() {
            var sc = this.getAttribute('data-add');
            st.fields[sc].push({ label: '', type: 'text', options: [] });
            st.preset = '';
            _obRender(sc, st.fields[sc].length - 1);
          };
        });
        Array.prototype.forEach.call(body.querySelectorAll('.ob-cfrow'), function(row) {
          var sc = row.getAttribute('data-s'), i = +row.getAttribute('data-i'), f = st.fields[sc][i];
          row.querySelector('.ob-cfin').oninput = function() { f.label = this.value; _obUnmarkPreset(); };
          row.querySelector('.ob-cfsel').onchange = function() {
            f.type = this.value;
            if (f.type !== 'select') f.options = [];
            row.querySelector('.ob-cftype').textContent = _obICONS[this.value] || 'أ';
            _obUnmarkPreset();
          };
          row.querySelector('.ob-cfdel').onclick = function() {
            st.fields[sc].splice(i, 1); st.preset = ''; _obRender();
          };
        });
      }

      else {
        body.innerHTML = '<div class="ob-pane ob-done">' +
          '<div class="ob-seal"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11"/></svg></div>' +
          '<h2>عيادتك جاهزة</h2>' +
          '<p>حُفظت الإعدادات. لن تظهر هذه الشاشة مرّة أخرى — يفتح التطبيق مباشرةً في كل دخول.</p>' +
          '<dl class="ob-recap">' +
            '<div><dt>الطبيب</dt><dd>' + (_obEsc(st.title) || '—') + '</dd></div>' +
            '<div><dt>التخصّص</dt><dd>' + (_obEsc(st.specialty) || '—') + '</dd></div>' +
            '<div><dt>العنوان</dt><dd>' + (_obEsc(st.address) || '—') + '</dd></div>' +
            '<div><dt>خانات المريض</dt><dd>' + st.fields.patient.length + ' خانة</dd></div>' +
            '<div><dt>خانات الزيارة</dt><dd>' + st.fields.visit.length + ' خانة</dd></div>' +
          '</dl>' +
          '<button class="ob-btn primary" type="button" id="obStart">ابدأ الآن</button>' +
        '</div>';
        document.getElementById('obStart').onclick = closeOnboarding;
      }

      _obSyncChrome();

      // الخانة المضافة حديثاً: تمرير إليها ووضع المؤشّر في اسمها
      if (focusScope) {
        var nrow = body.querySelector('.ob-cfrow[data-s="' + focusScope + '"][data-i="' + focusIdx + '"]');
        if (nrow) {
          var inp = nrow.querySelector('.ob-cfin');
          if (inp) { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } }
          var soft = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
          // حارس: بعض الـwebviews القديمة لا تعرّف scrollIntoView — لا نُسقط مسار الإضافة لأجله
          if (typeof nrow.scrollIntoView === 'function') {
            nrow.scrollIntoView({ behavior: soft ? 'smooth' : 'auto', block: 'center' });
          }
        }
      }
    }

    // حفظ نهائي — نفس مسار الحفظ القائم (settings/doctor عبر setDoc merge)
    function _obFinish() {
      var st = _obState;
      function clean(arr) {
        return arr.filter(function(f) { return (f.label || '').trim(); }).map(function(f) {
          return {
            id: f.id || (typeof _cfNewId === 'function' ? _cfNewId() : ('f' + Date.now() + Math.random().toString(36).slice(2, 7))),
            label: f.label.trim(),
            type: f.type || 'text',
            options: f.type === 'select' ? (f.options || []) : []
          };
        });
      }
      if (typeof settings === 'undefined' || !settings) settings = {};
      settings.title     = st.title.trim() || 'لوحة الطبيب';
      settings.specialty = st.specialty || '';
      settings.address   = st.address.trim();
      settings.mobile    = st.mobile.trim();
      settings.landline  = st.landline.trim();
      if (st.logo) settings.logo = st.logo;
      settings.chartTemplate = {
        patient: clean(st.fields.patient),
        visit: clean(st.fields.visit),
        dental: /أسنان|اسنان|dental/i.test(st.specialty || '')
      };
      settings.onboarded = true;
      settings.onboardedAt = Date.now();

      saveSettingsToLocal(settings);
      if (typeof applySettings === 'function') applySettings();

      st.step = 3;
      _obRender();
    }

    document.addEventListener('DOMContentLoaded', function() {
      var next = document.getElementById('obNext'), back = document.getElementById('obBack');
      if (next) next.onclick = function() {
        if (!_obState) return;
        if (_obState.step === 2) { _obFinish(); return; }
        if (_obState.step < 3) { _obState.step++; _obRender(); }
      };
      if (back) back.onclick = function() {
        if (_obState && _obState.step > 0) { _obState.step--; _obRender(); }
      };
    });
