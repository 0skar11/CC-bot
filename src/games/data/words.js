// words.js — the word lists of the typing games (src/games/games/: اسرع, فكك, حروف, حرف, عكس, عد): common Arabic
// nouns of 3-7 letters, English words of 4-8 letters, short phrases in both languages, and the anagram helper of
// `حروف` (any word in these lists made of the same letters is a right answer, plus the extra ones in ANAGRAMS).
// Nothing offensive, no names of Allah and no religious words. Checked by tests/gamesWordGamesData.test.js.

import { normalize } from '../engine/text.js';

const list = (text) => text.split(/\s+/u).filter(Boolean);

export const AR_WORDS = Object.freeze(list(`
    أسد نمر فيل زرافة حصان حمار جمل بقرة خروف ماعز قطة كلب أرنب فأر ثعلب ذئب غزال قرد تمساح سلحفاة ثعبان ضفدع
    نحلة نملة فراشة عصفور حمامة صقر نسر بومة ببغاء دجاجة ديك بطة إوزة سمكة حوت دلفين أخطبوط بعوضة ذبابة عنكبوت
    خفاش كنغر باندا فهد ضبع حرباء نعامة طاووس غراب بلبل قنفذ سنجاب جاموس حلزون
    خبز أرز لحم جبن زبدة لبن حليب عسل سكر ملح فلفل زيت بيض تفاحة موز برتقال عنب بطيخ شمام فراولة خوخ مشمش
    كمثرى رمان تين ليمون جوافة مانجو أناناس كرز تمر بلح طماطم خيار جزر بصل ثوم بطاطس كوسة باذنجان فاصوليا
    ملوخية سبانخ كرنب قرنبيط فول عدس حمص فطير كعك بسكويت حلاوة كنافة بسبوسة مربى عصير قهوة شاي مكرونة بيتزا
    شوربة سلطة فطيرة كباب كفتة فلافل طعمية شاورما زبادي قشطة دقيق خميرة توابل كمون قرفة نعناع ينسون كركديه
    بيت منزل شقة غرفة مطبخ حمام صالة شرفة سقف حائط أرضية باب شباك نافذة سلم مصعد كرسي طاولة سرير دولاب مرآة
    سجادة ستارة وسادة بطانية لحاف مخدة مصباح لمبة ثلاجة فرن غسالة مروحة مكيف تلفاز راديو ساعة منبه مفتاح قفل
    شمعة مكنسة دلو صابون فوطة مشط فرشاة معجون كوب فنجان طبق ملعقة شوكة سكين إبريق حلة طاسة صينية زجاجة برطمان
    علبة كيس صندوق درج مقعد أريكة كنبة مخزن سطح جرس حديقة
    رأس شعر وجه عين أنف أذن ذقن رقبة كتف ذراع كوع إصبع ظفر صدر بطن ظهر ركبة ساق قدم كعب قلب معدة كبد رئة عظم
    جلد لسان شفة ضرس حاجب رمش جبهة دماغ
    شمس قمر نجمة سماء سحابة مطر ثلج برق رعد ريح عاصفة بحر نهر بحيرة محيط جبل وادي صحراء غابة شجرة زهرة وردة
    ورقة غصن جذر عشب رمل حجر صخرة تراب طين نار دخان هواء ماء موجة شاطئ جزيرة كهف بركان شلال ضباب ندى فجر
    غروب نخلة زيتون صنوبر ياسمين هضبة سهل واحة نبع بئر كوكب مجرة نيزك فضاء هلال
    مدينة قرية شارع ميدان حارة كوبري جسر مدرسة جامعة مستشفى صيدلية مكتبة متحف مطعم مقهى فندق سوق محل بنك مصنع
    مطار ميناء محطة ملعب نادي سينما مسرح برج عمارة قصر قلعة هرم نفق رصيف إشارة كشك مخبز بقالة
    كتاب قلم دفتر كراسة مسطرة ممحاة براية حقيبة سبورة طباشير فصل درس امتحان واجب طالب مدير شهادة درجة جدول
    خريطة قاموس لوحة ألوان ورق مكتب حاسوب كمبيوتر شاشة طابعة رواية قصة مجلة جريدة رسالة ظرف طابع
    طبيب مهندس معلم محامي طيار بحار فلاح نجار حداد خباز طباخ سائق شرطي جندي رسام مصور ممثل مغني لاعب حارس
    ممرض صيدلي عامل تاجر كاتب صحفي مذيع ترزي حلاق سباك كهربائي مزارع صياد بواب
    قميص بنطلون فستان جاكيت معطف حذاء جورب قبعة طاقية كوفية وشاح حزام نظارة خاتم سوار قرط شنطة محفظة جيب زرار
    منديل بيجامة عباءة جلابية شبشب صندل بدلة كرافتة قفاز ثوب
    سيارة حافلة أتوبيس قطار طائرة سفينة مركب قارب دراجة تاكسي ترام مترو شاحنة عربة إسعاف جرار عجلة فرامل محرك
    بنزين طريق رحلة تذكرة جواز
    مطرقة مسمار منشار مفك كماشة مقص إبرة خيط حبل سلسلة ميزان شريط لاصق غراء بطارية شاحن سماعة هاتف موبايل
    كاميرا كشاف مظلة شبكة صنارة مجداف مرساة بوصلة خيمة فانوس سلة فأس مجرفة
    كرة هدف مرمى حكم مباراة بطولة كأس ميدالية سباحة ملاكمة شطرنج تنس دوري فريق مدرب جمهور صافرة ركلة شوط
    لعبة دمية بالون أرجوحة
    يوم ليلة صباح مساء أسبوع شهر عام قرن دقيقة ثانية شتاء صيف ربيع خريف عطلة إجازة حفلة هدية صورة لغز حلم
    فكرة كلمة جملة حرف رقم صوت لون شكل طعم رائحة ضوء نور سلام صديق جار أخت جدة عائلة طفل ولد بنت رجل امرأة
    شاب خال عمة خالة ابن حفيد ضيف علم بلد دولة عاصمة قارة حدود نقود فلوس عملة جنيه قرش كنز ذهب فضة لؤلؤ حديد
    نحاس خشب زجاج بلاستيك قطن صوف حرير
    أحمر أزرق أخضر أصفر أسود أبيض بني رمادي بنفسجي برتقالي وردي ذهبي فضي
    بحث عمل رسم سفر فرس حرب رقص درب برد دور
`));

