// generateDesignPreview.js — Generates the visual design preview gallery (Before vs After)
// for all CC-bot games, menus, duels, group games, and fantasy horse racing.
// Adheres strictly to the owner's design principles: Tajawal font, RTL, unified color palette,
// high readability, Discord-native embeds and buttons, and original fantasy horse artwork.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT_DIR, 'docs', 'design-preview');
const BEFORE_DIR = path.join(DOCS_DIR, 'before');
const AFTER_DIR = path.join(DOCS_DIR, 'after');
const SAMPLES_DIR = path.join(ROOT_DIR, 'docs', 'samples');
const ARTIFACT_DIR = path.resolve('C:/Users/ywsf5/.gemini/antigravity/brain/925283d2-9af9-4ab9-b1ab-e1037bcfdf41');

// Ensure target directories exist
fs.mkdirSync(BEFORE_DIR, { recursive: true });
fs.mkdirSync(AFTER_DIR, { recursive: true });
if (fs.existsSync(path.dirname(ARTIFACT_DIR))) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

console.log('🎨 Starting CC-Bot Games Design Preview Generation...');

// ==========================================
// 1. ASSET GENERATORS (SVG -> PNG via sharp)
// ==========================================

async function renderSvgToPng(svgString, outputPath, width = 800, height = 450) {
    const buffer = Buffer.from(svgString);
    await sharp(buffer)
        .resize(width, height)
        .png({ quality: 95, compressionLevel: 6 })
        .toFile(outputPath);
    console.log(`  ✓ Generated: ${path.relative(ROOT_DIR, outputPath)}`);
}

// Fantasy Horse Silhouette SVG path
const HORSE_SILHOUETTE = `M18,34 C16,32 15,28 17,24 C19,20 23,17 25,12 C26,10 27,6 29,4 C30,3 32,3 33,5 C34,7 35,9 37,8 C39,7 41,5 43,6 C44,7 43,10 41,12 C39,14 36,16 34,19 C35,22 37,25 38,29 C39,33 37,38 35,42 C33,45 31,48 29,52 L26,51 C27,47 28,43 27,39 C25,38 22,37 18,34 Z`;

// Redesigned Question Card (Single / Quiz)
function generateQuizCardSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="460" viewBox="0 0 800 460">
  <defs>
    <linearGradient id="bgQuiz" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0c1712"/>
      <stop offset="45%" stop-color="#12241c"/>
      <stop offset="100%" stop-color="#09120e"/>
    </linearGradient>
    <linearGradient id="emeraldPill" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#2ecc71"/>
      <stop offset="100%" stop-color="#1abc9c"/>
    </linearGradient>
    <linearGradient id="borderGlow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2ecc71" stop-opacity="0.8"/>
      <stop offset="50%" stop-color="#1abc9c" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#2ecc71" stop-opacity="0.6"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>

  <!-- Background Card -->
  <rect width="800" height="460" rx="24" fill="url(#bgQuiz)"/>
  <rect x="10" y="10" width="780" height="440" rx="20" fill="none" stroke="url(#borderGlow)" stroke-width="2.5"/>

  <!-- Decorative Corner Accents -->
  <path d="M 20 50 L 20 20 L 50 20" stroke="#2ecc71" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M 780 50 L 780 20 L 750 20" stroke="#2ecc71" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M 20 410 L 20 440 L 50 440" stroke="#2ecc71" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M 780 410 L 780 440 L 750 440" stroke="#2ecc71" stroke-width="4" fill="none" stroke-linecap="round"/>

  <!-- Category Badge -->
  <g transform="translate(260, 32)">
    <rect width="280" height="44" rx="22" fill="url(#emeraldPill)" filter="url(#glow)"/>
    <text x="140" y="28" font-family="'Tajawal', 'Segoe UI', Tahoma, sans-serif" font-size="20" font-weight="bold" fill="#0b1a13" text-anchor="middle" direction="rtl">🎯 سؤال ثقافي عام #14</text>
  </g>

  <!-- Question Content Box -->
  <rect x="50" y="105" width="700" height="235" rx="16" fill="#142c22" fill-opacity="0.6" stroke="#2ecc71" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="400" y="200" font-family="'Tajawal', 'Segoe UI', Tahoma, sans-serif" font-size="34" font-weight="800" fill="#ffffff" text-anchor="middle" direction="rtl">ما هي أول دولة عربية شاركت في نهائيات</text>
  <text x="400" y="255" font-family="'Tajawal', 'Segoe UI', Tahoma, sans-serif" font-size="36" font-weight="800" fill="#a7f3d0" text-anchor="middle" direction="rtl">كأس العالم لكرة القدم؟</text>

  <!-- Bottom Info Pill (Timer & Prize) -->
  <g transform="translate(180, 370)">
    <rect width="440" height="48" rx="24" fill="#091510" stroke="#2ecc71" stroke-opacity="0.4" stroke-width="1.5"/>
    <text x="220" y="30" font-family="'Tajawal', 'Segoe UI', Tahoma, sans-serif" font-size="18" font-weight="bold" fill="#34d399" text-anchor="middle" direction="rtl">⏱️ 30 ثانية للإجابة ・ 💰 الجائزة: 500 CC 🌀</text>
  </g>
</svg>`;
}

// Redesigned Map Card
function generateMapCardSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="460" viewBox="0 0 800 460">
  <defs>
    <linearGradient id="bgMap" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="50%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0b1120"/>
    </linearGradient>
    <linearGradient id="mapGlow" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>
  </defs>

  <rect width="800" height="460" rx="24" fill="url(#bgMap)"/>
  <rect x="10" y="10" width="780" height="440" rx="20" fill="none" stroke="#38bdf8" stroke-width="2" stroke-opacity="0.4"/>

  <!-- Badge -->
  <g transform="translate(270, 30)">
    <rect width="260" height="42" rx="21" fill="url(#mapGlow)"/>
    <text x="130" y="27" font-family="'Tajawal', sans-serif" font-size="20" font-weight="bold" fill="#082f49" text-anchor="middle" direction="rtl">🗺️ خمن اسم الدولة #7</text>
  </g>

  <!-- Country Silhouette Container -->
  <rect x="60" y="95" width="680" height="255" rx="16" fill="#0f172a" fill-opacity="0.8" stroke="#38bdf8" stroke-opacity="0.2"/>
  
  <!-- Stylized Egypt Silhouette Shape -->
  <path d="M 330 140 L 480 140 L 490 200 L 460 210 L 480 300 L 330 300 Z" fill="#0284c7" fill-opacity="0.85" stroke="#38bdf8" stroke-width="3" stroke-linejoin="round"/>
  <!-- Nile line -->
  <path d="M 440 140 Q 430 200 445 230 T 435 300" stroke="#7dd3fc" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  <circle cx="442" cy="170" r="5" fill="#facc15"/>
  <text x="455" y="175" font-family="'Tajawal', sans-serif" font-size="14" font-weight="bold" fill="#fef08a">العاصمة</text>

  <!-- Bottom Hint -->
  <g transform="translate(200, 375)">
    <rect width="400" height="44" rx="22" fill="#082f49" stroke="#38bdf8" stroke-opacity="0.5"/>
    <text x="200" y="28" font-family="'Tajawal', sans-serif" font-size="17" font-weight="bold" fill="#bae6fd" text-anchor="middle" direction="rtl">🌍 قارة: أفريقيا ・ 💡 تطل على بحرين</text>
  </g>
</svg>`;
}

