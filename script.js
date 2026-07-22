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
              if (role !== 'nurse') {
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

    var _dataLoaded = false;

    // يقرأ دور المستخدم، وإن لم يوجد مستند الدور يُنشئه تلقائياً للحساب المخوّل لهذا التطبيق (الممرضة)
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
        if (role !== 'nurse') { location.replace('index.html'); return; }   // ليست ممرضة → صفحة الدخول تتولّى التوجيه
        // ممرضة مصرّحة → افتح اللوحة وحمّل البيانات
        if (_dataLoaded) { revealApp(); return; }
        _dataLoaded = true;
        revealApp();
        if (typeof initializeData === 'function') initializeData();
      });
    }
    if (window._fbReady) initAuthWatch();
    else window.addEventListener('fbReady', initAuthWatch, { once: true });
  

/* ===== Main App ===== */

    // ================== localStorage Storage Layer ==================
    // مفاتيح مشتركة بين ملف الدكتور والممرضة
    const STORAGE_KEY        = 'doctorAppointments';
    const PATIENTS_STORAGE_KEY = 'doctorPatients';
    const CLOSED_DAYS_KEY    = 'closedDays';
    const SETTINGS_KEY       = 'nurseSettings';
    const NOTES_KEY          = 'sharedNotes';
    const TIME_SLOTS_KEY     = 'nurseTimeSlots';

    // ================== Time-Slots System ==================
    // قائمة السلوتات الزمنية الافتراضية (قابلة للتعديل من الإعدادات)
    const DEFAULT_TIME_SLOTS = ["08:00","08:30","09:00","09:30","10:00","10:30","11:00","11:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00"];
    let TIME_SLOTS = (function() {
      try {
        const stored = JSON.parse(localStorage.getItem(TIME_SLOTS_KEY));
        if (Array.isArray(stored) && stored.length) return stored;
      } catch (e) {}
      return DEFAULT_TIME_SLOTS.slice();
    })();
    function saveTimeSlots(arr) {
      TIME_SLOTS = (Array.isArray(arr) && arr.length) ? arr.slice() : DEFAULT_TIME_SLOTS.slice();
      try { localStorage.setItem(TIME_SLOTS_KEY, JSON.stringify(TIME_SLOTS)); } catch (e) {}
    }

    // أيام العطلة الأسبوعية الثابتة (0=الأحد .. 6=السبت)
    const WEEKLY_OFF_KEY = 'nurseWeeklyOff';
    let weeklyOffDays = (function() {
      try { const s = JSON.parse(localStorage.getItem(WEEKLY_OFF_KEY)); return Array.isArray(s) ? s : []; } catch (e) { return []; }
    })();
    function saveWeeklyOff(arr) {
      weeklyOffDays = Array.isArray(arr) ? arr.slice() : [];
      try { localStorage.setItem(WEEKLY_OFF_KEY, JSON.stringify(weeklyOffDays)); } catch (e) {}
    }
    // تحويل البيانات القديمة: "Morning" → "09:00" ، "Evening" → "14:00"
    function convertLegacySlotToTime(slot) {
      if (slot === 'Morning')  return '09:00';
      if (slot === 'Evening')  return '14:00';
      if (!slot || slot === 'Unknown') return '09:00';
      return slot; // أصلاً وقت مثل "09:00"
    }
    // إرجاع وقت السجل (يدعم Slot و slot ويحوّل القديم تلقائياً)
    function slotTimeOf(record) {
      if (!record) return '09:00';
      const raw = (record.Slot != null && record.Slot !== '') ? record.Slot
                : (record.slot != null && record.slot !== '') ? record.slot : '';
      return convertLegacySlotToTime(raw);
    }
    // عدد الدقائق منذ منتصف الليل (للترتيب)
    function slotMinutes(t) {
      const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
      return m ? (parseInt(m[1],10) * 60 + parseInt(m[2],10)) : 0;
    }
    // هل السلوت ضمن الفترة الصباحية (قبل 12:00)؟
    function isMorningSlot(slot) { return slotMinutes(convertLegacySlotToTime(slot)) < 12 * 60; }
    // النص المعروض للوقت (يُظهر الوقت بدل صباحاً/مساءً)
    function slotLabelOf(record) { return slotTimeOf(record); }

    // ================== منع الحجز المزدوج (Double-Booking) ==================
    // الحالات التي "تشغل" السلوت
    const ACTIVE_STATUSES = ['Pending','Accepted','InProgress'];
    // معرّف القفل لكل (تاريخ+وقت)
    function slotLockId(dateStr, time) { return normalizeDate(dateStr) + '_' + String(time).replace(':',''); }
    // هل الوقت محجوز فعلاً (من مواعيد الممرضة)؟ — exceptId لتجاهل موعد يجري تعديله
    function isSlotTakenLocal(dateStr, time, exceptId) {
      const ds = normalizeDate(dateStr);
      return (allRecords || []).some(function(r) {
        return r.id !== exceptId
          && ACTIVE_STATUSES.indexOf(r.Status) !== -1
          && normalizeDate(r.Date) === ds
          && slotTimeOf(r) === time;
      });
    }
    // أوقات اليوم المحجوزة (Set)
    function takenTimesForDay(dateStr, exceptId) {
      const ds = normalizeDate(dateStr); const set = {};
      (allRecords || []).forEach(function(r) {
        if (r.id !== exceptId && ACTIVE_STATUSES.indexOf(r.Status) !== -1 && normalizeDate(r.Date) === ds) set[slotTimeOf(r)] = true;
      });
      return set;
    }
    // مزامنة bookedSlots مع المواعيد النشطة المستقبلية (المصدر الذي يقرأه ملف المريض)
    // ── مجدوِل بـ debounce: يمنع حلقة التغذية الراجعة مع مُراقب bookedSlots ويقلّل عمليات فايربيز ──
    let _reconcileBusy = false;
    let _reconcileTimer = null;
    function scheduleReconcile() {
      if (_reconcileTimer) return;            // نداء واحد مؤجّل يكفي
      _reconcileTimer = setTimeout(function() {
        _reconcileTimer = null;
        reconcileBookedSlots();
      }, 1500);
    }
    function reconcileBookedSlots() {
      if (!window._bookedSlotsReady || !window._fb || _reconcileBusy) return;
      _reconcileBusy = true;
      try {
        const desired = {};
        (allRecords || []).forEach(function(r) {
          if (ACTIVE_STATUSES.indexOf(r.Status) === -1) return;
          const ds = normalizeDate(r.Date);
          if (!ds || parseLocalISODate(ds) < today) return;
          const t = slotTimeOf(r);
          desired[slotLockId(ds, t)] = { date: ds, time: t, apptId: r.id, status: 'booked' };
        });
        const current = window._bookedSlots || {};
        Object.keys(desired).forEach(function(id) {
          if (!current[id]) {
            window._bookedSlots[id] = desired[id];
            window._fb.setDoc(window._fb.docRef('bookedSlots', id),
              Object.assign({}, desired[id], { createdAt: window._fb.serverTimestamp() })
            ).catch(function(e){ console.error('[lock+]', e); });
          }
        });
        Object.keys(current).forEach(function(id) {
          // لا تحذف أقفال الأيام الماضية (تُترك كما هي ولا تُعاد كتابتها) — يمنع الحذف الجماعي المتكرر
          var cd = current[id] && current[id].date ? normalizeDate(current[id].date) : '';
          if (cd && parseLocalISODate(cd) < today) return;
          if (!desired[id]) {
            delete window._bookedSlots[id];
            window._fb.deleteDoc(window._fb.docRef('bookedSlots', id)).catch(function(e){ console.error('[lock-]', e); });
          }
        });
      } finally { _reconcileBusy = false; }
    }
    // بناء خيارات <option> لقائمة السلوتات (يُدرج القيمة المختارة حتى لو لم تكن ضمن القائمة)
    function buildTimeOptions(selected) {
      let opts = TIME_SLOTS.slice();
      if (selected && opts.indexOf(selected) === -1) opts = [selected].concat(opts);
      const sel = selected || TIME_SLOTS[0];
      return opts.map(function(t) {
        return '<option value="' + t + '"' + (t === sel ? ' selected' : '') + '>' + t + '</option>';
      }).join('');
    }
    // تعبئة عنصر <select> بقائمة السلوتات
    function fillTimeSelect(id, selected) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = buildTimeOptions(selected || TIME_SLOTS[0]);
    }
    // تعطيل الأوقات المحجوزة في قائمة <select>، وإرجاع أول وقت متاح
    function markTakenOptions(selectId, dateStr, exceptId) {
      const el = document.getElementById(selectId); if (!el) return '';
      const taken = takenTimesForDay(dateStr, exceptId);
      let firstFree = '';
      Array.prototype.forEach.call(el.options, function(o) {
        if (!o.value) return;
        if (taken[o.value]) { o.disabled = true; o.textContent = o.value + ' — محجوز'; }
        else { o.disabled = false; o.textContent = o.value; if (!firstFree) firstFree = o.value; }
      });
      if ((!el.value || taken[el.value]) && firstFree) el.value = firstFree;
      return firstFree;
    }

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

    function lsGet(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch(e) { return fallback; }
    }
    function lsSet(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {}
    }
    function notifyOtherTab(key) {
      // لم تعد ضرورية — onSnapshot يُزامن تلقائياً
    }

    // ================== Constants ==================
    const daysAr = ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
    const monthsAr = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = toLocalISODate(today);
    const maxFutureDate = new Date(); maxFutureDate.setMonth(maxFutureDate.getMonth()+3); maxFutureDate.setHours(23,59,59,999);
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate()-30); thirtyDaysAgo.setHours(0,0,0,0);
    const thirtyDaysAgoStr = toLocalISODate(thirtyDaysAgo);

    let allRecords = [], allPatients = {}, closedDays = [];
    let currentDate = new Date(), selectedDayStr = todayStr, currentSection = 'appointments', appointmentsTab = 'pending';
    let searchQuery = '', patientSearchQuery = '', lastPendingCount = 0, lastAcceptedCount = 0;
    let dayDensity = {};
    let manualAppointmentData = { patientName:'', phone:'', birthDate:'', address:'', visitType:'', selectedDate:'', selectedSlot:'Morning', currentStep:1 };
    let visitManagementState = { patientId:null, patientName:'', patientPhone:'', patientBirthDate:'', patientAddress:'', currentStep:1, appointmentRecord:null, isAddedToPatients:false };
    let addVisitState = { patientId:null, patientName:'', patientPhone:'', patientBirthDate:'', patientAddress:'' };
    let deleteAppointmentId = null;
    let settings = { title: 'لوحة الممرضة', logo: null };
    let currentArchiveTab = 'daily';

    // ================== Helpers ==================
    function toLocalISODate(date) { const y=date.getFullYear(); const m=String(date.getMonth()+1).padStart(2,'0'); const d=String(date.getDate()).padStart(2,'0'); return `${y}-${m}-${d}`; }
    function parseLocalISODate(s) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
    function normalizeDate(s) { if(!s) return ''; const [y,m,d]=(s+'').trim().substring(0,10).split('-').map(Number); if(!y||!m||!d) return (s+'').trim().substring(0,10); return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
    function formatDateAr(s) { if(!s) return '-'; const d=parseLocalISODate(normalizeDate(s)); return d.toLocaleDateString('ar-EG',{year:'numeric',month:'long',day:'numeric'}); }
    function calculateAge(b) { if(!b) return null; const birth=new Date(b); let age=today.getFullYear()-birth.getFullYear(); const m=today.getMonth()-birth.getMonth(); if(m<0||(m===0&&today.getDate()<birth.getDate())) age--; return age; }
    function normalizePhone(p) { return (p||'').replace(/[^\d+]/g,''); }
    function escapeHtml(text) { const div=document.createElement('div'); div.textContent=text; return div.innerHTML; }

    // ── Web Audio API — AudioContext مشترك مع keepalive ──
    var _notifAudioCtx = null;
    function _getNotifCtx() {
      if (!_notifAudioCtx || _notifAudioCtx.state === 'closed') {
        try { _notifAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { return null; }
      }
      return _notifAudioCtx;
    }
    // تفعيل مبكر عند أول تفاعل
    function _primeNotifAudio() {
      var ctx = _getNotifCtx();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      document.removeEventListener('click',      _primeNotifAudio);
      document.removeEventListener('touchstart', _primeNotifAudio);
      document.removeEventListener('keydown',    _primeNotifAudio);
    }
    document.addEventListener('click',      _primeNotifAudio);
    document.addEventListener('touchstart', _primeNotifAudio);
    document.addEventListener('keydown',    _primeNotifAudio);
    // keepalive: نبضة صامتة كل 30 ثانية لإبقاء Context يقظاً
    setInterval(function() {
      var ctx = _getNotifCtx();
      if (ctx && ctx.state === 'running') {
        try {
          var o = ctx.createOscillator(), g = ctx.createGain();
          g.gain.value = 0;
          o.connect(g); g.connect(ctx.destination);
          o.start(); o.stop(ctx.currentTime + 0.001);
        } catch(e) {}
      }
    }, 30000);

    function playNotifSound() {
      var ctx = _getNotifCtx(); if (!ctx) return;
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

    // مُعطّل بناءً على الطلب: تبقى فقط إشعارات الموعد الجديد وتنبيهات الدكتور.
    // (نُبقي التسجيل في الـ console للتشخيص دون إظهار أي توست)
    function showToast(msg, type='info', sound=false) {
      try { console.log('[toast:' + type + ']', msg); } catch (e) {}
    }

    // إشعار مخصص أسفل يمين — بدون أيقونة، يبقى 8 ثوانٍ، مع صوت
    // ── نظام إشعارات متعددة متراكمة ──
    var _notifContainer = null;
    function _getNotifContainer() {
      if (!_notifContainer) {
        _notifContainer = document.createElement('div');
        _notifContainer.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9998;display:flex;flex-direction:column-reverse;gap:10px;';
        document.body.appendChild(_notifContainer);
      }
      return _notifContainer;
    }

    function _createNotif(msg, color, duration) {
      var el = document.createElement('div');
      el.style.cssText = 'background:' + color + ';color:white;font-weight:800;font-size:.92rem;padding:13px 22px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.2);opacity:0;transform:translateX(20px);transition:opacity .25s,transform .25s;white-space:nowrap;max-width:280px;cursor:pointer;';
      el.textContent = msg;
      _getNotifContainer().appendChild(el);
      // animate in
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          el.style.opacity = '1';
          el.style.transform = 'translateX(0)';
        });
      });
      // dismiss on click
      el.onclick = function() { _dismissNotif(el); };
      // auto dismiss
      el._timer = setTimeout(function() { _dismissNotif(el); }, duration || 8000);
      return el;
    }

    function _dismissNotif(el) {
      clearTimeout(el._timer);
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 280);
    }

    function showNotifToast(msg) {
      _createNotif(msg, 'var(--primary)', 8000);
      playNotifSound();
    }

    // ── تنبيه الدكتور — يظهر كإشعار مرئي مع صوت متكرر ──
    var _alertSoundTimer = null;
    window.showDoctorAlert = function(payload) {
      var color = payload.type === 'next'         ? '#16a34a'
                : payload.type === 'custom'       ? '#d97706'
                : payload.type === 'newManualAppt'? '#7c3aed'
                : '#0d9488';
      var el = _createNotif(payload.message || 'تنبيه من الدكتور', color, 30000);
      clearInterval(_alertSoundTimer);
      playNotifSound();
      _alertSoundTimer = setInterval(playNotifSound, 5000);
      // إيقاف الصوت عند الضغط
      var origClick = el.onclick;
      el.onclick = function() { clearInterval(_alertSoundTimer); origClick.call(this); };
      // إيقاف الصوت بعد 30 ثانية
      setTimeout(function() { clearInterval(_alertSoundTimer); }, 30000);
    };
    window.closeDoctorAlert = function() { clearInterval(_alertSoundTimer); };

    // ================== localStorage CRUD ==================
    // ── FAB دوال زر الزائد (لوحة الممرضة) ──
    function toggleMobFab() {
      var trigger  = document.getElementById('mobFabTrigger');
      var pills    = document.getElementById('mobPills');
      var isOpen   = trigger && trigger.classList.contains('open');
      if (isOpen) { closeMobFab(); return; }
      if (trigger)  trigger.classList.add('open');
      if (pills)    pills.classList.add('active');
    }
    function closeMobFab() {
      var trigger  = document.getElementById('mobFabTrigger');
      var pills    = document.getElementById('mobPills');
      if (trigger)  trigger.classList.remove('open');
      if (pills)    pills.classList.remove('active');
    }
    // ── Draggable Desktop FAB (Nurse) ──
    (function() {
      var FAB_KEY = 'nurseFabPos';
      var fabEl, pillsEl, _wasDragged = false;

      function getFabPos() {
        try { var s = localStorage.getItem(FAB_KEY); if (s) return JSON.parse(s); } catch(e) {}
        return { right: 36, bottom: 36 };
      }
      function saveFabPos(pos) {
        try { localStorage.setItem(FAB_KEY, JSON.stringify(pos)); } catch(e) {}
      }
      function clampPos(pos) {
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var size = 56, margin = 8;
        return {
          right:  Math.max(margin, Math.min(vw - size - margin, pos.right)),
          bottom: Math.max(margin, Math.min(vh - size - margin, pos.bottom))
        };
      }
      function applyFabPos(pos) {
        var c = clampPos(pos);
        fabEl.style.left   = '';
        fabEl.style.top    = '';
        fabEl.style.right  = c.right  + 'px';
        fabEl.style.bottom = c.bottom + 'px';
      }
      function calcPillsLayout() {
        if (!pillsEl || !fabEl) return;
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var fr = parseFloat(fabEl.style.right)  || 36;
        var fb = parseFloat(fabEl.style.bottom) || 36;
        var fabSize = 56;
        var gap = 8;

        var pillH   = 52;
        var pillGap = 10;
        var count   = pillsEl.querySelectorAll('.fab-pill').length;
        var totalH  = count * pillH + (count - 1) * pillGap;

        var spaceAbove = vh - fb - fabSize;
        var spaceBelow = fb;
        var openUp = spaceAbove >= spaceBelow;

        pillsEl.style.flexDirection = openUp ? 'column-reverse' : 'column';
        pillsEl.style.top    = '';
        pillsEl.style.bottom = '';

        if (openUp) {
          pillsEl.style.bottom = (fb + fabSize + gap) + 'px';
        } else {
          pillsEl.style.bottom = (fb - totalH - gap) + 'px';
        }

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

      window._nurseCalcPillsLayout = calcPillsLayout;
      window._nurseWasDragged = function() { return _wasDragged; };
      window._nurseResetDragged = function() { _wasDragged = false; };

      function initDraggableFab() {
        fabEl   = document.getElementById('desktopSpeedDial');
        pillsEl = document.getElementById('desktopPills');
        if (!fabEl) return;

        // Apply saved position THEN show — prevents flash at default CSS position
        var pos = getFabPos();
        applyFabPos(pos);
        requestAnimationFrame(function() {
          fabEl.style.opacity = '1';
        });

        var startX, startY, startRight, startBottom, dragging = false;

        function onPointerDown(e) {
          if (e.target.closest('.fab-trigger') === null) return;
          dragging   = false;
          _wasDragged = false;
          startX      = e.clientX;
          startY      = e.clientY;
          startRight  = parseFloat(fabEl.style.right)  || 36;
          startBottom = parseFloat(fabEl.style.bottom) || 36;
          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup',   onPointerUp);
          e.preventDefault();
        }
        function onPointerMove(e) {
          var dx = e.clientX - startX;
          var dy = e.clientY - startY;
          if (!dragging && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
          if (!dragging) { closeFabDial(); } // أغلق pills عند بدء السحب
          dragging    = true;
          _wasDragged = true;
          fabEl.classList.add('dragging');
          // right decreases when moving right, bottom decreases when moving down
          var newRight  = startRight  - dx;
          var newBottom = startBottom - dy;
          applyFabPos({ right: newRight, bottom: newBottom });
          calcPillsLayout();
        }
        function onPointerUp() {
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
          var cur = { right: parseFloat(fabEl.style.right)||36, bottom: parseFloat(fabEl.style.bottom)||36 };
          applyFabPos(cur);
          calcPillsLayout();
        });
      }

      document.addEventListener('DOMContentLoaded', initDraggableFab);
    })();

    function toggleFabDial() {
      var trigger  = document.getElementById('desktopFabMain');
      if (!trigger) return;
      if (window._nurseWasDragged && window._nurseWasDragged()) { window._nurseResetDragged(); return; }
      var isOpen   = trigger.classList.contains('open');
      if (isOpen) { closeFabDial(); return; }
      if (window._nurseCalcPillsLayout) window._nurseCalcPillsLayout();
      trigger.classList.add('open');
      document.querySelectorAll('#desktopPills .fab-pill').forEach(function(p){ p.classList.add('visible'); });
      setTimeout(function() {
        document.addEventListener('click', _nurseOutsideHandler);
      }, 0);
    }
    function _nurseOutsideHandler(e) {
      var fab   = document.getElementById('desktopSpeedDial');
      var pills = document.getElementById('desktopPills');
      if ((fab && fab.contains(e.target)) || (pills && pills.contains(e.target))) return;
      closeFabDial();
      document.removeEventListener('click', _nurseOutsideHandler);
    }
    function closeFabDial() {
      var trigger  = document.getElementById('desktopFabMain');
      var pills    = document.getElementById('desktopPills');
      if (trigger)  trigger.classList.remove('open');
      if (pills)    document.querySelectorAll('#desktopPills .fab-pill').forEach(function(p){ p.classList.remove('visible'); });
      document.removeEventListener('click', _nurseOutsideHandler);
    }

    // ── تنظيف localStorage القديم (بدون ترحيل) ──
    function migrateLocalStorageToFirestore() {
      // مسح البيانات القديمة من localStorage فقط — Firestore هو المصدر الوحيد
      try {
        localStorage.removeItem('doctorAppointments');
        localStorage.removeItem('doctorPatients');
        localStorage.removeItem('closedDays');
        localStorage.removeItem('doctorSettings');
        localStorage.removeItem('nurseSettings');
        localStorage.removeItem('sharedNotes');
      } catch(e) {}
    }

    // ── تنظيف المواعيد القديمة في Firestore ──
    // مواعيد Pending تجاوز تاريخها → تُحدَّث إلى Rejected تلقائياً
    function purgeOldPendingAppointments(records) {
      var toExpire = records.filter(function(r) {
        if (r.Status !== 'Pending') return false;
        try {
          var d = parseLocalISODate(normalizeDate(r.Date));
          return d < today;
        } catch(e) { return false; }
      });
      toExpire.forEach(function(r) {
        // الطلبات المعلّقة المنتهية صلاحيتها تُحذف نهائياً (بدل إبقائها)
        _purgeAppointment(r.id, r).catch(function(){});
      });
    }

    // [توفير] عند عودة التبويب للواجهة: جلب خفيف للطلبات المعلّقة — يعالج عدم وصول الطلبات بعد تجميد التبويب بلا استطلاع مستمر
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState !== 'visible' || !window._fb || !window._fb.getDocs) return;
      if (!window._fb.auth || !window._fb.auth.currentUser) return;   // فقط عند تسجيل الدخول
      window._fb.getDocs(window._fb.query(window._fb.col('appointments'), window._fb.where('Status','==','Pending')))
        .then(function(snap) {
          var changed = false, fresh = 0;
          snap.forEach(function(d) {
            var data = d.data(); data.id = d.id;
            if (data.Slot === 'Morning' || data.Slot === 'Evening' || data.Slot === 'Unknown' || data.Slot == null || data.Slot === '') data.Slot = convertLegacySlotToTime(data.Slot);
            var ex = (allRecords || []).find(function(r){ return r.id === d.id; });
            if (!ex) { allRecords.push(data); changed = true; fresh++; }
            else if (ex.Status !== data.Status) { Object.assign(ex, data); changed = true; }
          });
          if (fresh) { try { showNotifToast('طلب جديد'); } catch(e){} }
          if (changed) {
            updateCounts(); calculateDensity(); renderCalendar();
            if (selectedDayStr) renderAgendaForDay(selectedDayStr);
            if (currentSection === 'appointments') renderBothAppointmentColumns();
          }
        }).catch(function(e){ console.error('[focus-refetch]', e); });
    });

    var _unsubAppt = null, _unsubPat = null, _unsubClosed = null, _unsubNurseAlerts = null;
    var _alertSeenAt = 0;
    var _nurseFirstLoad = false;
    // منع التكرار — خارج initializeData ليبقى بين الاستدعاءات
    var _shownAlertIds = new Set();
    var _lastAlertTs   = 0;

    function checkMissedAlerts() { /* غير مستخدمة في لوحة الممرضة */ }

    var _initialized = false;

    // ── فحص الطلبات الجديدة الفائتة عند فتح لوحة الممرضة ──
    function checkMissedNewRequests() {
      var SEEN_KEY = 'docbook_nur_apptSeen';
      var lastSeen = parseInt(localStorage.getItem(SEEN_KEY) || '0', 10);
      var nowTs = Date.now();
      localStorage.setItem(SEEN_KEY, String(nowTs));
      if (lastSeen === 0) return; // أول مرة — لا إشعار
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

    function initializeData() {
      // منع الاستدعاء المزدوج
      if (_initialized) return;
      _initialized = true;
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
      var _nurApptFirst = true;
      // [أقصى توفير] المواعيد: آخر 30 يوماً وما بعدها فقط
      var _apptWinStart = (function(){ var d=new Date(); d.setDate(d.getDate()-30); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();
      _unsubAppt = window._fb.onSnapshot(window._fb.query(window._fb.col('appointments'), window._fb.where('Date','>=',_apptWinStart)),
        function(snap) {
          allRecords = snap.docs.map(function(d) {
            var data = d.data();
            data.id = d.id;
            // توافق مع البيانات القديمة: حوّل Morning/Evening إلى وقت فعلي
            if (data.Slot === 'Morning' || data.Slot === 'Evening' || data.Slot === 'Unknown' || data.Slot == null || data.Slot === '') {
              data.Slot = convertLegacySlotToTime(data.Slot);
            }
            return data;
          });
          var _wasFirst = _nurApptFirst;
          if (_nurApptFirst) { _nurApptFirst = false; setTimeout(checkMissedNewRequests, 1000); }
          // إشعار "طلب جديد" — مصدر واحد، يتخطّى أوّل لقطة (دُمج هنا بدل مُراقب مكرّر)
          if (!_wasFirst) {
            var _added = snap.docChanges().filter(function(c){ return c.type === 'added' && c.doc.data().Status === 'Pending'; });
            if (_added.length) showNotifToast('طلب جديد');
          }
          // تحويل Accepted منتهي → NoShow
          var toUpdate = [];
          allRecords.forEach(function(r) {
            if (r.Status === 'Accepted') {
              var d = parseLocalISODate(normalizeDate(r.Date));
              if (d < today) { toUpdate.push(r.id); r.Status = 'NoShow'; }
            }
          });
          if (toUpdate.length) {
            toUpdate.forEach(function(id) {
              window._fb.setDoc(window._fb.docRef('appointments', id), { Status: 'NoShow' }, { merge: true });
            });
          }
          // تنظيف Pending منتهي الصلاحية
          purgeOldPendingAppointments(allRecords);
          updateCounts(); calculateDensity(); renderCalendar();
          if (selectedDayStr) renderAgendaForDay(selectedDayStr);
          if (currentSection === 'appointments') renderBothAppointmentColumns();
          scheduleReconcile(); // مزامنة أقفال المواعيد المحجوزة لملف المريض (مؤجّلة)
          // فحص الطلبات الفائتة عند أول تحميل
          if (!_nurseFirstLoad) { _nurseFirstLoad = true; }
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
          if (selectedDayStr) updateDayStatusBadge(selectedDayStr);
        }
      );

      // إعدادات الحجز المشتركة (أوقات الدوام + العطل الأسبوعية) — مصدر موحّد مع ملف المريض
      if (!window._bookingCfgSub) {
        window._bookingCfgSub = window._fb.onSnapshot(window._fb.docRef('config', 'booking'),
          function(snap) {
            if (!snap.exists()) return;
            const data = snap.data() || {};
            if (Array.isArray(data.slots) && data.slots.length) {
              TIME_SLOTS = data.slots.slice();
              try { localStorage.setItem(TIME_SLOTS_KEY, JSON.stringify(TIME_SLOTS)); } catch (e) {}
              fillTimeSelect('patientBookSlot');
            }
            if (Array.isArray(data.weeklyOff)) {
              weeklyOffDays = data.weeklyOff.slice();
              try { localStorage.setItem(WEEKLY_OFF_KEY, JSON.stringify(weeklyOffDays)); } catch (e) {}
            }
            renderCalendar();
          },
          function(e) { console.error('[booking-config]', e); }
        );
      }

      // أقفال المواعيد المحجوزة (لمنع الحجز المزدوج) — مصدر مشترك مع ملف المريض
      // نقرأ أقفال اليوم وما بعده فقط (لا نُحمّل تاريخ الأقفال القديمة) لتقليل القراءات
      if (!window._bookedSlotsSub) {
        window._bookedSlots = {};
        window._bookedSlotsReady = false;
        var _bsFirst = true;
        var _bsQuery = window._fb.query(window._fb.col('bookedSlots'), window._fb.where('date', '>=', todayStr));
        window._bookedSlotsSub = window._fb.onSnapshot(_bsQuery,
          function(snap) {
            const map = {};
            snap.forEach(function(d) { map[d.id] = d.data(); });
            window._bookedSlots = map;
            window._bookedSlotsReady = true;
            // مصالحة مرة واحدة فقط عند أول مزامنة — لا نعيدها على كل تغيير (يكسر حلقة التغذية الراجعة)
            if (_bsFirst) { _bsFirst = false; scheduleReconcile(); }
          },
          function(e) { console.error('[bookedSlots]', e); }
        );
      }

      // تنبيهات الطبيب للممرضة
      if (_unsubNurseAlerts) _unsubNurseAlerts();
      _unsubNurseAlerts = window._fb.onSnapshot(
        window._fb.query(window._fb.col('alerts'), window._fb.orderBy('createdAt','desc'), window._fb.limit(50)),
        function(snap) {
          snap.docChanges().forEach(function(change) {
            if (change.type !== 'added') return;
            var d = change.doc.data();
            if (d.direction !== 'doctorToNurse') return;
            if (d.read) return;
            var ts = d.createdAt ? d.createdAt.toMillis() : 0;
            if (ts <= _alertSeenAt) return;
            var alertKey = change.doc.id;
            if (_shownAlertIds.has(alertKey)) return;
            _shownAlertIds.add(alertKey); // أضف فوراً قبل العرض لمنع التكرار
            if (typeof showDoctorAlert === 'function') showDoctorAlert({ type: d.type, message: d.message });
            window._fb.updateDoc(change.doc.ref, { read: true });
          });
        },
        function(e) { console.error('[alerts]', e); }
      );

      // ── BroadcastChannel: fast path لنفس الجهاز ──
      function _handleFastAlert(payload) {
        if (!payload || payload.direction !== 'doctorToNurse') return;
        // استخدم docId كـ key موحّد مع Firestore
        var key = payload.docId || (String(payload.ts) + payload.type);
        if (_shownAlertIds.has(key)) return;
        _shownAlertIds.add(key); // أضف فوراً قبل العرض لمنع التكرار
        _lastAlertTs = payload.ts || Date.now();
        if (typeof showDoctorAlert === 'function') showDoctorAlert({ type: payload.type, message: payload.message });
      }
      try {
        var _nurseBC = new BroadcastChannel('nurseAlerts');
        _nurseBC.onmessage = function(e) { _handleFastAlert(e.data); };
      } catch(e) {}

      // الإعدادات
      window._fb.getDoc('settings', 'nurse').then(function(snap) {
        if (snap.exists()) { settings = snap.data(); applySettings(); }
      }).catch(function(){});

      // معلومات الطبيب/العيادة + قالب الحقول المخصّصة (يسجّلها الطبيب) — مستمع لحظي
      // ليظهر للممرّضة أي تعديل من الطبيب (خانات جديدة/تعديل) دون إعادة تحميل.
      window._fb.onSnapshot(window._fb.docRef('settings', 'doctor'), function(snap) {
        if (!snap.exists()) return;
        _docSettings = snap.data() || {};
        try { localStorage.setItem('doctorSettings', JSON.stringify(_docSettings)); } catch(e){}
        // إن كانت اضبارة مريض مفتوحة، حدّث عرض حقوله المخصّصة فوراً
        var _pdm = document.getElementById('patientDetailsModal');
        if (_pdm && !_pdm.classList.contains('hidden') && _pdm.dataset.patientId && typeof openPatientDetailsModal === 'function') {
          try { openPatientDetailsModal(_pdm.dataset.patientId); } catch(e){}
        }
      }, function(){});

      // إشعار "طلب جديد" مدمج الآن داخل مُراقب appointments الرئيسي أعلاه (مُراقب واحد لتقليل القراءات)
    }

    function saveAppointment(appointment) {
      appointment.id = appointment.id || ('appt_' + Date.now() + '_' + Math.random().toString(36).substr(2,6));
      const ref = window._fb.docRef('appointments', appointment.id);
      window._fb.setDoc(ref, Object.assign({}, appointment, { createdAt: window._fb.serverTimestamp() }))
        .then(function() {
          // (أُلغي إشعار "تم الحفظ" عند الإضافة بناءً على الطلب)
          // ── إرسال إشعار للطبيب عند إضافة موعد من الممرضة ──
          window._fb.addDoc(window._fb.col('alerts'), {
            type:      'newManualAppt',
            direction: 'nurseToDoctor',
            message:   'موعد جديد: ' + (appointment.PatientName || ''),
            read:      false,
            createdAt: window._fb.serverTimestamp(),
            expireAt:  new Date(Date.now() + 30*24*60*60*1000) // حذف تلقائي بعد ٣٠ يوماً (TTL)
          }).then(function(alertRef) {
            var payload = { type: 'newManualAppt', direction: 'nurseToDoctor',
                            message: 'موعد جديد: ' + (appointment.PatientName || ''),
                            ts: Date.now(), docId: alertRef.id };
            try { new BroadcastChannel('doctorAlerts').postMessage(payload); } catch(e) {}
          }).catch(function(){});
        })
        .catch(function(e) { showToast('فشل الحفظ: ' + e.code,'error'); console.error(e); });
    }

    function updateAppointmentStatus(id, status) {
      const record = allRecords.find(r => r.id === id);
      if (!record) { showToast('لم يُوجد الموعد','error'); return; }
      const ref = window._fb.docRef('appointments', id);

      // تحديث فوري في الذاكرة (optimistic update)
      record.Status = status;
      if (currentSection === 'appointments') renderBothAppointmentColumns();
      updateCounts(); calculateDensity(); renderCalendar();
      if (selectedDayStr) renderAgendaForDay(selectedDayStr);

      // حفظ في Firestore
      window._fb.setDoc(ref, Object.assign({}, record, {
        Status: status, updatedAt: window._fb.serverTimestamp()
      }), { merge: true })
        .then(function() {
          // (أُلغي إشعار تأكيد/تحديث حالة الموعد بناءً على الطلب)
          if (status === 'Accepted') {
            sendWhatsAppConfirmation(record.Phone, record.PatientName, record.Date, record.Slot, record.VisitType);
            window._fb.addDoc(window._fb.col('alerts'), {
              type: 'accepted', direction: 'nurseToDoctor',
              message: 'تم قبول موعد: ' + (record.PatientName || ''), read: false,
              createdAt: window._fb.serverTimestamp(),
              expireAt: new Date(Date.now() + 30*24*60*60*1000) // حذف تلقائي بعد ٣٠ يوماً (TTL)
            }).then(function(docRef) {
              // BroadcastChannel fast path لنفس الجهاز
              var payload = { type: 'accepted', direction: 'nurseToDoctor',
                              message: 'تم قبول موعد: ' + (record.PatientName || ''),
                              ts: Date.now(), docId: docRef.id };
              try { new BroadcastChannel('doctorAlerts').postMessage(payload); } catch(e) {}
            }).catch(function(){});
          } else if (status === 'Rejected') {
            sendWhatsAppRejection(record.Phone, record.PatientName, record.Date, record._rejectAltSlots || []);
          } else if (status === 'Cancelled') {
            sendWhatsAppCancellation(record.Phone, record.PatientName, record.Date);
          }
        })
        .catch(function(e) { showToast('فشل التحديث: ' + e.code,'error'); console.error(e); });
    }

    // حذف نهائي لموعد من قاعدة البيانات + تحرير قفل وقته (للإلغاء/الرفض/انتهاء الصلاحية)
    function _purgeAppointment(id, rec) {
      try {
        if (rec && rec.Date) {
          var lockId = slotLockId(normalizeDate(rec.Date), slotTimeOf(rec));
          window._fb.deleteDoc(window._fb.docRef('bookedSlots', lockId)).catch(function(){});
        }
      } catch (e) {}
      return window._fb.deleteDoc(window._fb.docRef('appointments', id));
    }

    function deleteAppointment(id) {
      const record = (allRecords || []).find(r => r.id === id);
      window._fb.deleteDoc(window._fb.docRef('appointments', id))
        .then(function() {
          // (أُلغي إشعار "تم الإلغاء" بناءً على الطلب)
          // إرسال رسالة إلغاء واتساب مع بديل SMS (نفس نظام التأكيد)
          if (record && record.Phone) sendWhatsAppCancellation(record.Phone, record.PatientName, record.Date);
        })
        .catch(function(e) { console.error(e); });
    }

    function savePatient(patient) {
      const patientId = patient.id || ('p_' + Date.now() + '_' + Math.random().toString(36).substr(2,6));
      patient.id = patientId;
      window._fb.setDoc(window._fb.docRef('patients', patientId), patient)
        .then(function() {
          showToast('تمت إضافة المريض','success');
          document.getElementById('patientBookModal').classList.add('hidden');
        })
        .catch(function(e) { showToast('فشل الحفظ','error'); console.error(e); });
    }

    /* ── حارس حجم مستند المريض ──
       كل زيارات المريض في مستند واحد، وحدّ Firestore ١ ميغابايت. عند بلوغه يفشل
       الحفظ كلياً بلا رسالة مفهومة. نحذّر قبل ذلك بوقت كافٍ.
       TextEncoder لا String.length: النصّ العربي حرفان بايت في UTF-8 فيُقاس نصفه خطأً.
       هنا تحذير فقط بلا منع — مسار الممرّضة ينشئ سجلّ موعد مرافقاً، ومنع الحفظ
       وسطه يترك البيانات متناقضة. المنع (عند ٩٥٪) في تطبيق الطبيب حيث الحفظ مستقلّ. */
    var DOC_LIMIT = 1048576;
    var _sizeWarned = {};
    function _docSizeBytes(o) {
      try { return new TextEncoder().encode(JSON.stringify(o)).length; } catch (e) { return 0; }
    }
    function _warnDocSize(patientId, data) {
      var pct = Math.round(_docSizeBytes(data) / DOC_LIMIT * 100);
      if (pct < 75 || _sizeWarned[patientId]) return;
      _sizeWarned[patientId] = 1;   // مرّة واحدة لكل مريض في الجلسة
      showToast('تنبيه: ملف هذا المريض امتلأ ' + pct + '٪ — أبلغ الطبيب', 'error');
    }

    function updatePatient(patientId, updatedData) {
      _warnDocSize(patientId, updatedData);
      window._fb.setDoc(window._fb.docRef('patients', patientId), updatedData, { merge: true })
        .then(function() { showToast('تم التحديث','success'); })
        .catch(function(e) { console.error(e); });
    }

    function deletePatient(id) {
      appConfirm('هل تريد حذف بيانات هذا المريض نهائياً؟', 'حذف').then(ok => {
        if (!ok) return;
        window._fb.deleteDoc(window._fb.docRef('patients', id))
          .then(function() {
            showToast('تم الحذف','success');
            if (currentSection === 'patients') renderPatientBook();
          })
          .catch(function(e) { showToast('فشل الحذف: ' + e.code,'error'); console.error(e); });
      });
    }

    function toggleDayClosed(dateStr, close) {
      const current = Array.isArray(closedDays) ? [...closedDays] : [];
      const updated = close
        ? (current.includes(dateStr) ? current : [...current, dateStr])
        : current.filter(d => d !== dateStr);
      window._fb.setDoc(window._fb.docRef('config', 'closedDays'), { list: updated })
        .then(function() {
          closedDays = updated;
          try { new BroadcastChannel('clinicSync').postMessage({ key: 'closedDays' }); } catch(e) {}
          renderCalendar();
          if (selectedDayStr) updateDayStatusBadge(selectedDayStr);
        })
        .catch(function(e) { console.error(e); });
    }

    function saveSettingsToFirebase(newSettings) {
      window._fb.setDoc(window._fb.docRef('settings', 'nurse'), newSettings)
        .then(function() { showToast('تم حفظ الإعدادات','success'); })
        .catch(function(e) { showToast('فشل حفظ الإعدادات','error'); console.error(e); });
    }

    // ================== WhatsApp + SMS Fallback ==================
    let _smsFallbackPhone = '';
    let _smsFallbackMsg   = '';

    function openSmsFallbackModal(phone, msg) {
      _smsFallbackPhone = phone;
      _smsFallbackMsg   = msg;
      const modal = document.getElementById('smsFallbackModal');
      const card  = document.getElementById('smsFallbackCard');
      modal.classList.remove('hidden');
      requestAnimationFrame(() => {
        card.style.transform = 'translateY(0)';
        card.style.opacity   = '1';
      });
    }

    function closeSmsModal() {
      const modal = document.getElementById('smsFallbackModal');
      const card  = document.getElementById('smsFallbackCard');
      card.style.transform = 'translateY(20px)';
      card.style.opacity   = '0';
      setTimeout(() => modal.classList.add('hidden'), 250);
    }

    function sendSMSFallback() {
      window.open(`sms:${_smsFallbackPhone}?body=${encodeURIComponent(_smsFallbackMsg)}`, '_blank');
      closeSmsModal();
    }

    function sendWhatsAppConfirmation(phone, name, date, slot, type) {
      const slotLabel = convertLegacySlotToTime(slot);
      const template = getMsg ? getMsg('confirm') : _defaultMsgs.confirm;
      const msg = template
        .replace('{اسم}', name)
        .replace('{تاريخ}', formatDateAr(date))
        .replace('{فترة}', slotLabel)
        .replace('{نوع}', type || 'زيارة');
      const normalized = normalizePhone(phone);
      window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(msg)}`, '_blank');
      setTimeout(() => openSmsFallbackModal(normalized, msg), 1800);
    }

    function sendWhatsAppRejection(phone, name, date, altSlots) {
      const template_r = getMsg ? getMsg('reject') : _defaultMsgs.reject;
      let msg = template_r
        .replace('{اسم}', name||'')
        .replace('{تاريخ}', formatDateAr(date));
      if (altSlots && altSlots.length > 0) {
        msg += `\n\nالمواعيد المتاحة للتعويض:\n`;
        altSlots.forEach((s, i) => {
          msg += `${i+1}. ${formatDateAr(s.date)} — ${convertLegacySlotToTime(s.slot)}\n`;
        });
        msg += `\nيرجى إعادة تعبئة فورم الحجز مرة أخرى بالموعد المناسب لك من هذه المواعيد المتاحة.`;
      }
      const normalized = normalizePhone(phone);
      window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(msg)}`, '_blank');
      setTimeout(() => openSmsFallbackModal(normalized, msg), 1800);
    }

    function sendWhatsAppCancellation(phone, name, date) {
      const template_c = getMsg ? getMsg('cancel') : _defaultMsgs.cancel;
      const msg = template_c
        .replace('{اسم}', name)
        .replace('{تاريخ}', formatDateAr(date));
      const normalized = normalizePhone(phone);
      window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(msg)}`, '_blank');
      setTimeout(() => openSmsFallbackModal(normalized, msg), 1800);
    }

    // ================== Settings ==================
    function applySettings() {
      document.getElementById('dashboardTitle').textContent = settings.title || 'لوحة الممرضة';
      const headerIcon = document.getElementById('headerLogoIcon');
      const headerImg  = document.getElementById('headerLogoImg');
      // Update sidebar profile name
      const sidebarName = document.getElementById('sidebarNurseName');
      if (sidebarName) sidebarName.textContent = settings.title || 'لوحة الممرضة';
      // Update sidebar avatar
      const sidebarAvatar = document.getElementById('sidebarNurseAvatar');
      if (sidebarAvatar) {
        if (settings.logo) {
          sidebarAvatar.innerHTML = '<img src="' + settings.logo + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
        } else {
          sidebarAvatar.innerHTML = '<i class="fas fa-user-nurse"></i>';
        }
      }
      if (settings.logo) {
        headerIcon.classList.add('hidden');
        headerImg.src = settings.logo;
        headerImg.classList.remove('hidden');
      } else {
        headerIcon.classList.remove('hidden');
        headerImg.classList.add('hidden');
      }
      // تحديث التحية في قسم الروزنامة
      updateCalGreeting();
    }

    function updateCalGreeting() {
      var h = new Date().getHours();
      var greet, svgIcon;
      var sunSVG = '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-left:6px;flex-shrink:0;"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/></svg>';
      var moonSVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#6366f1" stroke="#6366f1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-left:6px;flex-shrink:0;"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/></svg>';
      var partCloudSVG = '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-left:6px;flex-shrink:0;"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="2" y1="12" x2="5" y2="12"/><path d="M17 14a3 3 0 1 1 0 6H8a4 4 0 1 1 .87-7.9A4.5 4.5 0 0 1 17 14z" stroke="#94a3b8" fill="rgba(148,163,184,0.18)"/></svg>';
      if (h >= 5 && h < 12)       { greet = 'صباح الخير';  svgIcon = sunSVG; }
      else if (h >= 12 && h < 17) { greet = 'مساء الخير';  svgIcon = partCloudSVG; }
      else if (h >= 17 && h < 21) { greet = 'مساء النور';  svgIcon = moonSVG; }
      else                         { greet = 'تصبحين على خير'; svgIcon = moonSVG; }

      var nameEl = document.getElementById('profileDisplayName');
      var title = (nameEl && nameEl.textContent && nameEl.textContent.trim()) ? nameEl.textContent.trim() : (settings.title || '');
      var displayName = title.replace(/^لوحة\s*/,'').trim();
      var fullGreeting = displayName ? (greet + '، ' + displayName) : greet;

      var g = document.getElementById('calGreeting');
      if (g) g.innerHTML = '<span style="display:inline-flex;align-items:center;gap:4px;">' + svgIcon + fullGreeting + '</span>';
      var d = document.getElementById('calDateLabel');
      if (d) d.textContent = 'إليك ملخص روزنامتك ليوم ' + new Date().toLocaleDateString('ar-EG', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    }
    function closeSettingsModal() { document.getElementById('settingsModal').classList.add('hidden'); }
    window.switchSettingsPanel = function(panel) {
      document.querySelectorAll('.spanel').forEach(function(el){ el.classList.remove('active'); });
      document.querySelectorAll('.sni, .stab').forEach(function(el){ el.classList.remove('active'); });
      var p = document.getElementById('spanel-' + panel);
      if (p) p.classList.add('active');
      document.querySelectorAll('[data-panel="' + panel + '"]').forEach(function(el){ el.classList.add('active'); });
    };
    window.openSettingsModal = function() {
      switchSettingsPanel('profile');
      document.getElementById('settingsTitleInput').value = settings.title || 'لوحة الممرضة';
      document.getElementById('profileDisplayName').textContent = settings.title || 'لوحة الممرضة';
      const previewImg  = document.getElementById('logoPreviewImg');
      const previewIcon = document.getElementById('logoPreviewIcon');
      const removeBtn   = document.getElementById('removeLogoBtn');
      if (settings.logo) {
        previewImg.src = settings.logo; previewImg.classList.remove('hidden');
        previewIcon.classList.add('hidden'); removeBtn.classList.remove('hidden');
      } else {
        previewImg.classList.add('hidden'); previewIcon.classList.remove('hidden'); removeBtn.classList.add('hidden');
      }
      renderSlotSettingsEditor();
      renderWeeklyOffChips();
      updateAmPm('slotGenFrom','_ap_f1'); updateAmPm('slotGenTo','_ap_t1');
      updateAmPm('slotGenFrom2','_ap_f2'); updateAmPm('slotGenTo2','_ap_t2');
      document.getElementById('settingsModal').classList.remove('hidden');
    };
    // ── محرر سلوتات المواعيد ──
    const _fmtMin = function(m) { return String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0'); };
    window.toggleSecondPeriod = function() {
      const on = document.getElementById('slotGen2Enabled').checked;
      document.getElementById('slotGen2Wrap').style.display = on ? 'block' : 'none';
    };
    function renderSlotSettingsEditor() {
      const ta = document.getElementById('settingsSlotsInput');
      if (ta) ta.value = TIME_SLOTS.join(', ');
      if (!TIME_SLOTS.length) return;
      const mins = TIME_SLOTS.map(slotMinutes);
      // استنتاج مدة الموعد = أصغر فرق موجب
      let step = 30, minDiff = Infinity;
      for (let i = 1; i < mins.length; i++) { const dd = mins[i] - mins[i-1]; if (dd > 0 && dd < minDiff) minDiff = dd; }
      if (minDiff !== Infinity) step = minDiff;
      const stepSel = document.getElementById('slotGenStep');
      if (stepSel) { const allowed = [15,20,30,60]; stepSel.value = String(allowed.reduce(function(a,b){ return Math.abs(b-step) < Math.abs(a-step) ? b : a; })); }
      // ابحث عن أكبر فجوة (> 1.5×المدة) لتقسيم الأوقات إلى فترتين
      let splitIdx = -1, big = step * 1.5;
      for (let i = 1; i < mins.length; i++) { if (mins[i] - mins[i-1] > big) { big = mins[i] - mins[i-1]; splitIdx = i; } }
      const f1 = document.getElementById('slotGenFrom'), t1 = document.getElementById('slotGenTo');
      const chk = document.getElementById('slotGen2Enabled');
      const f2 = document.getElementById('slotGenFrom2'), t2 = document.getElementById('slotGenTo2');
      if (splitIdx > 0) {
        if (f1) f1.value = TIME_SLOTS[0];
        if (t1) t1.value = TIME_SLOTS[splitIdx - 1];
        if (chk) chk.checked = true;
        if (f2) f2.value = TIME_SLOTS[splitIdx];
        if (t2) t2.value = TIME_SLOTS[TIME_SLOTS.length - 1];
      } else {
        if (f1) f1.value = TIME_SLOTS[0];
        if (t1) t1.value = TIME_SLOTS[TIME_SLOTS.length - 1];
        if (chk) chk.checked = false;
      }
      toggleSecondPeriod();
    }
    // ── توليد الأوقات لفترة واحدة أو فترتين ──
    window.generateSlots = function() {
      const step = parseInt(document.getElementById('slotGenStep').value, 10) || 30;
      const ranges = [[document.getElementById('slotGenFrom').value || '08:00', document.getElementById('slotGenTo').value || '12:00']];
      if (document.getElementById('slotGen2Enabled').checked) {
        ranges.push([document.getElementById('slotGenFrom2').value || '16:00', document.getElementById('slotGenTo2').value || '20:00']);
      }
      const seen = {}, out = []; let bad = false;
      ranges.forEach(function(r) {
        const s = slotMinutes(r[0]), e = slotMinutes(r[1]);
        if (e <= s) { bad = true; return; }
        for (let m = s; m <= e; m += step) { const t = _fmtMin(m); if (!seen[t]) { seen[t] = 1; out.push(t); } }
      });
      if (bad) { _createNotif('في كل فترة، وقت النهاية يجب أن يكون بعد البداية', '#ef4444', 4000); return; }
      out.sort(function(a,b){ return slotMinutes(a) - slotMinutes(b); });
      document.getElementById('settingsSlotsInput').value = out.join(', ');
      autoSaveSettings();
      _createNotif('تم توليد ' + out.length + ' وقت وحفظها تلقائياً', 'var(--primary)', 3000);
    };
    // ── أيام العطلة الأسبوعية ──
    const WEEKDAYS_AR = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    function renderWeeklyOffChips() {
      const box = document.getElementById('weeklyOffChips'); if (!box) return;
      box.innerHTML = WEEKDAYS_AR.map(function(name, i) {
        const on = weeklyOffDays.indexOf(i) !== -1;
        return '<button type="button" class="off-chip' + (on ? ' off-chip-active' : '') + '" data-day="' + i + '" onclick="this.classList.toggle(\'off-chip-active\'); autoSaveSettings()">' + name + '</button>';
      }).join('');
    }
    function collectWeeklyOff() {
      const arr = [];
      document.querySelectorAll('#weeklyOffChips .off-chip-active').forEach(function(el) { arr.push(parseInt(el.getAttribute('data-day'), 10)); });
      return arr;
    }
    window.resetSlotSettings = function() {
      const ta = document.getElementById('settingsSlotsInput');
      if (ta) ta.value = DEFAULT_TIME_SLOTS.join(', ');
    };
    function applySlotSettingsFromInput() {
      const ta = document.getElementById('settingsSlotsInput');
      if (!ta) return;
      const parsed = ta.value.split(/[\n,،]+/)
        .map(function(s){ return s.trim(); })
        .filter(function(s){ return /^\d{1,2}:\d{2}$/.test(s); })
        .map(function(s){ const p = s.split(':'); return p[0].padStart(2,'0') + ':' + p[1]; });
      // إزالة التكرار + ترتيب تصاعدي
      const uniq = [];
      parsed.forEach(function(s){ if (uniq.indexOf(s) === -1) uniq.push(s); });
      uniq.sort(function(a,b){ return slotMinutes(a) - slotMinutes(b); });
      if (uniq.length) {
        saveTimeSlots(uniq);
        // إعادة تعبئة القوائم الثابتة
        fillTimeSelect('patientBookSlot');
      }
    }
    function autoSaveSettings() {
      const newTitle = (document.getElementById('settingsTitleInput') && document.getElementById('settingsTitleInput').value.trim()) || '';
      if (newTitle) settings.title = newTitle;
      applySlotSettingsFromInput();
      saveWeeklyOff(collectWeeklyOff());
      saveSettingsToFirebase(settings);
      try {
        window._fb.setDoc(window._fb.docRef('config', 'booking'),
          { slots: TIME_SLOTS, weeklyOff: weeklyOffDays, updatedAt: window._fb.serverTimestamp() },
          { merge: true }
        );
      } catch (e) { console.error('[auto-save booking-config]', e); }
      applySettings();
      renderCalendar();
    }
    function saveSettings() {
      autoSaveSettings();
      closeSettingsModal();
      showToast('تم حفظ الإعدادات','success');
    }
    function updateAmPm(inputId, spanId) {
      var el = document.getElementById(inputId);
      var sp = document.getElementById(spanId);
      if (!el || !sp) return;
      var h = parseInt((el.value || '00:00').split(':')[0], 10);
      sp.textContent = h < 12 ? 'ص' : 'م';
    }

    // ============================================================
    //   THEME (الوضع الليلي) + LANGUAGE (اللغة)
    // ============================================================
    const THEME_KEY = 'nurseTheme';
    function applyTheme(theme) {
      const dark = theme === 'dark';
      document.body.classList.toggle('theme-dark', dark);
      const btn = document.getElementById('themeToggleBtn');
      const knob = document.getElementById('themeToggleKnob');
      if (btn)  { btn.setAttribute('aria-checked', dark ? 'true' : 'false'); btn.style.background = dark ? 'var(--primary)' : 'var(--border-strong)'; }
      if (knob) { knob.style.transform = dark ? 'translateX(-22px)' : 'translateX(0)'; }
    }
    window.toggleTheme = function() {
      const next = document.body.classList.contains('theme-dark') ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      applyTheme(next);
    };

    // ── Rail collapse / expand ──
    var RAIL_KEY = 'nurseRailExpanded';
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
    // no-op stubs للتوافق مع أي مرجع قديم
    window.openDrawer  = function() {};
    window.closeDrawer = function() {};

    // ── إظهار / إخفاء الروزنامة الشهرية ──
    window.toggleMiniCalendar = function() {
      const w = document.getElementById('calendarWidget'); if (!w) return;
      const isHidden = w.style.display === 'none';
      w.style.display = isHidden ? '' : 'none';
      const btn = document.getElementById('miniCalToggleBtn');
      if (btn) btn.style.background = isHidden ? '' : 'var(--primary-light)';
    };

    // تطبيق الوضع المحفوظ عند التحميل
    (function() {
      let th = 'light';
      try { th = localStorage.getItem(THEME_KEY) || 'light'; } catch (e) {}
      applyTheme(th);
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
    window.removeLogo = function() {
      settings.logo = null;
      document.getElementById('logoPreviewImg').classList.add('hidden');
      document.getElementById('logoPreviewIcon').classList.remove('hidden');
      document.getElementById('removeLogoBtn').classList.add('hidden');
      document.getElementById('logoFileInput').value = '';
      saveSettingsToFirebase(settings);
      applySettings();
    };

    // ================== Day State ==================
    function isDayClosed(dateStr) {
      if (closedDays.includes(dateStr)) return true;
      // أيام العطلة الأسبوعية الثابتة
      if (weeklyOffDays && weeklyOffDays.length) {
        try { if (weeklyOffDays.indexOf(parseLocalISODate(dateStr).getDay()) !== -1) return true; } catch (e) {}
      }
      return false;
    }
    function closeDay(dateStr) { toggleDayClosed(dateStr, true); }
    function openDay(dateStr) { toggleDayClosed(dateStr, false); }
    function updateDayStatusBadge(dateStr) {
      const badge=document.getElementById('dayStatusBadge');
      const closeIcon=document.getElementById('closeDayIcon');
      const openIcon=document.getElementById('openDayIcon');
      // Reset any custom inline styles from past-day display
      badge.style.background = '';
      badge.style.color = '';
      badge.style.border = '';
      if (isDayClosed(dateStr)) {
        badge.innerHTML='مغلق'; badge.className='day-status-badge closed';
        closeIcon.classList.add('hidden'); openIcon.classList.remove('hidden');
      } else {
        badge.innerHTML='مفتوح'; badge.className='day-status-badge open';
        closeIcon.classList.remove('hidden'); openIcon.classList.add('hidden');
      }
    }
    function updateCounts() {
      const pending  = allRecords.filter(r=>r.Status==='Pending').length;
      const accepted = allRecords.filter(r=>r.Status==='Accepted').length;
      document.getElementById('pendingTabCount').textContent  = pending;
      document.getElementById('acceptedTabCount').textContent = accepted;
      lastPendingCount = pending; lastAcceptedCount = accepted;
      updateApptNavDot();
    }
    // نقطة الطلبات الجديدة: تظهر طالما يوجد طلب معلّق ولم يُقبل/يُرفض بعد
    function updateApptNavDot() {
      const pending = (allRecords || []).filter(r => r.Status === 'Pending').length;
      ['apptNavDot','apptNavDotMobile'].forEach(function(id) {
        const el = document.getElementById(id); if (el) el.style.display = pending > 0 ? 'block' : 'none';
      });
    }
    function calculateDensity() {
      dayDensity = {};
      allRecords.filter(r=>r.Status==='Accepted'||r.Status==='Visited'||r.Status==='NoShow').forEach(r=>{ const nd=normalizeDate(r.Date); dayDensity[nd]=(dayDensity[nd]||0)+1; });
    }

    // ================== Navigation ==================
    var _histNav = false;
    function setActiveSection(section, skipApptContent) {
      currentSection = section;
      if (!_histNav) history.pushState({ section }, '', '#' + section);
      document.querySelectorAll('.sidebar-item, .bottom-nav-item').forEach(el=>el.classList.remove('active'));
      const sectionMap = {
        appointments: ['sidebarAppointments','mobileAppointments','appointmentsSection'],
        patients:     ['sidebarPatients','mobilePatients','patientBookSection'],
        calendar:     ['sidebarCalendar','mobileCalendar','calendarSection'],
      };
      const allSections = ['appointmentsSection','patientBookSection','calendarSection'];
      allSections.forEach(s=>document.getElementById(s)?.classList.add('hidden'));
      const [side, mob, sec] = sectionMap[section] || [];
      document.getElementById(side)?.classList.add('active');
      document.getElementById(mob)?.classList.add('active');
      document.getElementById(sec)?.classList.remove('hidden');
      if (section==='appointments' && !skipApptContent) renderBothAppointmentColumns();
      if (section==='patients')     renderPatientBook();
      if (section==='calendar') { renderCalendar(); renderAgendaForDay(selectedDayStr); updateDayStatusBadge(selectedDayStr); updateCalGreeting(); }
    }
    window.goToManualForm = function() {
      if (window.innerWidth >= 768) {
        // Desktop: open floating overlay, don't switch sections
        openManualFormOverlay();
      } else {
        // Mobile: original behavior
        setActiveSection('appointments');
        setAppointmentsTab('manual');
      }
    };
    window.goToToday = function() {
      currentDate = new Date(today); selectedDayStr = todayStr;
      setActiveSection('calendar');
      renderCalendar(); renderAgendaForDay(todayStr); updateDayStatusBadge(todayStr);
    };
    function setAppointmentsTab(tab) {
      appointmentsTab = tab;
      // Dual view is always shown — tab logic only for mobile manual form
      if (tab === 'manual') {
        setActiveSection('appointments');
        openManualFormOverlay();
      } else {
        renderBothAppointmentColumns();
      }
    }

    // ================== Appointments ==================
    // ====== Appointments Sub-Nav ======
    let apptSubOpen = false;
    let activeApptTab = null; // null = لا شيء مختار

    window.toggleApptSubNav = function() {
      // Sidebar
      const sidebarSub  = document.getElementById('sidebarApptSub');
      const sidebarItem = document.getElementById('sidebarAppointments');
      if (sidebarSub)  sidebarSub.classList.toggle('open');
      if (sidebarItem) sidebarItem.classList.toggle('sub-open');
      // إظهار appointmentsSection مع pending فوراً
      if (!activeApptTab) activeApptTab = 'pending';
      setActiveSection('appointments', true);
      renderBothAppointmentColumns();
      switchApptTab(activeApptTab);
    };

    window.selectApptSub = function(tab) {
      activeApptTab = tab;
      apptSubOpen = false;
      // أغلق sub-nav
      const sidebarSub  = document.getElementById('sidebarApptSub');
      const sidebarItem = document.getElementById('sidebarAppointments');
      const mobSub      = document.getElementById('mobApptSubNav');
      if (sidebarSub)  sidebarSub.classList.remove('open');
      if (sidebarItem) sidebarItem.classList.remove('sub-open');
      if (mobSub)      mobSub.classList.remove('open');
      // Active states
      ['subPending','subAccepted','mobSubPending','mobSubAccepted'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
      });
      if (tab === 'pending') {
        document.getElementById('subPending')?.classList.add('active');
        document.getElementById('mobSubPending')?.classList.add('active');
      } else {
        document.getElementById('subAccepted')?.classList.add('active');
        document.getElementById('mobSubAccepted')?.classList.add('active');
      }
      // Sidebar item active
      if (sidebarItem) sidebarItem.classList.add('active');
      document.getElementById('mobileAppointments')?.classList.add('active');
      // أظهر القسم + render + الكارت الصح
      setActiveSection('appointments', true);
      renderBothAppointmentColumns();
      switchApptTab(tab);
    };

    // setActiveSection بدون إظهار محتوى (للـ sub-nav)
    function setActiveSectionNoContent() {
      setActiveSection('appointments', true); // skipApptContent=true
    }

    window.switchApptTab = function(tab) {
      const pendingCol  = document.querySelector('#appointmentsDualView .glass-card:nth-child(1)');
      const acceptedCol = document.querySelector('#appointmentsDualView .glass-card:nth-child(2)');
      if (tab === 'pending') {
        if (pendingCol)  pendingCol.classList.add('active');
        if (acceptedCol) acceptedCol.classList.remove('active');
      } else {
        if (pendingCol)  pendingCol.classList.remove('active');
        if (acceptedCol) acceptedCol.classList.add('active');
      }
      // Update inline tab bar
      const btnP = document.getElementById('apptTabBtnPending');
      const btnA = document.getElementById('apptTabBtnAccepted');
      const bdgP = document.getElementById('apptBadgePending');
      const bdgA = document.getElementById('apptBadgeAccepted');
      const BASE = 'flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:9px 14px;border-radius:50px;border:none;cursor:pointer;font-family:inherit;font-weight:700;font-size:.82rem;transition:all .22s;';
      if (btnP && btnA) {
        if (tab === 'pending') {
          btnP.style.cssText = BASE + 'background:var(--primary);color:white;box-shadow:0 2px 12px rgba(13,148,136,.3);';
          btnA.style.cssText = BASE + 'background:transparent;color:var(--text-muted);';
          if (bdgP) { bdgP.style.background='rgba(255,255,255,.25)'; bdgP.style.color='white'; }
          if (bdgA) { bdgA.style.background='var(--border)'; bdgA.style.color='var(--text-muted)'; }
        } else {
          btnA.style.cssText = BASE + 'background:var(--primary);color:white;box-shadow:0 2px 12px rgba(13,148,136,.3);';
          btnP.style.cssText = BASE + 'background:transparent;color:var(--text-muted);';
          if (bdgA) { bdgA.style.background='rgba(255,255,255,.25)'; bdgA.style.color='white'; }
          if (bdgP) { bdgP.style.background='var(--border)'; bdgP.style.color='var(--text-muted)'; }
        }
      }
    };

    function applyActiveTab() {
      const pendingCol  = document.querySelector('#appointmentsDualView .glass-card:nth-child(1)');
      const acceptedCol = document.querySelector('#appointmentsDualView .glass-card:nth-child(2)');
      if (activeApptTab) {
        switchApptTab(activeApptTab);
      } else {
        // لا اختيار → أخفِ الكارتين
        if (pendingCol)  pendingCol.classList.remove('active');
        if (acceptedCol) acceptedCol.classList.remove('active');
      }
    }

    function renderAppointmentsView() {
      renderBothAppointmentColumns();
      applyActiveTab();
    }

    function renderBothAppointmentColumns() {
      const pendingContainer  = document.getElementById('pendingCardsContainer');
      const acceptedContainer = document.getElementById('acceptedCardsContainer');
      if (!pendingContainer || !acceptedContainer) return;

      // --- Pending ---
      let pending = allRecords.filter(r=>r.Status==='Pending').sort((a,b)=>(b.Date||'').localeCompare(a.Date||''));
      document.getElementById('pendingTabCount').textContent = pending.length;
      const bdgP = document.getElementById('apptBadgePending');
      if (bdgP) bdgP.textContent = pending.length;
      ['subBadgePending','mobSubBadgePending'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=pending.length; });
      pendingContainer.classList.toggle('is-empty', pending.length === 0);
      pendingContainer.innerHTML = pending.length
        ? pending.map(r=>appointmentCardHTML(r,'Pending')).join('')
        : `<div style="grid-column:1/-1; display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; min-height:50vh; color:var(--text-muted); text-align:center;">
            <i class="fas fa-check-circle" style="font-size:2.6rem; margin-bottom:12px; opacity:.4; color:var(--green);"></i>
            <span style="font-size:.95rem; font-weight:600;">لا توجد طلبات جديدة</span></div>`;

      // --- Accepted --- (اليوم والمستقبل فقط)
      let accepted = allRecords.filter(r=>r.Status==='Accepted' && parseLocalISODate(normalizeDate(r.Date)) >= today).sort((a,b)=>(a.Date||'').localeCompare(b.Date||''));
      document.getElementById('acceptedTabCount').textContent = accepted.length;
      const bdgA = document.getElementById('apptBadgeAccepted');
      if (bdgA) bdgA.textContent = accepted.length;
      ['subBadgeAccepted','mobSubBadgeAccepted'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=accepted.length; });
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        accepted = accepted.filter(r=>(r.PatientName||'').toLowerCase().includes(q)||(r.Phone||'').includes(q)||(r.Date||'').includes(q));
      }
      acceptedContainer.classList.toggle('is-empty', accepted.length === 0);
      acceptedContainer.innerHTML = accepted.length
        ? accepted.map(r=>appointmentCardHTML(r,'Accepted')).join('')
        : `<div style="grid-column:1/-1; display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; min-height:50vh; color:var(--text-muted); text-align:center;">
            <i class="fas fa-calendar-xmark" style="font-size:2.6rem; margin-bottom:12px; opacity:.4;"></i>
            <span style="font-size:.95rem; font-weight:600;">لا توجد مواعيد مؤكدة</span></div>`;
      updateApptNavDot();
    }

    // Lucide-style inline SVG helpers for appointment cards
    const ICON = {
      phone: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.43 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.87a16 16 0 0 0 6.29 6.29l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
      whatsapp: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>`,
      check: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
      x: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
      eye: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
      trash: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
      stethoscope: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>`,
      calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
      clock: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
      tag: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
      bell: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
      sms: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    };

    // ══════════════════════════════════════════════════════════
    //  إعدادات Cloudinary
    // ══════════════════════════════════════════════════════════
    const CLOUDINARY_CLOUD_NAME    = 'dbckv4vqo';
    const CLOUDINARY_UPLOAD_PRESET = 'docbook';
    const IMAGE_EXPIRY_HOURS = 24;

    async function uploadToCloudinary(file) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
        formData.append('tags', 'docbook_temp');
        const res = await fetch(
          `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
          { method: 'POST', body: formData }
        );
        if (!res.ok) throw new Error('Upload failed');
        const data = await res.json();
        return { url: data.secure_url, publicId: data.public_id };
      } catch(e) {
        console.error('Cloudinary upload error:', e);
        return null;
      }
    }

    function isImageExpired(img) {
      if (!img || !img.uploadedAt) return false;
      return (Date.now() - img.uploadedAt) > IMAGE_EXPIRY_HOURS * 60 * 60 * 1000;
    }

    function appointmentCardHTML(record, status) {
      const phone = normalizePhone(record.Phone);
      const visitType = record.VisitType||'غير محدد';
      const date = formatDateAr(record.Date);
      const slot = slotLabelOf(record);
      const name = record.PatientName || '—';
      const initial = String(name).trim().charAt(0) || '؟';
      const isPending = (status === 'Pending');
      const statusCls = isPending ? 'is-pending' : 'is-accepted';
      const statusLabel = isPending ? 'بانتظار القبول' : 'مؤكد';

      const head = `
        <div class="appt-head">
          <div class="appt-id">
            <div class="appt-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
            <div class="appt-id-text">
              <p class="appt-name">${escapeHtml(name)}</p>
              <span class="appt-phone">${escapeHtml(record.Phone || '')}</span>
            </div>
          </div>
          <div class="appt-contacts">
            <a href="tel:${phone}" class="appt-ibtn call" title="اتصال">${ICON.phone}</a>
            <a href="https://wa.me/${phone}" target="_blank" class="appt-ibtn wa" title="واتساب">${ICON.whatsapp}</a>
          </div>
        </div>
        <div class="appt-chips">
          <span class="appt-chip">${ICON.clock}<span>${slot}</span></span>
          <span class="appt-chip">${ICON.calendar}<span>${date}</span></span>
          <span class="appt-chip">${ICON.tag}<span>${escapeHtml(visitType)}</span></span>
        </div>`;

      if (isPending) {
        return `<div class="appt-card ${statusCls}">
          ${head}
          <div class="appt-actions">
            <button class="appt-btn primary" onclick="acceptAppointment('${record.id}')">${ICON.check}<span>قبول</span></button>
            <button class="appt-btn danger" onclick="rejectAppointment('${record.id}')">${ICON.x}<span>رفض</span></button>
            <button class="appt-btn ghost" onclick="openModalById('${record.id}')">${ICON.eye}<span>تفاصيل</span></button>
          </div>
        </div>`;
      }
      return `<div class="appt-card ${statusCls}" data-card-id="${record.id}">
        ${head}
        <div class="appt-actions">
          <button class="appt-btn primary" onclick="openModalById('${record.id}')">${ICON.eye}<span>تفاصيل</span></button>
          <button class="appt-btn danger" onclick="cancelAppointment('${record.id}')">${ICON.trash}<span>إلغاء</span></button>
        </div>
      </div>`;
    }

    function acceptAppointment(id) { appConfirm('قبول هذا الموعد؟', 'قبول').then(ok => { if(ok) updateAppointmentStatus(id,'Accepted'); }); }
    function rejectAppointment(id)  { openRejectModal(id); }
    function cancelAppointment(id)  {
      appConfirm('إلغاء هذا الموعد وحذفه نهائياً؟', 'إلغاء الموعد').then(ok => {
        if (!ok) return;
        var rec = allRecords.find(r => r.id === id);
        if (rec && rec.Phone) sendWhatsAppCancellation(rec.Phone, rec.PatientName, rec.Date);
        _purgeAppointment(id, rec)
          .then(function(){ showToast('تم إلغاء الموعد وحذفه','success'); })
          .catch(function(e){ showToast('فشل الحذف','error'); console.error(e); });
      });
    }

    // ============================================================
    //   REJECT MODAL — روزنامة اختيار مواعيد التعويض
    // ============================================================
    let rejectModalApptId = null;
    let rejectCalDate = new Date();
    let rejectSelectedSlots = []; // [{date:'YYYY-MM-DD', slot:'HH:MM'}]
    let rejectPickDate = null;    // اليوم المحدد لاختيار أوقاته

    function openRejectModal(id) {
      const records = allRecords;
      const rec = records.find(r => r.id === id);
      if (!rec) return;
      rejectModalApptId = id;
      rejectSelectedSlots = [];
      rejectPickDate = null;
      rejectCalDate = new Date();
      rejectCalDate.setHours(0,0,0,0);
      document.getElementById('rejectPatientName').textContent = rec.PatientName;
      document.getElementById('rejectPatientDate').textContent = formatDateAr(rec.Date) + ' — ' + slotLabelOf(rec);
      renderRejectCalendar();
      renderRejectSelectedSlots();
      document.getElementById('rejectModal').classList.remove('hidden');
    }

    window.closeRejectModal = function() {
      document.getElementById('rejectModal').classList.add('hidden');
      rejectModalApptId = null;
      rejectSelectedSlots = [];
      rejectPickDate = null;
    };

    function renderRejectCalendar() {
      const grid = document.getElementById('rejectCalGrid');
      if (!grid) return;
      const year = rejectCalDate.getFullYear(), month = rejectCalDate.getMonth();
      document.getElementById('rejectCalMonth').textContent = monthsAr[month] + ' ' + year;
      grid.innerHTML = '';
      const today2 = new Date(); today2.setHours(0,0,0,0);
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month+1, 0).getDate();
      let startOffset = (firstDay + 3) % 7;
      for (let i = startOffset-1; i >= 0; i--) {
        const el = document.createElement('div'); el.className = 'rcal-day rcal-other'; grid.appendChild(el);
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, month, d); dateObj.setHours(0,0,0,0);
        const dateStr = toLocalISODate(dateObj);
        const isPast = dateObj < today2;
        const closed = isDayClosed(dateStr);
        const el = document.createElement('div');
        el.className = 'rcal-day' + (isPast ? ' rcal-past' : '') + (closed ? ' rcal-closed' : '');
        if (dateObj.getTime() === today2.getTime()) el.classList.add('rcal-today');
        const cnt = rejectSelectedSlots.filter(s => s.date === dateStr).length;
        if (!isPast && !closed) {
          el.classList.add('rcal-pick');
          if (rejectPickDate === dateStr) el.classList.add('rcal-pickactive');
          el.onclick = function() { rejectSelectDay(dateStr); };
        }
        el.innerHTML = '<span class="rcal-num">' + d + '</span>' + (cnt ? '<span class="rcal-count">' + cnt + '</span>' : '');
        grid.appendChild(el);
      }
      renderRejectTimePanel();
    }

    // اختيار اليوم لعرض أوقاته
    window.rejectSelectDay = function(dateStr) { rejectPickDate = dateStr; renderRejectCalendar(); };

    // لوحة الأوقات (سلوتات) لليوم المحدد
    function renderRejectTimePanel() {
      const panel = document.getElementById('rejectTimePanel'); if (!panel) return;
      if (!rejectPickDate) {
        panel.innerHTML = '<div style="text-align:center; color:var(--text-muted); font-size:.78rem; padding:12px; background:var(--bg); border:1.5px dashed var(--border); border-radius:12px;"><i class="far fa-hand-pointer" style="margin-left:6px;"></i>اختاري يوماً من الروزنامة لعرض الأوقات المتاحة</div>';
        return;
      }
      const taken = takenTimesForDay(rejectPickDate); // لا نقترح وقتاً محجوزاً
      const chips = TIME_SLOTS.map(function(t) {
        if (taken[t]) {
          return '<button type="button" class="rtime-chip" disabled title="محجوز" style="opacity:.4; cursor:not-allowed; text-decoration:line-through;">' + t + '</button>';
        }
        const active = rejectSelectedSlots.some(s => s.date === rejectPickDate && s.slot === t);
        return '<button type="button" class="rtime-chip' + (active ? ' rtime-chip-active' : '') + '" onclick="toggleRejectTime(\'' + t + '\')">' + t + '</button>';
      }).join('');
      panel.innerHTML = '<div class="rtime-wrap">'
        + '<p style="font-weight:700; font-size:.8rem; color:var(--text); margin-bottom:10px;"><i class="far fa-clock" style="margin-left:6px; color:var(--primary);"></i>أوقات ' + formatDateAr(rejectPickDate) + '</p>'
        + '<div class="rtime-grid">' + chips + '</div></div>';
    }

    // تبديل وقت كموعد بديل لليوم المحدد
    window.toggleRejectTime = function(time) {
      if (!rejectPickDate) return;
      const idx = rejectSelectedSlots.findIndex(s => s.date === rejectPickDate && s.slot === time);
      if (idx > -1) rejectSelectedSlots.splice(idx, 1);
      else rejectSelectedSlots.push({ date: rejectPickDate, slot: time });
      renderRejectCalendar();
      renderRejectSelectedSlots();
    };

    function renderRejectSelectedSlots() {
      const container = document.getElementById('rejectSelectedList');
      const sendBtn = document.getElementById('rejectSendBtn');
      if (!rejectSelectedSlots.length) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:.8rem;text-align:center;padding:10px 0;">لم يتم اختيار أي موعد بديل بعد</p>';
        sendBtn.textContent = 'رفض بدون مواعيد بديلة';
        sendBtn.style.background = 'var(--red)';
      } else {
        container.innerHTML = rejectSelectedSlots
          .sort((a,b)=>a.date.localeCompare(b.date))
          .map(s => `<div class="rcal-selected-chip">
            <i class="fas fa-calendar-day"></i>
            <span>${formatDateAr(s.date)} — ${convertLegacySlotToTime(s.slot)}</span>
            <button onclick="removeRejectSlot('${s.date}','${s.slot}')" title="حذف"><i class="fas fa-times"></i></button>
          </div>`).join('');
        sendBtn.textContent = 'رفض وإرسال المواعيد البديلة (' + rejectSelectedSlots.length + ')';
        sendBtn.style.background = 'var(--primary)';
      }
    }

    window.removeRejectSlot = function(dateStr, slot) {
      rejectSelectedSlots = rejectSelectedSlots.filter(s => !(s.date===dateStr && s.slot===slot));
      renderRejectCalendar();
      renderRejectSelectedSlots();
    };

    window.prevRejectMonth = function() {
      rejectCalDate.setMonth(rejectCalDate.getMonth() - 1);
      renderRejectCalendar();
    };
    window.nextRejectMonth = function() {
      rejectCalDate.setMonth(rejectCalDate.getMonth() + 1);
      renderRejectCalendar();
    };

    window.confirmReject = function() {
      if (!rejectModalApptId) return;
      const rec = allRecords.find(r => r.id === rejectModalApptId);
      if (!rec) return;
      rec._rejectAltSlots = rejectSelectedSlots.slice();
      // أرسل رسالة الرفض ثم احذف الموعد نهائياً (بدل إبقائه بحالة "مرفوض")
      sendWhatsAppRejection(rec.Phone, rec.PatientName, rec.Date, rejectSelectedSlots);
      _purgeAppointment(rec.id, rec).then(function() {
        showToast('تم رفض الموعد وحذفه','success');
        closeRejectModal();
      }).catch(function(e) { showToast('فشل الرفض','error'); console.error(e); });
      updateCounts(); calculateDensity(); renderCalendar();
      if (selectedDayStr) renderAgendaForDay(selectedDayStr);
      if (currentSection === 'appointments') renderBothAppointmentColumns();
    };

    // ================== Patients ==================
    var _pbTimer = null;
    function renderPatientBook() {
      const grid = document.getElementById('patientsGrid');
      const search = (patientSearchQuery || '').trim();
      if (search) {
        // [أقصى توفير] بحث من الخادم ببادئة الاسم
        grid.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted)"><i class="fas fa-circle-notch fa-spin"></i> جارٍ البحث في الخادم...</div>';
        clearTimeout(_pbTimer);
        _pbTimer = setTimeout(function() {
          var hi = search + String.fromCharCode(0xf8ff);
          window._fb.getDocs(window._fb.query(window._fb.col('patients'), window._fb.orderBy('name'), window._fb.where('name','>=',search), window._fb.where('name','<=', hi), window._fb.limit(25)))
            .then(function(snap){ var list=[]; snap.forEach(function(d){ var o=Object.assign({id:d.id}, d.data()); allPatients[d.id]=o; list.push(o); }); _pbRenderRows(list); })
            .catch(function(e){ console.error(e); grid.innerHTML='<div style="text-align:center;padding:32px;color:#dc2626">تعذّر البحث</div>'; });
        }, 350);
        return;
      }
      _pbRenderRows(Object.values(allPatients));
    }
    function _pbRenderRows(patients) {
      const grid = document.getElementById('patientsGrid');
      if (!patients.length) {
        grid.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);"><i class="fas fa-user-slash" style="font-size:2rem;display:block;margin-bottom:10px;opacity:.4;"></i>لا يوجد مرضى</div>';
        return;
      }
      grid.innerHTML = patients.map(p=>{
        const phone = normalizePhone(p.phone);
        return `<div class="patient-row" style="cursor:pointer;" title="افتح إضبارة المريض" onclick="openPatientDetailsModal('${p.id}')" oncontextmenu="event.preventDefault();openPatientDetailsModal('${p.id}');return false;">
          <div class="pr-name">
            <div class="pr-name-t">${escapeHtml(p.name)}</div>
            <div class="pr-phone-sub" dir="ltr">${escapeHtml(p.phone||'')}</div>
          </div>
          <div class="pr-visits"><i class="fas fa-calendar-check" style="font-size:.72rem;"></i> ${p.totalVisits||0} زيارة</div>
          <div class="pr-actions">
            <button class="pr-btn primary"   title="إضافة زيارة" onclick="event.stopPropagation();openAddVisitModal('${p.id}','${escapeHtml(p.name)}','${escapeHtml(p.phone)}','${p.birthDate||''}','${escapeHtml(p.address||'')}')"><i class="fas fa-plus"></i></button>
            <button class="pr-btn secondary" title="تفاصيل" onclick="event.stopPropagation();openPatientDetailsModal('${p.id}')"><i class="fas fa-eye"></i></button>
            <a class="pr-btn whatsapp" href="https://wa.me/${phone}" target="_blank" title="واتساب" onclick="event.stopPropagation()"><i class="fab fa-whatsapp"></i></a>
            <a class="pr-btn call" href="tel:${phone}" title="اتصال" onclick="event.stopPropagation()"><i class="fas fa-phone"></i></a>
            <button class="pr-btn danger"    title="حذف" onclick="event.stopPropagation();deletePatient('${p.id}')"><i class="fas fa-trash-alt"></i></button>
          </div>
        </div>`;
      }).join('');
    }

    function openPatientDetailsModal(patientId) {
      const p = allPatients[patientId]; if(!p) return;
      document.getElementById('modalPatientName').textContent  = p.name || '-';
      document.getElementById('modalPatientPhone').textContent = p.phone || '';
      document.getElementById('modalWhatsappBtn').href = `https://wa.me/${normalizePhone(p.phone||'')}`;
      document.getElementById('modalCallBtn').href     = `tel:${normalizePhone(p.phone||'')}`;
      document.getElementById('chartAvatar').textContent = ((p.name||'؟').trim().charAt(0)) || '؟';
      var _pills = document.getElementById('chartHeaderPills'); if (_pills) _pills.innerHTML = renderChartHeaderPills(p);
      document.getElementById('chartInfoGrid').innerHTML = renderChartInfoTiles(p);
      renderChartVisits(patientId);
      document.getElementById('patientDetailsModal').dataset.patientId = patientId;
      document.getElementById('patientDetailsModal').classList.remove('hidden');
      var _rail = document.getElementById('mainRail'); if (_rail) _rail.style.display = 'none';   // إخفاء السايدبار أثناء فتح الإضبارة
    }
    window.closePatientDetailsModal = function() { document.getElementById('patientDetailsModal').classList.add('hidden'); var _rail = document.getElementById('mainRail'); if (_rail) _rail.style.display = ''; };   // إعادة إظهار السايدبار

    function renderChartVisits(pid) {
      const p = allPatients[pid]; const box = document.getElementById('chartVisitsList'); if (!box) return;
      const visits = (p.appointments || []).map(function(v, i){ return { v:v, i:i }; });
      visits.sort(function(a, b){ const d=(b.v.date||'').localeCompare(a.v.date||''); return d!==0 ? d : (slotMinutes(slotTimeOf(b.v)) - slotMinutes(slotTimeOf(a.v))); });
      document.getElementById('chartVisitsCount').textContent = '(' + visits.length + ')';
      if (!visits.length) { box.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:.85rem;"><i class="far fa-folder-open" style="font-size:1.6rem;display:block;margin-bottom:8px;opacity:.4;"></i>لا توجد زيارات بعد</div>'; return; }
      // الممرضة: تاريخ ونوع الزيارة فقط — بدون أي تشخيص أو وصفة
      box.innerHTML = visits.map(function(o){
        const v=o.v, c=schedStatusColor(v);
        return '<div class="chart-visit" style="border:1.5px solid var(--border);border-right:4px solid ' + c.bd + ';border-radius:12px;background:var(--surface);display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;">'
          + '<div style="min-width:0;"><div style="font-weight:800;font-size:.88rem;color:var(--text);">' + escapeHtml(v.visitType || 'زيارة') + '</div>'
          + '<div style="font-size:.74rem;color:var(--text-muted);margin-top:2px;"><i class="far fa-calendar" style="font-size:.68rem;"></i> ' + formatDateAr(v.date) + ' · ' + slotTimeOf(v) + '</div></div>'
          + '</div>';
      }).join('');
    }

    // ===== طباعة إضبارة المريض (PDF) =====
    // معلومات الطبيب/العيادة (تُحمَّل من settings/doctor) — تُستخدم في الطباعة
    var _docSettings = {};
    (function() { try { var raw = localStorage.getItem('doctorSettings'); if (raw) _docSettings = JSON.parse(raw) || {}; } catch (e) {} })();

    // طباعة عبر iframe مخفي — لا نوافذ منبثقة ولا تعليق
    function _doPrint(html) {
      // الموبايل/التابلت: نفتح تبويب طباعة مستقلاً (الـ iframe يطبع صفحة الموقع على الموبايل)
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
        try { var cw = f.contentWindow; cw.onafterprint = function() { setTimeout(cleanup, 200); }; cw.focus(); cw.print(); }
        catch (e) { console.error('print error', e); }
        setTimeout(cleanup, 60000);
      }
      f.onload = function() { setTimeout(fire, 450); };
      var d = f.contentWindow.document;
      d.open(); d.write(html); d.close();
      setTimeout(fire, 1600);
    }

    // قالب طباعة بنفس هوية ملف الطبيب — يقرأ معلومات الطبيب/العيادة من _docSettings
    function _printSheet(pillText, innerHtml) {
      var s = _docSettings || {};
      var docName = s.title || 'الطبيب', specialty = s.specialty || '';
      var mobile = s.mobile || '', landline = s.landline || '', address = s.address || '';
      var _printBase = window.location.href.replace(/\/[^\/]*(\?.*)?$/, '/');
      var emblem = '<svg viewBox="0 0 100 100" width="100%" height="100%"><path d="M50 86 C22 64 9 46 9 31 A20 20 0 0 1 50 23 A20 20 0 0 1 91 31 C91 46 78 64 50 86 Z" fill="none" stroke="#0d9488" stroke-width="3.4"/><rect x="44" y="36" width="12" height="30" rx="2" fill="#0d9488"/><rect x="35" y="45" width="30" height="12" rx="2" fill="#0d9488"/></svg>';
      var brandHtml = '<img src="brand-logo.png" alt="DocBook" style="max-width:120px;max-height:88px;object-fit:contain;display:block;">';
      var css = '@page{size:A4;margin:0;}'
        + '*{font-family:Cairo,Tajawal,Arial,sans-serif;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
        + 'html,body{margin:0;padding:0;background:#fff;}'
        + '.wt,.wb{position:fixed;left:0;width:100%;height:150px;z-index:0;} .wt{top:0;} .wb{bottom:0;}'
        + '.pill{position:fixed;top:30px;right:46px;z-index:6;display:flex;align-items:center;gap:9px;background:rgba(255,255,255,.18);border:2px solid rgba(255,255,255,.85);color:#fff;border-radius:30px;padding:7px 18px 7px 8px;font-weight:800;font-size:15px;}'
        + '.pill .pc{width:24px;height:24px;border-radius:50%;background:#fff;color:#0d9488;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;}'
        + '.watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:300px;height:300px;opacity:.06;z-index:0;}'
        + '.contact{position:fixed;bottom:46px;left:0;width:100%;z-index:6;display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:18px;color:#fff;font-size:12.5px;font-weight:600;padding:0 30px;}'
        + '.contact .ct b{font-weight:800;} .contact .sep{opacity:.55;}'
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
        + '.atbl{width:100%;border-collapse:collapse;font-size:13.5px;}'
        + '.atbl th,.atbl td{border:1px solid #e2e8f0;padding:9px 10px;text-align:right;}'
        + '.atbl th{background:#f0fdfa;color:#0f766e;font-weight:800;}'
        + '.atbl thead{display:table-header-group;} .atbl tr{break-inside:avoid;}';
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

    window.printPatientChart = function(pid) {
      const p = allPatients[pid]; if (!p) return;
      const age = p.birthDate ? calculateAge(p.birthDate) : null;
      function cell(k, val, full) { return '<div class="info-cell' + (full ? ' full' : '') + '"><div class="k">' + k + '</div><div class="vv">' + (val || '-') + '</div></div>'; }
      // خلايا حقول المريض المخصّصة (قالب الطبيب المشترك) — تُطبع الحقول التي لها قيمة
      var pcustom = getChartTemplate().patient.map(function(f) {
        var d = _cfDisplayVal(f, (p.custom || {})[f.id]);
        return d === '' ? '' : cell(escapeHtml(f.label), escapeHtml(d));
      }).join('');
      const info = '<div class="sec-title">معلومات المريض</div><div class="info-grid">'
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
        var cst = (v && v.custom) || {};
        return vFields.map(function(f) {
          var d = _cfDisplayVal(f, cst[f.id]);
          return d === '' ? '' : (escapeHtml(f.label) + ': ' + escapeHtml(d));
        }).filter(Boolean).join(' · ');
      }
      const visits = (p.appointments || []).slice().sort(function(a, b){ return (a.date || '').localeCompare(b.date || ''); });
      let rows = visits.map(function(v, i){ return '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(v.visitType || '-') + '</td><td>' + formatDateAr(v.date) + '</td><td>' + slotTimeOf(v) + '</td>' + (vFields.length ? ('<td>' + (_vCustomText(v) || '-') + '</td>') : '') + '</tr>'; }).join('');
      if (!rows) rows = '<tr><td colspan="' + (vFields.length ? 5 : 4) + '" style="text-align:center;color:#64748b;">لا توجد زيارات</td></tr>';
      const archive = '<div class="sec-title">أرشيف الزيارات</div><table class="atbl"><thead><tr><th style="width:42px;">#</th><th>نوع الزيارة</th><th>التاريخ</th><th>الوقت</th>' + (vFields.length ? '<th>القياسات / البيانات</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table>';
      _printSheet('إضبارة المريض', info + archive);
    };

    // ===== تعديل معلومات المريض (الممرضة: الاسم/الهاتف/تاريخ الميلاد/العنوان فقط) =====
    window.openPatientInfoEditor = function(pid) {
      const p = allPatients[pid]; if (!p) return;
      document.getElementById('piPatientId').value = pid;
      document.getElementById('piName').value    = p.name || '';
      document.getElementById('piPhone').value   = p.phone || '';
      document.getElementById('piBirth').value   = p.birthDate || '';
      document.getElementById('piAddress').value = p.address || '';
      buildCustomFieldInputs(document.getElementById('piCustomFields'), getChartTemplate().patient, p.custom, 'حقول مخصّصة');
      updatePiAge();
      document.getElementById('patientInfoModal').classList.remove('hidden');
    };
    window.closePatientInfoEditor = function() { document.getElementById('patientInfoModal').classList.add('hidden'); };
    window.updatePiAge = function() {
      const b = document.getElementById('piBirth').value;
      const el = document.getElementById('piAgeDisplay'); if (!el) return;
      const a = b ? calculateAge(b) : null;
      el.textContent = (a != null && a >= 0) ? '(' + a + ' سنة)' : '';
    };
    window.savePatientInfo = function() {
      const pid = document.getElementById('piPatientId').value;
      const p = allPatients[pid]; if (!p) return;
      p.name      = document.getElementById('piName').value.trim() || p.name;
      p.phone     = document.getElementById('piPhone').value.trim();
      p.birthDate = document.getElementById('piBirth').value;
      p.address   = document.getElementById('piAddress').value.trim();
      p.custom    = readCustomFieldInputs(document.getElementById('piCustomFields'));   // حقول المريض المخصّصة
      updatePatient(pid, { name: p.name, phone: p.phone, birthDate: p.birthDate, address: p.address, custom: p.custom });
      closePatientInfoEditor();
      openPatientDetailsModal(pid);
    };

    function openAddVisitModal(patientId,name,phone,birthDate,address) {
      addVisitState = { patientId, patientName:name, patientPhone:phone, patientBirthDate:birthDate, patientAddress:address };
      document.getElementById('addVisitPatientName').textContent = name;
      document.getElementById('addVisitDate').value  = todayStr;
      fillTimeSelect('addVisitSlot');
      document.getElementById('addVisitModal').classList.remove('hidden');
    }
    window.openAddVisitModalFromModal = function() {
      const patientId = document.getElementById('patientDetailsModal').dataset.patientId;
      const p = allPatients[patientId];
      if(p) { openAddVisitModal(patientId,p.name,p.phone,p.birthDate,p.address); closePatientDetailsModal(); }
    };
    function submitAddVisit() {
      const p = allPatients[addVisitState.patientId]; if(!p) return;
      const type      = document.getElementById('addVisitType').value;
      const visitDate = document.getElementById('addVisitDate').value;
      const slot      = document.getElementById('addVisitSlot').value;
      if(!type)      { showToast('اختر نوع الزيارة','error'); return; }
      if(!visitDate) { showToast('اختر تاريخ الزيارة','error'); return; }
      if(!p.appointments) p.appointments=[];
      p.appointments.push({ date:visitDate, slot, visitType:type, dayName:daysAr[parseLocalISODate(visitDate).getDay()] });
      p.totalVisits = p.appointments.length;
      p.lastVisit   = visitDate;
      updatePatient(p.id, p);

      // ── إنشاء سجل في appointments ليراه الطبيب ──
      const apptId = 'appt_' + Date.now() + '_' + Math.random().toString(36).substr(2,6);
      const apptRecord = {
        id:             apptId,
        PatientName:    p.name  || p.PatientName || '',
        Phone:          p.phone || p.Phone       || '',
        BirthDate:      p.birthDate || p.BirthDate || '',
        Address:        p.address   || p.Address   || '',
        Date:           visitDate,
        Slot:           slot,
        VisitType:      type,
        Status:         'Visited',
        linkedPatientId: p.id,
        source:         'nurse_patients_book'
      };
      window._fb.setDoc(window._fb.docRef('appointments', apptId),
        Object.assign({}, apptRecord, { createdAt: window._fb.serverTimestamp() })
      ).catch(function(e) { console.error('[addVisit→appointments]', e); });

      // ── إشارة للطبيب: حضر المريض ──
      _signalNowServing(p.id, p.name || p.PatientName || '');

      document.getElementById('addVisitModal').classList.add('hidden');
      showToast('تمت إضافة الزيارة — فُتحت إضبارته عند الطبيب','success');
    }

    function showVisitStep(step) {
      document.getElementById('visitStep1').style.display = step===1 ? 'flex' : 'none';
      document.getElementById('visitStep2').style.display = step===2 ? 'flex' : 'none';
      document.getElementById('visitStep3').style.display = step===3 ? 'flex' : 'none';
    }

    window.openVisitManagement = function(record) {
      visitManagementState = { patientId:null, patientName:record.PatientName, patientPhone:record.Phone, patientBirthDate:record.BirthDate, patientAddress:record.Address||'', currentStep:1, appointmentRecord:record, isAddedToPatients:false };
      document.getElementById('visitManagementPatientName').textContent = record.PatientName;
      document.getElementById('visitNewPatientName').value = record.PatientName;
      document.getElementById('visitNewPatientPhone').value = record.Phone;
      document.getElementById('visitNewPatientBirthDate').value = record.BirthDate||'';
      document.getElementById('visitNewPatientAddress').value = record.Address||'';
      document.getElementById('visitNewPatientDate').value = record.Date || todayStr;
      fillTimeSelect('visitNewPatientSlot', slotTimeOf(record));
      document.getElementById('existingPatientDate').value = record.Date || todayStr;
      fillTimeSelect('existingPatientSlot', slotTimeOf(record));
      document.getElementById('visitManagementModal').classList.remove('hidden');
      showVisitStep(1);
    };

    document.getElementById('firstVisitYes').addEventListener('click', ()=>{ showVisitStep(2); });

    document.getElementById('firstVisitNo').addEventListener('click', ()=>{
      document.getElementById('patientSearchInput').value = '';
      document.getElementById('patientSearchResults').innerHTML = '';
      showSearchView();
      showVisitStep(3);
    });

    document.getElementById('backToVisitStep1FromNew').addEventListener('click', ()=>{ showVisitStep(1); });

    document.getElementById('backToVisitStep1FromSearch').addEventListener('click', ()=>{ showVisitStep(1); });

    function showSearchView() {
      document.getElementById('patientSearchView').style.display = 'flex';
      document.getElementById('patientSearchView').style.flexDirection = 'column';
      document.getElementById('selectedPatientView').style.display = 'none';
      selectedVisitPatientId = null;
    }

    function showPatientDetailsView() {
      document.getElementById('patientSearchView').style.display = 'none';
      document.getElementById('selectedPatientView').style.display = 'flex';
      document.getElementById('selectedPatientView').style.flexDirection = 'column';
    }

    let selectedVisitPatientId = null;

    document.getElementById('patientSearchInput').addEventListener('input', (e)=>{
      const term = e.target.value.toLowerCase().trim();
      selectedVisitPatientId = null;
      if(!term) { document.getElementById('patientSearchResults').innerHTML=''; return; }
      const matches = Object.values(allPatients).filter(p=> p.name.toLowerCase().includes(term) || p.phone.includes(term));
      document.getElementById('patientSearchResults').innerHTML = matches.map(p=>`
        <div onclick="previewPatientForVisit('${p.id}')" style="padding:10px; background:var(--bg); border:1.5px solid var(--border); border-radius:var(--radius-sm); cursor:pointer; transition:all .15s;" onmouseover="this.style.background='var(--primary-light)';this.style.borderColor='var(--primary)'" onmouseout="this.style.background='var(--bg)';this.style.borderColor='var(--border)'">
          <p style="font-weight:700; color:var(--text);">${escapeHtml(p.name)}</p>
          <p style="font-size:.75rem; color:var(--text-muted);">${escapeHtml(p.phone)}</p>
        </div>
      `).join('');
    });

    window.previewPatientForVisit = function(patientId) {
      const p = allPatients[patientId]; if(!p) return;
      selectedVisitPatientId = patientId;
      // Calculate age
      let ageStr = '-';
      if(p.birthDate) {
        const bd = parseLocalISODate(p.birthDate);
        const now = new Date();
        let age = now.getFullYear() - bd.getFullYear();
        if(now.getMonth() < bd.getMonth() || (now.getMonth()===bd.getMonth() && now.getDate()<bd.getDate())) age--;
        ageStr = age + ' سنة';
      }
      // Get first visit from appointments array
      let firstVisitStr = '-';
      if(p.firstVisit) {
        firstVisitStr = formatDateAr(p.firstVisit);
      } else if(p.appointments && p.appointments.length) {
        const sorted = [...p.appointments].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
        firstVisitStr = formatDateAr(sorted[0].date);
      }
      document.getElementById('selPatientName').textContent = p.name;
      document.getElementById('selPatientPhone').textContent = p.phone || '-';
      document.getElementById('selPatientAge').textContent = ageStr;
      document.getElementById('selPatientAddress').textContent = p.address || '-';
      document.getElementById('selPatientFirstVisit').textContent = firstVisitStr;
      document.getElementById('selPatientLastVisit').textContent = p.lastVisit ? formatDateAr(p.lastVisit) : 'لا توجد';
      document.getElementById('selPatientTotalVisits').textContent = (p.totalVisits || (p.appointments||[]).length || 0) + ' زيارة';
      showPatientDetailsView();
    };

    document.getElementById('submitExistingPatientVisit').addEventListener('click', ()=>{
      if(!selectedVisitPatientId) { showToast('اختر مريضاً من نتائج البحث أعلاه', 'info'); return; }
      selectPatientForVisit(selectedVisitPatientId);
    });

    // إشارة للطبيب: حضر المريض (تُكتب وثيقة واحدة يستمع لها الطبيب)
    function _signalNowServing(patientId, name) {
      window._fb.setDoc(window._fb.docRef('config', 'nowServing'),
        { patientId: patientId, name: name || '', ts: Date.now() }, { merge: true }
      ).then(function(){ console.log('[nowServing] أُرسلت الإشارة للطبيب:', patientId, name); })
       .catch(function(e){ console.error('[nowServing] فشل الإرسال:', e); showToast('تعذّر إرسال الإشارة للطبيب — تحقّق من قواعد Firestore', 'error'); });
    }

    function submitNewPatientVisit() {
      const name = document.getElementById('visitNewPatientName').value.trim();
      const phone = document.getElementById('visitNewPatientPhone').value.trim();
      const birth = document.getElementById('visitNewPatientBirthDate').value;
      const addr = document.getElementById('visitNewPatientAddress').value.trim();
      const type = document.getElementById('visitNewPatientVisitType').value;
      const slot = document.getElementById('visitNewPatientSlot').value;
      if(!name || !phone || !birth || !type) { showToast('املأ البيانات الأساسية','error'); return; }
      const visitDate = document.getElementById('visitNewPatientDate').value || todayStr;
      const patientId = 'p_'+Date.now()+'_'+Math.random().toString(36).substr(2,6);
      const newPatient = {
        id:patientId, name, phone, birthDate:birth, address:addr,
        appointments:[{ date:visitDate, slot:slot, visitType:type, dayName:daysAr[parseLocalISODate(visitDate).getDay()] }],
        firstVisit:visitDate, lastVisit:visitDate, totalVisits:1
      };
      // حفظ المريض الجديد في Firestore
      window._fb.setDoc(window._fb.docRef('patients', patientId), newPatient)
        .catch(function(e) { console.error('[savePatient]', e); });
      // تغيير حالة الموعد إلى "Visited"
      const apptId = visitManagementState.appointmentRecord?.id;
      if(apptId) {
        window._fb.setDoc(window._fb.docRef('appointments', apptId),
          { Status: 'Visited', linkedPatientId: patientId }, { merge: true }
        ).catch(function(e) { console.error(e); });
      }
      _signalNowServing(patientId, name);   // إشعار الطبيب: حضر المريض
      document.getElementById('visitManagementModal').classList.add('hidden');
      showToast('تمت الزيارة وتم نقل المريض إلى الدفتر','success');
      updateCounts(); calculateDensity(); renderCalendar();
      if(selectedDayStr) renderAgendaForDay(selectedDayStr);
      if(currentSection === 'appointments') renderBothAppointmentColumns();
      setActiveSection('patients');
    }

    document.getElementById('submitNewPatientVisit').addEventListener('click', submitNewPatientVisit);

    window.selectPatientForVisit = function(patientId) {
      const p = allPatients[patientId]; if(!p) return;
      const visitDate = document.getElementById('existingPatientDate').value || todayStr;
      const slot = document.getElementById('existingPatientSlot').value || TIME_SLOTS[0];
      const type = visitManagementState.appointmentRecord?.VisitType || document.getElementById('visitNewPatientVisitType').value || 'مراجعة';
      p.appointments = p.appointments || [];
      p.appointments.push({ date:visitDate, slot:slot, visitType:type, dayName:daysAr[parseLocalISODate(visitDate).getDay()] });
      p.totalVisits = p.appointments.length;
      p.lastVisit = visitDate;
      // تحديث المريض في Firestore
      updatePatient(p.id, p);
      // تغيير حالة الموعد إلى "Visited"
      const apptId2 = visitManagementState.appointmentRecord?.id;
      if(apptId2) {
        window._fb.setDoc(window._fb.docRef('appointments', apptId2),
          { Status: 'Visited', linkedPatientId: patientId }, { merge: true }
        ).catch(function(e) { console.error(e); });
      }
      _signalNowServing(patientId, p.name);   // إشعار الطبيب: حضر المريض
      document.getElementById('visitManagementModal').classList.add('hidden');
      showToast('تمت الزيارة وتمت إضافتها لسجل المريض','success');
      updateCounts(); calculateDensity(); renderCalendar();
      if(selectedDayStr) renderAgendaForDay(selectedDayStr);
      if(currentSection === 'appointments') renderBothAppointmentColumns();
      setActiveSection('patients');
    };


    // ================== Calendar ==================
    function renderCalendar() {
      const grid = document.getElementById('calendarGrid'); if(!grid) return;
      grid.innerHTML = '';
      const year=currentDate.getFullYear(), month=currentDate.getMonth();
      document.getElementById('currentMonth').textContent = `${monthsAr[month]} ${year}`;
      const firstDay = new Date(year,month,1).getDay();
      const daysInMonth = new Date(year,month+1,0).getDate();
      // الأسبوع يبدأ الجمعة — مطابق لروزنامة الطبيب. لا بدّ أن توافق هذه المعادلة
      // ترتيب الأسماء في app.html، وإلا وقع كل يوم في عمود غير عموده.
      let startOffset = (firstDay + 2) % 7;
      for(let i=startOffset-1;i>=0;i--) {
        const d=document.createElement('div'); d.className='compact-calendar-day other-month'; d.textContent=''; grid.appendChild(d);
      }
      for(let d=1;d<=daysInMonth;d++) {
        const dateObj=new Date(year,month,d); dateObj.setHours(0,0,0,0);
        const dateStr=toLocalISODate(dateObj);
        const dayDiv=document.createElement('div'); dayDiv.className='compact-calendar-day'; dayDiv.textContent=d;
        if(dateObj < today) {
          dayDiv.classList.add('past-day');
          if(selectedDayStr===dateStr) dayDiv.classList.add('selected');
          dayDiv.style.cursor = 'pointer';
          const countPast=dayDensity[dateStr]||0;
          if(countPast>0) {
            const dot=document.createElement('div'); dot.className='compact-appointment-dot';
            if(countPast<=2) dot.classList.add('compact-dot-low');
            else if(countPast<=4) dot.classList.add('compact-dot-medium');
            else dot.classList.add('compact-dot-high');
            dayDiv.appendChild(dot);
          }
          dayDiv.addEventListener('click', ()=> {
            selectedDayStr = dateStr;
            renderCalendar();
            renderAgendaForDay(dateStr);
            updateDayStatusBadge(dateStr);
            document.getElementById('dayAgenda').classList.remove('hidden');
          });
        }
        else {
          if(dateObj.getTime()===today.getTime()) dayDiv.classList.add('today');
          if(selectedDayStr===dateStr) dayDiv.classList.add('selected');
          dayDiv.addEventListener('click',()=>selectDay(dateStr));
          const count=dayDensity[dateStr]||0;
          if(count>0) {
            const dot=document.createElement('div'); dot.className='compact-appointment-dot';
            if(count<=2) dot.classList.add('compact-dot-low');
            else if(count<=4) dot.classList.add('compact-dot-medium');
            else dot.classList.add('compact-dot-high');
            dayDiv.appendChild(dot);
          }
          if(isDayClosed(dateStr)) dayDiv.classList.add('closed-day');
        }
        grid.appendChild(dayDiv);
      }
      renderScheduleGrid();
    }
    function selectDay(dateStr) {
      selectedDayStr=dateStr;
      if (typeof schedRefDate !== 'undefined') schedRefDate = parseLocalISODate(dateStr);
      renderCalendar(); renderAgendaForDay(dateStr); updateDayStatusBadge(dateStr);
      document.getElementById('dayAgenda').classList.remove('hidden');
    }

    // ================== Schedule Grid (شبكة ساعات يومي/أسبوعي) ==================
    const SCHED_START_HOUR = 6;   // بداية الشبكة (6 صباحاً)
    const SCHED_END_HOUR   = 24;  // نهاية الشبكة (12 منتصف الليل)
    let   SCHED_HOUR_PX    = 56;  // ارتفاع الساعة (قابل للتكبير/التصغير)
    const SCHED_HOUR_PX_MIN = 34, SCHED_HOUR_PX_MAX = 120;
    window.schedZoom = function(dir) {
      SCHED_HOUR_PX = Math.max(SCHED_HOUR_PX_MIN, Math.min(SCHED_HOUR_PX_MAX, SCHED_HOUR_PX + dir * 12));
      renderScheduleGrid();
    };
    const SCHED_EN_DAYS    = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    const SCHED_EN_MONTHS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    let scheduleView = (window.innerWidth < 820) ? 'day' : 'week'; // الموبايل/التابلت يبدأ بعرض اليوم
    let schedRefDate = new Date(today);

    function weekStartSun(d) { const x = new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate() - x.getDay()); return x; }
    function fmtSchedHour(h) { const h24 = h % 24; const ap = h24 < 12 ? 'AM' : 'PM'; let hh = h24 % 12; if (hh === 0) hh = 12; return ap + ' ' + hh; }
    function schedFmtRange(days) {
      const M = SCHED_EN_MONTHS;
      if (days.length === 1) { const d = days[0]; return M[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
      const a = days[0], b = days[days.length - 1];
      return M[a.getMonth()] + ' ' + a.getDate() + ' - ' + M[b.getMonth()] + ' ' + b.getDate() + ', ' + b.getFullYear();
    }
    // اللون حسب نوع الزيارة، مع تجاوز للحالة (لم يحضر = أحمر، تمت = أخضر)
    function schedStatusColor(r) {
      if (r.Status === 'NoShow')  return { bg:'#fee2e2', bd:'#ef4444', tx:'#991b1b' }; // أحمر — لم يحضر
      if (r.Status === 'Visited') return { bg:'#dcfce7', bd:'#16a34a', tx:'#166534' }; // أخضر — تمت الزيارة
      const t = r.VisitType || '';
      if (t.indexOf('تحاليل') !== -1 || t.indexOf('تحليل') !== -1) return { bg:'#dbeafe', bd:'#2563eb', tx:'#1e40af' }; // أزرق — تحاليل
      if (t.indexOf('مراجعة') !== -1)                              return { bg:'#fef9c3', bd:'#f59e0b', tx:'#92400e' }; // أصفر — مراجعة
      if (t.indexOf('كشف') !== -1 || t.indexOf('جديد') !== -1)     return { bg:'#ede9fe', bd:'#7c3aed', tx:'#5b21b6' }; // بنفسجي — زيارة جديدة
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
    window.schedToggleDay = function(ds) { if (isDayClosed(ds)) openDay(ds); else closeDay(ds); };

    // ===== بحث في المواعيد المؤكدة المستقبلية (من شريط أدوات الجدول) =====
    window.toggleSchedSearch = function() {
      const bar = document.getElementById('schedSearchBar'); if (!bar) return;
      const show = bar.style.display === 'none';
      bar.style.display = show ? 'block' : 'none';
      const btn = document.getElementById('schedSearchBtn'); if (btn) btn.style.background = show ? 'var(--primary-light)' : '';
      if (show) { const i = document.getElementById('schedSearchInput'); if (i) { i.value = ''; renderSchedSearch(); setTimeout(function(){ i.focus(); }, 60); } }
    };
    window.renderSchedSearch = function() {
      const box = document.getElementById('schedSearchResults'); if (!box) return;
      const q = (document.getElementById('schedSearchInput').value || '').toLowerCase().trim();
      let recs = (allRecords || []).filter(function(r) {
        return r.Status === 'Accepted' && parseLocalISODate(normalizeDate(r.Date)) >= today;
      });
      if (q) recs = recs.filter(function(r) {
        return (r.PatientName || '').toLowerCase().includes(q) || (r.Phone || '').includes(q)
            || normalizeDate(r.Date).includes(q) || formatDateAr(r.Date).includes(q);
      });
      recs.sort(function(a, b) {
        const d = (normalizeDate(a.Date)).localeCompare(normalizeDate(b.Date));
        return d !== 0 ? d : (slotMinutes(slotTimeOf(a)) - slotMinutes(slotTimeOf(b)));
      });
      recs = recs.slice(0, 40);
      if (!recs.length) { box.innerHTML = '<p style="font-size:.8rem;color:var(--text-muted);text-align:center;padding:10px;">لا مواعيد مؤكدة قادمة مطابقة</p>'; return; }
      box.innerHTML = recs.map(function(r) {
        return '<div onclick="schedSearchGo(\'' + r.id + '\')" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;background:var(--surface);border:1.5px solid var(--border);border-radius:12px;cursor:pointer;">'
          + '<div style="min-width:0;"><p style="font-weight:700;font-size:.86rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(r.PatientName || '') + '</p>'
          + '<p style="font-size:.74rem;color:var(--text-muted);"><span style="color:var(--primary);font-weight:700;font-family:\'DM Mono\',monospace;">' + slotLabelOf(r) + '</span> · ' + formatDateAr(r.Date) + '</p></div>'
          + '<i class="fas fa-chevron-left" style="color:var(--text-muted);font-size:.7rem;flex-shrink:0;"></i></div>';
      }).join('');
    };
    window.schedSearchGo = function(id) {
      const r = (allRecords || []).find(function(x){ return x.id === id; });
      if (!r) return;
      toggleSchedSearch();
      selectDay(normalizeDate(r.Date)); // ينقل الجدول/الروزنامة لليوم المطلوب
      openModalById(id);                 // يفتح التفاصيل
    };

    // ===== ملء الشاشة للروزنامة =====
    let _schedFullPrevCollapsed = false;
    window.toggleSchedFullscreen = function() {
      const sec = document.getElementById('calendarSection'); if (!sec) return;
      const on = sec.classList.toggle('is-fullscreen');
      const btn = document.getElementById('schedFullBtn');
      if (on) {
        _schedFullPrevCollapsed = document.body.classList.contains('sidebar-collapsed');
        document.body.classList.add('sidebar-collapsed');       // طي الناف بار
        if (btn) { btn.innerHTML = '<i class="fas fa-compress"></i>'; btn.title = 'تصغير'; btn.style.background = 'var(--primary-light)'; }
      } else {
        document.body.classList.toggle('sidebar-collapsed', _schedFullPrevCollapsed); // إرجاع حالة الناف بار
        if (btn) { btn.innerHTML = '<i class="fas fa-expand"></i>'; btn.title = 'ملء الشاشة'; btn.style.background = ''; }
      }
      setTimeout(function() { if (typeof renderScheduleGrid === 'function') renderScheduleGrid(); }, 360);
    };
    // النقر على بطاقة موعد: تأكيد الحضور (جديد/قديم) للمواعيد القابلة للتنفيذ، أو التفاصيل للمنتهية
    window.schedCardClick = function(id) {
      const r = (allRecords || []).find(function(x){ return x.id === id; });
      if (!r) return;
      if (r.Status === 'Visited' || r.Status === 'NoShow') { openModalById(id); }
      else { openVisitManagement(r); }
    };

    function renderSchedStats() {
      const bar = document.getElementById('schedStatsBar'); if (!bar) return;
      const recs   = (allRecords || []).filter(r => r.Date === todayStr);
      const active = recs.filter(r => ['Accepted','Visited','NoShow'].includes(r.Status));
      const total    = active.length;
      const visited  = recs.filter(r => r.Status === 'Visited').length;
      const absent   = recs.filter(r => r.Status === 'NoShow').length;
      const remaining = active.filter(r => r.Status === 'Accepted').length;
      function chip(cls, label, val, icon) {
        return '<div class="sched-stat ' + cls + '">'
          + '<span class="sched-stat-ic"><i class="' + icon + '"></i></span>'
          + '<div style="min-width:0;"><div class="sched-stat-n">' + val + '</div>'
          + '<div class="sched-stat-l">' + label + '</div></div></div>';
      }
      bar.innerHTML =
          chip('sched-stat--total', 'مواعيد اليوم', total, 'fas fa-calendar-check')
        + chip('sched-stat--rem', 'متبقية', remaining, 'fas fa-clock')
        + chip('sched-stat--vis', 'زاروا اليوم', visited, 'fas fa-user-check')
        + chip('sched-stat--abs', 'لم يحضروا', absent, 'fas fa-user-xmark');
    }

    function renderScheduleGrid() {
      renderSchedStats();
      const host = document.getElementById('scheduleGrid'); if (!host) return;
      // أيام العرض
      let days = [];
      if (scheduleView === 'week') {
        const start = weekStartSun(schedRefDate);
        for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(d.getDate() + i); d.setHours(0,0,0,0); days.push(d); }
      } else {
        const d = new Date(schedRefDate); d.setHours(0,0,0,0); days = [d];
      }
      const lbl = document.getElementById('schedRangeLabel');
      if (lbl) lbl.textContent = schedFmtRange(days);
      // ترتيب زمني (الأحد→السبت)؛ شبكة RTL تضع العمود الأول يميناً، لذا عمود الساعات أولاً
      const visDays = days;

      const totalH = SCHED_END_HOUR - SCHED_START_HOUR;
      const bodyH  = totalH * SCHED_HOUR_PX;
      const nCols  = visDays.length;
      // حد أدنى لعرض العمود في العرض الأسبوعي (تمرير أفقي على الشاشات الصغيرة)
      const colMin = (scheduleView === 'week') ? 88 : 0;
      const colsTemplate = '50px repeat(' + nCols + ',minmax(' + colMin + 'px,1fr))';
      const nowMins = (new Date()).getHours() * 60 + (new Date()).getMinutes();

      // ===== Header (عمود الساعات أولاً = يميناً) =====
      let head = '<div style="display:grid;grid-template-columns:' + colsTemplate + ';position:sticky;top:0;background:var(--surface);z-index:7;">';
      head += '<div class="sched-head-cell" style="font-size:.55rem;color:var(--text-muted);display:flex;align-items:flex-end;justify-content:center;padding-bottom:6px;">GMT+3</div>';
      visDays.forEach(function(d) {
        const ds = toLocalISODate(d);
        const isToday = d.getTime() === today.getTime();
        const isClosed = isDayClosed(ds);
        const numCls = isToday ? 'sched-head-num today' : 'sched-head-num';
        head += '<div class="sched-head-cell" style="cursor:pointer;position:relative;" onclick="schedPickDay(\'' + ds + '\')">'
              + '<span onclick="event.stopPropagation();schedToggleDay(\'' + ds + '\')" title="فتح/إغلاق اليوم" style="position:absolute;top:3px;left:4px;font-size:.6rem;opacity:.55;color:' + (isClosed ? 'var(--red)' : 'var(--text-muted)') + ';"><i class="fas fa-' + (isClosed ? 'lock' : 'lock-open') + '"></i></span>'
              + '<div class="sched-head-name">' + SCHED_EN_DAYS[d.getDay()] + '</div>'
              + '<div class="' + numCls + '">' + d.getDate() + '</div>'
              + '</div>';
      });
      head += '</div>';

      // ===== Body ===== (بلا هامش علوي/سفلي ليلتصق الجدول بالحواف؛ أول/آخر تسمية مثبّتة لئلا تُقصّ)
      let body = '<div style="display:grid;grid-template-columns:' + colsTemplate + ';">';
      // عمود الساعات (يميناً)
      let gutter = '<div style="position:relative;height:' + bodyH + 'px;">';
      for (let h = SCHED_START_HOUR; h <= SCHED_END_HOUR; h++) {
        const _ty = (h === SCHED_START_HOUR) ? 'translateY(0)' : (h === SCHED_END_HOUR ? 'translateY(-100%)' : '');
        gutter += '<div class="sched-gutter-lbl" style="top:' + ((h - SCHED_START_HOUR) * SCHED_HOUR_PX) + 'px;' + (_ty ? 'transform:' + _ty + ';' : '') + '">' + fmtSchedHour(h) + '</div>';
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
        // تجميع حسب وقت البدء لمعالجة التداخل
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
            const due = (r.Status === 'Accepted' || r.Status === 'InProgress') && isWithin6Hours(r) && !isReminderSent(r.id);
            cells += '<div class="sched-appt' + (due ? ' sched-appt-due' : '') + '" style="top:' + top + 'px;height:' + cardH + 'px;left:calc(' + left + '% + 2px);width:calc(' + w + '% - 4px);background:' + c.bg + ';border-color:' + c.bd + ';color:' + c.tx + ';" onclick="schedCardClick(\'' + r.id + '\')" oncontextmenu="event.preventDefault();openModalById(\'' + r.id + '\');return false;">'
                  + '<div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (due ? '<i class="fas fa-bell" style="font-size:.55rem;color:#d97706;"></i>' : '<i class="far fa-clock" style="font-size:.55rem;"></i>') + ' ' + escapeHtml(r.PatientName || '') + '</div>'
                  + '<div style="opacity:.85;font-family:\'DM Mono\',monospace;">' + slotLabelOf(r) + '</div>'
                  + '</div>';
          });
        });
        let nowLine = '';
        if (d.getTime() === today.getTime() && nowMins >= SCHED_START_HOUR * 60 && nowMins <= SCHED_END_HOUR * 60) {
          nowLine = '<div class="sched-now-line" style="top:' + ((nowMins - SCHED_START_HOUR * 60) / 60 * SCHED_HOUR_PX) + 'px;"></div>';
        }
        const lineGrad = 'repeating-linear-gradient(180deg,var(--border) 0,var(--border) 1px,transparent 1px,transparent ' + SCHED_HOUR_PX + 'px)';
        const bg = closed
          ? lineGrad + ',repeating-linear-gradient(45deg,rgba(239,68,68,.13),rgba(239,68,68,.13) 7px,transparent 7px,transparent 14px)'
          : lineGrad;
        body += '<div class="sched-daycol" data-ds="' + ds + '" style="height:' + bodyH + 'px;background:' + bg + ';">' + cells + nowLine + '</div>';
      });
      body += '</div>';

      host.innerHTML = head + body;
      renderTodayReminders();
      renderMobileDayAgenda(selectedDayStr || todayStr);
    }

    // ===== أجندة الموبايل: مواعيد اليوم مجمّعة حسب الساعة المحجوزة =====
    window.confirmAttendById = function(id) {
      const r = (allRecords || []).find(function(x){ return x.id === id; });
      if (r) openVisitManagement(r);
    };
    function mobileApptCard(r) {
      const c = schedStatusColor(r);
      let right;
      if (r.Status === 'Visited')      right = '<span class="m-appt-badge m-badge-done"><i class="fas fa-check-circle"></i> تمت</span>';
      else if (r.Status === 'NoShow')  right = '<span class="m-appt-badge m-badge-noshow"><i class="fas fa-user-times"></i> لم يحضر</span>';
      else right = '<div class="m-appt-btns">'
        + '<button class="m-btn-ok" onclick="event.stopPropagation();confirmAttendById(\'' + r.id + '\')"><i class="fas fa-check"></i> تأكيد الحضور</button>'
        + '<button class="m-btn-cancel" onclick="event.stopPropagation();cancelAppointment(\'' + r.id + '\')"><i class="fas fa-times"></i> إلغاء</button>'
        + '</div>';
      const t = slotLabelOf(r);
      return '<div class="m-appt" style="border-right-color:' + c.bd + ';" onclick="openModalById(\'' + r.id + '\')">'
        + '<div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">'
        + '<div style="display:flex;align-items:center;gap:3px;background:var(--primary-light);color:var(--primary);border-radius:8px;padding:5px 9px;font-family:\'DM Mono\',monospace;font-weight:800;font-size:.78rem;flex-shrink:0;white-space:nowrap;"><i class="far fa-clock" style="font-size:.62rem;"></i> ' + t + '</div>'
        + '<div style="min-width:0;">'
        + '<p class="m-appt-name">' + escapeHtml(r.PatientName || '') + '</p>'
        + '<p class="m-appt-date">' + (r.VisitType ? escapeHtml(r.VisitType) : formatDateAr(r.Date)) + '</p>'
        + '</div></div>' + right + '</div>';
    }
    function renderMobileStats(dateStr) {
      dateStr = dateStr || selectedDayStr || todayStr;
      const recs   = (allRecords || []).filter(function(r){ return normalizeDate(r.Date) === dateStr; });
      const active = recs.filter(function(r){ return ['Accepted','Visited','NoShow'].indexOf(r.Status) !== -1; });
      const set = function(id, v){ const e = document.getElementById(id); if (e) e.textContent = v; };
      set('msTotal', active.length);
      set('msRem',   active.filter(function(r){ return r.Status === 'Accepted'; }).length);
      set('msVis',   recs.filter(function(r){ return r.Status === 'Visited'; }).length);
      set('msAbs',   recs.filter(function(r){ return r.Status === 'NoShow'; }).length);
    }
    function renderMobileDayAgenda(dateStr) {
      const box = document.getElementById('mobileDayAgenda'); if (!box) return;
      dateStr = dateStr || selectedDayStr || todayStr;
      renderMobileStats(dateStr);
      const titleEl = document.getElementById('mobileAgendaTitle');
      if (titleEl) titleEl.textContent = daysAr[parseLocalISODate(dateStr).getDay()] + ' — ' + formatDateAr(dateStr);
      const lock = document.getElementById('mobileDayLock');
      if (lock) {
        const closed = isDayClosed(dateStr);
        lock.innerHTML = closed ? '<i class="fas fa-lock"></i> مغلق' : '<i class="fas fa-lock-open"></i> مفتوح';
        lock.style.background = closed ? 'var(--red-light)' : 'var(--green-light)';
        lock.style.color = closed ? '#dc2626' : '#16a34a';
      }
      const recs = (allRecords || []).filter(function(r){
        return ['Accepted','InProgress','Pending','Visited','NoShow'].indexOf(r.Status) !== -1 && normalizeDate(r.Date) === dateStr;
      }).sort(function(a,b){ return slotMinutes(slotTimeOf(a)) - slotMinutes(slotTimeOf(b)); });
      if (!recs.length) {
        box.innerHTML = '<div style="text-align:center;padding:28px 10px;color:var(--text-muted);font-size:.85rem;"><i class="far fa-calendar-check" style="font-size:1.8rem;display:block;margin-bottom:10px;opacity:.4;"></i>لا مواعيد في هذا اليوم</div>';
        return;
      }
      // قائمة مسطّحة مرتّبة من الأبكر للمتأخّر — الوقت داخل كل كرت
      box.innerHTML = recs.map(mobileApptCard).join('');
    }

    // ===== تذكير مواعيد اليوم =====
    window.remindById = function(id, btn) {
      const r = (allRecords || []).find(function(x){ return x.id === id; });
      if (r) sendWhatsAppReminder(r, btn);
    };
    function renderTodayReminders() {
      const box = document.getElementById('todayRemindersList'); if (!box) return;
      const recs = (allRecords || []).filter(function(r) {
        return (r.Status === 'Accepted' || r.Status === 'InProgress') && normalizeDate(r.Date) === todayStr;
      }).sort(function(a,b){ return slotMinutes(slotTimeOf(a)) - slotMinutes(slotTimeOf(b)); });
      if (!recs.length) {
        box.innerHTML = '<p style="text-align:center; color:var(--text-muted); font-size:.8rem; padding:10px;">لا مواعيد اليوم</p>';
        return;
      }
      box.innerHTML = recs.map(function(r) {
        const sent = isReminderSent(r.id);
        const right = sent
          ? '<span style="display:inline-flex; align-items:center; gap:5px; color:#16a34a; font-weight:800; font-size:.78rem; white-space:nowrap;"><i class="fas fa-check-circle"></i> تم إرسال التذكير</span>'
          : '<button onclick="remindById(\'' + r.id + '\',this)" style="display:inline-flex; align-items:center; gap:6px; background:#25D366; color:#fff; border:none; border-radius:9px; padding:7px 13px; font-weight:700; font-size:.78rem; font-family:inherit; cursor:pointer; white-space:nowrap;"><i class="fab fa-whatsapp"></i> تذكير</button>';
        return '<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:9px 12px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--surface);">'
          + '<div style="display:flex; align-items:center; gap:11px; min-width:0;">'
            + '<span style="font-family:\'DM Mono\',monospace; font-weight:800; color:var(--primary); font-size:.84rem;">' + slotLabelOf(r) + '</span>'
            + '<div style="min-width:0;"><p style="font-weight:700; font-size:.84rem; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + escapeHtml(r.PatientName || '') + '</p>'
            + '<p style="font-size:.7rem; color:var(--text-muted);">' + escapeHtml(r.VisitType || '') + '</p></div>'
          + '</div>' + right + '</div>';
      }).join('');
    }

    // ===== بحث المريض في الشريط الجانبي =====
    window.renderCalPatientSearch = function() {
      const q = (document.getElementById('calPatientSearch').value || '').toLowerCase().trim();
      const box = document.getElementById('calPatientSearchResults');
      if (!q) { box.innerHTML = ''; return; }
      const matches = Object.values(allPatients).filter(function(p) {
        return (p.name || '').toLowerCase().includes(q) || (p.phone || '').includes(q);
      }).slice(0, 12);
      if (!matches.length) { box.innerHTML = '<p style="font-size:.75rem;color:var(--text-muted);text-align:center;padding:6px;">لا نتائج</p>'; return; }
      box.innerHTML = matches.map(function(p) {
        return '<div onclick="openPatientDetailsModal(\'' + p.id + '\')" style="padding:8px 10px;background:var(--bg);border:1.5px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;" onmouseover="this.style.borderColor=\'var(--primary)\'" onmouseout="this.style.borderColor=\'var(--border)\'">'
          + '<p style="font-weight:700;font-size:.8rem;color:var(--text);">' + escapeHtml(p.name || '') + '</p>'
          + '<p style="font-size:.7rem;color:var(--text-muted);">' + escapeHtml(p.phone || '') + '</p>'
          + '</div>';
      }).join('');
    };

    // ===== بحث المريض من الهيدر (موبايل) =====
    window.toggleHeaderSearch = function() {
      const bar = document.getElementById('headerSearchBar'); if (!bar) return;
      const willOpen = bar.classList.contains('hidden');
      bar.classList.toggle('hidden');
      if (willOpen) {
        const inp = document.getElementById('headerPatientSearch');
        if (inp) { inp.value = ''; renderHeaderPatientSearch(); setTimeout(function(){ inp.focus(); }, 60); }
      }
    };
    window.renderHeaderPatientSearch = function() {
      const q = (document.getElementById('headerPatientSearch').value || '').toLowerCase().trim();
      const box = document.getElementById('headerSearchResults'); if (!box) return;
      if (!q) { box.innerHTML = ''; return; }
      const matches = Object.values(allPatients).filter(function(p) {
        return (p.name || '').toLowerCase().includes(q) || (p.phone || '').includes(q);
      }).slice(0, 20);
      if (!matches.length) { box.innerHTML = '<p style="font-size:.8rem;color:var(--text-muted);text-align:center;padding:8px;">لا نتائج</p>'; return; }
      box.innerHTML = matches.map(function(p) {
        return '<div onclick="openPatientDetailsModal(\'' + p.id + '\'); toggleHeaderSearch();" style="padding:10px 12px;background:var(--bg);border:1.5px solid var(--border);border-radius:12px;cursor:pointer;">'
          + '<p style="font-weight:700;font-size:.86rem;color:var(--text);">' + escapeHtml(p.name || '') + '</p>'
          + '<p style="font-size:.74rem;color:var(--text-muted);">' + escapeHtml(p.phone || '') + '</p>'
          + '</div>';
      }).join('');
    };
    function getPastDayVisits(dateStr) {
      let visits = [];
      Object.values(allPatients).forEach(p => {
        (p.appointments || []).forEach(v => {
          const vDate = (v.date || v.Date || '').toString().trim().substring(0, 10);
          if (vDate === dateStr) {
            visits.push({
              patientName: p.name || p.PatientName || '',
              phone: p.phone || p.Phone || '',
              slot: v.slot || v.Slot || 'Morning',
              visitType: v.visitType || v.VisitType || '-'
            });
          }
        });
      });
      return visits;
    }
    function renderAgendaForDay(dateStr) {
      const isPast = parseLocalISODate(dateStr) < today;
      document.getElementById('agendaTitle').textContent = `${daysAr[parseLocalISODate(dateStr).getDay()]} — ${formatDateAr(dateStr)}`;

      if (isPast) {
        const visits      = getPastDayVisits(dateStr);
        const noShow      = allRecords.filter(r => r.Status === 'NoShow'    && normalizeDate(r.Date) === dateStr);
        const cancelledRec= allRecords.filter(r => (r.Status === 'Cancelled' || r.Status === 'Rejected') && normalizeDate(r.Date) === dateStr);
        const byTime      = (a,b) => slotMinutes(slotTimeOf(a)) - slotMinutes(slotTimeOf(b));
        const morning     = visits.filter(v => isMorningSlot(v.slot)).sort(byTime);
        const evening     = visits.filter(v => !isMorningSlot(v.slot)).sort(byTime);
        const noShowMorn  = noShow.filter(r => isMorningSlot(r.Slot)).sort(byTime);
        const noShowEve   = noShow.filter(r => !isMorningSlot(r.Slot)).sort(byTime);
        const cancelMorn  = cancelledRec.filter(r => isMorningSlot(r.Slot)).sort(byTime);
        const cancelEve   = cancelledRec.filter(r => !isMorningSlot(r.Slot)).sort(byTime);

        document.getElementById('agendaCount').textContent =
          `زيارات: ${visits.length}${noShow.length ? ' · لم يحضر: ' + noShow.length : ''}${cancelledRec.length ? ' · ملغاة: ' + cancelledRec.length : ''}`;
        document.getElementById('agendaMorningCount').textContent = morning.length + noShowMorn.length + cancelMorn.length;
        document.getElementById('agendaEveningCount').textContent = evening.length + noShowEve.length + cancelEve.length;
        document.getElementById('closeDayIcon').classList.add('hidden');
        document.getElementById('openDayIcon').classList.add('hidden');

        const badge = document.getElementById('dayStatusBadge');
        badge.style.cssText = 'background:var(--bg);color:var(--text-muted);border:1px solid var(--border);';
        badge.className = 'day-status-badge';
        badge.innerHTML = `<i class="fas fa-history" style="margin-left:4px;font-size:.75rem;"></i> سابق`;

        const pastCard = (v) => `
          <div class="agenda-card" style="border-color:#86efac; background:#f0fdf4; opacity:.85;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <p class="agenda-patient-name">${escapeHtml(v.patientName)}</p>
                <p class="agenda-patient-phone">${escapeHtml(v.phone)}</p>
                <span style="font-size:.68rem;font-weight:700;color:#16a34a;"><i class="far fa-clock" style="font-size:.6rem;margin-left:2px;"></i>${slotLabelOf(v)}</span>
              </div>
              <span style="font-size:.72rem;padding:3px 10px;border-radius:20px;font-weight:700;
                background:#dcfce7;color:#16a34a;border:1px solid #86efac;">
                <i class="fas fa-check-circle" style="margin-left:3px;font-size:.65rem;"></i>تمت الزيارة
              </span>
            </div>
          </div>`;
        const noShowCard = (r) => `
          <div class="agenda-card" style="border-color:#fca5a5; background:#fef2f2; opacity:.85;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <p class="agenda-patient-name">${escapeHtml(r.PatientName)}</p>
                <p class="agenda-patient-phone">${escapeHtml(r.Phone)}</p>
              </div>
              <span style="font-size:.72rem;padding:3px 10px;border-radius:20px;font-weight:700;
                background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;">
                <i class="fas fa-user-times" style="margin-left:3px;font-size:.65rem;"></i>لم يحضر
              </span>
            </div>
          </div>`;
        const cancelCard = (r) => `
          <div class="agenda-card" style="border-color:#fca5a5; background:#fef2f2; opacity:.85;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <p class="agenda-patient-name">${escapeHtml(r.PatientName)}</p>
                <p class="agenda-patient-phone">${escapeHtml(r.Phone)}</p>
              </div>
              <span style="font-size:.72rem;padding:3px 10px;border-radius:20px;font-weight:700;
                background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;">
                <i class="fas fa-ban" style="margin-left:3px;font-size:.65rem;"></i>تم الإلغاء
              </span>
            </div>
          </div>`;
        const emptyMsg = (slot) => `<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:.82rem;">لا توجد مواعيد ${slot}</div>`;
        document.getElementById('agendaMorning').innerHTML =
          (morning.length    ? morning.map(pastCard).join('')   : '') +
          (noShowMorn.length ? noShowMorn.map(noShowCard).join('') : '') +
          (cancelMorn.length ? cancelMorn.map(cancelCard).join('') : '') +
          (!morning.length && !noShowMorn.length && !cancelMorn.length ? emptyMsg('صباحية') : '');
        document.getElementById('agendaEvening').innerHTML =
          (evening.length   ? evening.map(pastCard).join('')   : '') +
          (noShowEve.length ? noShowEve.map(noShowCard).join('') : '') +
          (cancelEve.length ? cancelEve.map(cancelCard).join('') : '') +
          (!evening.length && !noShowEve.length && !cancelEve.length ? emptyMsg('مسائية') : '');

      } else {
        const accepted    = allRecords.filter(r => r.Status === 'Accepted'   && normalizeDate(r.Date) === dateStr);
        const inProgress  = allRecords.filter(r => r.Status === 'InProgress' && normalizeDate(r.Date) === dateStr);
        const visited     = allRecords.filter(r => r.Status === 'Visited'    && normalizeDate(r.Date) === dateStr);
        const cancelled   = allRecords.filter(r => (r.Status === 'Cancelled' || r.Status === 'Rejected') && normalizeDate(r.Date) === dateStr);
        const byTime           = (a,b) => slotMinutes(slotTimeOf(a)) - slotMinutes(slotTimeOf(b));
        const morning          = accepted.filter(r    => isMorningSlot(r.Slot)).sort(byTime);
        const evening          = accepted.filter(r    => !isMorningSlot(r.Slot)).sort(byTime);
        const inProgMorning    = inProgress.filter(r  => isMorningSlot(r.Slot)).sort(byTime);
        const inProgEvening    = inProgress.filter(r  => !isMorningSlot(r.Slot)).sort(byTime);
        const visitedMorning   = visited.filter(r     => isMorningSlot(r.Slot)).sort(byTime);
        const visitedEvening   = visited.filter(r     => !isMorningSlot(r.Slot)).sort(byTime);
        const cancelMorning    = cancelled.filter(r   => isMorningSlot(r.Slot)).sort(byTime);
        const cancelEvening    = cancelled.filter(r   => !isMorningSlot(r.Slot)).sort(byTime);
        const totalAll = accepted.length + inProgress.length + visited.length + cancelled.length;
        document.getElementById('agendaCount').textContent =
          `مواعيد: ${accepted.length + inProgress.length + visited.length}${cancelled.length ? ' · ملغاة: ' + cancelled.length : ''}`;
        document.getElementById('agendaMorningCount').textContent = morning.length + inProgMorning.length + visitedMorning.length + cancelMorning.length;
        document.getElementById('agendaEveningCount').textContent = evening.length + inProgEvening.length + visitedEvening.length + cancelEvening.length;
        const emptyMsg = (slot) => `<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:.82rem;">لا توجد مواعيد ${slot}</div>`;
        const inProgressCardHTML = (r) => `
          <div class="agenda-card" style="border-color:#fbbf24; background:#fffbeb; border-width:2px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div>
                <p class="agenda-patient-name">${escapeHtml(r.PatientName)}</p>
                <p class="agenda-patient-phone">${escapeHtml(r.Phone)}</p>
              </div>
              <span style="font-size:.72rem;padding:3px 10px;border-radius:20px;font-weight:700;
                background:#fef3c7;color:#92400e;border:1px solid #fbbf24;white-space:nowrap;">
                <i class="fas fa-spinner fa-spin" style="margin-left:3px;font-size:.65rem;"></i>جارية
              </span>
            </div>
          </div>`;
        const visitedCardHTML = (r) => `
          <div class="agenda-card" style="border-color:#86efac; background:#f0fdf4; opacity:.85;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <p class="agenda-patient-name">${escapeHtml(r.PatientName)}</p>
                <p class="agenda-patient-phone">${escapeHtml(r.Phone)}</p>
              </div>
              <span style="font-size:.72rem;padding:3px 10px;border-radius:20px;font-weight:700;
                background:#dcfce7;color:#16a34a;border:1px solid #86efac;">
                <i class="fas fa-check-circle" style="margin-left:3px;font-size:.65rem;"></i>تمت الزيارة
              </span>
            </div>
          </div>`;
        const cancelCardHTML = (r) => `
          <div class="agenda-card" style="border-color:#fca5a5; background:#fef2f2; opacity:.85;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <p class="agenda-patient-name">${escapeHtml(r.PatientName)}</p>
                <p class="agenda-patient-phone">${escapeHtml(r.Phone)}</p>
              </div>
              <span style="font-size:.72rem;padding:3px 10px;border-radius:20px;font-weight:700;
                background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;">
                <i class="fas fa-ban" style="margin-left:3px;font-size:.65rem;"></i>تم الإلغاء
              </span>
            </div>
          </div>`;
        document.getElementById('agendaMorning').innerHTML =
          (morning.length      ? morning.map(r => agendaCardHTML(r)).join('') : '') +
          (inProgMorning.length? inProgMorning.map(inProgressCardHTML).join('') : '') +
          (visitedMorning.length ? visitedMorning.map(visitedCardHTML).join('') : '') +
          (cancelMorning.length  ? cancelMorning.map(cancelCardHTML).join('') : '') +
          (!morning.length && !inProgMorning.length && !visitedMorning.length && !cancelMorning.length ? emptyMsg('صباحية') : '');
        document.getElementById('agendaEvening').innerHTML =
          (evening.length      ? evening.map(r => agendaCardHTML(r)).join('') : '') +
          (inProgEvening.length? inProgEvening.map(inProgressCardHTML).join('') : '') +
          (visitedEvening.length ? visitedEvening.map(visitedCardHTML).join('') : '') +
          (cancelEvening.length  ? cancelEvening.map(cancelCardHTML).join('') : '') +
          (!evening.length && !inProgEvening.length && !visitedEvening.length && !cancelEvening.length ? emptyMsg('مسائية') : '');
        updateDayStatusBadge(dateStr);
      }
    }
    function showPastDayDetails(dateStr) {
      // جمع كل الزيارات الفعلية لهذا اليوم من دفتر المرضى فقط
      let actualVisits = [];
      Object.values(allPatients).forEach(p => {
        (p.appointments || []).forEach(v => {
          // مقارنة مرنة للتاريخ (date أو Date)
          const vDate = (v.date || v.Date || '').toString().trim().substring(0, 10);
          if (vDate === dateStr) {
            actualVisits.push({ slot: v.slot || v.Slot || 'Morning', visitType: v.visitType || v.VisitType });
          }
        });
      });

      const total   = actualVisits.length;
      const morning = actualVisits.filter(v => isMorningSlot(v.slot)).length;
      const evening = actualVisits.filter(v => !isMorningSlot(v.slot)).length;
      const cancelled = allRecords.filter(r =>
        (r.Status === 'Cancelled' || r.Status === 'Rejected') &&
        (r.Date || '').toString().trim().substring(0, 10) === dateStr
      ).length;

      document.getElementById('dayDetailsTitle').textContent = `تفاصيل ${formatDateAr(dateStr)}`;
      document.getElementById('dayDetailsContent').innerHTML = `
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div style="background:var(--primary-light);border-radius:var(--radius-sm);padding:14px;text-align:center;">
            <p style="font-size:.78rem;color:var(--text-muted);margin-bottom:2px;">إجمالي الزيارات الفعلية</p>
            <p style="font-size:2rem;font-weight:800;color:var(--text);font-family:'DM Mono',monospace;line-height:1;">${total}</p>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div style="background:var(--amber-light);border-radius:var(--radius-sm);padding:11px;text-align:center;">
              <p style="font-size:.72rem;color:var(--text-muted);margin-bottom:2px;">صباحاً</p>
              <p style="font-size:1.5rem;font-weight:800;color:var(--text);font-family:'DM Mono',monospace;">${morning}</p>
            </div>
            <div style="background:#eff6ff;border-radius:var(--radius-sm);padding:11px;text-align:center;">
              <p style="font-size:.72rem;color:var(--text-muted);margin-bottom:2px;">مساءً</p>
              <p style="font-size:1.5rem;font-weight:800;color:var(--text);font-family:'DM Mono',monospace;">${evening}</p>
            </div>
          </div>
          <div style="background:var(--red-light);border-radius:var(--radius-sm);padding:11px;text-align:center;">
            <p style="font-size:.72rem;color:var(--text-muted);margin-bottom:2px;">ملغاة / مرفوضة</p>
            <p style="font-size:1.5rem;font-weight:800;color:var(--red);font-family:'DM Mono',monospace;">${cancelled}</p>
          </div>
          <p style="font-size:.68rem;color:var(--text-muted);text-align:center;opacity:.6;">${dateStr}</p>
        </div>`;
      document.getElementById('dayDetailsModal').classList.remove('hidden');
    }
    // ── هل الموعد خلال 6 ساعات القادمة؟ ──
    function isWithin6Hours(record) {
      const dateStr = normalizeDate(record.Date);
      if (dateStr !== todayStr) return false;
      const now = new Date();
      const nowMins = now.getHours() * 60 + now.getMinutes();
      // الوقت المحدد للموعد بالدقائق — نُظهر الزر خلال آخر 6 ساعات قبله وحتى ساعة بعده
      const apptMins = slotMinutes(slotTimeOf(record));
      return nowMins >= (apptMins - 360) && nowMins <= (apptMins + 60);
    }

    // ── قراءة حالة التذكير من localStorage ──
    function getReminderSentKey(recordId) { return 'reminder_sent_' + recordId; }
    function isReminderSent(recordId) { return localStorage.getItem(getReminderSentKey(recordId)) === '1'; }
    function markReminderSent(recordId) { localStorage.setItem(getReminderSentKey(recordId), '1'); }

    // ── بناء نص رسالة واتساب ──
    function buildReminderMessage(record) {
      const slot   = slotTimeOf(record);
      const date   = formatDateAr(record.Date);
      const visit  = record.VisitType || 'الزيارة';
      const template_rem = getMsg ? getMsg('reminder') : _defaultMsgs.reminder;
      return template_rem
        .replace('{اسم}', record.PatientName)
        .replace('{تاريخ}', date)
        .replace('{فترة}', slot)
        .replace('{نوع}', visit);
    }

    // ── متغير عالمي لتتبع الزر الحالي والسجل ──
    let _reminderActiveId   = null;
    let _reminderActiveBtn  = null;
    let _reminderActivePhone = null;

    // ── إرسال تذكير واتساب ──
    window.sendWhatsAppReminder = function(record, btn) {
      const phone   = normalizePhone(record.Phone);
      const message = buildReminderMessage(record);
      const url     = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

      _reminderActiveId    = record.id;
      _reminderActiveBtn   = btn;
      _reminderActivePhone = phone;

      window.open(url, '_blank');

      // بعد العودة للتبويب نسأل الممرضة: هل تمت الرسالة؟
      const onVisible = function() {
        if (document.visibilityState === 'visible') {
          document.removeEventListener('visibilitychange', onVisible);
          setTimeout(function() {
            openReminderConfirmModal(record);
          }, 600);
        }
      };
      document.addEventListener('visibilitychange', onVisible);
    };

    // ── فتح نافذة التأكيد ──
    function openReminderConfirmModal(record) {
      document.getElementById('rcmPatientName').textContent = record.PatientName;
      const phone   = normalizePhone(record.Phone);
      const message = buildReminderMessage(record);
      document.getElementById('rcmSmsBtn').href = `sms:${phone}?body=${encodeURIComponent(message)}`;
      document.getElementById('reminderConfirmModal').classList.remove('hidden');
    }

    window.closeReminderConfirmModal = function() {
      document.getElementById('reminderConfirmModal').classList.add('hidden');
      _reminderActiveId   = null;
      _reminderActiveBtn  = null;
      _reminderActivePhone= null;
    };

    function _restoreCardAfterReminder(id) {
      if (!_reminderActiveBtn) return;
      const card = document.querySelector(`[data-card-id="${id}"]`) ||
                   _reminderActiveBtn.closest('.agenda-card, .appt-card');
      _reminderActiveBtn.remove();
      if (card) {
        const badge = card.querySelector('.reminder-due-badge');
        if (badge) badge.remove();
        card.classList.remove('reminder-due');
      }
    }

    window.confirmReminderSent = function() {
      if (_reminderActiveId) {
        markReminderSent(_reminderActiveId);
        _restoreCardAfterReminder(_reminderActiveId);
        showToast('تم تسجيل إرسال التذكير ✓', 'success');
      }
      closeReminderConfirmModal();
      if (typeof renderTodayReminders === 'function') renderTodayReminders();
    };

    window.dismissReminderSent = function() {
      if (_reminderActiveId) {
        markReminderSent(_reminderActiveId);
        _restoreCardAfterReminder(_reminderActiveId);
      }
      showToast('لم يتم الإرسال — يمكنك المحاولة مجدداً', 'error');
      closeReminderConfirmModal();
    };

    function agendaCardHTML(record) {
      const phone     = normalizePhone(record.Phone);
      const within6h  = isWithin6Hours(record);
      const sentAlready = isReminderSent(record.id);
      const reminderBtn = (within6h && !sentAlready)
        ? `<button class="agenda-action-btn reminder"
             title="إرسال تذكير بالموعد"
             onclick='sendWhatsAppReminder(${JSON.stringify(record).replace(/'/g,"\\'")},this)'>
             ${ICON.bell}
           </button>`
        : '';
      const dueBadge = within6h && !sentAlready
        ? `<span class="reminder-due-badge"><i class="fas fa-bell" style="font-size:.6rem;"></i> موعد قريب</span>`
        : '';
      return `<div class="agenda-card ${within6h ? 'reminder-due' : ''}">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <p class="agenda-patient-name">${escapeHtml(record.PatientName)}</p>
            <p class="agenda-patient-phone">${escapeHtml(record.Phone)}</p>
            ${dueBadge}
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            ${reminderBtn}
            <button class="agenda-action-btn manage" title="إدارة الزيارة" onclick='openVisitManagement(${JSON.stringify(record).replace(/'/g,"\\'")})'>${ICON.stethoscope}</button>
            <button class="agenda-action-btn details" title="تفاصيل" onclick="openModalById('${record.id}')">${ICON.eye}</button>
          </div>
        </div>
        <div style="margin-top:6px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span style="font-size:.72rem; font-weight:700; color:var(--primary); background:var(--primary-light); padding:2px 9px; border-radius:20px;"><i class="far fa-clock" style="font-size:.62rem; margin-left:3px;"></i>${slotLabelOf(record)}</span>
          <span style="font-size:.75rem; color:var(--primary); font-weight:600;">${record.VisitType}</span>
        </div>
      </div>`;
    }

    window.openModalById = function(id) {
      const r=allRecords.find(r=>r.id===id); if(!r) return;
      
      // Update agendaTitle (date)
      document.getElementById('agendaTitle').textContent = r.Date ? formatDateAr(r.Date) : '-';

      // Update patient name
      document.getElementById('appDetailsName').textContent = r.PatientName;
      // تاريخ الموعد داخل البطاقة (id مستقل لتفادي تكرار agendaTitle)
      var _dp = document.getElementById('apptdDatePill'); if (_dp) _dp.textContent = r.Date ? formatDateAr(r.Date) : '-';

      // Update phone
      const phone=r.Phone||'-';
      document.getElementById('appDetailsPhone').textContent = phone;
      document.getElementById('appDetailsWhatsappBtn').href = phone!=='-' ? `https://wa.me/${normalizePhone(phone)}` : '#';
      
      // Update patient details
      document.getElementById('appDetailsBirthDate').textContent = r.BirthDate?formatDateAr(r.BirthDate):'-';
      const age = r.BirthDate?calculateAge(r.BirthDate):'-';
      document.getElementById('appDetailsAge').textContent = age!=='-'?age+' سنة':'-';
      document.getElementById('appDetailsAddress').textContent = r.Address||'-';
      
      // Update hidden fields
      document.getElementById('appDetailsVisitType').textContent = r.VisitType||'-';
      const slotText = slotLabelOf(r);
      document.getElementById('appDetailsSlot').textContent = slotText;
      document.getElementById('appDetailsDate').textContent = r.Date?formatDateAr(r.Date):'-';
      
      // Update visible badges
      document.getElementById('slotBadge').textContent = slotText;
      document.getElementById('visitTypeBadge').textContent = r.VisitType||'-';
      
      deleteAppointmentId = id;
      _editApptId = id;
      var _ep = document.getElementById('apptEditPanel'); if (_ep) _ep.style.display = 'none';
      const deleteBtn=document.getElementById('deleteAppointmentModalBtn');
      // يظهر زر الحذف لكل المواعيد عدا الملغاة/المرفوضة
      (['Cancelled','Rejected'].includes(r.Status)) ? deleteBtn.classList.add('hidden') : deleteBtn.classList.remove('hidden');
      document.getElementById('appointmentDetailsModal').classList.remove('hidden');
    };
    window.closeAppointmentDetailsModal = function() { document.getElementById('appointmentDetailsModal').classList.add('hidden'); };

    // ===== تعديل تاريخ/وقت الموعد =====
    var _editApptId = null;
    window.toggleApptEdit = function(show) {
      const panel = document.getElementById('apptEditPanel'); if (!panel) return;
      const willShow = (show === undefined) ? (panel.style.display === 'none') : show;
      if (willShow) {
        const r = (allRecords || []).find(function(x){ return x.id === _editApptId; });
        if (r) {
          document.getElementById('editApptDate').value = normalizeDate(r.Date);
          fillTimeSelect('editApptSlot', slotTimeOf(r));
          markTakenOptions('editApptSlot', normalizeDate(r.Date), r.id); // عطّل المحجوز (عدا الموعد نفسه)
          const de = document.getElementById('editApptDate');
          de.onchange = function() { fillTimeSelect('editApptSlot', document.getElementById('editApptSlot').value); markTakenOptions('editApptSlot', de.value, r.id); };
        }
      }
      panel.style.display = willShow ? 'block' : 'none';
    };
    window.saveApptEdit = function() {
      const r = (allRecords || []).find(function(x){ return x.id === _editApptId; });
      if (!r) return;
      const newDate = document.getElementById('editApptDate').value;
      const newSlot = document.getElementById('editApptSlot').value;
      if (!newDate || !newSlot) { _createNotif('اختر تاريخاً ووقتاً', '#ef4444', 4000); return; }
      // منع الحجز المزدوج (عدا الموعد نفسه)
      if (isSlotTakenLocal(newDate, newSlot, r.id)) { _createNotif('هذا الوقت محجوز مسبقاً، اختر وقتاً آخر.', '#ef4444', 5000); return; }
      if (isDayClosed(newDate)) { _createNotif('هذا اليوم مغلق، اختر يوماً آخر.', '#ef4444', 5000); return; }
      // تحديث فوري في الذاكرة → يتغيّر مكان الموعد على الجدول تلقائياً
      r.Date = newDate; r.Slot = newSlot;
      r.DayName = daysAr[parseLocalISODate(newDate).getDay()];
      window._fb.setDoc(window._fb.docRef('appointments', r.id),
        { Date: newDate, Slot: newSlot, DayName: r.DayName, updatedAt: window._fb.serverTimestamp() }, { merge: true }
      ).catch(function(e){ console.error('[editAppt]', e); });
      // إعادة الرسم في كل العروض
      updateCounts(); calculateDensity(); renderCalendar();
      if (selectedDayStr) renderAgendaForDay(selectedDayStr);
      if (currentSection === 'appointments') renderBothAppointmentColumns();
      // تحديث عرض النافذة
      document.getElementById('slotBadge').textContent = slotLabelOf(r);
      document.getElementById('agendaTitle').textContent = r.Date ? formatDateAr(r.Date) : '-';
      document.getElementById('appDetailsDate').textContent = r.Date ? formatDateAr(r.Date) : '-';
      toggleApptEdit(false);
      showToast('تم تعديل الموعد', 'success');
    };

    window.confirmDelete = function(id) {
      deleteAppointmentId = id;
      document.getElementById('confirmDeleteModal').classList.remove('hidden');
    };
    document.getElementById('confirmDeleteYes').addEventListener('click', function() {
      if(deleteAppointmentId) {
        deleteAppointment(deleteAppointmentId);
        document.getElementById('confirmDeleteModal').classList.add('hidden');
        document.getElementById('appointmentDetailsModal').classList.add('hidden');
        deleteAppointmentId = null;
      }
    });
    document.getElementById('confirmDeleteNo').addEventListener('click', function() {
      document.getElementById('confirmDeleteModal').classList.add('hidden'); deleteAppointmentId=null;
    });
    window.deleteAppointmentFromModal = function() {
      if(deleteAppointmentId) { document.getElementById('appointmentDetailsModal').classList.add('hidden'); confirmDelete(deleteAppointmentId); }
    };

    // حذف الموعد مع إشعار إلغاء عبر واتساب (وخيار SMS احتياطي) — يعمل على الموبايل/التابلت/اللابتوب
    window.deleteApptWithNotify = function() {
      var id = deleteAppointmentId; if (!id) return;
      var r = (allRecords || []).find(function(x){ return x.id === id; });
      appConfirm('حذف هذا الموعد وإرسال إشعار إلغاء للمريض؟', 'حذف الموعد').then(function(ok){
        if (!ok) return;
        // إشعار الإلغاء: واتساب أولاً ثم خيار SMS إن لم تصل الرسالة
        if (r && r.Phone) sendWhatsAppCancellation(r.Phone, r.PatientName || '', r.Date);
        // حذف الموعد فعلياً
        if (typeof deleteAppointment === 'function') deleteAppointment(id);
        document.getElementById('appointmentDetailsModal').classList.add('hidden');
        deleteAppointmentId = null;
        showToast('تم حذف الموعد', 'success');
      });
    };

    // ================== Manual Form ==================
    function updateManualSummaryFields() {
      document.getElementById('summaryPatientName').textContent = manualAppointmentData.patientName||'-';
      const age = manualAppointmentData.birthDate?calculateAge(manualAppointmentData.birthDate):'-';
      document.getElementById('summaryAge').textContent = age!=='-'?age+' سنة':'-';
      document.getElementById('confirmPatientName').textContent = manualAppointmentData.patientName||'-';
      document.getElementById('confirmPhone').textContent       = manualAppointmentData.phone||'-';
      document.getElementById('confirmVisitType').textContent   = manualAppointmentData.visitType||'-';
      document.getElementById('confirmDate').textContent        = manualAppointmentData.selectedDate?formatDateAr(manualAppointmentData.selectedDate):'-';
      document.getElementById('confirmSlot').textContent        = manualAppointmentData.selectedSlot==='Morning'?'صباحاً':'مساءً';
    }
    function setupManualForm() {
      document.getElementById('manualDateInput').min = todayStr;
      document.getElementById('manualDateInput').max = toLocalISODate(maxFutureDate);
      document.getElementById('manualBirthDate').max = todayStr;
      const slotMorning=document.getElementById('slotMorning'), slotEvening=document.getElementById('slotEvening');
      const newSlotMorning=slotMorning.cloneNode(true), newSlotEvening=slotEvening.cloneNode(true);
      slotMorning.parentNode.replaceChild(newSlotMorning, slotMorning);
      slotEvening.parentNode.replaceChild(newSlotEvening, slotEvening);
      document.getElementById('slotMorning').addEventListener('click',function(){
        document.getElementById('slotMorning').classList.add('selected');
        document.getElementById('slotEvening').classList.remove('selected');
        manualAppointmentData.selectedSlot='Morning'; updateManualSummaryFields();
      });
      document.getElementById('slotEvening').addEventListener('click',function(){
        document.getElementById('slotEvening').classList.add('selected');
        document.getElementById('slotMorning').classList.remove('selected');
        manualAppointmentData.selectedSlot='Evening'; updateManualSummaryFields();
      });
      document.getElementById('manualPatientName').addEventListener('input',function(e){ manualAppointmentData.patientName=e.target.value; updateManualSummaryFields(); });
      document.getElementById('manualPhone').addEventListener('input',function(e){ manualAppointmentData.phone=e.target.value; updateManualSummaryFields(); });
      document.getElementById('manualBirthDate').addEventListener('change',function(e){ manualAppointmentData.birthDate=e.target.value; updateManualSummaryFields(); });
      document.getElementById('manualAddress').addEventListener('input',function(e){ manualAppointmentData.address=e.target.value; });
      document.getElementById('manualVisitType').addEventListener('change',function(e){ manualAppointmentData.visitType=e.target.value; updateManualSummaryFields(); });
      document.getElementById('manualDateInput').addEventListener('change',function(e){ manualAppointmentData.selectedDate=e.target.value; updateManualSummaryFields(); });
      loadManualFormData();
    }
    function saveManualFormData() {
      manualAppointmentData.patientName   = document.getElementById('manualPatientName').value;
      manualAppointmentData.phone         = document.getElementById('manualPhone').value;
      manualAppointmentData.birthDate     = document.getElementById('manualBirthDate').value;
      manualAppointmentData.address       = document.getElementById('manualAddress').value;
      manualAppointmentData.visitType     = document.getElementById('manualVisitType').value;
      manualAppointmentData.selectedDate  = document.getElementById('manualDateInput').value;
    }
    function loadManualFormData() {
      document.getElementById('manualPatientName').value = manualAppointmentData.patientName||'';
      document.getElementById('manualPhone').value       = manualAppointmentData.phone||'';
      document.getElementById('manualBirthDate').value   = manualAppointmentData.birthDate||'';
      document.getElementById('manualAddress').value     = manualAppointmentData.address||'';
      document.getElementById('manualVisitType').value   = manualAppointmentData.visitType||'';
      document.getElementById('manualDateInput').value   = manualAppointmentData.selectedDate||'';
      if(manualAppointmentData.selectedSlot==='Morning') {
        document.getElementById('slotMorning').classList.add('selected');
        document.getElementById('slotEvening').classList.remove('selected');
      } else {
        document.getElementById('slotEvening').classList.add('selected');
        document.getElementById('slotMorning').classList.remove('selected');
      }
      updateManualSummaryFields();
    }
    function goToStep(step) {
      manualAppointmentData.currentStep = step;
      document.querySelectorAll('.form-step').forEach(s=>s.classList.remove('active'));
      document.getElementById(`step${step}`).classList.add('active');
      document.querySelectorAll('.step-dot').forEach((dot,i)=>{
        let n=i+1;
        const wrapper = dot.closest('.step-dot-wrapper');
        dot.classList.remove('active','completed');
        if(wrapper) wrapper.classList.remove('active','completed');
        if(n<step) { dot.classList.add('completed'); dot.innerHTML='<i class="fas fa-check" style="font-size:.75rem;"></i>'; if(wrapper) wrapper.classList.add('completed'); }
        else if(n===step) { dot.classList.add('active'); dot.textContent=n; if(wrapper) wrapper.classList.add('active'); }
        else dot.textContent=n;
      });
      // Update connectors
      document.querySelectorAll('.step-dot-connector').forEach((c,i)=>{
        c.classList.toggle('done', step > i+1);
      });
    }
    document.getElementById('nextToStep2')?.addEventListener('click',()=>{
      saveManualFormData();
      if(!manualAppointmentData.patientName||!manualAppointmentData.phone||!manualAppointmentData.birthDate||!manualAppointmentData.visitType){ showToast('املأ جميع الحقول','error'); return; }
      goToStep(2);
    });
    document.getElementById('backToStep1')?.addEventListener('click',()=>{ saveManualFormData(); goToStep(1); });
    document.getElementById('nextToStep3')?.addEventListener('click',()=>{
      saveManualFormData();
      if(!manualAppointmentData.selectedDate||isDayClosed(manualAppointmentData.selectedDate)){ showToast('اختر تاريخ صحيح','error'); return; }
      goToStep(3);
    });
    document.getElementById('backToStep2')?.addEventListener('click',()=>{ saveManualFormData(); goToStep(2); });
    document.getElementById('submitManualAppointment')?.addEventListener('click',()=>{
      saveManualFormData();
      if(!manualAppointmentData.patientName||!manualAppointmentData.phone||!manualAppointmentData.birthDate||!manualAppointmentData.visitType||!manualAppointmentData.selectedDate){ showToast('بيانات ناقصة','error'); return; }
      const appointment = {
        PatientName: manualAppointmentData.patientName,
        Phone: manualAppointmentData.phone,
        BirthDate: manualAppointmentData.birthDate,
        Address: manualAppointmentData.address,
        Age: calculateAge(manualAppointmentData.birthDate),
        Date: manualAppointmentData.selectedDate,
        Slot: manualAppointmentData.selectedSlot,
        VisitType: manualAppointmentData.visitType,
        Status: 'Accepted',
        DayName: daysAr[parseLocalISODate(manualAppointmentData.selectedDate).getDay()],
        CreatedAt: new Date().toISOString()
      };
      saveAppointment(appointment);
      setActiveSection('appointments');
    });

    function animateNumber(element, target, suffix='', duration=700) {
      if(!element) return;
      const isFloat = !Number.isInteger(target);
      const startTime = performance.now();
      const step = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = target * eased;
        element.textContent = isFloat ? current.toFixed(1) + suffix : Math.floor(current) + suffix;
        if (progress < 1) requestAnimationFrame(step);
        else element.textContent = (isFloat ? parseFloat(target).toFixed(1) : target) + suffix;
      };
      requestAnimationFrame(step);
    }
    window.showDayDetails=function(){
      if(!selectedDayStr) return;
      const isPast = selectedDayStr < todayStr;
      const dateStr = selectedDayStr;
      let total, morningCount, eveningCount, cancelled;
      if (isPast) {
        const visits   = getPastDayVisits(dateStr);
        const noShow   = allRecords.filter(r => r.Status==='NoShow'   && normalizeDate(r.Date)===dateStr);
        const cancelRec= allRecords.filter(r => (r.Status==='Cancelled'||r.Status==='Rejected') && normalizeDate(r.Date)===dateStr);
        total        = visits.length + noShow.length + cancelRec.length;
        morningCount = visits.filter(v => isMorningSlot(v.slot)).length +
                       noShow.filter(r => isMorningSlot(r.Slot)).length +
                       cancelRec.filter(r => isMorningSlot(r.Slot)).length;
        eveningCount = visits.filter(v => !isMorningSlot(v.slot)).length +
                       noShow.filter(r => !isMorningSlot(r.Slot)).length +
                       cancelRec.filter(r => !isMorningSlot(r.Slot)).length;
        cancelled    = cancelRec.length;
      } else {
        const accepted = allRecords.filter(r => r.Status==='Accepted'  && normalizeDate(r.Date)===dateStr);
        const visitedR = allRecords.filter(r => r.Status==='Visited'   && normalizeDate(r.Date)===dateStr);
        const cancelRec= allRecords.filter(r => (r.Status==='Cancelled'||r.Status==='Rejected') && normalizeDate(r.Date)===dateStr);
        total        = accepted.length + visitedR.length + cancelRec.length;
        morningCount = accepted.filter(r => isMorningSlot(r.Slot)).length +
                       visitedR.filter(r => isMorningSlot(r.Slot)).length +
                       cancelRec.filter(r => isMorningSlot(r.Slot)).length;
        eveningCount = accepted.filter(r => !isMorningSlot(r.Slot)).length +
                       visitedR.filter(r => !isMorningSlot(r.Slot)).length +
                       cancelRec.filter(r => !isMorningSlot(r.Slot)).length;
        cancelled    = cancelRec.length;
      }
      document.getElementById('dayDetailsTitle').textContent = `تفاصيل ${formatDateAr(dateStr)}`;
      document.getElementById('dayDetailsContent').innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div style="background:var(--primary-light);border-radius:var(--radius-sm);padding:14px;text-align:center;">
            <p style="font-size:.82rem;color:var(--text-muted);">${isPast?'إجمالي الزيارات':'إجمالي المواعيد'}</p>
            <p style="font-size:2rem;font-weight:800;font-family:'DM Mono',monospace;">${total}</p>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div style="background:var(--amber-light);border-radius:var(--radius-sm);padding:12px;text-align:center;">
              <p style="font-size:.78rem;color:var(--text-muted);">صباحاً</p>
              <p style="font-size:1.6rem;font-weight:800;font-family:'DM Mono',monospace;">${morningCount}</p>
            </div>
            <div style="background:#eff6ff;border-radius:var(--radius-sm);padding:12px;text-align:center;">
              <p style="font-size:.78rem;color:var(--text-muted);">مساءً</p>
              <p style="font-size:1.6rem;font-weight:800;font-family:'DM Mono',monospace;">${eveningCount}</p>
            </div>
          </div>
          <div style="background:var(--red-light);border-radius:var(--radius-sm);padding:12px;text-align:center;">
            <p style="font-size:.78rem;color:var(--text-muted);">الملغاة / المرفوضة</p>
            <p style="font-size:1.6rem;font-weight:800;color:var(--red);font-family:'DM Mono',monospace;">${cancelled}</p>
          </div>
        </div>`;
      document.getElementById('dayDetailsModal').classList.remove('hidden');
    };
    window.closeDayDetailsModal=function(){ document.getElementById('dayDetailsModal').classList.add('hidden'); };

    // URL / History routing
    window.addEventListener('popstate', function(e) {
      var s = (e.state && e.state.section) || location.hash.slice(1);
      var _vn = ['calendar','appointments','patients'];
      if (_vn.includes(s)) { _histNav = true; setActiveSection(s); _histNav = false; }
    });

    // ================== DOMContentLoaded ==================
    document.addEventListener('DOMContentLoaded',()=>{
      // initializeData() تُستدعى من onAuth بعد التحقق من تسجيل الدخول
      applySettings();
      fillTimeSelect('patientBookSlot');
      renderSlotSettingsEditor();
      var _h = location.hash.slice(1);
      var _validN = ['calendar','appointments','patients'];
      var _initN = _validN.includes(_h) ? _h : 'calendar';
      _histNav = true; setActiveSection(_initN); _histNav = false;
      history.replaceState({ section: _initN }, '', '#' + _initN);
      if (typeof setScheduleView === 'function') setScheduleView(scheduleView);
      const todayStr = today.toLocaleDateString('ar-EG',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
      document.getElementById('nurseHeaderDate').textContent = todayStr;
      const sidebarDate = document.getElementById('sidebarNurseDate');
      if (sidebarDate) sidebarDate.textContent = todayStr;

      // Nav listeners
      // sidebarAppointments يستخدم onclick مباشرة الآن
      document.getElementById('sidebarPatients').addEventListener('click',()=>setActiveSection('patients'));
      document.getElementById('sidebarCalendar').addEventListener('click',()=>setActiveSection('calendar'));
      // mobileAppointments يستخدم onclick مباشرة الآن
      document.getElementById('mobilePatients').addEventListener('click',()=>setActiveSection('patients'));
      document.getElementById('mobileCalendar').addEventListener('click',()=>setActiveSection('calendar'));

      document.getElementById('appointmentsPendingTab').addEventListener('click',()=>setAppointmentsTab('pending'));
      document.getElementById('appointmentsAcceptedTab').addEventListener('click',()=>setAppointmentsTab('accepted'));
      document.getElementById('searchInput').addEventListener('input',(e)=>{ searchQuery=e.target.value; renderBothAppointmentColumns(); });

      document.getElementById('addNewPatientBtn').addEventListener('click',()=>document.getElementById('patientBookModal').classList.remove('hidden'));
      document.getElementById('patientBookSearch').addEventListener('input',(e)=>{ patientSearchQuery=e.target.value; renderPatientBook(); });
      document.getElementById('cancelPatientBtn').addEventListener('click',()=>document.getElementById('patientBookModal').classList.add('hidden'));

      document.getElementById('submitPatientBookBtn').addEventListener('click',()=>{
        const name=document.getElementById('patientBookName').value.trim();
        const phone=document.getElementById('patientBookPhone').value.trim();
        const birth=document.getElementById('patientBookBirthDate').value;
        const addr=document.getElementById('patientBookAddress').value.trim();
        const type=document.getElementById('patientBookVisitType').value;
        const slot=document.getElementById('patientBookSlot').value;
        if(!name||!phone||!birth||!type){ showToast('املأ البيانات الأساسية','error'); return; }
        const patientId='p_'+Date.now()+'_'+Math.random().toString(36).substr(2,6);
        const newPatient={id:patientId,name,phone,birthDate:birth,address:addr,
          appointments:[{date:todayStr,slot,visitType:type,dayName:daysAr[today.getDay()]}],
          firstVisit:todayStr,lastVisit:todayStr,totalVisits:1};
        savePatient(newPatient);

        // ── إنشاء سجل في appointments ليراه الطبيب ──
        const apptId2 = 'appt_' + Date.now() + '_' + Math.random().toString(36).substr(2,6);
        window._fb.setDoc(window._fb.docRef('appointments', apptId2), {
          id: apptId2, PatientName: name, Phone: phone, BirthDate: birth, Address: addr,
          Date: todayStr, Slot: slot, VisitType: type,
          Status: 'Visited', linkedPatientId: patientId, source: 'nurse_patients_book',
          createdAt: window._fb.serverTimestamp()
        }).catch(function(e){ console.error('[patientBook→appointments]', e); });

        document.getElementById('patientBookModal').classList.add('hidden');
        ['patientBookName','patientBookPhone','patientBookBirthDate','patientBookAddress','patientBookVisitType'].forEach(id=>document.getElementById(id).value='');
      });

      document.getElementById('cancelAddVisitBtn').addEventListener('click',()=>document.getElementById('addVisitModal').classList.add('hidden'));
      document.getElementById('submitAddVisitBtn').addEventListener('click',submitAddVisit);

      document.getElementById('prevMonthBtn').addEventListener('click',()=>{ currentDate.setMonth(currentDate.getMonth()-1); renderCalendar(); });
      document.getElementById('nextMonthBtn').addEventListener('click',()=>{ currentDate.setMonth(currentDate.getMonth()+1); renderCalendar(); });
      document.getElementById('closeDayIcon').addEventListener('click',()=>closeDay(selectedDayStr));
      document.getElementById('openDayIcon').addEventListener('click',()=>openDay(selectedDayStr));
      document.getElementById('showDayDetailsBtn').addEventListener('click',showDayDetails);

      // Close modals on backdrop click
      ['appointmentDetailsModal','patientDetailsModal','visitManagementModal','addVisitModal',
       'patientBookModal','confirmDeleteModal','dayDetailsModal','settingsModal'].forEach(id=>{
        document.getElementById(id).addEventListener('click',(e)=>{
          if(e.target.id===id){
            if(id==='appointmentDetailsModal') closeAppointmentDetailsModal();
            else if(id==='patientDetailsModal') closePatientDetailsModal();

            else if(id==='dayDetailsModal') closeDayDetailsModal();
            else document.getElementById(id).classList.add('hidden');
          }
        });
      });
      document.getElementById('closePatientDetailsModalBtn').addEventListener('click',()=>closePatientDetailsModal());

      // Logo upload → Firebase Storage
      document.getElementById('logoFileInput').addEventListener('change',function(e){
        const file=e.target.files[0]; if(!file) return;
        if(!file.type.startsWith('image/')){ showToast('الرجاء اختيار ملف صورة','error'); return; }
        if(file.size>5*1024*1024){ showToast('حجم الصورة يجب أن يكون أقل من 5 ميغابايت','error'); return; }
        showToast('جاري رفع الصورة…','');
        window._fb.uploadLogo('nurse', file).then(function(url){
          settings.logo = url;
          const previewImg=document.getElementById('logoPreviewImg');
          const previewIcon=document.getElementById('logoPreviewIcon');
          const removeBtn=document.getElementById('removeLogoBtn');
          previewImg.src=url; previewImg.classList.remove('hidden');
          previewIcon.classList.add('hidden'); removeBtn.classList.remove('hidden');
          saveSettingsToFirebase(settings);
          applySettings();
          showToast('تم رفع الصورة بنجاح','success');
        }).catch(function(err){ showToast('فشل رفع الصورة','error'); console.error(err); });
      });
    });

    // ================== Manual Form Overlay (desktop) ==================
    let oManualData = { patientName:'', phone:'', birthDate:'', address:'', visitType:'', selectedDate:'', selectedSlot:TIME_SLOTS[0], currentStep:1 };

    function openManualFormOverlay() {
      oManualData = { patientName:'', phone:'', birthDate:'', address:'', visitType:'', selectedDate:'', selectedSlot:TIME_SLOTS[0], currentStep:1 };
      // Reset fields
      ['oManualPatientName','oManualPhone','oManualBirthDate','oManualAddress'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('oManualVisitType').value = '';
      document.getElementById('oManualDateInput').value = '';
      document.getElementById('oManualBirthDate').max = todayStr;
      if (window.oSelectSlot) oSelectSlot(TIME_SLOTS[0]);
      document.getElementById('oClosedDayWarning').classList.add('hidden');
      document.getElementById('oSelectedDayInfo').classList.add('hidden');
      document.getElementById('oSlotSelectorWrapper').classList.add('hidden');
      oCalDate = new Date(); oCalDate.setHours(0,0,0,0);
      oUpdateSummary();
      oGoToStep(1);
      oRenderCalendar();
      document.getElementById('manualFormOverlay').classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeManualFormOverlay() {
      document.getElementById('manualFormOverlay').classList.remove('active');
      document.body.style.overflow = '';
    }

    window.handleOverlayClick = function(e) {
      if (e.target.id === 'manualFormOverlay') closeManualFormOverlay();
    };

    function oGoToStep(step) {
      oManualData.currentStep = step;
      document.querySelectorAll('#manualFormPanel .form-step').forEach(s => s.classList.remove('active'));
      document.getElementById('overlayStep' + step).classList.add('active');
      ['overlayStep1Dot','overlayStep2Dot','overlayStep3Dot'].forEach((id, i) => {
        const dot = document.getElementById(id);
        const wrapper = document.getElementById(id.replace('Dot','Wrapper'));
        const n = i + 1;
        dot.classList.remove('active','completed');
        if(wrapper) wrapper.classList.remove('active','completed');
        if (n < step) { dot.classList.add('completed'); dot.innerHTML = '<i class="fas fa-check" style="font-size:.75rem;"></i>'; if(wrapper) wrapper.classList.add('completed'); }
        else if (n === step) { dot.classList.add('active'); dot.textContent = n; if(wrapper) wrapper.classList.add('active'); }
        else dot.textContent = n;
      });
      // Update connectors
      const c1 = document.getElementById('overlayConnector1');
      const c2 = document.getElementById('overlayConnector2');
      if(c1) c1.classList.toggle('done', step > 1);
      if(c2) c2.classList.toggle('done', step > 2);
    }

    function oUpdateSummary() {
      document.getElementById('oSummaryPatientName').textContent = oManualData.patientName || '-';
      const age = oManualData.birthDate ? calculateAge(oManualData.birthDate) : '-';
      document.getElementById('oSummaryAge').textContent = age !== '-' ? age + ' سنة' : '-';
      document.getElementById('oConfirmPatientName').textContent = oManualData.patientName || '-';
      document.getElementById('oConfirmPhone').textContent       = oManualData.phone || '-';
      document.getElementById('oConfirmVisitType').textContent   = oManualData.visitType || '-';
      document.getElementById('oConfirmDate').textContent        = oManualData.selectedDate ? formatDateAr(oManualData.selectedDate) : '-';
      document.getElementById('oConfirmSlot').textContent        = convertLegacySlotToTime(oManualData.selectedSlot);
    }

    // ── Calendar for Step 2 ──
    let oCalDate = new Date(); oCalDate.setHours(0,0,0,0);

    function oGetDayAppointments(dateStr) {
      const recs = (allRecords || []).filter(r =>
        (r.Status === 'Accepted' || r.Status === 'Pending' || r.Status === 'InProgress') &&
        normalizeDate(r.Date) === dateStr
      );
      const byTime = (a,b) => slotMinutes(slotTimeOf(a)) - slotMinutes(slotTimeOf(b));
      return {
        morning: recs.filter(r => isMorningSlot(r.Slot)).sort(byTime),
        evening: recs.filter(r => !isMorningSlot(r.Slot)).sort(byTime)
      };
    }

    function oRenderCalendar() {
      const grid = document.getElementById('oCalGrid'); if (!grid) return;
      grid.innerHTML = '';
      const year = oCalDate.getFullYear(), month = oCalDate.getMonth();
      document.getElementById('oCalMonth').textContent = monthsAr[month] + ' ' + year;
      const today2 = new Date(); today2.setHours(0,0,0,0);
      const maxDate = new Date(today2); maxDate.setMonth(maxDate.getMonth() + 3);
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month+1, 0).getDate();
      // Friday-first: Fri=5→col0, Sat=6→col1, Sun=0→col2, Mon=1→col3, Tue=2→col4, Wed=3→col5, Thu=4→col6
      let startOffset = (firstDay + 3) % 7;
      for (let i = startOffset-1; i >= 0; i--) {
        const el = document.createElement('div');
        el.className = 'compact-calendar-day other-month';
        grid.appendChild(el);
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, month, d); dateObj.setHours(0,0,0,0);
        const dateStr = toLocalISODate(dateObj);
        const isPast = dateObj < today2;
        const isClosed = isDayClosed(dateStr);
        const isFutureTooFar = dateObj > maxDate;
        const isSelected = oManualData.selectedDate === dateStr;
        const isToday = dateObj.getTime() === today2.getTime();
        const appts = oGetDayAppointments(dateStr);
        const mCount = appts.morning.length, eCount = appts.evening.length;
        const total = mCount + eCount;

        const el = document.createElement('div');
        el.className = 'compact-calendar-day';
        if (isToday) el.classList.add('today');
        if (isSelected) el.classList.add('selected');
        if (isClosed) el.classList.add('closed-day');
        if (isPast || isFutureTooFar) { el.classList.add('past-day'); el.style.cursor = 'default'; }

        el.textContent = d;

        // density dot
        if (!isPast && !isFutureTooFar && total > 0) {
          const dot = document.createElement('div');
          dot.className = 'compact-appointment-dot';
          if (total <= 2) dot.classList.add('compact-dot-low');
          else if (total <= 4) dot.classList.add('compact-dot-medium');
          else dot.classList.add('compact-dot-high');
          el.appendChild(dot);
        }

        if (!isPast && !isClosed && !isFutureTooFar) {
          el.addEventListener('click', function() { oSelectDay(dateStr); });
        }
        grid.appendChild(el);
      }
    }

    function oSelectDay(dateStr) {
      oManualData.selectedDate = dateStr;
      document.getElementById('oManualDateInput').value = dateStr;
      const closed = isDayClosed(dateStr);
      document.getElementById('oClosedDayWarning').classList.toggle('hidden', !closed);
      // Show slot selector (time slots)
      document.getElementById('oSlotSelectorWrapper').classList.toggle('hidden', closed);
      if (!closed) {
        fillTimeSelect('oSlotSelect', oManualData.selectedSlot || TIME_SLOTS[0]);
        markTakenOptions('oSlotSelect', dateStr); // تعطيل الأوقات المحجوزة
        oManualData.selectedSlot = document.getElementById('oSlotSelect').value;
      }
      // Show day info panel
      const appts = oGetDayAppointments(dateStr);
      const dateObj = parseLocalISODate(dateStr);
      document.getElementById('oSelectedDayLabel').textContent = daysAr[dateObj.getDay()] + ' — ' + formatDateAr(dateStr);

      // Helper: render mini appointment cards
      function renderMiniCards(list, container) {
        if (!list.length) {
          container.innerHTML = '<p style="color:var(--text-muted);font-size:.75rem;padding:6px 8px;text-align:center;background:var(--bg);border-radius:var(--radius-sm);border:1.5px dashed var(--border);">لا مواعيد لهذا اليوم</p>';
          return;
        }
        container.innerHTML = list.map(r => {
          const visitType = r.VisitType || 'غير محدد';
          const name = r.PatientName || '—';
          const phone = r.Phone || '';
          return `<div style="display:flex;align-items:center;gap:8px;background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius-sm);padding:7px 10px;transition:border-color .15s;" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--border)'">
            <div style="width:28px;height:28px;border-radius:50%;background:var(--primary-light);border:1.5px solid var(--border-strong);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <i class="fas fa-user" style="font-size:.6rem;color:var(--primary);"></i>
            </div>
            <div style="flex:1;min-width:0;">
              <p style="font-weight:700;font-size:.78rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</p>
              <p style="font-size:.68rem;color:var(--text-muted);margin-top:1px;"><span style="color:var(--primary);font-weight:700;">${slotLabelOf(r)}</span> · ${visitType}</p>
            </div>
          </div>`;
        }).join('');
      }

      document.getElementById('oMorningCount').textContent = appts.morning.length;
      renderMiniCards(appts.morning, document.getElementById('oMorningPatients'));
      document.getElementById('oEveningCount').textContent = appts.evening.length;
      renderMiniCards(appts.evening, document.getElementById('oEveningPatients'));
      document.getElementById('oSelectedDayInfo').classList.remove('hidden');
      oUpdateSummary();
      oRenderCalendar();
    }

    window.oSelectSlot = function(slot) {
      oManualData.selectedSlot = slot;
      const sel = document.getElementById('oSlotSelect');
      if (sel && sel.value !== slot) sel.value = slot;
      oUpdateSummary();
    };

    window.oPrevMonth = function() { oCalDate.setMonth(oCalDate.getMonth()-1); oRenderCalendar(); };
    window.oNextMonth = function() { oCalDate.setMonth(oCalDate.getMonth()+1); oRenderCalendar(); };

    document.addEventListener('DOMContentLoaded', function() {
      // Live input
      ['oManualPatientName','oManualPhone','oManualBirthDate','oManualAddress'].forEach(id => {
        document.getElementById(id).addEventListener('input', function(e) {
          const map = { oManualPatientName:'patientName', oManualPhone:'phone', oManualBirthDate:'birthDate', oManualAddress:'address' };
          oManualData[map[id]] = e.target.value;
          oUpdateSummary();
        });
      });
      document.getElementById('oManualVisitType').addEventListener('change', function(e) {
        oManualData.visitType = e.target.value; oUpdateSummary();
      });
      // oManualDateInput is now hidden — driven by calendar clicks

      // Step navigation
      document.getElementById('oNextToStep2').addEventListener('click', function() {
        oManualData.patientName = document.getElementById('oManualPatientName').value.trim();
        oManualData.phone       = document.getElementById('oManualPhone').value.trim();
        oManualData.birthDate   = document.getElementById('oManualBirthDate').value;
        oManualData.address     = document.getElementById('oManualAddress').value.trim();
        oManualData.visitType   = document.getElementById('oManualVisitType').value;
        if (!oManualData.patientName || !oManualData.phone || !oManualData.birthDate || !oManualData.visitType) {
          showToast('املأ جميع الحقول', 'error'); return;
        }
        oUpdateSummary();
        oCalDate = new Date(); oCalDate.setHours(0,0,0,0);
        oRenderCalendar();
        oGoToStep(2);
      });
      document.getElementById('oBackToStep1').addEventListener('click', () => oGoToStep(1));
      document.getElementById('oNextToStep3').addEventListener('click', function() {
        oManualData.selectedDate = document.getElementById('oManualDateInput').value;
        if (!oManualData.selectedDate) { showToast('اختر تاريخ الموعد', 'error'); return; }
        if (isDayClosed(oManualData.selectedDate)) { showToast('هذا اليوم مغلق للحجز', 'error'); return; }
        oUpdateSummary(); oGoToStep(3);
      });
      document.getElementById('oBackToStep2').addEventListener('click', () => oGoToStep(2));
      document.getElementById('oSubmitManualAppointment').addEventListener('click', function() {
        // Validate all fields (important on desktop where steps are shown together)
        if (!oManualData.patientName) { showToast('أدخل اسم المريض', 'error'); document.getElementById('oManualPatientName').focus(); return; }
        if (!oManualData.phone) { showToast('أدخل رقم الهاتف', 'error'); document.getElementById('oManualPhone').focus(); return; }
        if (!oManualData.visitType) { showToast('اختر نوع الزيارة', 'error'); document.getElementById('oManualVisitType').focus(); return; }
        oManualData.selectedDate = document.getElementById('oManualDateInput').value;
        if (!oManualData.selectedDate) { showToast('اختر تاريخ الموعد', 'error'); return; }
        if (isDayClosed(oManualData.selectedDate)) { showToast('هذا اليوم مغلق للحجز', 'error'); return; }
        // منع الحجز المزدوج
        if (isSlotTakenLocal(oManualData.selectedDate, oManualData.selectedSlot)) {
          _createNotif('هذا الوقت محجوز مسبقاً، الرجاء اختيار وقت آخر.', '#ef4444', 5000);
          return;
        }
        oUpdateSummary();
        const appointment = {
          PatientName: oManualData.patientName, Phone: oManualData.phone,
          BirthDate: oManualData.birthDate, Address: oManualData.address,
          VisitType: oManualData.visitType, Date: oManualData.selectedDate,
          Slot: oManualData.selectedSlot, Status: 'Accepted',
          createdAt: new Date().toISOString(), source: 'manual'
        };
        saveAppointment(appointment);
        closeManualFormOverlay();
      });

      // ESC key closes overlay
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeManualFormOverlay();
      });
    });



/* ===== Notes ===== */

  // جلب الملاحظات من localStorage
  window.loadNotesData = function(callback) {
    function doLoad() {
      window._fb.getDoc('config', 'notes').then(function(snap) {
        var notes = snap.exists() ? (snap.data().list || []) : [];
        callback(Array.isArray(notes) ? notes : []);
      }).catch(function() { callback([]); });
    }
    if (window._fbReady) doLoad();
    else window.addEventListener('fbReady', doLoad, { once: true });
  }

  // حفظ الملاحظات في Firestore
  window.saveNotesData = function(notes, callback) {
    function doSave() {
      window._fb.setDoc(window._fb.docRef('config', 'notes'), { list: notes })
        .then(function() {
          showToast('تم حفظ الملاحظة بنجاح', 'success');
          if (callback) callback();
        })
        .catch(function(e) {
          showToast('فشل حفظ الملاحظة', 'error');
          console.error(e);
        });
    }
    if (window._fbReady) doSave();
    else window.addEventListener('fbReady', doSave, { once: true });
  }

  window.openNotesOverlay = function() {
    const el = document.getElementById('notesOverlay');
    el.style.display = 'flex';
    // جلب البيانات أولاً ثم عرض الملاحظات
    window.loadNotesData(function(notes) {
      window.renderNotes();
      setTimeout(() => {
        const searchInput = document.getElementById('notesSearchInput');
        if (searchInput) searchInput.focus();
      }, 200);
    });
  };

  window.closeNotesOverlay = function() {
    document.getElementById('notesOverlay').style.display = 'none';
    window.hideAddNoteForm();
  };

  window.showAddNoteForm = function() {
    document.getElementById('addNoteForm').style.display = 'block';
    setTimeout(() => document.getElementById('noteTextInput').focus(), 50);
  };

  window.hideAddNoteForm = function() {
    document.getElementById('addNoteForm').style.display = 'none';
    var inp = document.getElementById('noteTextInput');
    inp.value = '';
    delete inp.dataset.editId;
    var saveBtn = document.getElementById('addNoteForm')?.querySelector('button[onclick*="saveNote"]');
    if (saveBtn) saveBtn.textContent = 'حفظ';
  };

  window.saveNote = function() {
    const input  = document.getElementById('noteTextInput');
    const text   = input.value.trim();
    const editId = input.dataset.editId ? parseInt(input.dataset.editId) : null;
    if (!text) { showToast('الرجاء إدخال ملاحظة', 'error'); return; }

    window.loadNotesData(function(notes) {
      if (!notes) notes = [];
      if (editId) {
        // وضع التعديل
        var idx = notes.findIndex(function(n) { return n.id === editId; });
        if (idx !== -1) {
          notes[idx].text = text;
          notes[idx].date = new Date().toLocaleDateString('ar-EG');
        }
      } else {
        // وضع الإضافة
        notes.unshift({ id: Date.now(), text: text, pinned: false, date: new Date().toLocaleDateString('ar-EG') });
      }
      window.saveNotesData(notes, function() {
        // إعادة تعيين الحالة
        input.value = '';
        delete input.dataset.editId;
        var saveBtn = document.getElementById('addNoteForm')?.querySelector('button[onclick*="saveNote"]');
        if (saveBtn) saveBtn.textContent = 'حفظ';
        window.hideAddNoteForm();
        window.renderNotes();
      });
    });
  };

  window.togglePin = function(id) {
    window.loadNotesData(function(notes) {
      if (!notes) notes = [];
      const note = notes.find(n => n.id === id);
      if (note) {
        note.pinned = !note.pinned;
        window.saveNotesData(notes, function() {
          window.renderNotes();
        });
      }
    });
  };

  window.editNote = function(id) {
    window.loadNotesData(function(notes) {
      var note = (notes || []).find(function(n) { return n.id === id; });
      if (!note) return;
      var form  = document.getElementById('addNoteForm');
      var input = document.getElementById('noteTextInput');
      if (!form || !input) return;
      form.style.display = 'block';
      input.value = note.text;
      input.dataset.editId = String(id);
      input.focus();
      var saveBtn = form.querySelector('button[onclick*="saveNote"]');
      if (saveBtn) saveBtn.textContent = 'تحديث الملاحظة';
    });
  };

    window.deleteNote = function(id) {
    window.loadNotesData(function(notes) {
      if (!notes) notes = [];
      const filteredNotes = notes.filter(n => n.id !== id);
      window.saveNotesData(filteredNotes, function() {
        window.renderNotes();
      });
    });
  };

  window.renderNotes = function() {
    window.loadNotesData(function(notes) {
      if (!notes || !Array.isArray(notes)) notes = [];
      
      const q = (document.getElementById('notesSearchInput')?.value || '').trim().toLowerCase();
      let displayNotes = notes;
      if (q) {
        displayNotes = notes.filter(n => n && n.text && n.text.toLowerCase().includes(q));
      }

      displayNotes.sort((a, b) => {
        if (!a || !b) return 0;
        return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      });

      const total = notes.length;
      const countLabel = document.getElementById('notesCountLabel');
      if (countLabel) {
        countLabel.textContent = total === 0 ? 'لا توجد ملاحظات' : `${total} ملاحظة`;
      }

      const list = document.getElementById('notesList');
      const empty = document.getElementById('notesEmpty');
      
      if (!list) return;
      
      if (displayNotes.length === 0) {
        list.innerHTML = '';
        if (empty) {
          list.appendChild(empty);
          empty.style.display = 'block';
        }
        return;
      }
      if (empty) empty.style.display = 'none';
      
      list.innerHTML = displayNotes.map(n => {
        if (!n || !n.text) return '';
        return `
          <div class="note-card${n.pinned ? ' pinned' : ''}">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px;">
              <p style="font-size:.88rem; line-height:1.65; color:var(--text); flex:1; white-space:pre-wrap; word-break:break-word;">${escapeHtml(n.text)}</p>
              <div style="display:flex; gap:2px; flex-shrink:0;">
                <button class="note-pin-btn" onclick="togglePin(${n.id})" title="${n.pinned ? 'إلغاء التثبيت' : 'تثبيت'}">${n.pinned ? '📌' : '📍'}</button>
                <button onclick="editNote(${n.id})" title="تعديل" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--primary);border-radius:6px;display:flex;align-items:center;justify-content:center;" onmouseover="this.style.background='var(--primary-light)'" onmouseout="this.style.background='none'">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="note-delete-btn" onclick="deleteNote(${n.id})" title="حذف"><i class="fas fa-trash"></i></button>
              </div>
            </div>
            <div style="margin-top:8px; font-size:.7rem; color:var(--text-muted);">${n.date || ''}${n.pinned ? ' · <span style="color:#d97706;font-weight:700;">مثبتة</span>' : ''}</div>
          </div>
        `;
      }).join('');
    });
  };

  // حفظ الملاحظة باستخدام Ctrl+Enter
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') window.closeNotesOverlay();
    if (e.key === 'Enter' && e.ctrlKey && document.getElementById('addNoteForm').style.display !== 'none') window.saveNote();
  });

  function escapeHtml(text) { 
    const d = document.createElement('div'); 
    d.textContent = text; 
    return d.innerHTML; 
  }
  

/* ===== Sign Out ===== */

  // ── تسجيل الخروج عبر Firebase ──
  // زر تسجيل الخروج للعرض فقط — معطّل (لا يسجّل خروجاً)
  window.docbookSignOut = function() {
    function go(){ location.replace('index.html'); }
    try { window._fb.signOut().then(go).catch(go); } catch(e){ go(); }
  };

  

/* ===== Message Customizer ===== */

    // ══════════════════════════════════════════════
    // نظام تخصيص رسائل المريض
    // ══════════════════════════════════════════════

    var _defaultMsgs = {
      confirm:  'تم قبول موعدك {تاريخ} {فترة}\nنسعد برؤيتك 🌿',
      reject:   'نسعى جاهدين لتعويض الموعد الذي تم رفضه\n\nنأسف، نظراً للضغط وعدم توفر مواعيد في {تاريخ}، لم نتمكن من تأكيد موعدكم.',
      cancel:   'تم إلغاء موعدك {تاريخ}',
      reminder: 'السلام عليكم {اسم},\n\nهذا تذكير بموعدكم لدينا اليوم {تاريخ} في الفترة {فترة}.\nنوع الزيارة: {نوع}.\n\nنرجو الحضور في الوقت المحدد.\nشكراً لكم 🌿'
    };

    var _customMsgs = {};
    var _MSG_KEY = 'docbook_custom_msgs';

    function loadCustomMsgs() {
      if (window._fbReady) {
        window._fb.getDoc('config', 'customMsgs').then(function(snap) {
          _customMsgs = snap.exists() ? (snap.data() || {}) : {};
          renderMsgPreviews();
        }).catch(function() { renderMsgPreviews(); });
      } else {
        window.addEventListener('fbReady', loadCustomMsgs, { once: true });
      }
    }

    function saveCustomMsgs() {
      if (!window._fbReady) return;
      window._fb.setDoc(window._fb.docRef('config', 'customMsgs'), _customMsgs, { merge: true })
        .catch(function(e) { console.error('msgs save', e); });
    }

    function getMsg(type) {
      return _customMsgs[type] || _defaultMsgs[type] || '';
    }

    function renderMsgPreviews() {
      ['confirm','reject','cancel','reminder'].forEach(function(type) {
        var el = document.getElementById('msgPreview_' + type);
        if (el) el.textContent = getMsg(type);
      });
    }

    window.openMsgCustomizer = function() {
      document.getElementById('msgCustomizerModal').classList.remove('hidden');
      loadCustomMsgs();
    };

    window.closeMsgCustomizer = function() {
      document.getElementById('msgCustomizerModal').classList.add('hidden');
    };

    window.toggleMsgEdit = function(type) {
      var textarea = document.getElementById('msgEdit_' + type);
      var preview  = document.getElementById('msgPreview_' + type);
      var editBtn  = document.getElementById('msgEditBtn_' + type);
      var saveBtn  = document.getElementById('msgSaveBtn_' + type);
      var isEditing = textarea.style.display === 'block';
      if (isEditing) {
        textarea.style.display = 'none';
        preview.style.display  = 'block';
        editBtn.style.display  = 'flex';
        saveBtn.style.display  = 'none';
      } else {
        textarea.value = getMsg(type);
        textarea.style.display = 'block';
        preview.style.display  = 'none';
        editBtn.style.display  = 'none';
        saveBtn.style.display  = 'flex';
        textarea.focus();
      }
    };

    window.saveMsg = function(type) {
      var textarea = document.getElementById('msgEdit_' + type);
      var val = textarea.value.trim();
      if (!val) { showToast('الرسالة فارغة', 'error'); return; }
      _customMsgs[type] = val;
      saveCustomMsgs();
      var preview = document.getElementById('msgPreview_' + type);
      if (preview) preview.textContent = val;
      textarea.style.display = 'none';
      if (preview) preview.style.display = 'block';
      document.getElementById('msgEditBtn_' + type).style.display = 'flex';
      document.getElementById('msgSaveBtn_' + type).style.display = 'none';
      showToast('تم حفظ الرسالة', 'success');
    };

    window.resetMsg = function(type) {
      delete _customMsgs[type];
      saveCustomMsgs();
      var preview = document.getElementById('msgPreview_' + type);
      var textarea = document.getElementById('msgEdit_' + type);
      if (preview) { preview.textContent = _defaultMsgs[type]; preview.style.display = 'block'; }
      if (textarea) textarea.style.display = 'none';
      document.getElementById('msgEditBtn_' + type).style.display = 'flex';
      document.getElementById('msgSaveBtn_' + type).style.display = 'none';
      showToast('تمت إعادة التعيين', 'success');
    };

    // ── تحميل الرسائل المخصصة عند بدء التشغيل ──
    window.addEventListener('fbReady', function() {
      window._fb.getDoc('config', 'customMsgs').then(function(snap) {
        _customMsgs = snap.exists() ? (snap.data() || {}) : {};
      }).catch(function(){});
    }, { once: true });

    /* ============================================================
       الحقول المخصّصة (مشتركة مع الطبيب) — الممرّضة تقرأ قالب الطبيب من
       _docSettings.chartTemplate (settings/doctor)، وتعرض/تعدّل حقول
       المريض الثابتة. أي تعديل من الطبيب يظهر هنا فور تحديث settings/doctor.
       ============================================================ */
    function getChartTemplate() {
      var t = (typeof _docSettings !== 'undefined' && _docSettings && _docSettings.chartTemplate) || {};
      return {
        patient: Array.isArray(t.patient) ? t.patient : [],
        visit:   Array.isArray(t.visit)   ? t.visit   : []
      };
    }
    // عرض القيمة (قراءة فقط)
    function _cfDisplayVal(f, val) {
      if (f.type === 'checkbox') return val ? 'نعم' : '';
      if (f.type === 'date' && val) return formatDateAr(val);
      return (val != null && String(val).trim() !== '') ? String(val) : '';
    }
    function _cfChip(label, valHtml, color) {
      return '<div style="background:var(--bg);border:1.5px solid var(--border);border-radius:10px;padding:8px 11px;min-width:0;overflow:hidden;">'
        + '<div style="font-size:.68rem;color:var(--text-muted);font-weight:600;margin-bottom:2px;">' + escapeHtml(label) + '</div>'
        + '<div style="font-size:.86rem;font-weight:700;word-break:break-word;overflow-wrap:anywhere;color:' + (color || 'var(--text)') + ';">' + (valHtml || '-') + '</div></div>';
    }
    // بطاقات حقول المريض المخصّصة (تُعرض فقط الحقول التي لها قيمة)
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
    // بناء عناصر الإدخال من تعريف الحقول (نمط النموذج — بطاقة معلومات المريض)
    function buildCustomFieldInputs(container, fields, values, opts) {
      if (!container) return;
      opts = (typeof opts === 'string') ? { heading: opts } : (opts || {});
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
      var grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;align-items:start;';
      var labelCss = 'display:block;font-size:.8rem;font-weight:700;color:var(--text-secondary);margin-bottom:5px;';
      fields.forEach(function(f) {
        var cell = document.createElement('div');
        var val = values[f.id];
        var el;
        if (f.type === 'textarea') {
          cell.style.gridColumn = '1/-1';
          var lblt = document.createElement('label'); lblt.style.cssText = labelCss; lblt.textContent = f.label || '(حقل)'; cell.appendChild(lblt);
          el = document.createElement('textarea'); el.rows = 2; el.className = 'form-input'; el.style.resize = 'vertical'; el.value = (val != null ? val : '');
        } else if (f.type === 'checkbox') {
          cell.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:22px;';
          var lblc = document.createElement('span'); lblc.style.cssText = 'font-weight:700;font-size:.82rem;color:var(--text-primary);'; lblc.textContent = f.label || '(حقل)'; cell.appendChild(lblc);
          el = document.createElement('input'); el.type = 'checkbox';
          el.checked = (val === true || val === 'true' || val === 'نعم');
          el.style.cssText = 'width:20px;height:20px;accent-color:var(--primary);cursor:pointer;flex-shrink:0;';
        } else {
          var lbl = document.createElement('label'); lbl.style.cssText = labelCss; lbl.textContent = f.label || '(حقل)'; cell.appendChild(lbl);
          if (f.type === 'select') {
            el = document.createElement('select'); el.className = 'form-input';
            var blank = document.createElement('option'); blank.value = ''; blank.textContent = '—'; el.appendChild(blank);
            (f.options || []).forEach(function(o) { var op = document.createElement('option'); op.value = o; op.textContent = o; if (String(val) === String(o)) op.selected = true; el.appendChild(op); });
          } else {
            el = document.createElement('input'); el.type = (f.type === 'number') ? 'number' : (f.type === 'date' ? 'date' : 'text');
            el.className = 'form-input'; el.value = (val != null ? val : '');
          }
        }
        el.setAttribute('data-cfid', f.id);
        el.setAttribute('data-cftype', f.type);
        cell.appendChild(el);
        grid.appendChild(cell);
      });
      container.appendChild(grid);
    }
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
  