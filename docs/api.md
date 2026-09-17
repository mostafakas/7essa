# مرجع الـAPI

كل المسارات تبدأ بـ `/api/v1`. الطلبات المعدِّلة تتطلب الترويسة `x-csrf-token` (قيمة الكوكي `hessa_csrf`).
المسارات التي عمود صلاحيتها اسم صلاحية تتطلب الترويسة `x-workspace-id`، ويُرفض الطلب إن لم يكن الدور يملكها.
مسارات «مسجل» تحتاج جلسة فقط، وبوابة الأسرة تعمل بسياق المستخدم وسياسات قاعدة البيانات.

المبالغ المحسوبة (المتبقي، الإجماليات، بنود الكشف) أعداد صحيحة بالقرش، وحقول الإيصالات والعقود نصوص عشرية بالجنيه.

| الطريقة | المسار | الصلاحية | الوظيفة |
|---|---|---|---|
| GET | `/auth/csrf` | عام | تهيئة كوكي الحماية |
| POST | `/auth/otp/request` | عام (حد معدل) | طلب رمز الدخول |
| POST | `/auth/otp/verify` | عام (حد معدل) | التحقق وإنشاء الجلسة |
| POST | `/auth/refresh` | عام (حد معدل) | تدوير الجلسة |
| POST | `/auth/logout` | عام | تسجيل الخروج |
| POST | `/auth/logout-all` | مسجل | الخروج من كل الأجهزة |
| GET | `/auth/me` | مسجل | الحساب والعضويات وعدد الأبناء |
| PATCH | `/auth/me` | مسجل | تعديل الاسم |
| POST | `/workspaces` | مسجل | إنشاء مساحة عمل (تجربة 30 يومًا) |
| GET | `/workspaces/current` | workspace.view | المساحة الحالية وصلاحياتي |
| PATCH | `/workspaces/current` | workspace.manage | الإعدادات |
| GET | `/workspaces/current/teachers` | academics.read | قائمة المدرسين |
| GET | `/workspaces/current/members` | staff.manage | الفريق |
| POST | `/workspaces/current/members` | staff.manage | إضافة عضو |
| PATCH | `/workspaces/current/members/:id` | staff.manage | تغيير الدور أو الحالة أو المشرف |
| GET | `/workspaces/current/audit` | staff.manage | سجل العمليات |
| GET | `/academics/halls` | academics.read | القاعات |
| GET | `/academics/halls/occupancy?month` | academics.read | نسبة الإشغال |
| POST | `/academics/halls` | academics.write | إضافة قاعة |
| PATCH | `/academics/halls/:id` | academics.write | تعديل قاعة |
| DELETE | `/academics/halls/:id` | academics.write | حذف قاعة غير مستخدمة |
| GET | `/academics/groups` | academics.read | المجموعات |
| POST | `/academics/groups` | academics.write | إنشاء مجموعة |
| PATCH | `/academics/groups/:id` | academics.write | تعديل أو أرشفة |
| POST | `/academics/groups/:id/schedule` | academics.write | توليد مواعيد أسبوعية (409 عند التعارض) |
| GET | `/academics/sessions?from&to` | academics.read | الحصص في فترة |
| POST | `/academics/sessions` | academics.write | حصة إضافية |
| PATCH | `/academics/sessions/:id` | academics.write | تغيير موعد |
| POST | `/academics/sessions/:id/cancel` | academics.write | إلغاء مع إشعار الأسر |
| POST | `/students` | students.write | تسجيل طالب (هوية موحدة) |
| GET | `/students?q&groupId&status&page` | students.read | البحث |
| GET | `/students/by-code/:code` | students.read | الطالب بالكود |
| GET | `/students/:id` | students.read | ملف الطالب |
| GET | `/students/:id/card` | students.read | بيانات الكارنيه |
| POST | `/students/:id/card/reissue` | students.write | كارنيه بدل فاقد |
| PATCH | `/students/enrollments/:id` | students.write | الحالة أو الخصم |
| POST | `/students/enrollments/:id/transfer` | students.write | نقل لمجموعة أخرى |
| GET | `/attendance/today` | attendance.record | حصص اليوم مع العدادات |
| POST | `/attendance/scan` | attendance.record | تسجيل حضور بالرمز أو الكود |
| POST | `/attendance/sync` | attendance.record | مزامنة عمليات دون اتصال (حتى 500) |
| GET | `/attendance/sessions/:id` | attendance.record | كشف الحصة |
| POST | `/attendance/sessions/:id/open` | attendance.record | فتح الكشف |
| POST | `/attendance/sessions/:id/close` | attendance.record | إغلاق وتسجيل الغياب وإشعاره |
| POST | `/attendance/sessions/:id/manual` | attendance.record | تسجيل يدوي |
| GET | `/finance/today` | finance.collect | مؤشرات اليوم |
| POST | `/finance/shifts/open` | finance.shift | فتح وردية |
| GET | `/finance/shifts/current` | finance.shift | ورديتي وإجمالياتها |
| GET | `/finance/shifts?status` | finance.shift.approve | الورديات |
| POST | `/finance/shifts/:id/close` | finance.shift | إغلاق بالعد الفعلي |
| POST | `/finance/shifts/:id/approve` | finance.shift.approve | اعتماد (شخص آخر) |
| POST | `/finance/receipts` | finance.collect | إصدار إيصال |
| GET | `/finance/receipts?month&status&shiftId` | finance.collect | الإيصالات |
| GET | `/finance/receipts/:id` | finance.collect | إيصال للطباعة |
| POST | `/finance/receipts/:id/cancel-request` | finance.cancel.request | طلب إلغاء |
| POST | `/finance/receipts/:id/cancel-decision` | finance.cancel.approve | اعتماد أو رفض |
| POST | `/finance/expenses` | finance.expense | مصروف |
| GET | `/finance/expenses?month` | finance.expense | المصروفات |
| GET | `/finance/dues?month&groupId` | finance.dues | المتأخرات |
| GET | `/finance/summary?month` | finance.reports | التقرير الشهري |
| GET | `/settlements/contracts` | settlements.manage | العقود |
| POST | `/settlements/contracts` | staff.manage | عقد جديد (ينهي السابق) |
| POST | `/settlements/contracts/:id/end` | staff.manage | إنهاء عقد |
| GET | `/settlements/advances?month` | settlements.manage | السلف |
| POST | `/settlements/advances` | settlements.manage | سلفة |
| POST | `/settlements/calculate` | settlements.manage | حساب شهر |
| GET | `/settlements?month` | settlements.manage | كشوف الشهر |
| GET | `/settlements/mine` | settlements.read.own | كشوفي |
| GET | `/settlements/:id` | workspace.view | كشف (صاحبه أو الإدارة) |
| POST | `/settlements/:id/confirm` | settlements.read.own | تأكيد المدرس |
| POST | `/settlements/:id/dispute` | settlements.read.own | اعتراض |
| POST | `/settlements/:id/approve` | settlements.approve | اعتماد |
| POST | `/settlements/:id/pay` | settlements.pay | صرف |
| GET | `/exams/questions` | exams.manage | بنك الأسئلة |
| POST | `/exams/questions` | exams.manage | سؤال |
| POST | `/exams/questions/import` | exams.manage | حتى 200 سؤال |
| PATCH | `/exams/questions/:id` | exams.manage | تعديل سؤال غير مستخدم في امتحان منشور |
| GET | `/exams` | exams.grade | الامتحانات |
| POST | `/exams` | exams.manage | إنشاء يدوي أو بالمواصفات |
| GET | `/exams/:id` | exams.grade | الامتحان بالإجابات |
| PATCH | `/exams/:id` | exams.manage | موعد الإغلاق أو إظهار الدرجات |
| POST | `/exams/:id/publish` | exams.manage | نشر وإشعار |
| POST | `/exams/:id/close` | exams.manage | إغلاق |
| POST | `/exams/:id/paper-results` | exams.grade | نتيجة ورقية |
| GET | `/exams/:id/results` | exams.grade | النتائج والتحليل |
| GET | `/family/children` | مسجل | الأبناء والمتبقي والموافقات |
| GET | `/family/children/:id/qr` | مسجل | رمز الحضور المتغير |
| GET | `/family/children/:id/attendance?month` | مسجل | الحضور |
| GET | `/family/children/:id/receipts` | مسجل | المدفوعات |
| GET | `/family/children/:id/results` | مسجل | الدرجات |
| GET | `/family/schedule?from&to` | مسجل | جدول موحد (حتى شهرين) |
| POST | `/family/consents/:enrollmentId` | مسجل | موافقة ولي الأمر |
| GET | `/family/exams` | مسجل | الامتحانات المتاحة |
| POST | `/family/exams/:id/start` | مسجل | بدء أو استكمال |
| GET | `/family/attempts/:id` | مسجل | الورقة أو النتيجة |
| POST | `/family/attempts/:id/submit` | مسجل | التسليم والتصحيح |
| GET | `/notifications` | مسجل | آخر 50 إشعارًا |
| POST | `/notifications/read` | مسجل | تعليم كمقروء |
| GET | `/platform/overview` | مالك المنصة | أرقام مجمعة |
| PATCH | `/platform/workspaces/:id` | مالك المنصة | الحالة والخطة والتجربة |
| GET | `/health` | عام | فحص الخدمة وقاعدة البيانات |

إجمالي المسارات: 100.