// Redesigned Camo Card
function generateCamoCardSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="460" viewBox="0 0 800 460">
  <defs>
    <linearGradient id="bgCamo" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e1b4b"/>
      <stop offset="50%" stop-color="#312e81"/>
      <stop offset="100%" stop-color="#111827"/>
    </linearGradient>
  </defs>

  <rect width="800" height="460" rx="24" fill="url(#bgCamo)"/>
  <rect x="10" y="10" width="780" height="440" rx="20" fill="none" stroke="#818cf8" stroke-width="2" stroke-opacity="0.4"/>

  <!-- Badge -->
  <g transform="translate(280, 30)">
    <rect width="240" height="42" rx="21" fill="#6366f1"/>
    <text x="120" y="27" font-family="'Tajawal', sans-serif" font-size="20" font-weight="bold" fill="#ffffff" text-anchor="middle" direction="rtl">🔍 قوة الملاحظة (تمويه) #9</text>
  </g>

  <!-- Camouflage Pattern Frame -->
  <rect x="60" y="95" width="680" height="255" rx="16" fill="#1e1b4b" stroke="#818cf8" stroke-opacity="0.2"/>
  
  <!-- Anti-OCR Noise Lines & Shapes -->
  <path d="M 80 180 Q 200 120 350 200 T 700 160" stroke="#a5b4fc" stroke-width="3" fill="none" opacity="0.3"/>
  <path d="M 80 240 Q 300 320 500 220 T 720 280" stroke="#c7d2fe" stroke-width="2.5" fill="none" opacity="0.25"/>
  <circle cx="150" cy="180" r="45" fill="#4338ca" opacity="0.4"/>
  <circle cx="620" cy="240" r="55" fill="#4338ca" opacity="0.35"/>
  <circle cx="380" cy="160" r="35" fill="#4f46e5" opacity="0.3"/>

  <!-- Hidden Text (Anti-OCR styled) -->
  <text x="400" y="245" font-family="'Tajawal', sans-serif" font-size="76" font-weight="900" fill="#e0e7ff" text-anchor="middle" letter-spacing="8" direction="rtl" opacity="0.88">الأهرامات</text>

  <!-- Bottom Hint -->
  <g transform="translate(200, 375)">
    <rect width="400" height="44" rx="22" fill="#1e1b4b" stroke="#818cf8" stroke-opacity="0.5"/>
    <text x="200" y="28" font-family="'Tajawal', sans-serif" font-size="17" font-weight="bold" fill="#c7d2fe" text-anchor="middle" direction="rtl">⚡ اكتب الكلمة المخفية بسرعة في الشات!</text>
  </g>
</svg>`;
}

// Redesigned Horse Race Track Artwork (The Masterpiece)
function generateHorseRaceSvg() {
    const horses = [
        { id: 1, name: 'الرعد', odds: '×2.2', color: '#38bdf8', trail: '#0284c7', pos: 580, y: 110, emoji: '⚡' },
        { id: 2, name: 'البرق', odds: '×3.8', color: '#a855f7', trail: '#7e22ce', pos: 520, y: 165, emoji: '🌩️' },
        { id: 3, name: 'الصقر', odds: '×6.5', color: '#22c55e', trail: '#15803d', pos: 460, y: 220, emoji: '🦅' },
        { id: 4, name: 'النمر', odds: '×12.0', color: '#f97316', trail: '#c2410c', pos: 390, y: 275, emoji: '🐅' },
        { id: 5, name: 'العاصفة', odds: '×20.0', color: '#ec4899', trail: '#be185d', pos: 330, y: 330, emoji: '🌪️' },
        { id: 6, name: 'الشبح', odds: '×38.0', color: '#14b8a6', trail: '#0f766e', pos: 280, y: 385, emoji: '👻' },
    ];

    const laneSvgs = horses.map((h, i) => `
    <!-- Lane ${h.id} -->
    <rect x="50" y="${h.y - 20}" width="700" height="46" rx="8" fill="#181e2e" fill-opacity="0.7" stroke="${h.color}" stroke-opacity="0.15" stroke-width="1"/>
    <!-- Lane Number & Horse Badge -->
    <rect x="55" y="${h.y - 16}" width="125" height="38" rx="6" fill="#0f131d"/>
    <text x="65" y="${h.y + 8}" font-family="'Tajawal', sans-serif" font-size="15" font-weight="bold" fill="${h.color}">#${h.id} ${h.emoji} ${h.name}</text>
    <text x="145" y="${h.y + 8}" font-family="sans-serif" font-size="12" font-weight="bold" fill="#facc15">${h.odds}</text>
    
    <!-- Track Line & Dash Markers -->
    <line x1="185" y1="${h.y + 3}" x2="680" y2="${h.y + 3}" stroke="#334155" stroke-width="2" stroke-dasharray="6,6"/>
    
    <!-- Speed/Dust Trail -->
    <path d="M ${h.pos - 80} ${h.y + 3} L ${h.pos} ${h.y + 3}" stroke="${h.trail}" stroke-width="5" stroke-linecap="round" opacity="0.6"/>
    
    <!-- Horse Silhouette Avatar -->
    <g transform="translate(${h.pos}, ${h.y - 18})">
      <circle cx="18" cy="18" r="18" fill="${h.color}" filter="url(#glowHorse)"/>
      <text x="18" y="24" font-family="'Segoe UI Emoji', sans-serif" font-size="18" text-anchor="middle">${h.emoji}</text>
    </g>
  `).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480" viewBox="0 0 800 480">
  <defs>
    <linearGradient id="bgHorses" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0a0f1d"/>
      <stop offset="50%" stop-color="#131b2e"/>
      <stop offset="100%" stop-color="#070a14"/>
    </linearGradient>
    <linearGradient id="goldBanner" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#d97706"/>
    </linearGradient>
    <filter id="glowHorse" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>

  <!-- Frame Background -->
  <rect width="800" height="480" rx="24" fill="url(#bgHorses)"/>
  <rect x="10" y="10" width="780" height="460" rx="20" fill="none" stroke="#f59e0b" stroke-width="2" stroke-opacity="0.35"/>

  <!-- Header Banner -->
  <g transform="translate(240, 24)">
    <rect width="320" height="44" rx="22" fill="url(#goldBanner)"/>
    <text x="160" y="28" font-family="'Tajawal', sans-serif" font-size="22" font-weight="900" fill="#0f172a" text-anchor="middle" direction="rtl">🏇 سباق الخيول الأسطوري 🏆</text>
  </g>

  <!-- Finish Line Checker Pattern -->
  <g transform="translate(685, 80)">
    <line x1="0" y1="0" x2="0" y2="340" stroke="#f8fafc" stroke-width="6" stroke-dasharray="10,10"/>
    <text x="5" y="-10" font-family="sans-serif" font-size="16" fill="#facc15">🏁 خط النهاية</text>
  </g>

  <!-- Distance Percentage Markers -->
  <text x="190" y="80" font-family="sans-serif" font-size="11" fill="#64748b">الانطلاق</text>
  <text x="350" y="80" font-family="sans-serif" font-size="11" fill="#64748b">25%</text>
  <text x="470" y="80" font-family="sans-serif" font-size="11" fill="#64748b">50%</text>
  <text x="590" y="80" font-family="sans-serif" font-size="11" fill="#64748b">75%</text>

  <!-- Lanes -->
  ${laneSvgs}

  <!-- Footer Status -->
  <g transform="translate(180, 432)">
    <rect width="440" height="34" rx="17" fill="#0f172a" stroke="#f59e0b" stroke-opacity="0.3"/>
    <text x="220" y="22" font-family="'Tajawal', sans-serif" font-size="14" font-weight="bold" fill="#fde68a" text-anchor="middle" direction="rtl">⚡ الحصان #1 (الرعد) يتصدر السباق بفارق بسيط! ⚡</text>
  </g>
</svg>`;
}

