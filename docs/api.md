# مرجع الـAPI

كل المسارات تبدأ بـ `/api/v1`. الطلبات المعدِّلة تتطلب الترويسة `x-csrf-token` (قيمة الكوكي `hessa_csrf`).
المسارات التي عمود صلاحيتها اسم صلاحية تتطلب الترويسة `x-workspace-id`، ويُرفض الطلب إن لم يكن الدور يملكها.
مسارات «مسجل» تحتاج جلسة فقط، وبوابة الأسرة تعمل بسياق المستخدم وسياسات قاعدة البيانات.
مسارات `/platform/*` تتطلب عضوية فريق المنصة، وعمود الصلاحية فيها صلاحية المنصة (بدونه = أي عضو في الفريق، قراءة).

رموز أخطاء مهمة في `code`:
- `PASSWORD_CHANGE_REQUIRED` (403): كلمة مرور مؤقتة، كل المسارات مغلقة عدا `/auth/change-password` و`/auth/me` والخروج.
- `READ_ONLY` (403): المساحة للعرض فقط (انتهت التجربة أو الاشتراك)، طلبات القراءة تعمل.
- `WORKSPACE_BLOCKED` (403): المساحة موقوفة من إدارة المنصة.

المبالغ المحسوبة (المتبقي، الإجماليات، بنود الكشف) أعداد صحيحة بالقرش، وحقول الإيصالات والعقود نصوص عشرية بالجنيه.