export const EN_WORDS = Object.freeze(list(`
    apple banana orange grape lemon melon peach cherry mango olive bread butter cheese honey sugar pepper
    rice pasta pizza salad soup coffee juice water candy cookie table chair sofa window door house garden
    kitchen mirror carpet pillow blanket lamp clock phone camera laptop screen mouse keyboard pencil paper
    book school teacher student lesson letter number answer question story music guitar piano drum dance
    movie ticket train plane rocket boat ship truck bicycle river ocean island beach desert forest mountain
    valley cloud storm thunder rain snow winter summer spring autumn morning night evening sunset planet star
    moon earth stone silver gold metal glass cotton wool tiger lion zebra horse camel rabbit monkey eagle
    parrot turtle dolphin whale shark spider snake goat sheep chicken duck goose frog bridge tower
    castle market bank hotel museum library airport station street city village doctor farmer driver pilot
    police artist singer player coach team goal match winner heart smile friend family brother sister baby
    king queen dream idea color shape sound light shadow happy brave quick heavy listen silent study taste
    angle elbow words thing
`));

export const PHRASES = Object.freeze({
    ar: Object.freeze([
        'صباح الفل', 'يوم جميل', 'كوباية شاي', 'الجو حلو', 'مساء الخير', 'على طول', 'خلي بالك', 'يلا بينا',
        'قهوة سادة', 'بحر وسما', 'الشمس طالعة', 'نجمة في السما', 'أحلى صباح', 'شاي بلبن', 'عيش وملح',
        'قمر الليل الحلو', 'كل يوم أحسن', 'الدنيا ربيع والجو بديع', 'باب البيت مفتوح', 'الكورة في الملعب',
        'فنجان قهوة سخن', 'ورد في الجنينة', 'عصفور على الشجرة', 'قطة نايمة جنب', 'مطر خفيف النهارده',
    ]),
    en: Object.freeze([
        'good morning', 'nice day', 'hot coffee', 'blue sky', 'see you soon', 'well done', 'take care',
        'happy birthday', 'green garden', 'fast car', 'good night', 'open the door', 'time to play',
        'cold ice cream', 'big red apple', 'the sun is up', 'cats love fish', 'read a book', 'stay cool',
        'one more time', 'lucky green star', 'birds can fly', 'drink more water', 'keep it simple', 'game on',
    ]),
});

// Extra answers of `حروف` that are not in the lists above (each made of the same letters as its key).
export const ANAGRAMS = Object.freeze({
    'ملح': ['حلم'],
    'قمر': ['رقم'],
    'قصر': ['صقر', 'رقص'],
    'علم': ['عمل'],
    'ورد': ['دور'],
    'برد': ['درب'],
    'حرب': ['بحر'],
    'رسم': ['سمر'],
    'سفر': ['فرس'],
    'حجر': ['جحر'],
    'heart': ['earth'],
    'night': ['thing'],
    'lemon': ['melon'],
    'listen': ['silent', 'enlist', 'tinsel'],
    'study': ['dusty'],
    'taste': ['state'],
    'peach': ['cheap'],
    'angle': ['glean'],
    'elbow': ['below'],
    'words': ['sword'],
    'stone': ['notes', 'tones'],
});

/** The letters of a comparable word, sorted (spaces left out): the anagram key. */
export function letterKey(word) {
    return [...normalize(word).replace(/\s+/gu, '')].sort().join('');
}

const index = new Map();
function addToIndex(word) {
    const key = letterKey(word);
    const known = index.get(key) || [];
    if (!known.some((other) => normalize(other) === normalize(word))) known.push(word);
    index.set(key, known);
}
for (const word of [...AR_WORDS, ...EN_WORDS]) addToIndex(word);
for (const [word, others] of Object.entries(ANAGRAMS)) for (const other of [word, ...others]) addToIndex(other);

/** Every right answer of `حروف` for `word`: the word itself first, then every known word with the same letters. */
export function anagramsOf(word) {
    const same = (index.get(letterKey(word)) || []).filter((other) => normalize(other) !== normalize(word));
    return [word, ...same];
}