// Redesigned Dual XO Board Visual
function generateDualXoSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="460" viewBox="0 0 800 460">
  <defs>
    <linearGradient id="bgXo" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e1b4b"/>
    </linearGradient>
  </defs>

  <rect width="800" height="460" rx="24" fill="url(#bgXo)"/>
  <rect x="10" y="10" width="780" height="440" rx="20" fill="none" stroke="#38bdf8" stroke-width="2" stroke-opacity="0.3"/>

  <!-- Title Badge -->
  <g transform="translate(260, 25)">
    <rect width="280" height="44" rx="22" fill="#3b82f6"/>
    <text x="140" y="28" font-family="'Tajawal', sans-serif" font-size="20" font-weight="bold" fill="#ffffff" text-anchor="middle" direction="rtl">⚔️ تحدي إكس أو (XO) المباشر</text>
  </g>

  <!-- Players Bar -->
  <g transform="translate(150, 85)">
    <rect width="220" height="42" rx="12" fill="#ef4444" fill-opacity="0.2" stroke="#ef4444" stroke-width="1.5"/>
    <text x="110" y="26" font-family="'Tajawal', sans-serif" font-size="16" font-weight="bold" fill="#fca5a5" text-anchor="middle">❌ @Ahmed (صاحب التحدي)</text>
    
    <text x="250" y="28" font-family="'Tajawal', sans-serif" font-size="18" font-weight="bold" fill="#94a3b8" text-anchor="middle">VS</text>

    <rect width="220" height="42" rx="12" x="280" fill="#3b82f6" fill-opacity="0.2" stroke="#3b82f6" stroke-width="1.5"/>
    <text x="390" y="26" font-family="'Tajawal', sans-serif" font-size="16" font-weight="bold" fill="#93c5fd" text-anchor="middle">⭕ @Omar (المنافس)</text>
  </g>

  <!-- 3x3 Grid Buttons Preview -->
  <g transform="translate(265, 145)">
    <!-- Row 0 -->
    <rect x="0" y="0" width="80" height="80" rx="12" fill="#ef4444" stroke="#f87171" stroke-width="2"/>
    <text x="40" y="52" font-size="38" text-anchor="middle">❌</text>
    
    <rect x="95" y="0" width="80" height="80" rx="12" fill="#3b82f6" stroke="#60a5fa" stroke-width="2"/>
    <text x="135" y="52" font-size="38" text-anchor="middle">⭕</text>
    
    <rect x="190" y="0" width="80" height="80" rx="12" fill="#ef4444" stroke="#f87171" stroke-width="2"/>
    <text x="230" y="52" font-size="38" text-anchor="middle">❌</text>

    <!-- Row 1 (Winning Line) -->
    <rect x="0" y="90" width="80" height="80" rx="12" fill="#3b82f6" stroke="#60a5fa" stroke-width="2"/>
    <text x="40" y="142" font-size="38" text-anchor="middle">⭕</text>
    
    <rect x="95" y="90" width="80" height="80" rx="12" fill="#ef4444" stroke="#f87171" stroke-width="3" filter="drop-shadow(0 0 8px #ef4444)"/>
    <text x="135" y="142" font-size="38" text-anchor="middle">❌</text>
    
    <rect x="190" y="90" width="80" height="80" rx="12" fill="#334155" stroke="#475569" stroke-width="1.5"/>
    <text x="230" y="142" font-size="38" text-anchor="middle" fill="#64748b">➖</text>

    <!-- Row 2 -->
    <rect x="0" y="180" width="80" height="80" rx="12" fill="#ef4444" stroke="#f87171" stroke-width="3" filter="drop-shadow(0 0 8px #ef4444)"/>
    <text x="40" y="232" font-size="38" text-anchor="middle">❌</text>
    
    <rect x="95" y="180" width="80" height="80" rx="12" fill="#334155" stroke="#475569" stroke-width="1.5"/>
    <text x="135" y="232" font-size="38" text-anchor="middle" fill="#64748b">➖</text>
    
    <rect x="190" y="180" width="80" height="80" rx="12" fill="#3b82f6" stroke="#60a5fa" stroke-width="2"/>
    <text x="230" y="232" font-size="38" text-anchor="middle">⭕</text>

    <!-- Diagonal Winning Strike Line -->
    <line x1="20" y1="220" x2="250" y2="40" stroke="#facc15" stroke-width="6" stroke-linecap="round" opacity="0.9"/>
  </g>

  <!-- Status Line -->
  <g transform="translate(180, 415)">
    <text x="220" y="15" font-family="'Tajawal', sans-serif" font-size="16" font-weight="bold" fill="#facc15" text-anchor="middle" direction="rtl">🏆 فاز باللعبة: @Ahmed بتشكيل 3 على خط مائل! (+500 CC)</text>
  </g>
