# جدول حالة وأوامر ألعاب CC-Bot (GAMES_STATUS.md)

تم تدقيق ومطابقة جميع ألعاب الشات، الكازينو، الألعاب الفردية، الثنائية، والجماعية في CC-Bot بناءً على خطة العمل (`docs/GAMES_PLAN.md`) وتوجيهات الأونر.

---

## 📊 مصفوفة الألعاب الكاملة (Games Status Matrix)

| اللعبة (Game) | النوع (Kind) | الأوامر (Prefix & Slash) | الحالة (Status) | متاحة في قائمة `/games`؟ | ملاحظات وتفاصيل (Notes) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **سؤال (quiz)** | single | `.سؤال` / `!quiz` | implemented | نعم (Yes) | أسئلة عامة وثقافية كصورة PNG لمنع النسخ |
| **رياضيات (math)** | single | `.رياضيات` / `.احسب` | implemented | نعم (Yes) | معادلات حسابية وسرعة بديهة كصورة PNG |
| **لغز (riddle)** | single | `.لغز` / `!riddle` | implemented | نعم (Yes) | ألغاز وحزازير ببطاقة Tajawal عريضة |
| **عكس (antonym)** | single | `.عكس` / `!antonym` | implemented | نعم (Yes) | إيجاد مضاد الكلمة باللغة العربية |
| **جمع (plural)** | single | `.جمع` / `!plural` | implemented | نعم (Yes) | إيجاد جمع التكسير أو المذكر/المؤنث |
| **مفرد (singular)** | single | `.مفرد` / `!singular` | implemented | نعم (Yes) | إيجاد مفرد الكلمات |
| **ترجم (translate)** | single | `.ترجم` / `!translate` | implemented | نعم (Yes) | ترجمة كلمات من وإلى الإنجليزية |
| **حروف (letters)** | single | `.حروف` / `!letters` | implemented | نعم (Yes) | تكوين كلمة من حروف مبعثرة |
| **عكسي (reverse)** | single | `.عكسي` / `!reverse` | implemented | نعم (Yes) | كتابة الكلمة معكوسة بسرعة |
| **فكك (split)** | single | `.فكك` / `!split` | implemented | نعم (Yes) | تفكيك حروف الكلمة بفواصل |
| **رتب (sort)** | single | `.رتب` / `!sort` | implemented | نعم (Yes) | ترتيب الحروف هجائياً أو منطقياً |
| **كرر (echo)** | single | `.كرر` / `!echo` | implemented | نعم (Yes) | تكرار النص المكتوب في الصورة |
| **اسرع (fast)** | single | `.اسرع` / `!fast` | implemented | نعم (Yes) | كتابة جملة سريعة في الشات |
| **عد (count)** | single | `.عد` / `!count` | implemented | نعم (Yes) | عد عناصر معينة في الصورة |
| **قص (cut)** | single | `.قص` / `!cut` | implemented | نعم (Yes) | قص حروف أو كلمات معينة |
| **ناقص (missing)** | single | `.ناقص` / `!missing` | implemented | نعم (Yes) | إكمال الحرف أو الرقم الناقص |
| **ارقام (numbers)** | single | `.ارقام` / `!numbers` | implemented | نعم (Yes) | متتاليات وتحديات رقمية |
| **خريطة (map)** | single | `.خريطة` / `!map` | implemented | نعم (Yes) | كارت خريطة الدولة كصورة PNG أصلية |
| **تمويه (camo)** | single | `.تمويه` / `!camo` | implemented | نعم (Yes) | كارت مضاد للبوتات والـ OCR |
| **اعلام (flags)** | single | `.اعلام` / `!flags` | implemented | نعم (Yes) | كارت علم الدولة بدقة فيكتور عالية |
| **ايموجي (emojiGuess)**| single | `.ايموجي` / `!emoji` | implemented | نعم (Yes) | تخمين اسم فيلم أو مثل من الإيموجي |
| **الوان (colors)** | single | `.الوان` / `!colors` | implemented | نعم (Yes) | اختبار ستروب البصري لسرعة الألوان |
| **ثعبان (snake)** | single | `.ثعبان` / `!snake` | implemented | نعم (Yes) | لعبة أركيد بشبكة 5×5 وأزرار تحكم |
| **زر (button)** | single | `.زر` / `!button` | implemented | نعم (Yes) | اختبار سرعة رد الفعل عند ظهور الزر |
| **ريبلكا (replica)** | single | `.ريبلكا` / `!replica` | implemented | نعم (Yes) | إنسان/حيوان/جماد/نبات/دولة بحرف معين، أسرع كلمة صح (src/games/data/categories.js) |
| **اكس او (xo)** | dual | `.اكس` / `.xo` | implemented | نعم (Yes) | تحدي 1v1 بشبكة أزرار 3×3 وخط فوز ذهبي |
| **حجره (rps)** | dual | `.حجره` / `.rps` | implemented | نعم (Yes) | حجرة ورقة مقص بلوبي فوري |
| **توصيل 4 (connect)** | dual | `.توصيل` / `.connect`| implemented | نعم (Yes) | كونكت فور بشبكة 6×7 وأزرار إسقاط |
| **قرعة (roulette)** | group | `.قرعة` / `.roulette`| implemented | نعم (Yes) | روليت السيرفر لاختيار فائز عشوائي |
| **كراسي (chairs)** | group | `.كراسي` / `.chairs` | implemented | نعم (Yes) | كراسي موسيقية واستبعاد الخاسر بالتايمر |
| **غميضة (hideAndSeek)**| group | `.غميضة` / `.hide` | implemented | نعم (Yes) | استغماية مع أدوار الباحث والمختبئين |
| **مافيا (mafia)** | group | `.مافيا` / `.mafia` | implemented | نعم (Yes) | مافيا كاملة بأدوار ليلية ومحاكمة نهارية |
| **مينز (mines)** | casino | `مينز` / `/casino mines` | implemented | نعم (Yes) | كازينو 5×5 مع جواهر وزر سحب أرباح |
| **عملة (coinflip)** | casino | `عملة` / `/casino coinflip`| implemented | نعم (Yes) | ملك ولا كتابة ومضاعف فوري |
| **سلوت (slots)** | casino | `سلوت` / `/casino slots`| implemented | نعم (Yes) | ماكينة سلوت 3×3 |
| **نرد (dice)** | casino | `نرد` / `/casino dice` | implemented | نعم (Yes) | رول نرد وتوقع فوق/تحت |
| **فرخة (chicken)** | casino | `فرخة` / `/casino chicken`| implemented | نعم (Yes) | عبور الحارات وتفادي الاصطدام |
| **بلاك جاك (blackjack)**| casino | `بلاك جاك` / `/casino blackjack`| implemented | نعم (Yes) | مواجهة الموزع والوصول لـ 21 |
| **روليت كازينو (roulette)**| casino | `روليت` / `/casino roulette`| implemented | نعم (Yes) | مراهنة ألوان وأرقام جماعية |
| **صاروخ (rocket)** | casino | `صاروخ` / `/casino rocket`| implemented | نعم (Yes) | كراش ومضاعف تصاعدي وسحب أرباح |
| **سباق الخيول (horses)**| casino | `احصنة` / `.احصنة` / `/casino horses`| implemented | نعم (تم إضافتها) | 6 خيول فانتسي، مضمار SVG، ونسبة بيت 2.58% |

