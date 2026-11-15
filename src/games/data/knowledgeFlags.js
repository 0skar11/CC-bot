// knowledgeFlags.js — the countries of `اعلام` / `flags`: 'ISO 3166-1 alpha-2 code ; Arabic names ; English names'
// ('|' between accepted names, the first one is shown in the reveal). The flag emoji is built from the code (two
// regional indicator letters), so a flag can never point at the wrong country.
// Coverage: the UN member states plus the two observer states (Palestine, the Vatican), except Israel, left out on
// purpose so the game never turns into a political argument in the room (add a line here to bring it back).
// SIMILAR: flags that look the same as an emoji (Chad / Romania, Indonesia / Monaco); they stay in the data, the
// game never asks them.

import { split } from './knowledge.js';

const LINES = `
AF ; أفغانستان|افغانستان ; afghanistan
AL ; ألبانيا|البانيا ; albania
DZ ; الجزائر|جزائر ; algeria
AD ; أندورا|اندورا ; andorra
AO ; أنغولا|أنجولا|انجولا|انغولا ; angola
AG ; أنتيغوا وباربودا|انتيجوا وباربودا|أنتيغوا ; antigua and barbuda|antigua
AR ; الأرجنتين|الارجنتين ; argentina
AM ; أرمينيا|ارمينيا ; armenia
AU ; أستراليا|استراليا ; australia
AT ; النمسا ; austria
AZ ; أذربيجان|اذربيجان ; azerbaijan
BS ; جزر البهاما|البهاما|الباهاماس ; bahamas|the bahamas
BH ; البحرين ; bahrain
BD ; بنغلاديش|بنجلاديش|بنغلادش ; bangladesh
BB ; باربادوس ; barbados
BY ; بيلاروسيا|روسيا البيضاء ; belarus
BE ; بلجيكا ; belgium
BZ ; بليز ; belize
BJ ; بنين ; benin
BT ; بوتان ; bhutan
BO ; بوليفيا ; bolivia
BA ; البوسنة والهرسك|البوسنة ; bosnia and herzegovina|bosnia
BW ; بوتسوانا ; botswana
BR ; البرازيل ; brazil
BN ; بروناي ; brunei
BG ; بلغاريا ; bulgaria
BF ; بوركينا فاسو|بوركينافاسو ; burkina faso
BI ; بوروندي ; burundi
CV ; الرأس الأخضر|كاب فيردي|كابو فيردي ; cabo verde|cape verde
KH ; كمبوديا ; cambodia
CM ; الكاميرون ; cameroon
CA ; كندا ; canada
CF ; جمهورية أفريقيا الوسطى|أفريقيا الوسطى|افريقيا الوسطى ; central african republic|car
TD ; تشاد ; chad
CL ; تشيلي|شيلي ; chile
CN ; الصين ; china
CO ; كولومبيا ; colombia
KM ; جزر القمر ; comoros
CG ; الكونغو|جمهورية الكونغو|الكونغو برازافيل|الكونغو برازفيل ; congo|republic of the congo|congo-brazzaville|congo brazzaville
CD ; الكونغو الديمقراطية|جمهورية الكونغو الديمقراطية|الكونغو كينشاسا|الكونغو ; dr congo|drc|democratic republic of the congo|congo-kinshasa|congo
CR ; كوستاريكا|كوستا ريكا ; costa rica
CI ; ساحل العاج|كوت ديفوار ; ivory coast|cote d'ivoire|côte d'ivoire|cote divoire
HR ; كرواتيا ; croatia
CU ; كوبا ; cuba
CY ; قبرص ; cyprus
CZ ; التشيك|جمهورية التشيك|تشيكيا ; czechia|czech republic|czech
DK ; الدنمارك|الدنمرك ; denmark
DJ ; جيبوتي ; djibouti
DM ; دومينيكا ; dominica
DO ; جمهورية الدومينيكان|الدومينيكان ; dominican republic|dominican
EC ; الإكوادور|الاكوادور ; ecuador
EG ; مصر ; egypt
SV ; السلفادور ; el salvador|salvador
GQ ; غينيا الاستوائية|غينيا الإستوائية ; equatorial guinea
ER ; إريتريا|اريتريا ; eritrea
EE ; إستونيا|استونيا ; estonia
SZ ; إسواتيني|اسواتيني|سوازيلاند ; eswatini|swaziland
ET ; إثيوبيا|اثيوبيا ; ethiopia
FJ ; فيجي|فيدجي ; fiji
FI ; فنلندا ; finland
FR ; فرنسا ; france
GA ; الغابون|الجابون ; gabon
GM ; غامبيا|جامبيا ; gambia|the gambia
GE ; جورجيا ; georgia
DE ; ألمانيا|المانيا ; germany
GH ; غانا ; ghana
GR ; اليونان ; greece
GD ; غرينادا|جرينادا ; grenada
GT ; غواتيمالا|جواتيمالا ; guatemala
GN ; غينيا ; guinea
GW ; غينيا بيساو ; guinea-bissau|guinea bissau
GY ; غيانا|جيانا|غويانا ; guyana
HT ; هايتي ; haiti
HN ; هندوراس ; honduras
HU ; المجر|هنغاريا|هنجاريا ; hungary
IS ; آيسلندا|أيسلندا|ايسلندا ; iceland
IN ; الهند ; india
ID ; إندونيسيا|اندونيسيا ; indonesia
IR ; إيران|ايران ; iran
IQ ; العراق ; iraq
IE ; أيرلندا|ايرلندا|إيرلندا ; ireland
IT ; إيطاليا|ايطاليا ; italy
JM ; جامايكا ; jamaica
JP ; اليابان ; japan
JO ; الأردن|الاردن ; jordan
KZ ; كازاخستان ; kazakhstan
KE ; كينيا ; kenya
KI ; كيريباتي ; kiribati
KP ; كوريا الشمالية ; north korea
KR ; كوريا الجنوبية ; south korea
KW ; الكويت ; kuwait
KG ; قيرغيزستان|قرغيزستان ; kyrgyzstan
LA ; لاوس ; laos
LV ; لاتفيا ; latvia
LB ; لبنان ; lebanon
LS ; ليسوتو ; lesotho
LR ; ليبيريا ; liberia
LY ; ليبيا ; libya
LI ; ليختنشتاين|ليشتنشتاين ; liechtenstein
LT ; ليتوانيا ; lithuania
LU ; لوكسمبورغ|لوكسمبورج ; luxembourg
MG ; مدغشقر ; madagascar
MW ; مالاوي|ملاوي ; malawi
MY ; ماليزيا ; malaysia
MV ; جزر المالديف|المالديف ; maldives
ML ; مالي ; mali
MT ; مالطا ; malta
MH ; جزر مارشال ; marshall islands
MR ; موريتانيا ; mauritania
MU ; موريشيوس ; mauritius
MX ; المكسيك ; mexico
FM ; ميكرونيزيا ; micronesia
MD ; مولدوفا ; moldova
MC ; موناكو ; monaco
MN ; منغوليا|منجوليا ; mongolia
ME ; الجبل الأسود|مونتينيغرو|مونتنيجرو ; montenegro
MA ; المغرب ; morocco
MZ ; موزمبيق ; mozambique
MM ; ميانمار|بورما ; myanmar|burma
NA ; ناميبيا ; namibia
NR ; ناورو ; nauru
NP ; نيبال ; nepal
NL ; هولندا ; netherlands|holland|the netherlands
NZ ; نيوزيلندا ; new zealand
NI ; نيكاراغوا|نيكاراجوا ; nicaragua
NE ; النيجر ; niger
NG ; نيجيريا ; nigeria
MK ; مقدونيا الشمالية|مقدونيا ; north macedonia|macedonia
NO ; النرويج ; norway
OM ; عمان|سلطنة عمان ; oman
PK ; باكستان ; pakistan
PW ; بالاو ; palau
PA ; بنما ; panama
PG ; بابوا غينيا الجديدة ; papua new guinea
PY ; باراغواي|باراجواي ; paraguay
PE ; بيرو ; peru
PH ; الفلبين ; philippines|the philippines
PL ; بولندا ; poland
PT ; البرتغال ; portugal
QA ; قطر ; qatar
RO ; رومانيا ; romania
RU ; روسيا ; russia
RW ; رواندا ; rwanda
KN ; سانت كيتس ونيفيس ; saint kitts and nevis|st kitts and nevis
LC ; سانت لوسيا ; saint lucia|st lucia
VC ; سانت فينسنت والغرينادين|سانت فنسنت والغرينادين ; saint vincent and the grenadines|st vincent
WS ; ساموا ; samoa
SM ; سان مارينو ; san marino
ST ; ساو تومي وبرينسيب ; sao tome and principe|são tomé and príncipe
SA ; السعودية|المملكة العربية السعودية ; saudi arabia|saudi|ksa
SN ; السنغال ; senegal
RS ; صربيا ; serbia
SC ; سيشل|سيشيل ; seychelles
SL ; سيراليون ; sierra leone
SG ; سنغافورة ; singapore
SK ; سلوفاكيا ; slovakia
SI ; سلوفينيا ; slovenia
SB ; جزر سليمان ; solomon islands
SO ; الصومال ; somalia
ZA ; جنوب أفريقيا|جنوب افريقيا|جنوب إفريقيا ; south africa
SS ; جنوب السودان ; south sudan
ES ; إسبانيا|اسبانيا ; spain
LK ; سريلانكا|سري لانكا ; sri lanka
SD ; السودان ; sudan
SR ; سورينام ; suriname|surinam
SE ; السويد ; sweden
CH ; سويسرا ; switzerland
SY ; سوريا|سورية ; syria
TJ ; طاجيكستان ; tajikistan
TZ ; تنزانيا ; tanzania
TH ; تايلاند|تايلند ; thailand
TL ; تيمور الشرقية|تيمور ليشتي ; timor-leste|east timor
TG ; توغو|توجو ; togo
TO ; تونغا|تونجا ; tonga
TT ; ترينيداد وتوباغو|ترينيداد وتوباجو|ترينيداد ; trinidad and tobago|trinidad
TN ; تونس ; tunisia
TR ; تركيا ; turkey|turkiye|türkiye
TM ; تركمانستان ; turkmenistan
TV ; توفالو ; tuvalu
UG ; أوغندا|اوغندا|أوجندا ; uganda
UA ; أوكرانيا|اوكرانيا ; ukraine
AE ; الإمارات|الامارات|الإمارات العربية المتحدة ; uae|united arab emirates|emirates
GB ; بريطانيا|المملكة المتحدة|إنجلترا|انجلترا ; united kingdom|uk|great britain|britain|england
US ; أمريكا|امريكا|الولايات المتحدة|الولايات المتحدة الأمريكية ; united states|usa|us|america|united states of america
UY ; الأوروغواي|أوروغواي|الأوروجواي|أوروجواي ; uruguay
UZ ; أوزبكستان|اوزبكستان ; uzbekistan
VU ; فانواتو ; vanuatu
VE ; فنزويلا ; venezuela
VN ; فيتنام ; vietnam|viet nam
YE ; اليمن ; yemen
ZM ; زامبيا ; zambia
ZW ; زيمبابوي ; zimbabwe
PS ; فلسطين ; palestine
VA ; الفاتيكان ; vatican|vatican city|holy see
`;

/** Two flags that look the same as an emoji: the game never asks these. */
export const SIMILAR = new Set(['TD', 'RO', 'ID', 'MC']);
/** Names two countries share on purpose (`الكونغو` is said for both Congos). */
export const SHARED_NAMES = new Set(['الكونغو', 'congo']);

/** The flag emoji of an ISO 3166-1 alpha-2 code (two regional indicator symbols). */
export function flagEmoji(code) {
    return [...String(code).toUpperCase()].map((letter) => String.fromCodePoint(0x1F1E6 + letter.charCodeAt(0) - 65)).join('');
}

/** [{ code, flag, ar: [...], en: [...] }] */
export const COUNTRIES = Object.freeze(LINES.trim().split('\n').map((line) => {
    const [code, ar, en] = line.split(';').map((part) => part.trim());
    return Object.freeze({ code, flag: flagEmoji(code), ar: Object.freeze(split(ar)), en: Object.freeze(split(en)) });
}));

/** The countries the game asks (SIMILAR left out). */
export const FLAG_ROUNDS = Object.freeze(COUNTRIES.filter((country) => !SIMILAR.has(country.code)));