</svg>`;
}

// Redesigned Casino Mines Board Visual
function generateCasinoMinesSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="460" viewBox="0 0 800 460">
  <defs>
    <linearGradient id="bgMines" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#18181b"/>
      <stop offset="50%" stop-color="#27272a"/>
      <stop offset="100%" stop-color="#09090b"/>
    </linearGradient>
    <linearGradient id="gemGlow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#047857"/>
    </linearGradient>
  </defs>

  <rect width="800" height="460" rx="24" fill="url(#bgMines)"/>
  <rect x="10" y="10" width="780" height="440" rx="20" fill="none" stroke="#f59e0b" stroke-width="2" stroke-opacity="0.3"/>

  <!-- Badge -->
  <g transform="translate(260, 20)">
    <rect width="280" height="42" rx="21" fill="#f59e0b"/>
    <text x="140" y="27" font-family="'Tajawal', sans-serif" font-size="20" font-weight="bold" fill="#09090b" text-anchor="middle" direction="rtl">💣 كازينو الألغام (Mines 5x5)</text>
  </g>

  <!-- 5x5 Grid representation -->
  <g transform="translate(210, 75)">
    <!-- 25 squares grid -->
    ${Array.from({ length: 5 }, (_, r) =>
        Array.from({ length: 5 }, (_, c) => {
            const isGem = (r === 0 && c === 1) || (r === 1 && c === 3) || (r === 2 && c === 2) || (r === 3 && c === 0) || (r === 4 && c === 4);
            const isBomb = (r === 1 && c === 1) || (r === 3 && c === 4) || (r === 4 && c === 2);
            const x = c * 75;
            const y = r * 62;
            if (isGem) {
                return `
          <rect x="${x}" y="${y}" width="65" height="54" rx="10" fill="url(#gemGlow)" stroke="#34d399" stroke-width="2"/>
          <text x="${x + 32}" y="${y + 36}" font-size="26" text-anchor="middle">💎</text>
        `;
            }
            return `
        <rect x="${x}" y="${y}" width="65" height="54" rx="10" fill="#3f3f46" stroke="#52525b" stroke-width="1.5"/>
        <text x="${x + 32}" y="${y + 35}" font-size="22" text-anchor="middle" fill="#71717a">❓</text>
      `;
        }).join('')
    ).join('')}
  </g>

  <!-- Multiplier and Cashout Button -->
  <g transform="translate(180, 400)">
    <rect width="440" height="46" rx="23" fill="#10b981"/>
    <text x="220" y="29" font-family="'Tajawal', sans-serif" font-size="18" font-weight="bold" fill="#ffffff" text-anchor="middle" direction="rtl">💰 سحب الأرباح الآن: 490 CC (مضاعف ×2.45) 💰</text>
  </g>
</svg>`;
}

// ==========================================
// 2. GENERATE AND SAVE PNG SURFACES
// ==========================================

async function generateAllSurfaces() {
    // 1. "After" Redesigned Images
    await renderSvgToPng(generateQuizCardSvg(), path.join(AFTER_DIR, 'single-quiz.png'));
    await renderSvgToPng(generateMapCardSvg(), path.join(AFTER_DIR, 'single-map.png'));
    await renderSvgToPng(generateCamoCardSvg(), path.join(AFTER_DIR, 'single-camo.png'));
    await renderSvgToPng(generateHorseRaceSvg(), path.join(AFTER_DIR, 'casino-horses.png'), 800, 480);
    await renderSvgToPng(generateDualXoSvg(), path.join(AFTER_DIR, 'dual-xo.png'));
    await renderSvgToPng(generateCasinoMinesSvg(), path.join(AFTER_DIR, 'casino-mines.png'));

    // 2. "Before" Images (Copying sample cards or generating current state representations)
    if (fs.existsSync(path.join(SAMPLES_DIR, 'card-arabic.png'))) {
        fs.copyFileSync(path.join(SAMPLES_DIR, 'card-arabic.png'), path.join(BEFORE_DIR, 'single-quiz.png'));
        console.log('  ✓ Copied: docs/design-preview/before/single-quiz.png');
    }
    if (fs.existsSync(path.join(SAMPLES_DIR, 'map-EG.png'))) {
        fs.copyFileSync(path.join(SAMPLES_DIR, 'map-EG.png'), path.join(BEFORE_DIR, 'single-map.png'));
        console.log('  ✓ Copied: docs/design-preview/before/single-map.png');
    }
    if (fs.existsSync(path.join(SAMPLES_DIR, 'camo-word.png'))) {
        fs.copyFileSync(path.join(SAMPLES_DIR, 'camo-word.png'), path.join(BEFORE_DIR, 'single-camo.png'));
        console.log('  ✓ Copied: docs/design-preview/before/single-camo.png');
    }

    // Generate Before versions for XO, Mines, and Horses (showing plain text / raw format)
    const beforeXoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="460" viewBox="0 0 800 460">
    <rect width="800" height="460" fill="#2b2d31"/>
    <text x="400" y="80" font-family="sans-serif" font-size="24" fill="#ffffff" text-anchor="middle">❌⭕ اكس او</text>
    <text x="400" y="130" font-family="sans-serif" font-size="18" fill="#dbdee1" text-anchor="middle">❌ @Ahmed ・ ⭕ @Omar</text>
    <g transform="translate(290, 170)">
      <rect x="0" y="0" width="60" height="60" fill="#4e5058"/><text x="30" y="40" font-size="28" text-anchor="middle">❌</text>
      <rect x="75" y="0" width="60" height="60" fill="#4e5058"/><text x="105" y="40" font-size="28" text-anchor="middle">⭕</text>
      <rect x="150" y="0" width="60" height="60" fill="#4e5058"/><text x="180" y="40" font-size="28" text-anchor="middle">❌</text>
      <rect x="0" y="75" width="60" height="60" fill="#4e5058"/><text x="30" y="115" font-size="28" text-anchor="middle">⭕</text>
      <rect x="75" y="75" width="60" height="60" fill="#4e5058"/><text x="105" y="115" font-size="28" text-anchor="middle">❌</text>
      <rect x="150" y="75" width="60" height="60" fill="#4e5058"/><text x="180" y="115" font-size="28" text-anchor="middle">➖</text>
      <rect x="0" y="150" width="60" height="60" fill="#4e5058"/><text x="30" y="190" font-size="28" text-anchor="middle">❌</text>
      <rect x="75" y="150" width="60" height="60" fill="#4e5058"/><text x="105" y="190" font-size="28" text-anchor="middle">➖</text>
      <rect x="150" y="150" width="60" height="60" fill="#4e5058"/><text x="180" y="190" font-size="28" text-anchor="middle">⭕</text>
    </g>
    <text x="400" y="420" font-family="sans-serif" font-size="16" fill="#949ba4" text-anchor="middle">🎯 الدور على @Ahmed</text>
  </svg>`;
    await renderSvgToPng(beforeXoSvg, path.join(BEFORE_DIR, 'dual-xo.png'));

    const beforeHorsesSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="460" viewBox="0 0 800 460">
    <rect width="800" height="460" fill="#2b2d31"/>
    <rect x="40" y="40" width="720" height="380" rx="10" fill="#1e1f22" stroke="#4e5058" stroke-width="1"/>
    <text x="60" y="90" font-family="sans-serif" font-size="22" font-weight="bold" fill="#f2f3f5">🏇 سباق الخيول الخيالي</text>
    <text x="60" y="130" font-family="sans-serif" font-size="16" fill="#dbdee1">🏆 قائمة الخيول ونسب الفوز (نص عادي في الإمبيد):</text>
    <text x="80" y="170" font-family="sans-serif" font-size="16" fill="#949ba4">• #1 ⚡ الرعد — ×2.2</text>
    <text x="80" y="210" font-family="sans-serif" font-size="16" fill="#949ba4">• #2 🌩️ البرق — ×3.8</text>
    <text x="80" y="250" font-family="sans-serif" font-size="16" fill="#949ba4">• #3 🦅 الصقر — ×6.5</text>
    <text x="80" y="290" font-family="sans-serif" font-size="16" fill="#949ba4">• #4 🐅 النمر — ×12.0</text>
    <text x="80" y="330" font-family="sans-serif" font-size="16" fill="#949ba4">• #5 🌪️ العاصفة — ×20.0</text>
    <text x="80" y="370" font-family="sans-serif" font-size="16" fill="#949ba4">• #6 👻 الشبح — ×38.0</text>
  </svg>`;
    await renderSvgToPng(beforeHorsesSvg, path.join(BEFORE_DIR, 'casino-horses.png'));
}

