// categories.js — the word lists of the `ريبلكا` game (src/games/games/replica.js): "a human, an animal, a thing, a
// plant, a country that starts with the letter ...". Every category lists its words by first letter (written the
// plain way: normalize() of src/games/engine/text.js makes أ إ آ → ا, ة → ه, ى → ي); a letter with fewer than
// MIN_WORDS words is never asked. The game accepts a word only when it is on the list of that category and letter.

export const MIN_WORDS = 3;

const lines = (text) => Object.fromEntries(text.trim().split('\n').map((line) => {
    const [letter, ...words] = line.trim().split(/\s+/u);
    return [letter, words];
}));

export const CATEGORIES = {
    human: {
        ar: 'إنسان',
        en: 'a human name',
        words: lines(`
ا احمد ابراهيم اسامه ايمان اسماء امل ايه اياد
ب بسمه بلال بسنت باسم بدر
ت تامر تقي تسنيم
ح حسن حسين حنان حمزه حازم حبيبه
خ خالد خديجه خلود
د دعاء داليا دينا داود
ر رنا رامي رحاب رضوي رشا
ز زياد زينب زكريا زهره
س سارة سلمي سعيد سامي سمير سلمان
ش شيماء شهد شريف شادي
ص صلاح صفاء صالح صبري
ع علي عمر عائشه عمرو عبير عادل
ف فاطمه فارس فادي فرح فريد
ك كريم كمال كوثر كرم
م محمد مصطفي منه مريم محمود ميار
ن نور نادر نبيل نهي نجلاء ندي
ه هدي هاني هبه هشام هالة
ي يوسف ياسمين ياسر يحيي يمني
`),
    },
    animal: {
        ar: 'حيوان',
        en: 'an animal',
        words: lines(`
ا اسد ارنب افعي اخطبوط
ب بقره بطه بطريق ببغاء بومه بجعه
ج جمل جاموس جرذ جراد
ح حصان حمار حمامه حوت حلزون حرباء
د دب دجاجه دلفين ديك دوده
ز زرافه زنبور
س سمكه سلحفاه سنجاب سلطعون سحليه
ص صقر صرصور صرد
ض ضفدع ضبع ضب
ع عصفور عقرب عنكبوت عقاب عجل
غ غزال غراب غوريلا
ف فيل فار فراشه فهد فرس
ق قرد قط قطه قرش قنفذ
ك كلب كنغر كوالا كركدن
ن نمر نمله نحله نعامه نسر نمس
ه هر هدهد هامستر
و وز وعل ورل ورشان
`),
    },
    thing: {
        ar: 'جماد',
        en: 'an object',
        words: lines(`
ا ابريق اريكه اناء انبوب
ب باب بطانيه بيت برج بالون بساط
ت تلفاز تليفون تاج تابوت تذكره
ج جرس جوال جاكيت جزمه
ح حقيبه حذاء حبل حجر حاسوب
خ خزانه خاتم خيمه خريطه
د دولاب دفتر دراجه دلو دبوس
ر راديو رف ريشه رمح
س سرير سيف ساعه سياره سكين سلم سجاده
ش شباك شمعه شنطه شوكه شاشه
ص صندوق صحن صابون صنبور
ط طاوله طبق طاسه طائره طوب
ع عجله علبه عصا عدسه
غ غسالة غطاء غرفه غلايه
ف فنجان فرشاه فستان فرن
ق قلم قفل قميص قدر قارب
ك كرسي كتاب كوب كاميرا كمبيوتر
ل لمبه لوحه لعبه لوح
م مفتاح مكتب مراه مسطره مقص مروحه مصباح
ن نظاره نافذه نجفه
`),
    },
    plant: {
        ar: 'نبات',
        en: 'a plant',
        words: lines(`
ا اناناس ارز اكاسيا
ب بطاطس بصل بطيخ برتقال بامبه بقدونس برسيم
ت تفاح تين توت تمر ترمس
ج جزر جرجير جوافه
ح حمص حلبه حنطه حبهان
خ خيار خس خوخ خرشوف
ر رمان رز ريحان
ز زيتون زعتر زنجبيل
س سبانخ سفرجل سمسم
ش شمام شعير شاي
ف فراوله فلفل فول فجل
ق قمح قرنبيط قرع قصب
ك كرنب كرز كمثري كزبره
ل ليمون لوز لفت لبلاب
م موز مانجو مشمش ملوخيه
ن نعناع نخل نبق
ه هليون هندباء
ع عنب عدس عرقسوس
ط طماطم طحلب
`),
    },
    country: {
        ar: 'دولة',
        en: 'a country',
        words: lines(`
ا اسبانيا ايطاليا ايران اندونيسيا اثيوبيا اوكرانيا
ب بلجيكا بريطانيا برازيل بولندا بيرو بنغلاديش
ت تركيا تونس تايلاند تشاد
ج جزائر جيبوتي جامايكا
س سوريا سودان سعوديه سويسرا سويد سنغال
ع عمان عراق
ف فرنسا فلسطين فنلندا فيتنام فنزويلا
ك كندا كويت كوبا كوريا كينيا
ل لبنان ليبيا لاتفيا
م مصر مغرب موريتانيا مكسيك ماليزيا
ن نيجيريا نرويج نيوزيلندا نيبال
ي يمن يابان يونان
ه هولندا هند هنغاريا
ق قطر قبرص
ر روسيا رومانيا
`),
    },
};

export const CATEGORY_IDS = Object.keys(CATEGORIES);

/** The words a category lists under a letter, or []. */
export const wordsFor = (category, letter) => CATEGORIES[category]?.words?.[letter] ?? [];

/** Every { category, letter } pair that has enough words to be asked. */
export function askablePairs() {
    const pairs = [];
    for (const category of CATEGORY_IDS) {
        for (const [letter, words] of Object.entries(CATEGORIES[category].words)) {
            if (words.length >= MIN_WORDS) pairs.push({ category, letter });
        }
    }
    return pairs;
}