| الطريقة | المسار | الصلاحية | الوظيفة |
|---|---|---|---|
| GET | `/auth/csrf` | عام | تهيئة كوكي الحماية |
| POST | `/auth/login` | عام (10/دقيقة) | `{ identifier, password }` — اسم مستخدم أو موبايل؛ قفل 15 دقيقة بعد 5 محاولات |
| POST | `/auth/change-password` | مسجل | `{ currentPassword, newPassword }` — ينهي الجلسات الأخرى |
| POST | `/auth/refresh` | عام (حد معدل) | تدوير الجلسة |
| POST | `/auth/logout` | عام | تسجيل الخروج |
| POST | `/auth/logout-all` | مسجل | الخروج من كل الأجهزة |
| GET | `/auth/me` | مسجل | الحساب والعضويات وعدد الأبناء وإعدادات المنصة العامة |
| PATCH | `/auth/me` | مسجل | تعديل الاسم |
| POST | `/workspaces` | مسجل | إنشاء مساحة عمل (إن سمحت الإعدادات بالتسجيل الذاتي) |
| GET | `/workspaces/current` | workspace.view | المساحة الحالية وصلاحياتي وحالة الوصول |
| GET | `/workspaces/current/subscription` | workspace.view | الخطة والحدود والاستخدام وتاريخ الانتهاء |
| PATCH | `/workspaces/current` | workspace.manage | الإعدادات |
| GET | `/workspaces/current/teachers` | academics.read | قائمة المدرسين |
| GET | `/workspaces/current/members` | staff.manage | الفريق |
| POST | `/workspaces/current/members` | staff.manage | إضافة عضو (يرجع بيانات دخول مؤقتة للحساب الجديد) |
| POST | `/workspaces/current/members/:id/credentials` | staff.manage | كلمة مؤقتة جديدة لعضو لم يدخل بعد |
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
| POST | `/students` | students.write | تسجيل طالب (هوية موحدة) ← بيانات دخول ولي الأمر إن كان جديدًا |
| GET | `/students?q&groupId&status&page` | students.read | البحث |
| GET | `/students/by-code/:code` | students.read | الطالب بالكود |
| GET | `/students/:id` | students.read | ملف الطالب |
| GET | `/students/:id/card` | students.read | بيانات الكارنيه |
| POST | `/students/:id/card/reissue` | students.write | كارنيه بدل فاقد |
| PATCH | `/students/enrollments/:id` | students.write | الحالة أو الخصم |
| POST | `/students/enrollments/:id/transfer` | students.write | نقل لمجموعة أخرى |
| GET | `/students/:id/accounts` | students.write | حسابا ولي الأمر والطالب وحالة دخولهما |
| POST | `/students/:id/guardian-credentials` | students.write | كلمة مؤقتة لولي أمر لم يدخل بعد |
| POST | `/students/:id/student-account` | students.write | إنشاء حساب للطالب أو كلمة مؤقتة جديدة له |
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
| GET | `/platform/whoami` | عضو الفريق | دوري وصلاحياتي في فريق المنصة |
| GET | `/platform/overview` | عضو الفريق | المؤشرات: المساحات حسب الحالة، الإيراد، التجارب والتجديدات القريبة، آخر الإجراءات |
| GET | `/platform/audit?scope&action&workspaceId&actorId&page` | عضو الفريق | سجل العمليات عبر المنصة |
| GET | `/platform/system` | عضو الفريق | صحة النظام: دور القاعدة وRLS والأسرار وآخر تشغيل يومي |
| GET | `/platform/settings` | عضو الفريق | إعدادات المنصة |
| PATCH | `/platform/settings` | platform.settings.manage | التسجيل الذاتي، أيام التجربة والسماح، رقم الدعم، رسالة الصيانة |
| GET | `/platform/workspaces?q&status&type&plan&due&page` | عضو الفريق | المساحات مع المالك والاستخدام وحالة الوصول |
| POST | `/platform/workspaces` | platform.workspaces.manage | إنشاء مساحة مع مالكها (جديد أو موجود) ← بيانات دخول مؤقتة |
| GET | `/platform/workspaces/:id` | عضو الفريق | التفاصيل والفريق والمدفوعات والملاحظات |
| PATCH | `/platform/workspaces/:id` | حسب الحقل | البيانات والحالة (workspaces.manage)، الخطة والحدود والدفع (billing.manage) |
| POST | `/platform/workspaces/:id/extend-trial` | platform.workspaces.manage | تمديد التجربة بعدد أيام |
| POST | `/platform/workspaces/:id/members` | platform.workspaces.manage | إضافة عضو (مستخدم موجود أو جديد) |
| PATCH | `/platform/workspaces/:id/members/:mid` | platform.workspaces.manage | الدور أو الحالة أو المشرف |
| POST | `/platform/workspaces/:id/notes` | platform.workspaces.manage | ملاحظة داخلية |
| DELETE | `/platform/workspaces/:id/notes/:noteId` | platform.workspaces.manage | حذف ملاحظة |
| POST | `/platform/workspaces/:id/payments` | platform.billing.manage | تسجيل دفعة ← يمد الاشتراك ويفعّل المساحة |
| GET | `/platform/workspaces/:id/audit?page` | عضو الفريق | سجل عمليات المساحة |
| GET | `/platform/users?q&kind&status&page` | عضو الفريق | كل الحسابات مع الحالة والارتباطات |
| POST | `/platform/users` | platform.users.manage | إنشاء حساب (ودور في فريق المنصة لمالكها فقط) |
| GET | `/platform/users/:id` | عضو الفريق | الحساب والعضويات والأبناء والجلسات والسجل |
| PATCH | `/platform/users/:id` | platform.users.manage | الاسم والرقم واسم المستخدم والحالة والملاحظات والدور |
| POST | `/platform/users/:id/reset-password` | platform.users.manage | كلمة مرور جديدة (مؤقتة أو محددة) وإنهاء الجلسات |
| POST | `/platform/users/:id/revoke-sessions` | platform.users.manage | الخروج من كل الأجهزة |
| POST | `/platform/users/:id/unlock` | platform.users.manage | فك القفل المؤقت |
| GET | `/platform/plans` | عضو الفريق | الخطط مع عدد المساحات |
| POST | `/platform/plans` | platform.billing.manage | خطة جديدة |
| PATCH | `/platform/plans/:id` | platform.billing.manage | الأسعار والحدود والإتاحة |
| GET | `/platform/payments?from&to&workspaceId&page` | عضو الفريق | المدفوعات مع الإجمالي |
| DELETE | `/platform/payments/:id` | platform.settings.manage | حذف دفعة مسجلة بالخطأ |
| GET | `/platform/announcements` | عضو الفريق | كل الإعلانات |
| POST | `/platform/announcements` | platform.content.manage | نشر إعلان (مع إشعار اختياري) |
| PATCH | `/platform/announcements/:id` | platform.content.manage | تعديل أو إيقاف |
| DELETE | `/platform/announcements/:id` | platform.content.manage | حذف |
| GET | `/announcements/active` | مسجل | الإعلانات السارية لي ورسالة الصيانة |
| GET | `/cron/daily` | `Bearer CRON_SECRET` | المهمة اليومية (Vercel Cron) |
| GET | `/health` | عام | فحص الخدمة وقاعدة البيانات |

إجمالي المسارات: 138.