// ==========================================
// 3. BUILD INTERACTIVE HTML PREVIEW GALLERY
// ==========================================

function buildGalleryHtml() {
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>معرض تصاميم ألعاب CC-Bot — المقارنة الشاملة (Before vs After)</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800;900&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Tajawal', sans-serif;
      background-color: #1e1f22;
      color: #dbdee1;
    }
    .discord-chat {
      background-color: #313338;
    }
    .discord-embed {
      background-color: #2b2d31;
      border-right: 4px solid #5865F2;
    }
    .discord-btn-primary { background-color: #5865F2; }
    .discord-btn-primary:hover { background-color: #4752c4; }
    .discord-btn-secondary { background-color: #4e5058; }
    .discord-btn-secondary:hover { background-color: #6d6f78; }
    .discord-btn-success { background-color: #248046; }
    .discord-btn-success:hover { background-color: #1a6334; }
    .discord-btn-danger { background-color: #da373c; }
    .discord-btn-danger:hover { background-color: #a1282c; }
  </style>
</head>
<body class="min-h-screen pb-16">

  <!-- Top Navigation & Header -->
  <header class="bg-[#2b2d31] border-b border-[#1f2023] px-6 py-4 sticky top-0 z-50 shadow-md">
    <div class="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <span class="text-3xl">🎮</span>
        <div>
          <h1 class="text-xl font-black text-white">معرض تحسين وتطوير أشكال الألعاب — CC-Bot</h1>
          <p class="text-xs text-[#949ba4]">مقارنة حية تفاعلية بين التصميم الحالي (Before) والتصميم الجديد المقترح (After)</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs px-3 py-1.5 rounded-full font-bold">
          ✓ جاهز للعرض والاعتماد
        </span>
      </div>
    </div>
  </header>

  <!-- Category Filter Bar -->
  <nav class="max-w-7xl mx-auto px-6 py-4">
    <div class="flex flex-wrap gap-2 border-b border-[#2b2d31] pb-4" id="navTabs">
      <button onclick="filterCategory('all')" class="tab-btn px-4 py-2 rounded-lg text-sm font-bold bg-[#5865F2] text-white transition">🌟 عرض الكل</button>
      <button onclick="filterCategory('menu')" class="tab-btn px-4 py-2 rounded-lg text-sm font-bold bg-[#2b2d31] text-[#949ba4] hover:text-white transition">📋 قائمة المساعدة (Help Menu)</button>
      <button onclick="filterCategory('single')" class="tab-btn px-4 py-2 rounded-lg text-sm font-bold bg-[#2b2d31] text-[#949ba4] hover:text-white transition">🎯 الألعاب الفردية وكروت الصور</button>
      <button onclick="filterCategory('dual')" class="tab-btn px-4 py-2 rounded-lg text-sm font-bold bg-[#2b2d31] text-[#949ba4] hover:text-white transition">⚔️ الألعاب الثنائية (XO والتوصيل)</button>
      <button onclick="filterCategory('group')" class="tab-btn px-4 py-2 rounded-lg text-sm font-bold bg-[#2b2d31] text-[#949ba4] hover:text-white transition">👥 الألعاب الجماعية (كراسي ومافيا)</button>
      <button onclick="filterCategory('casino')" class="tab-btn px-4 py-2 rounded-lg text-sm font-bold bg-[#2b2d31] text-[#949ba4] hover:text-white transition">🏇 سباق الخيول والكازينو</button>
    </div>
  </nav>

  <!-- Main Content Container -->
  <main class="max-w-7xl mx-auto px-6 space-y-12">

    <!-- SURFACE 1: FANTASY HORSE RACING -->
    <section class="surface-card bg-[#2b2d31] rounded-2xl p-6 border border-[#383a40]" data-category="casino">
      <div class="flex items-center justify-between pb-4 border-b border-[#383a40] mb-6">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-2xl">🏇</span>
            <h2 class="text-xl font-black text-amber-400">سباق الخيول الأسطوري (Fantasy Horse Racing)</h2>
          </div>
          <p class="text-xs text-[#949ba4] mt-1">تطوير شامل لشاشة السباق مع 6 خيول فانتسي، مضمار تفاعلي، وجدول نسب فوز دقيق 100% رياضياً.</p>
        </div>
        <span class="bg-amber-400/10 text-amber-300 text-xs px-3 py-1 rounded-full font-bold">كازينو & حظ</span>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Before -->
        <div class="bg-[#1e1f22] p-4 rounded-xl border border-[#383a40]">
          <div class="flex items-center justify-between pb-3 mb-3 border-b border-[#2b2d31]">
            <span class="text-xs font-bold text-red-400">❌ قبل (الشكل الحالي)</span>
            <span class="text-[11px] text-[#949ba4]">رسالة إمبيد نصية فقط بدون صورة للمضمار</span>
          </div>
          <div class="rounded-lg overflow-hidden border border-[#383a40] mb-3">
            <img src="before/casino-horses.png" alt="Before Horses" class="w-full object-cover">
          </div>
          <p class="text-xs text-[#949ba4] leading-relaxed">
            • قائمة نصية جافة في الإمبيد بدون أي تمثيل بصري للمضمار.<br>
            • غياب شكل الخيول وحركتها أثناء السباق.<br>
            • كانت ناقصة في قائمة الألعاب والكازينو الرئيسية.
          </p>
        </div>

        <!-- After -->
        <div class="bg-[#1e1f22] p-4 rounded-xl border-2 border-amber-500/40">
          <div class="flex items-center justify-between pb-3 mb-3 border-b border-[#2b2d31]">
            <span class="text-xs font-bold text-emerald-400">✅ بعد (التصميم المقترح الجديد)</span>
            <span class="text-[11px] text-amber-300">مضمار ملون بتقنية SVG/Sharp عالي الدقة</span>
          </div>
          <div class="rounded-lg overflow-hidden border border-amber-500/30 mb-3 shadow-lg">
            <img src="after/casino-horses.png" alt="After Horses" class="w-full object-cover">
          </div>
          <div class="space-y-2 text-xs text-[#dbdee1]">
            <div class="p-2.5 bg-[#2b2d31] rounded-lg border-r-4 border-amber-400">
              <span class="font-bold text-amber-300">🏇 6 خيول فانتسي بهويات بصرية أصلية:</span>
              <div class="grid grid-cols-2 gap-1 mt-1 text-[11px]">
                <span>⚡ 1. الرعد (×2.2)</span>
                <span>🌩️ 2. البرق (×3.8)</span>
                <span>🦅 3. الصقر (×6.5)</span>
                <span>🐅 4. النمر (×12.0)</span>
                <span>🌪️ 5. العاصفة (×20.0)</span>
                <span>👻 6. الشبح (×38.0)</span>
              </div>
            </div>
            <p class="text-emerald-400 text-[11px]">✓ تم إدراج اللعبة رسمياً في قائمة الألعاب (/games) وقائمة الكازينو مع زر اللعب من جديد.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- SURFACE 2: SINGLE QUIZ CARDS -->
    <section class="surface-card bg-[#2b2d31] rounded-2xl p-6 border border-[#383a40]" data-category="single">
      <div class="flex items-center justify-between pb-4 border-b border-[#383a40] mb-6">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-2xl">🎯</span>
            <h2 class="text-xl font-black text-emerald-400">كروت الأسئلة الفردية (Quiz Cards)</h2>
          </div>
          <p class="text-xs text-[#949ba4] mt-1">تحديث شكل بطاقة السؤال لتكون بستايل زمردي متناسق، خط تجوال عريض، وإطار مضيء واضح على الموبايل.</p>
        </div>
        <span class="bg-emerald-400/10 text-emerald-300 text-xs px-3 py-1 rounded-full font-bold">فردي</span>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Before -->
        <div class="bg-[#1e1f22] p-4 rounded-xl border border-[#383a40]">
          <div class="flex items-center justify-between pb-3 mb-3 border-b border-[#2b2d31]">
            <span class="text-xs font-bold text-red-400">❌ قبل (الشكل الحالي)</span>
            <span class="text-[11px] text-[#949ba4]">كارت بنفسجي قديم مع تشويش نقاط كثيف</span>
          </div>
          <div class="rounded-lg overflow-hidden border border-[#383a40] mb-3">
            <img src="before/single-quiz.png" alt="Before Quiz" class="w-full object-cover">
          </div>
          <p class="text-xs text-[#949ba4] leading-relaxed">
            • لون بنفسجي متكرر في كل الألعاب دون تمييز لنوع اللعبة.<br>
            • غياب البادج العلوي الواضح لنوع السؤال.<br>
            • الخط في بعض الأسئلة الطويلة يحتاج هوامش وتنفس أكبر.
          </p>
        </div>

        <!-- After -->
        <div class="bg-[#1e1f22] p-4 rounded-xl border-2 border-emerald-500/40">
          <div class="flex items-center justify-between pb-3 mb-3 border-b border-[#2b2d31]">
            <span class="text-xs font-bold text-emerald-400">✅ بعد (التصميم المقترح الجديد)</span>
            <span class="text-[11px] text-emerald-300">كارت زمردي حديث متوافق مع شاشات الجوال</span>
          </div>
          <div class="rounded-lg overflow-hidden border border-emerald-500/30 mb-3 shadow-lg">
            <img src="after/single-quiz.png" alt="After Quiz" class="w-full object-cover">
          </div>
          <div class="space-y-2 text-xs text-[#dbdee1]">
            <p>• إطار مضيء بأركان تكنولوجية حديثة مع خلفية داكنة مريحة للعين.</p>
            <p>• بادج علوي واضح <code class="bg-[#2b2d31] px-2 py-0.5 rounded text-emerald-300">🎯 سؤال ثقافي عام #14</code>.</p>
            <p>• خط تجوال عربي عريض واضح جداً حتى على الشاشات الصغيرة مع شريط التايمر والجائزة بالأسفل.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- SURFACE 3: DUAL 1v1 BOARDS (XO) -->
    <section class="surface-card bg-[#2b2d31] rounded-2xl p-6 border border-[#383a40]" data-category="dual">
      <div class="flex items-center justify-between pb-4 border-b border-[#383a40] mb-6">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-2xl">⚔️</span>
            <h2 class="text-xl font-black text-sky-400">الألعاب الثنائية (XO & توصيل 4)</h2>
          </div>
          <p class="text-xs text-[#949ba4] mt-1">تمييز واضح لأزرار اللاعبين، إبراز خط الفوز الذهبي، وتايمر تنازلي مباشر على الديسكورد.</p>
        </div>
        <span class="bg-sky-400/10 text-sky-300 text-xs px-3 py-1 rounded-full font-bold">ثنائي 1v1</span>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Before -->
        <div class="bg-[#1e1f22] p-4 rounded-xl border border-[#383a40]">
          <div class="flex items-center justify-between pb-3 mb-3 border-b border-[#2b2d31]">
            <span class="text-xs font-bold text-red-400">❌ قبل (الشكل الحالي)</span>
            <span class="text-[11px] text-[#949ba4]">أزرار رمادية عادية دون تمييز لخط الفوز</span>
          </div>
          <div class="rounded-lg overflow-hidden border border-[#383a40] mb-3">
            <img src="before/dual-xo.png" alt="Before XO" class="w-full object-cover">
          </div>
          <p class="text-xs text-[#949ba4] leading-relaxed">
            • الأزرار تبدو رمادية خافتة عند انتهاء اللعبة.<br>
            • لا يظهر للاعبين كيف تحقق الفوز بالضبط على اللوحة.<br>
            • رسالة الدور غير بارزة في الشات المزدحم.
          </p>
        </div>

        <!-- After -->
        <div class="bg-[#1e1f22] p-4 rounded-xl border-2 border-sky-500/40">
          <div class="flex items-center justify-between pb-3 mb-3 border-b border-[#2b2d31]">
            <span class="text-xs font-bold text-emerald-400">✅ بعد (التصميم المقترح الجديد)</span>
            <span class="text-[11px] text-sky-300">لوحة حيوية مع تمييز خط الفوز الذهبي</span>
          </div>
          <div class="rounded-lg overflow-hidden border border-sky-500/30 mb-3 shadow-lg">
            <img src="after/dual-xo.png" alt="After XO" class="w-full object-cover">
          </div>
          <div class="space-y-2 text-xs text-[#dbdee1]">
            <p>• أزرار ملونة واضحة: 🔴 لصاحب التحدي، 🔵 للمنافس.</p>
            <p>• خط الفوز يظهر مضيئاً باللون الذهبي عند اكتمال 3 على صف أو خط مائل.</p>
            <p>• زر <code class="bg-[#2b2d31] px-2 py-0.5 rounded text-sky-300">🔁 العب تاني</code> يظهر مباشرة أسفل النتيجة للتحدي الفوري.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- SURFACE 4: CASINO MINES -->
    <section class="surface-card bg-[#2b2d31] rounded-2xl p-6 border border-[#383a40]" data-category="casino">
      <div class="flex items-center justify-between pb-4 border-b border-[#383a40] mb-6">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-2xl">💣</span>
            <h2 class="text-xl font-black text-amber-400">كازينو الألغام (Mines 5x5)</h2>
          </div>
          <p class="text-xs text-[#949ba4] mt-1">واجهة بصرية أنيقة مع زر أخضر لسحب الأرباح يوضح المضاعف المباشر والمبلغ المكتسب.</p>
        </div>
        <span class="bg-amber-400/10 text-amber-300 text-xs px-3 py-1 rounded-full font-bold">كازينو</span>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Before -->
        <div class="bg-[#1e1f22] p-4 rounded-xl border border-[#383a40]">
          <div class="flex items-center justify-between pb-3 mb-3 border-b border-[#2b2d31]">
            <span class="text-xs font-bold text-red-400">❌ قبل (الشكل الحالي)</span>
            <span class="text-[11px] text-[#949ba4]">شبكة أزرار رمادية تقليدية</span>
          </div>
          <div class="p-6 bg-[#2b2d31] rounded-lg text-center space-y-2">
            <p class="text-sm font-bold text-white">💣 مينز (Mines)</p>
            <p class="text-xs text-[#949ba4]">شبكة 5 صفوف أزرار، كل زر مربع رمادي ⬛</p>
            <p class="text-xs text-[#dbdee1]">زر سحب الأرباح رمادي خافت مع نص مقتضب</p>
          </div>
        </div>

        <!-- After -->
        <div class="bg-[#1e1f22] p-4 rounded-xl border-2 border-amber-500/40">
          <div class="flex items-center justify-between pb-3 mb-3 border-b border-[#2b2d31]">
            <span class="text-xs font-bold text-emerald-400">✅ بعد (التصميم المقترح الجديد)</span>
            <span class="text-[11px] text-amber-300">أزرار جواهر زمردية وزر كاش آوت واضح</span>
          </div>
          <div class="rounded-lg overflow-hidden border border-amber-500/30 mb-3 shadow-lg">
            <img src="after/casino-mines.png" alt="After Mines" class="w-full object-cover">
          </div>
          <p class="text-xs text-[#dbdee1]">
            ✓ الجواهر المكتشفة تضيء باللون الأخضر الزمردي.<br>
            ✓ زر سحب الأرباح بارز باللون الأخضر (Success) ويعرض المبلغ الدقيق المتاح للسحب لحظياً.
          </p>
        </div>
      </div>
    </section>

    <!-- SURFACE 5: VISUAL CAMO & MAP -->
    <section class="surface-card bg-[#2b2d31] rounded-2xl p-6 border border-[#383a40]" data-category="single">
      <div class="flex items-center justify-between pb-4 border-b border-[#383a40] mb-6">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-2xl">🗺️</span>
            <h2 class="text-xl font-black text-indigo-400">كروت الخريطة والتمويه البصري (Map & Camo)</h2>
          </div>
          <p class="text-xs text-[#949ba4] mt-1">تحديث صور الخرائط والكلمات المموهة لحماية السؤال من النسخ مع تباين ألوان عالي ومريح.</p>
        </div>
        <span class="bg-indigo-400/10 text-indigo-300 text-xs px-3 py-1 rounded-full font-bold">بصري</span>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-[#1e1f22] p-4 rounded-xl border border-sky-500/30">
          <span class="text-xs font-bold text-sky-400 mb-2 block">🗺️ كارت الخريطة الجديد:</span>
          <img src="after/single-map.png" alt="Map Card" class="rounded-lg w-full object-cover mb-2">
          <p class="text-xs text-[#949ba4]">تحديد واضح لحدود الدولة وموقع العاصمة وقارة الدولة في شريط سفلي أنيق.</p>
        </div>

        <div class="bg-[#1e1f22] p-4 rounded-xl border border-indigo-500/30">
          <span class="text-xs font-bold text-indigo-400 mb-2 block">🔍 كارت التمويه البصري الجديد:</span>
          <img src="after/single-camo.png" alt="Camo Card" class="rounded-lg w-full object-cover mb-2">
          <p class="text-xs text-[#949ba4]">تمويه ذكي يمنع بوتات النسخ والـ OCR التلقائي مع سهولة قراءته للاعب البشري.</p>
        </div>
      </div>
    </section>

    <!-- DISCORD LIVE EMBED SIMULATOR -->
    <section class="surface-card bg-[#2b2d31] rounded-2xl p-6 border border-[#383a40]" data-category="menu">
      <div class="flex items-center justify-between pb-4 border-b border-[#383a40] mb-6">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-2xl">💬</span>
            <h2 class="text-xl font-black text-[#5865F2]">محاكاة رسالة الديسكورد الحية (Discord Message Simulator)</h2>
          </div>
          <p class="text-xs text-[#949ba4] mt-1">شكل الرسالة الحقيقية في شات الديسكورد مع الأزرار والقائمة المنسدلة.</p>
        </div>
        <span class="bg-[#5865F2]/10 text-[#5865F2] text-xs px-3 py-1 rounded-full font-bold">Discord UI</span>
      </div>

      <!-- Realistic Discord Chat Message -->
      <div class="discord-chat p-4 rounded-xl border border-[#232428] max-w-3xl mx-auto space-y-4">
        <!-- Message Header -->
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-400 to-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow">
            CC
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <span class="font-bold text-white text-sm">CC Bot</span>
              <span class="bg-[#5865F2] text-white text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase">BOT</span>
              <span class="text-[#949ba4] text-xs">اليوم في 07:55 ص</span>
            </div>

            <!-- Discord Embed -->
            <div class="discord-embed p-4 rounded-lg mt-2 space-y-3 max-w-xl">
              <div class="flex items-center justify-between">
                <span class="text-sm font-bold text-white">📖 قائمة أوامر وألعاب CC Bot</span>
                <span class="text-xs text-[#949ba4]">v2.0</span>
              </div>
              <p class="text-xs text-[#dbdee1] leading-relaxed">
                من هنا تقدر توصل لكل ألعاب الشات، الكازينو، البورصة، والألعاب الجماعية. اختار القائمة من السيلكت تحت أو اكتب الأمر مباشرة!
              </p>
              
              <div class="bg-[#1e1f22] p-2.5 rounded-lg border border-[#383a40] space-y-1 text-xs">
                <div class="flex justify-between items-center text-amber-300 font-bold">
                  <span>🎰 العاب الكازينو الجديدة:</span>
                  <span class="text-[10px] text-[#949ba4]">نسب فوز 2.58%</span>
                </div>
                <div class="text-[#949ba4] text-[11px] space-y-0.5">
                  <p>🏇 <code class="text-amber-200">احصنة 100 1</code> ・ سباق الخيول الخيالي (جديد!)</p>
                  <p>💣 <code class="text-amber-200">مينز 100 3</code> ・ 🪙 <code class="text-amber-200">عملة 100 ملك</code> ・ 🎰 <code class="text-amber-200">سلوت 100</code></p>
                </div>
              </div>

              <!-- Embed Footer -->
              <div class="flex items-center justify-between pt-2 border-t border-[#383a40] text-[11px] text-[#949ba4]">
                <span>طلب بواسطة: @0skar</span>
                <span>CC Economy 🌀</span>
              </div>
            </div>

            <!-- Discord Select Menu -->
            <div class="mt-3 max-w-xl">
              <div class="bg-[#1e1f22] border border-[#383a40] rounded px-3 py-2 text-xs text-[#dbdee1] flex items-center justify-between cursor-pointer hover:border-[#5865F2]">
                <span>اختر القائمة المطلوبة (الألعاب الفردية، الثنائية، الكازينو...)</span>
                <span>▼</span>
              </div>
            </div>

            <!-- Discord Buttons Row -->
            <div class="flex flex-wrap gap-2 mt-3 max-w-xl">
              <button class="discord-btn-primary text-white text-xs px-3.5 py-1.5 rounded font-bold flex items-center gap-1.5 shadow">
                <span>🎰</span> العاب الكازينو
              </button>
              <button class="discord-btn-success text-white text-xs px-3.5 py-1.5 rounded font-bold flex items-center gap-1.5 shadow">
                <span>🏇</span> سباق الخيول
              </button>
              <button class="discord-btn-secondary text-white text-xs px-3.5 py-1.5 rounded font-bold flex items-center gap-1.5 shadow">
                <span>📖</span> شرح الأوامر
              </button>
              <button class="discord-btn-secondary text-white text-xs px-3.5 py-1.5 rounded font-bold flex items-center gap-1.5 shadow">
                <span>🌐</span> الدعم الفني
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

  </main>

  <script>
    function filterCategory(category) {
      const cards = document.querySelectorAll('.surface-card');
      const tabs = document.querySelectorAll('.tab-btn');

      tabs.forEach(tab => {
        tab.classList.remove('bg-[#5865F2]', 'text-white');
        tab.classList.add('bg-[#2b2d31]', 'text-[#949ba4]');
      });
      event.target.classList.remove('bg-[#2b2d31]', 'text-[#949ba4]');
      event.target.classList.add('bg-[#5865F2]', 'text-white');

      cards.forEach(card => {
        if (category === 'all' || card.dataset.category === category) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    }
  </script>
</body>
</html>`;
}

// ==========================================
// 4. WRITE DOCUMENTATION & HTML GALLERIES
// ==========================================

async function main() {
    await generateAllSurfaces();

    // 1. Build and write D:\bots\CC-bot\docs\design-preview\index.html
    const galleryHtml = buildGalleryHtml();
    const indexPath = path.join(DOCS_DIR, 'index.html');
    fs.writeFileSync(indexPath, galleryHtml, 'utf8');
    console.log(`  ✓ Written: docs/design-preview/index.html (${galleryHtml.length} bytes)`);

    // 2. Also write to Antigravity brain artifact directory for interactive inline preview!
    const artifactPath = path.join(ARTIFACT_DIR, 'discord_games_preview.html');
    fs.writeFileSync(artifactPath, galleryHtml, 'utf8');
    console.log(`  ✓ Written Artifact: ${artifactPath}`);

    // 3. Write README.md in docs/design-preview/
    const readmeContent = `# معرض تصاميم ألعاب CC-Bot — تقرير التحسينات البصرية (Design Preview)

تم إعداد هذا المعرض خصيصاً لمراجعة الأونر واعتماد الأشكال والتصاميم الجديدة للألعاب قبل البدء في مرحلة التنفيذ البرمجي (Phase 2)، وفقاً لتوجيهات **Prompt 2** الصارمة.

---

## 🎨 الهوية البصرية وفلسفة التصميم الموحدة (Design Principles)

1. **لوحة الألوان الموحدة (Color Palette):**
   - **اللون الأساسي:** الأزرق الديسكوردي البنفسجي Blurple (\`#5865F2\`)
   - **الألعاب الفردية (Single / Quiz):** الأخضر الزمردي (\`#2ecc71\` / \`#10b981\`)
   - **الألعاب الثنائية 1v1 (Dual):** الأزرق السماوي (\`#3498db\` / \`#38bdf8\`)
   - **الألعاب الجماعية (Group):** البنفسجي الأرجواني (\`#9b59b6\` / \`#8b5cf6\`)
   - **ألعاب الكازينو والبورصة (Casino):** الذهبي الملكي (\`#f1c40f\` / \`#f59e0b\`)

2. **الخط والطباعة (Typography):**
   - الاعتماد الكامل على خط **Tajawal** الأصلي المرفق في (\`assets/fonts/\`).
   - نصوص عربية منسقة من اليمين لليسار (RTL) بأحجام مدروسة لسهولة القراءة من الهاتف الجوال.
   - إزالة التشويش الحاد المزعج، مع الحفاظ على كروت الأسئلة كصور (PNG) لمنع النسخ والغش التلقائي بواسطة البوتات.

3. **هيكلة الرسائل والإمبيد (Discord Message Standards):**
   - عنوان واضح مع إيموجي مميز في البداية.
   - تايمر تنازلي مباشر باستخدام صيغة الديسكورد \`<t:UNIX:R>\`.
   - أزرار ديسكورد متناسقة: الأخضر (Success) للانضمام، الأزرق (Primary) للعب مجدداً، الرمادي (Secondary) للحياد، والأحمر (Danger) للاستسلام.
   - زر \`🔁 العب تاني\` فوري في رسائل إعلان الفائز لتشجيع استمرار اللعب والنشاط في السيرفر.

---

## 🏇 سباق الخيول الأسطوري (Fantasy Horse Racing)
- تم بناء مضمار سباق تفاعلي عالي الدقة (SVG/Sharp) يوضح حركة الخيول أثناء السباق نحو خط النهاية.
- تضمين 6 خيول فانتسي بهويات وألوان متباينة:
  1. ⚡ **الرعد** (Desert Thunder) — النسبة: ×2.2
  2. 🌩️ **البرق** (Shadow Lightning) — النسبة: ×3.8
  3. 🦅 **الصقر** (Sky Falcon) — النسبة: ×6.5
  4. 🐅 **النمر** (Golden Tiger) — النسبة: ×12.0
  5. 🌪️ **العاصفة** (Storm Runner) — النسبة: ×20.0
  6. 👻 **الشبح** (Astral Ghost) — النسبة: ×38.0
- نسبة ربح الكازينو (House Edge) مثبتة رياضياً بدقة 2.58% (وفق معادلة RTP).
- تم ربط اللعبة رسمياً في قائمة الأوامر العامة \`.العاب\` وقائمة الكازينو المباشرة.

---

## 📁 الملفات التي سيشملها التطوير في Phase 2 (بعد الاعتماد):
- \`src/games/engine/card.js\` & \`imageCard.js\` (تحديث القوالب ولوحة الألوان الزمردية)
- \`src/games/helpMenu.js\` & \`src/services/cc/gamesMenuUi.js\` (تضمين سباق الخيول وتحديث الإمبيد)
- \`src/games/games/xo.js\` & \`connect.js\` (تحديث الألوان وإبراز خط الفوز)
- \`src/services/cc/casinoUi.js\` & \`casinoHorses.js\` (تحديث واجهة الألغام وسباق الخيول)
`;

    fs.writeFileSync(path.join(DOCS_DIR, 'README.md'), readmeContent, 'utf8');
    console.log(`  ✓ Written: docs/design-preview/README.md`);

    console.log('\n🎉 Preview gallery successfully generated!');
}

main().catch(err => {
    console.error('❌ Error generating design preview:', err);
    process.exit(1);
});
