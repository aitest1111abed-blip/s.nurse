/* =====================================================================
   ⚙️  إعدادات العميل — هذا هو الملف الوحيد الذي تعدّله عند ربط عيادة/مشروع
   Firebase جديد. ضع نسخة مطابقة منه في مجلدات: doctor / nurse / booking.
   لا حاجة للبحث داخل الكود إطلاقاً.
   ===================================================================== */

/* (1) إعدادات مشروع Firebase
   من: Firebase Console → ⚙️ Project settings → Your apps → Web app → SDK config */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCMUMqjGH9Xsl_qZBkOHAVvDuzc-ii-U4k",
  authDomain: "simple-b8b05.firebaseapp.com",
  databaseURL: "https://simple-b8b05-default-rtdb.firebaseio.com",
  projectId: "simple-b8b05",
  storageBucket: "simple-b8b05.firebasestorage.app",
  messagingSenderId: "943515326256",
  appId: "1:943515326256:web:b1eff0fd8ea996eb73daf5"
};
/* المشروع السابق (مفتاحه لم يعد صالحاً — محفوظ للتراجع إن لزم):
   apiKey: "AIzaSyBOiLLRqSykhwzYrrFrdRO2mzWTYDU2W1M",
   projectId: "savedatatest-4dc4c", messagingSenderId: "64405748598",
   appId: "1:64405748598:web:a0c2282d07d67c63a41857" */

/* (2) حسابات جوجل للموظفين — نفس هذه الإيميلات يجب أن تُوضع في قواعد Firestore */
window.DOCBOOK_ROLES = {
  doctor: ['ahmadtaim450@gmail.com'],   // ← بريد/بُرُد الطبيب (يمكن أكثر من واحد)
  nurse:  ['aistam379@gmail.com']       // ← بريد/بُرُد الممرضة
};

/* (دالة مساعدة — لا تعدّلها) */
window.DOCBOOK_ROLE_OF = function (email) {
  email = (email || '').toLowerCase().trim();
  if ((window.DOCBOOK_ROLES.doctor || []).map(function (e) { return e.toLowerCase(); }).indexOf(email) !== -1) return 'doctor';
  if ((window.DOCBOOK_ROLES.nurse  || []).map(function (e) { return e.toLowerCase(); }).indexOf(email) !== -1) return 'nurse';
  return null;
};