---

## 🚫 الألعاب الملغاة نهائياً (Cancelled Games)
بأمر الأونر المباشر، تم إلغاء هذه الألعاب نهائياً وعدم برمجتها:
- ❌ **شعار** (ملغاة)
- ❌ **لاعب** (ملغاة)
- ❌ **نادي** (ملغاة)
- ❌ **شطرنج** (ملغاة)

---

## ⏳ الألعاب المؤجلة لمراحل قادمة (Postponed Games)
ألعاب تم تأجيلها حتى يطلب الأونر تفعيلها مستقبلاً:
- `فعالية`, `تصويت`, `سباق`, `لغم`, `خداع`, `منتجات`, `دول`, `بومب`, `سلسلة`, `الجاسوس`, `بحث`, `كلمات`, `كروت`, `شفرة`, `كودنيمز`.

---

## 🔍 تدقيق سلامة سباق الخيول (Horse Race Audit)
1. **الوصول عبر الأوامر (Reachability):**
   - تعمل بكتابة `.احصنة` و `.horses` في أي روم.
   - تعمل بكتابة `احصنة` أو `horses` مباشرة (بدون نقطة) في رومات الكازينو المخصصة.
   - تعمل عبر سلاش كوماند `/casino horses`.
2. **الرهان والمبالغ:**
   - تدعم الرهان الفردي والجماعي.
   - تدعم اختصارات المبالغ القياسية من `src/config/amount.js` (مثل: `5k`, `10k`, `all`, `half`).
   - تلتزم بالحد الأقصى للرهان (`CASINO.maxBet`) وفترة الكولداون.
3. **سلامة الرصيد والـ House Edge:**
   - تسوية الرصيد تتم عبر دالة `updateCCState` الذرية والمحمية ضد السباق والتكرار (idempotent).
   - نسبة ربح الكازينو (House Edge) مثبتة رياضياً بدقة **2.58%** (RTP 97.42%).
4. **معالجة التايمر والاستبعاد (Bug #289):**
   - تم التحقق من أن جميع الألعاب الثنائية والجماعية تستبعد تلقائياً أي لاعب ينتهي وقته دون تحرك لتجنب تعليق الروم، وتنتهي اللعبة بفوز اللاعب النشط.
