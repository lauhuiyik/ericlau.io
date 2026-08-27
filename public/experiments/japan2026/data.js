/* =====================================================================
   Japan 2026 — trip data
   Edit this file to add / change spots, hotels or the day plan.
   Each spot needs at least: id, name, city, lat, lng. Everything else
   is optional but nice to have. After editing, just re-open the page.
   reservation: "no" | "recommended" | "required"
   meal:        "breakfast" | "lunch" | "dinner" | "snack" | "anytime" | "attraction"
   coords:      "high" | "medium" | "low"  (low = double-check the pin)
   ===================================================================== */

const TRIP = {
  title: "Japan 2026",
  subtitle: "7–20 August · Tokyo & Osaka",
  flightIn:  "Mon 7 Aug — QF79 arrive Tokyo Narita 19:00",
  flightOut: "Thu 20 Aug — QF80 depart Tokyo Narita 20:25"
};

/* ----------------------------- HOTELS ------------------------------ */
const HOTELS = [
  {
    id: "sunroute-ginza",
    name: "Hotel Sunroute Ginza",
    area: "Ginza, Tokyo",
    city: "Tokyo",
    checkin: "2026-08-07", checkout: "2026-08-10", nights: 3,
    checkinTime: "14:00", checkoutTime: "11:00",
    address: "1-15-11 Ginza, Chuo-ku, Tokyo 104-0061",
    lat: 35.67358, lng: 139.76980,
    conf: "5669.204.011", pin: "7306",
    phone: "+81 3 5579 9733",
    pdf: "pdfs/sunroute-ginza.pdf",
    maps: "Hotel Sunroute Ginza Tokyo"
  },
  {
    id: "aman-tokyo",
    name: "Aman Tokyo",
    area: "Otemachi, Tokyo",
    city: "Tokyo",
    checkin: "2026-08-10", checkout: "2026-08-11", nights: 1,
    checkinTime: "15:00", checkoutTime: "16:00 (guaranteed late checkout)",
    address: "The Otemachi Tower, 1-5-6 Otemachi, Chiyoda-ku, Tokyo 100-0004",
    lat: 35.68770, lng: 139.76640,
    conf: "9093475915156",
    phone: "+81 3 5224 3333",
    pdf: "pdfs/aman-tokyo.pdf",
    note: "FHR perks: daily breakfast for 2, US$100 credit, 4pm checkout.",
    maps: "Aman Tokyo Otemachi Tower"
  },
  {
    id: "fairfield-osaka-namba",
    name: "Fairfield by Marriott Osaka Namba",
    area: "Namba, Osaka",
    city: "Osaka",
    checkin: "2026-08-11", checkout: "2026-08-13", nights: 2,
    checkinTime: "15:00", checkoutTime: "12:00",
    address: "2-3-25 Motomachi, Naniwa-ku, Osaka 556-0016",
    lat: 34.66120, lng: 135.49860,
    conf: "85430258",
    phone: "+81 6 6649 4111",
    pdf: "pdfs/fairfield-osaka-namba.pdf",
    maps: "Fairfield by Marriott Osaka Namba"
  },
  {
    id: "doubletree-osaka-castle",
    name: "DoubleTree by Hilton Osaka Castle",
    area: "Osaka Castle, Osaka",
    city: "Osaka",
    checkin: "2026-08-13", checkout: "2026-08-14", nights: 1,
    checkinTime: "15:00", checkoutTime: "11:00",
    address: "1-1 Otemae 1-chome, Chuo-ku, Osaka 540-0008",
    lat: 34.68500, lng: 135.52320,
    conf: "3488101423",
    phone: "+81 6 6335 9801",
    pdf: "pdfs/doubletree-osaka-castle.pdf",
    maps: "DoubleTree by Hilton Osaka Castle"
  },
  {
    id: "knot-shinjuku",
    name: "THE KNOT TOKYO Shinjuku",
    area: "Nishi-Shinjuku, Tokyo",
    city: "Tokyo",
    checkin: "2026-08-14", checkout: "2026-08-16", nights: 2,
    checkinTime: "15:00", checkoutTime: "10:00",
    address: "4-31-1 Nishi-Shinjuku, Shinjuku-ku, Tokyo 160-0023",
    lat: 35.68870, lng: 139.68872,
    conf: "5191.595.177", pin: "0666",
    phone: "+81 3 3375 6511",
    pdf: "pdfs/knot-shinjuku.pdf",
    maps: "THE KNOT TOKYO Shinjuku"
  },
  {
    id: "keisei-monzennakacho",
    name: "Keisei Richmond Hotel Monzen-nakacho",
    area: "Monzen-nakacho, Koto, Tokyo",
    city: "Tokyo",
    checkin: "2026-08-16", checkout: "2026-08-20", nights: 4,
    checkinTime: "14:00", checkoutTime: "11:00",
    address: "2-8-9 Monzennakacho, Koto-ku, Tokyo 135-0048",
    lat: 35.67282, lng: 139.79660,
    conf: "5236.922.595", pin: "9542",
    phone: "+81 3 5646 5300",
    pdf: "pdfs/keisei-monzennakacho.pdf",
    maps: "Keisei Richmond Hotel Tokyo Monzennakacho"
  }
];

/* ------------------------------ SPOTS ------------------------------ */
/* tags from your shortlist; meal is my best fit. */
const SPOTS = [
  // ---- Ginza / central Tokyo ----
  { id:"torigin-ginza", best:"Kamameshi (clay-pot rice) + charcoal yakitori", name:"Torigin Ginza Honten", tag:"Yakitori / kamameshi", city:"Tokyo", area:"Ginza", meal:"lunch", address:"B1, New Ginza Bldg 6, 5-5-7 Ginza, Chuo-ku", lat:35.6716, lng:139.7637, hours:"11:30–22:00 (LO 21:30)", closed:"Year-end only", station:"Ginza (1–3 min)", reservation:"recommended", coords:"high", note:"Showa-era (since 1953) kamameshi + yakitori.", maps:"鳥ぎん 銀座本店 銀座5-5-7" },
  { id:"fukumimi-ginza", best:"Hakata-style charcoal chicken skewers", name:"Kushiyaki Bistro Fukumimi (Ginza 5)", tag:"Yakitori izakaya", city:"Tokyo", area:"Ginza", meal:"dinner", address:"B1F, 5-10-9 Ginza, Chuo-ku", lat:35.6700, lng:139.7660, hours:"16:00–23:30 (LO 22:30)", closed:"Irregular", station:"Ginza / Higashi-Ginza (3 min)", reservation:"recommended", coords:"medium", note:"Several Fukumimi branches around Ginza.", maps:"串焼BISTRO 福みみ 銀座5 銀座5-10-9" },
  { id:"hiiragi-ginza", best:"Anmitsu & seasonal fruit kakigori", name:"Hiiragi Ginza Honten", tag:"Japanese sweets / parfait / kakigori", city:"Tokyo", area:"Ginza", meal:"snack", address:"6-12-15 Ginza, Chuo-ku", lat:35.6699, lng:139.7637, hours:"11:30–20:00 (LO 19:30)", closed:"Open daily", station:"Higashi-Ginza (3 min)", reservation:"no", coords:"medium", note:"Opened 2024; anmitsu, kakigori, mitarashi dango.", maps:"ひいらぎ 銀座本店 銀座6-12-15" },
  { id:"ginza-hachigo", best:"Clear chicken-&-clam shoyu chukasoba", name:"Ginza Hachigo", tag:"Ramen (chukasoba)", city:"Tokyo", area:"Ginza", meal:"lunch", address:"1F, 3-14-2 Ginza, Chuo-ku", lat:35.6712, lng:139.7691, hours:"Lunch from 11:00; dinner from ~16:00", closed:"Monday", station:"Higashi-Ginza (3 min)", reservation:"recommended", coords:"high", note:"Michelin-pedigree; uses a reservation line to skip queues. (Also covers your 'hachigo ginza'.)", maps:"銀座 八五 銀座3-14-2" },
  { id:"echire-marunouchi", best:"Échiré butter croissant & financiers", name:"Échiré Maison du Beurre", tag:"Butter pastries", city:"Tokyo", area:"Marunouchi", meal:"snack", address:"Marunouchi Brick Square 1F, 2-6-1 Marunouchi, Chiyoda-ku", lat:35.6792, lng:139.7637, hours:"10:00–19:00", closed:"Irregular", station:"Tokyo / Nijubashimae (3–5 min)", reservation:"no", coords:"high", note:"Croissants & financiers sell out early; expect a queue.", maps:"エシレ・メゾン デュ ブール 丸の内ブリックスクエア" },
  { id:"tsukiji-market", best:"Fresh sushi, tamagoyaki & grilled scallop skewers", name:"Tsukiji Outer Market", tag:"Seafood market", city:"Tokyo", area:"Tsukiji", meal:"breakfast", address:"4-16-2 Tsukiji, Chuo-ku", lat:35.6655, lng:139.7707, hours:"Most stalls 05:00–14:00 (best early)", closed:"Many shops closed Sun & some Wed", station:"Tsukiji / Tsukijishijo (1 min)", reservation:"no", coords:"high", note:"Go early; the wholesale market itself moved to Toyosu.", maps:"築地場外市場 中央区築地4-16-2" },
  { id:"tsujihan-nihonbashi", best:"'Zeitaku-don' piled seafood rice bowl", name:"Tsujihan Nihonbashi Honten", tag:"Kaisendon", city:"Tokyo", area:"Nihonbashi", meal:"lunch", address:"1F, 3-1-15 Nihonbashi, Chuo-ku", lat:35.6818, lng:139.7740, hours:"Mon–Fri 11:00–21:00; wknd from 10:00", closed:"Irregular", station:"Nihonbashi (2 min)", reservation:"no", coords:"high", note:"Famous tiered 'zeitaku-don'. Long queues; go off-peak.", maps:"日本橋海鮮丼 つじ半 日本橋本店 日本橋3-1-15" },
  { id:"chateraise-ginza", best:"Premium egg tart & fruit shortcake", name:"Chateraise YATSUDOKI Ginza 7", tag:"Cakes / egg tart", city:"Tokyo", area:"Ginza", meal:"snack", address:"7-15-11 Ginza, Chuo-ku", lat:35.6685, lng:139.7625, hours:"10:00–20:00", closed:"Open daily", station:"Higashi-Ginza / Shimbashi", reservation:"no", coords:"medium", note:"Premium 'YATSUDOKI' branch — most central Chateraise.", maps:"シャトレーゼ YATSUDOKI 銀座7丁目 銀座7-15-11" },
  { id:"cloud-club-matcha", best:"Made-to-order ceremonial matcha latte", name:"Cloud Club Matcha", tag:"Matcha latte stand", city:"Tokyo", area:"Ginza", meal:"snack", address:"3-14-6 Ginza, Chuo-ku", lat:35.6710, lng:139.7693, hours:"~09:00–16:00 (weekends vary)", closed:"Check locally", station:"Higashi-Ginza", reservation:"no", coords:"medium", note:"Made-to-order, card only, no seating.", maps:"CLOUD CLUB MATCHA 銀座3-14-6" },
  { id:"sushi-itsutsu", best:"Edomae omakase nigiri counter", name:"Sushi Itsutsu", tag:"Omakase sushi", city:"Tokyo", area:"Higashi-Ginza", meal:"dinner", address:"1F Fushiya Bldg, 3-12-8 Ginza, Chuo-ku", lat:35.6699, lng:139.7682, hours:"Dinner 17:30 & 20:00 seatings; wknd lunch 13:00", closed:"Monday + NY", station:"Higashi-Ginza (2 min)", reservation:"required", coords:"medium", note:"~12-seat counter, omakase ~¥11,000. Book ahead.", maps:"鮨 いつつ 銀座3-12-8 伏谷ビル" },
  { id:"butter-biei", best:"Butter-soaked hotcakes & Biei butter biscuits", name:"BUTTER Biei Hoboku Rakunojo", tag:"Hokkaido butter sweets", city:"Tokyo", area:"Marunouchi", meal:"snack", address:"Marunouchi Bldg (Marubiru) B1F, 2-4-1 Marunouchi, Chiyoda-ku", lat:35.6800, lng:139.7640, hours:"Shop 10:00–21:00; cafe 11:00–19:00", closed:"Jan 1 only", station:"Tokyo (direct, Marunouchi side)", reservation:"no", coords:"medium", note:"'Butter-eating hotcakes'; queues common.", maps:"BUTTER 美瑛放牧酪農場 丸ビル 丸の内2-4-1" },
  { id:"front-room", best:"All-day brunch plates & pastries", name:"The Front Room", tag:"All-day cafe", city:"Tokyo", area:"Marunouchi", meal:"anytime", address:"Marunouchi Bldg 1F, 2-4-1 Marunouchi, Chiyoda-ku", lat:35.6797, lng:139.7639, hours:"Mon–Thu 8:00–22:00; Fri to 23:00; wknd 9:00–21:00", closed:"Open daily", station:"Tokyo (direct)", reservation:"recommended", coords:"high", note:"In the Marunouchi Building — not the Peninsula.", maps:"THE FRONT ROOM Marunouchi Building Tokyo" },
  { id:"rokurinsha", best:"Rich pork-&-fish tsukemen", name:"Rokurinsha", tag:"Tsukemen ramen", city:"Tokyo", area:"Tokyo Station", meal:"lunch", address:"Tokyo Ramen Street B1F, Tokyo Station Ichibangai", lat:35.6796, lng:139.7687, hours:"Morning 7:30–10:00; regular 10:00–23:00", closed:"Open daily", station:"Tokyo (Yaesu South, 1 min)", reservation:"no", coords:"high", note:"Famous tsukemen; 20–60 min queue at peak, morning shorter.", maps:"Rokurinsha Tokyo Ramen Street Tokyo Station" },
  { id:"brulee-merize", best:"Crème brûlée tart (top omiyage pick)", name:"Brulee Merize", tag:"Crème brûlée tart", city:"Tokyo", area:"Tokyo Station", meal:"snack", address:"Tokyo Gift Palette, Yaesu North, Tokyo Station", lat:35.6815, lng:139.7676, hours:"~09:00–20:30", closed:"Open daily", station:"Tokyo (Yaesu North)", reservation:"no", coords:"medium", note:"#1 in Gift Palette rankings — good omiyage.", maps:"Brulee Merize Tokyo Gift Palette Tokyo Station" },

  // ---- Akihabara / Ueno / east ----
  { id:"roast-beef-ohno", best:"Roast beef bowl with egg-yolk sauce", name:"Roast Beef Ohno (Akihabara)", tag:"Roast beef bowl", city:"Tokyo", area:"Akihabara", meal:"lunch", address:"B1F, 1-2-3 Sotokanda, Chiyoda-ku", lat:35.6985, lng:139.7720, hours:"Mon–Sat 11:00–23:00; Sun to 22:00", closed:"Open daily", station:"Akihabara (1 min)", reservation:"no", coords:"medium", note:"Several Tokyo branches (also Harajuku).", maps:"ローストビーフ大野 秋葉原店 外神田1-2-3" },
  { id:"wagyu-dendo", best:"All-you-can-eat wagyu yakiniku", name:"Wagyu AYCE Hall of Fame (Akihabara)", tag:"Wagyu all-you-can-eat", city:"Tokyo", area:"Akihabara", meal:"dinner", address:"BiTO AKIBA 3F, 1-18-19 Sotokanda, Chiyoda-ku", lat:35.6986, lng:139.7716, hours:"Wkdy 12:00–22:00; wknd 11:30–22:00 (last entry 20:00)", closed:"Open daily", station:"Akihabara (2–3 min)", reservation:"recommended", coords:"medium", note:"By Heijoen. Web booking 1–6 ppl.", maps:"和牛放題の殿堂 肉屋横丁 秋葉原" },
  { id:"kuriya-kurogi", best:"Luxury kakigori & warabi mochi", name:"Kuriya otona Kurogi", tag:"Luxury kakigori / wagashi", city:"Tokyo", area:"Ueno", meal:"snack", address:"PARCO_ya Ueno 1F, 3-24-6 Ueno, Taito-ku", lat:35.7075, lng:139.7740, hours:"10:00–21:00 (LO 20:00)", closed:"Follows PARCO_ya", station:"Ueno-Hirokoji / Okachimachi (1–2 min)", reservation:"recommended", coords:"medium", note:"Sister to kappo 'Kurogi'. Long queues.", maps:"廚 otona くろぎ PARCO_ya 上野" },

  // ---- Asakusa / Skytree ----
  { id:"sensoji", best:"Iconic temple + Nakamise street snacks", name:"Senso-ji Temple", tag:"Temple / sightseeing", city:"Tokyo", area:"Asakusa", meal:"attraction", address:"2-3-1 Asakusa, Taito-ku", lat:35.7148, lng:139.7967, hours:"Main hall 6:00–17:00; grounds 24h", closed:"Open daily", station:"Asakusa (5 min)", reservation:"no", coords:"high", note:"Kaminarimon + Nakamise street. Free.", maps:"Sensoji Temple Asakusa Tokyo" },
  { id:"wagyu-ichinoya", best:"Wagyu rare-steak rice box", name:"Kuroge Wagyu Ichinoya (Asakusa)", tag:"Wagyu rare-steak bowl", city:"Tokyo", area:"Asakusa", meal:"lunch", address:"1F, 1-34-6 Asakusa, Taito-ku", lat:35.7123, lng:139.7972, hours:"Wkdy 11:00–16:30; wknd to 19:30", closed:"Open daily", station:"Asakusa (3 min)", reservation:"no", coords:"high", note:"Kanji 壱乃屋. Wagyu rare-steak rice box.", maps:"黒毛和牛 壱乃屋 浅草 浅草1-34-6" },
  { id:"benizuru", best:"Jiggly soufflé pancakes", name:"Benizuru", tag:"Soufflé pancakes", city:"Tokyo", area:"Asakusa", meal:"snack", address:"2-1-11 Nishi-Asakusa, Taito-ku", lat:35.7136, lng:139.7903, hours:"~10:00–20:00", closed:"Wednesday", station:"Tawaramachi / Asakusa (5 min)", reservation:"required", coords:"medium", note:"Same-day ticket from ~7:00am; no phone bookings.", maps:"紅鶴 benizuru 浅草 台東区西浅草2-1-11" },
  { id:"okoppe-milk", best:"Okhotsk milk soft serve", name:"Okoppe Milk Stand", tag:"Hokkaido soft serve", city:"Tokyo", area:"Skytree", meal:"snack", address:"Tokyo Solamachi (Tabe-Terrace), 1-1-2 Oshiage, Sumida-ku", lat:35.7101, lng:139.8107, hours:"~10:00–21:00 (mall hours)", closed:"Follows Solamachi", station:"Tokyo Skytree / Oshiage", reservation:"no", coords:"medium", note:"Okhotsk organic milk soft serve & parfaits.", maps:"Okoppe Milk Stand Tokyo Solamachi Skytree" },
  { id:"popo-sandwich", best:"Cheap retro egg & fruit sandwiches", name:"Sandwich Popo", tag:"Sandwiches", city:"Tokyo", area:"Nishi-Nippori", meal:"breakfast", address:"3-6-12 Nishinippori, Arakawa-ku", lat:35.7320, lng:139.7668, hours:"~07:00–18:00", closed:"Often Sunday", station:"Nishi-Nippori (next to station)", reservation:"no", coords:"medium", note:"Since 1973; cheap (~¥300) handmade sandwiches.", maps:"Sandwich Popo Nishi-Nippori Tokyo" },

  // ---- Shibuya / Harajuku / Omotesando / Nakameguro / Ebisu ----
  { id:"menya-musashi-shibuya", best:"Thick, rich tsukemen", name:"Menya Musashi Bukotsu Gaiden", tag:"Ramen / tsukemen", city:"Tokyo", area:"Shibuya", meal:"lunch", address:"2-8-5 Dogenzaka, Shibuya-ku", lat:35.6584, lng:139.6979, hours:"11:30–22:30", closed:"Open daily", station:"Shibuya (2–3 min)", reservation:"no", coords:"high", note:"Shibuya branch of Menya Musashi.", maps:"麺屋武蔵 武骨外伝 渋谷 道玄坂" },
  { id:"edw-yellow", best:"Tornado omurice & soufflé pancakes", name:"EDW yellow (Espresso D Works)", tag:"Omurice / soufflé pancakes", city:"Tokyo", area:"Shibuya", meal:"lunch", address:"B1F Ikushin Bldg, 26-5 Udagawacho, Shibuya-ku", lat:35.6615, lng:139.6975, hours:"~11:00–20:00", closed:"Check locally", station:"Shibuya (7 min)", reservation:"no", coords:"medium", note:"Fluffy omurice & soufflé pancakes; can wait 30–45 min.", maps:"EDW yellow 渋谷 宇田川町" },
  { id:"path", best:"Dutch pancake with ham & burrata", name:"PATH", tag:"Brunch / Dutch pancake", city:"Tokyo", area:"Tomigaya", meal:"breakfast", address:"1F A-FLAT, 1-44-2 Tomigaya, Shibuya-ku", lat:35.6707, lng:139.6889, hours:"Brunch 8:00–14:00; dinner ~18:00–23:00", closed:"Mon & 1st/3rd Sun (verify)", station:"Yoyogi-koen (4 min)", reservation:"recommended", coords:"high", note:"Famous Dutch pancake with raw ham & burrata at brunch; walk-in, queues.", maps:"PATH 富ヶ谷 代々木公園" },
  { id:"love-table", best:"Mille-crêpe & crêpe parfaits", name:"Afternoon Tea LOVE&TABLE", tag:"Crêpes / dessert", city:"Tokyo", area:"Omotesando", meal:"snack", address:"4-3-2 Jingumae, Shibuya-ku", lat:35.6677, lng:139.7095, hours:"~11:00–20:00", closed:"Follows building", station:"Omotesando (3 min)", reservation:"recommended", coords:"medium", note:"Mille-crêpe / crêpe dessert cafe.", maps:"アフタヌーンティー・ラブアンドテーブル 表参道" },
  { id:"age3-ginza", best:"Crispy-outside, mochi-soft fried sandwiches w/ light cream", name:"Age.3 Ginza", tag:"Fried (katsu) sandwich", city:"Tokyo", area:"Ginza", meal:"snack", address:"Sugiura Bldg 1F, 1-24-11 Ginza, Chuo-ku", lat:35.6730, lng:139.7705, hours:"11:00–19:00", closed:"Open daily", station:"Shintomicho (4 min); Ginza-itchome", reservation:"recommended", coords:"medium", note:"Ginza branch — ~7–10 min from Hotel Sunroute Ginza. Long lines; TableCheck FastPass available. (Other branches: Asakusa, Harajuku.)", maps:"Age.3 アゲサン 銀座" },
  { id:"iam-donut", best:"Fresh fluffy 'nama' donuts", name:"I'm donut ? Omotesando", tag:"Fresh 'nama' donuts", city:"Tokyo", area:"Omotesando", meal:"snack", address:"3-5-18 Kita-Aoyama, Minato-ku", lat:35.6655, lng:139.7125, hours:"~11:00–19:00 (sells out early)", closed:"Irregular", station:"Omotesando (3 min)", reservation:"no", coords:"medium", note:"Famous fluffy fresh donuts; long queues.", maps:"I'm donut ? omotesando 表参道 北青山" },
  { id:"amam-dacotan", best:"Mentaiko France & filled pastries", name:"Amam Dacotan Omotesando", tag:"Bakery", city:"Tokyo", area:"Omotesando", meal:"snack", address:"3-7-6 Kita-Aoyama, Minato-ku", lat:35.6660, lng:139.7120, hours:"11:00–19:00 (or sold out)", closed:"Open daily", station:"Omotesando (1 min)", reservation:"no", coords:"medium", note:"Fukuoka-origin bakery; queues before opening.", maps:"AMAM DACOTAN 表参道 アマムダコタン" },
  { id:"the-matcha-tokyo", best:"Organic matcha latte & soft serve", name:"The Matcha Tokyo (Omotesando)", tag:"Matcha cafe", city:"Tokyo", area:"Omotesando", meal:"snack", address:"5-11-13 Jingumae, Shibuya-ku", lat:35.6660, lng:139.7080, hours:"Mon–Fri 11:00–18:30; wknd to 19:00", closed:"Open daily", station:"Meiji-jingumae (3 min)", reservation:"no", coords:"medium", note:"Organic matcha lattes & soft serve, Cat Street.", maps:"THE MATCHA TOKYO 表参道 神宮前5-11-13" },
  { id:"little-bakery", best:"American donuts & breakfast plates", name:"The Little BAKERY Tokyo", tag:"American-style bakery cafe", city:"Tokyo", area:"Harajuku", meal:"breakfast", address:"6-13-6 Jingumae, Shibuya-ku", lat:35.6680, lng:139.7050, hours:"~10:00–18:00", closed:"Open daily", station:"Meiji-jingumae (5 min)", reservation:"no", coords:"medium", note:"Retro diner-style bakery; donuts & lunch sets.", maps:"The Little BAKERY Tokyo 原宿 神宮前" },
  { id:"harbs", best:"Tall strawberry mille-crêpe cake", name:"HARBS", tag:"Mille-crêpe cake", city:"Tokyo", area:"Shinjuku / Roppongi", meal:"snack", address:"Lumine Est Shinjuku B2F (also Roppongi Hills, Marunouchi, Azabudai)", lat:35.6905, lng:139.7005, hours:"~11:00–21:00", closed:"Follows building", station:"Shinjuku (at station)", reservation:"recommended", coords:"medium", note:"Many branches — pick the one nearest you. No Omotesando Hills branch.", maps:"HARBS ルミネエスト新宿" },
  { id:"marcy-land", best:"Sea-urchin (uni) ramen", name:"Marcy Land Omotesando", tag:"Uni (sea urchin) ramen", city:"Tokyo", area:"Omotesando", meal:"dinner", address:"Omotesando backstreet (Hills side)", lat:35.6655, lng:139.7115, hours:"Evenings, seasonal — check IG", closed:"Irregular / seasonal", station:"Omotesando", reservation:"no", coords:"low", note:"Pop-up trailer; check @marcy_land_omotesando before going.", maps:"マーシーランド表参道 Marcy Land Omotesando うにラーメン" },
  { id:"onibus-nakameguro", best:"Single-origin pour-over coffee", name:"Onibus Coffee Nakameguro", tag:"Specialty coffee", city:"Tokyo", area:"Nakameguro", meal:"anytime", address:"2-14-1 Kamimeguro, Meguro-ku", lat:35.6447, lng:139.6995, hours:"9:00–18:00", closed:"Irregular", station:"Nakameguro (1 min)", reservation:"no", coords:"high", note:"Converted house with terrace over the tracks.", maps:"ONIBUS COFFEE 中目黒 上目黒2-14-1" },
  { id:"neel-nakameguro", best:"Cold brew & katsu sando", name:"neel Nakameguro", tag:"Cafe / katsu sando", city:"Tokyo", area:"Nakameguro", meal:"anytime", address:"1-25-9 Aobadai, Meguro-ku", lat:35.6453, lng:139.6975, hours:"~09:00–20:30", closed:"Check locally", station:"Nakameguro (5–7 min)", reservation:"no", coords:"medium", note:"Turquoise house off the Meguro River; cold brew, natural wine.", maps:"neel 中目黒 青葉台 1-25-9" },
  { id:"fruits-season", best:"Vegan fruit sandwiches & parfaits", name:"fruits and season", tag:"Vegan fruit sandwich / parfait", city:"Tokyo", area:"Ebisu", meal:"snack", address:"1F, 1-10-1 Ebisu, Shibuya-ku", lat:35.6470, lng:139.7100, hours:"11:00–19:00", closed:"Open daily", station:"Ebisu (5 min)", reservation:"no", coords:"medium", note:"Japan's first vegan fruit-sando shop.", maps:"fruits and season 恵比寿 フルーツサンド" },
  { id:"hatoya", best:"Matcha latte topped with matcha gelato", name:"Hatoya Shibuya", tag:"Matcha / sweets", city:"Tokyo", area:"Kamiyamacho", meal:"snack", address:"1F AISK Bldg, 3-8 Kamiyamacho, Shibuya-ku", lat:35.6650, lng:139.6930, hours:"8:00–18:00", closed:"Irregular", station:"Yoyogi-koen (~500m)", reservation:"no", coords:"low", note:"Kyoto-origin tea brand; matcha latte + gelato. Verify pin.", maps:"Hatoya Shibuya 鳩屋 神山町 抹茶" },
  { id:"yoroniku", best:"Premium yakiniku omakase cuts", name:"Yoroniku", tag:"High-end yakiniku", city:"Tokyo", area:"Minami-Aoyama", meal:"dinner", address:"B1F Luna Rossa, 6-6-22 Minami-Aoyama, Minato-ku", lat:35.6597, lng:139.7185, hours:"Wkdy 18:00–24:00; wknd from 17:00", closed:"NY only", station:"Omotesando (8 min)", reservation:"required", coords:"medium", note:"Tabelog Hyakumeiten; very hard to book.", maps:"よろにく 南青山 6-6-22" },
  { id:"sato-briand", best:"Chef-grilled premium yakiniku", name:"SATO Briand Honten", tag:"Premium yakiniku", city:"Tokyo", area:"Asagaya", meal:"dinner", address:"1F Arai Bldg, 3-44-2 Asagaya-minami, Suginami-ku", lat:35.7035, lng:139.6357, hours:"Dinner ~17:00–23:00 (course seatings)", closed:"Irregular", station:"Asagaya (2 min)", reservation:"required", coords:"medium", note:"Staff grill everything; book via satobriand.yoyaku.at.", maps:"SATOブリアン 本店 阿佐ヶ谷南3-44-2" },
  { id:"pizza-marumo", best:"Award-winning Neapolitan margherita", name:"pizza marumo (Mamuro)", tag:"Neapolitan pizza", city:"Tokyo", area:"Ebisu", meal:"dinner", address:"1F Ebisu Verso Bldg, 1-11-13 Ebisu-Minami, Shibuya-ku", lat:35.6460, lng:139.7100, hours:"Lunch 11:30–15:00; dinner 17:00–23:00", closed:"Wednesday", station:"Ebisu (3 min)", reservation:"recommended", coords:"low", note:"Likely your 'pizza mamuro'; chef ranked world top-10 pizzaiolo.", maps:"pizza marumo 恵比寿南1-11-13" },

  // ---- Shinjuku / west / Kagurazaka / Ikebukuro / Kichijoji ----
  { id:"tatsunoya-shinjuku", best:"Hakata tonkotsu ramen", name:"Ramen Tatsunoya Shinjuku", tag:"Tonkotsu ramen", city:"Tokyo", area:"Nishi-Shinjuku", meal:"lunch", address:"7-4-5 Nishi-Shinjuku, Shinjuku-ku", lat:35.6953, lng:139.6997, hours:"11:00–22:00", closed:"Tuesday", station:"Seibu-Shinjuku (2 min)", reservation:"no", coords:"medium", note:"Hakata tonkotsu; Tokyo-only tsukemen motsu.", maps:"ラーメン龍の家 新宿小滝橋通り店" },
  { id:"unatetsu-hanare", best:"Charcoal-grilled unagi over rice", name:"Shinjuku Unatetsu Hanare", tag:"Unagi (eel)", city:"Tokyo", area:"Kabukicho", meal:"dinner", address:"1-22-2 Kabukicho, Shinjuku-ku", lat:35.6952, lng:139.7036, hours:"11:00–24:30 (LO 24:00)", closed:"Dec 31–Jan 2", station:"Seibu-Shinjuku (1 min)", reservation:"recommended", coords:"medium", note:"60+ year unagi specialist, 3rd branch.", maps:"新宿うな鐵 はなれ 歌舞伎町" },
  { id:"jones-cafe", best:"NYC-style breakfast & brunch", name:"The Jones Cafe & Bar", tag:"All-day cafe / bar", city:"Tokyo", area:"Nishi-Shinjuku", meal:"anytime", address:"1F Kimpton Shinjuku, 3-4-7 Nishi-Shinjuku, Shinjuku-ku", lat:35.6909, lng:139.6905, hours:"Bfast 8:00–11:00; lunch–dinner to 22:00", closed:"Open daily", station:"Nishi-Shinjuku (5 min)", reservation:"recommended", coords:"high", note:"In Kimpton Shinjuku; NYC-inspired.", maps:"The Jones Cafe Bar Kimpton Shinjuku Tokyo" },
  { id:"mister-donut", best:"Pon de Ring chewy donuts", name:"Mister Donut (Shinjuku)", tag:"Donuts", city:"Tokyo", area:"Shinjuku", meal:"snack", address:"1-2-1 Kabukicho, Shinjuku-ku", lat:35.6938, lng:139.7016, hours:"~6:00–02:00 (long hours)", closed:"Open daily", station:"Shinjuku / Seibu-Shinjuku (5 min)", reservation:"no", coords:"medium", note:"Many branches citywide — pick the nearest.", maps:"Mister Donut Shinjuku Yasukuni-dori" },
  { id:"baba-flat", best:"Bakery breads & sandwiches with coffee", name:"Baba FLAT (Pan to Coffee)", tag:"Bakery / coffee", city:"Tokyo", area:"Takadanobaba", meal:"breakfast", address:"1F Orange Court, 3-10-1 Okubo, Shinjuku-ku", lat:35.7088, lng:139.7045, hours:"08:30–19:00 (LO 18:30)", closed:"Irregular", station:"Nishi-Waseda / Takadanobaba (~0.5km)", reservation:"no", coords:"medium", note:"Bread, sandwiches & coffee near Takadanobaba.", maps:"パンとコーヒー 馬場FLAT 新宿区大久保3-10-1" },
  { id:"lambert", best:"Reservation-only matcha sweets set", name:"LAMBERT", tag:"Reservation matcha cafe", city:"Tokyo", area:"Hyakunincho", meal:"snack", address:"3-22-15 Hyakunincho, Shinjuku-ku", lat:35.7012, lng:139.6957, hours:"10:30–17:00", closed:"Check locally", station:"Okubo / Shin-Okubo (5 min)", reservation:"required", coords:"medium", note:"Reservation-only; 1 food + 1 drink per guest.", maps:"LAMBERT cafe Hyakunincho Shinjuku Tokyo" },
  { id:"400c-kagurazaka", best:"Reservation-only Neapolitan pizza", name:"400°C Pizza Kagurazaka", tag:"Neapolitan pizza", city:"Tokyo", area:"Kagurazaka", meal:"lunch", address:"1F kif annex, 13-1 Wakamiya-cho, Shinjuku-ku", lat:35.7019, lng:139.7363, hours:"11:00–16:00 (reservation-only)", closed:"Tuesday", station:"Ushigome-Kagurazaka", reservation:"required", coords:"medium", note:"Fully reservation-based; book IG @kagurazaka400do.", maps:"400℃ PIZZA TOKYO 神楽坂 新宿区若宮町13-1" },
  { id:"brunch-no4", best:"Brioche French toast & brunch", name:"No.4 (Number Four)", tag:"Bakery cafe / brunch", city:"Tokyo", area:"Yonbancho", meal:"breakfast", address:"5-9 Yonbancho, Chiyoda-ku", lat:35.6907, lng:139.7390, hours:"8:00–21:00 (LO 20:30)", closed:"Check locally", station:"Kojimachi (3 min)", reservation:"no", coords:"medium", note:"By T.Y.Harbor; brioche French toast in the morning.", maps:"No.4 カフェ 千代田区四番町5-9" },
  { id:"hikiniku-kichijoji", best:"Charcoal hamburg steak with rice", name:"Hikiniku to Come Kichijoji", tag:"Charcoal hamburg & rice", city:"Tokyo", area:"Kichijoji", meal:"lunch", address:"2-8-3 Kichijoji Honcho, Musashino-shi", lat:35.7053, lng:139.5793, hours:"Lunch 11:00–15:00; dinner 17:00–21:00", closed:"Wednesday", station:"Kichijoji (7 min)", reservation:"required", coords:"medium", note:"Same-day ticket from ~9am at the door; arrive early.", maps:"挽肉と米 吉祥寺 武蔵野市吉祥寺本町2-8-3" },
  { id:"sen-ikebukuro", best:"Thick-noodle tsukemen", name:"Sen (遷)", tag:"Tsukemen ramen", city:"Tokyo", area:"Ikebukuro", meal:"lunch", address:"Near Ikebukuro West Exit, Toshima-ku", lat:35.7305, lng:139.7090, hours:"Check IG @sen_tokyoikebukuro", closed:"Unknown", station:"Ikebukuro (West, 3 min)", reservation:"no", coords:"low", note:"Opened Sept 2025; thick-noodle tsukemen. Details still emerging.", maps:"遷 sen 池袋 つけ麺" },
  { id:"menya-sugou", best:"Creamy chicken-paitan ramen", name:"Menya Sugou — Tori no Toriko", tag:"Chicken-paitan ramen", city:"Tokyo", area:"Shimbashi", meal:"lunch", address:"Hiro Bldg, 2-11-2 Shimbashi, Minato-ku", lat:35.6678, lng:139.7565, hours:"11:30–15:30 & 17:30–22:00", closed:"Check locally", station:"Uchisaiwaicho / Shimbashi (2–3 min)", reservation:"no", coords:"low", note:"In Shimbashi (not Sangenjaya).", maps:"麺屋周郷 鶏のとりこ 新橋" },
  { id:"konas-coffee", best:"Hawaiian-style fluffy pancakes", name:"Kona's Coffee (Seijo)", tag:"Hawaiian pancakes", city:"Tokyo", area:"Seijo / Chofu", meal:"snack", address:"1-41-1 Irimacho, Chofu-shi", lat:35.6447, lng:139.5818, hours:"Wkdy 10:00–22:00; wknd from 9:00", closed:"Irregular", station:"Roadside (not station-close)", reservation:"no", coords:"low", note:"Suburban chain — pick a branch that fits your route.", maps:"コナズ珈琲 成城店 調布市入間町1-41-1" },
  { id:"eteco-bread", best:"Artisan bakery breads (sells out)", name:"etéco bread", tag:"Bakery", city:"Tokyo", area:"Ikenoue / Shimokitazawa", meal:"breakfast", address:"2-42-7 Daizawa, Setagaya-ku", lat:35.6605, lng:139.6692, hours:"From 9:00 until sold out", closed:"Mon, Tue, Fri (varies)", station:"Ikenoue (1 min)", reservation:"no", coords:"medium", note:"Cash only; arrive early. Check IG @eteco_bread.", maps:"eteco bread Ikenoue Setagaya Tokyo" },
  { id:"ishibashi", best:"Steamed-then-grilled unagi (eel)", name:"Ishibashi (石ばし)", tag:"Unagi kappo", city:"Tokyo", area:"Edogawabashi", meal:"dinner", address:"2-4-29 Suido, Bunkyo-ku", lat:35.7095, lng:139.7270, hours:"11:30–14:30 & 18:00–21:00 (varies)", closed:"Sun, Mon & holidays", station:"Edogawabashi (6 min)", reservation:"required", coords:"low", note:"Renowned EEL restaurant (since 1910) — not sukiyaki. Allow time; book ahead.", maps:"石ばし 江戸川橋 文京区水道2-4-29" },
  { id:"pizza-pst", best:"Charred Neapolitan margherita", name:"Pizza Studio Tamaki (PST)", tag:"Neapolitan pizza", city:"Tokyo", area:"Higashi-Azabu", meal:"dinner", address:"1-24-6-105 Higashi-Azabu, Minato-ku", lat:35.6562, lng:139.7430, hours:"Tue–Fri 17:00–23:00; wknd 12:00–22:00", closed:"Monday", station:"Akabanebashi (3 min)", reservation:"recommended", coords:"medium", note:"Limited seats, long queues — book ahead.", maps:"PIZZA STUDIO TAMAKI 東麻布1-24-6 港区" },
  { id:"tachigui-hiroya", best:"Edomae standing-sushi course", name:"Tachigui-zushi Hiroya", tag:"Standing sushi", city:"Tokyo", area:"Shibadaimon", meal:"dinner", address:"1-4-4 Shibadaimon, Minato-ku", lat:35.6577, lng:139.7541, hours:"Lunch 12:00–14:00; dinner 17:00–22:00", closed:"Irregular", station:"Daimon / Hamamatsucho (3 min)", reservation:"recommended", coords:"medium", note:"High-quality standing sushi — courses from ~¥5,000 (not cheap).", maps:"立喰い鮨 浩也 芝大門1-4-4" },
  { id:"eggcellent", best:"Eggs benedict on house muffins", name:"eggcellent", tag:"Eggs benedict", city:"Tokyo", area:"Roppongi", meal:"breakfast", address:"Roppongi Hills Hillside B1F, 6-10-1 Roppongi, Minato-ku", lat:35.6594, lng:139.7290, hours:"Wkdy 7:00–21:00; wknd from 8:00", closed:"Open daily", station:"Roppongi (connected)", reservation:"no", coords:"high", note:"Organic-egg breakfast specialist. Confirm it's open.", maps:"エッグセレント 六本木ヒルズ ヒルサイドB1" },
  { id:"balcony-6th", best:"Italian cafe plates & desserts", name:"Balcony by 6th (was '6th by Oriental Hotel')", tag:"Cafe / Italian", city:"Tokyo", area:"Azabudai Hills", meal:"anytime", address:"3F Tower Plaza, Azabudai Hills, 1-3-1 Azabudai, Minato-ku", lat:35.6627, lng:139.7393, hours:"~11:00–23:00", closed:"Check locally", station:"Kamiyacho / Toranomon Hills (5 min)", reservation:"recommended", coords:"medium", note:"The old Yurakucho '6th' relocated here in 2023.", maps:"Balcony by 6th Azabudai Hills Tokyo" },
  { id:"milkland", best:"Hokkaido milk soft serve", name:"Milkland Hokkaido → Tokyo", tag:"Dairy cafe / soft serve", city:"Tokyo", area:"Jiyugaoka", meal:"snack", address:"1-26-16 Jiyugaoka, Meguro-ku", lat:35.6090, lng:139.6685, hours:"11:00–19:00", closed:"Wednesday", station:"Jiyugaoka (3 min)", reservation:"no", coords:"medium", note:"Hokuren dairy cafe; Hokkaido milk soft serve.", maps:"MILKLAND HOKKAIDO TOKYO 自由が丘1-26-16" },
  { id:"asako-iwayanagi", best:"Artistic seasonal fruit parfaits", name:"Pâtisserie Asako Iwayanagi", tag:"Artistic parfaits", city:"Tokyo", area:"Todoroki", meal:"snack", address:"4-4-5 Todoroki, Setagaya-ku", lat:35.6066, lng:139.6418, hours:"Tue–Sun 10:00–19:00", closed:"Monday", station:"Todoroki (5 min)", reservation:"recommended", coords:"medium", note:"Famous parfaits (~¥5,000); salon takes bookings via TableCheck.", maps:"Patisserie Asako Iwayanagi Todoroki Setagaya Tokyo" },

  // ---- Osaka ----
  { id:"grenier-umeda", best:"Hand-held brûlée mille-feuille", name:"grenier Umeda", tag:"Brûlée mille-feuille", city:"Osaka", area:"Umeda", meal:"snack", address:"Hankyu Grand Bldg 1F, 8-47 Kakuda-cho, Kita-ku", lat:34.7039, lng:135.4994, hours:"10:00–20:00", closed:"Follows building", station:"Osaka-Umeda (1 min)", reservation:"no", coords:"high", note:"Hand-held brûlée mille-feuille.", maps:"grenier 梅田 阪急グランドビル 大阪市北区角田町8-47" },
  { id:"kitan-hibiki", best:"Aged-wagyu burger (lunch only)", name:"Kitan Hibiki", tag:"Wagyu burger / yakiniku", city:"Osaka", area:"Namba", meal:"lunch", address:"1-1-7 Namba, Chuo-ku", lat:34.6655, lng:135.5022, hours:"Lunch ~12:00–15:00; dinner 17:00–23:00", closed:"Irregular", station:"Namba (5 min)", reservation:"recommended", coords:"medium", note:"Aged-wagyu burger (w/ Gui's Burger) at lunch & 17:00–19:00.", maps:"㐂舌響 KITAN HIBIKI 難波 大阪市中央区難波1-1-7" },
  { id:"mooken", best:"Caramel-top mini cream puffs", name:"MooKEN", tag:"Mini cream puffs", city:"Osaka", area:"Shinsaibashi", meal:"snack", address:"1-5-26 Shinsaibashisuji, Chuo-ku", lat:34.6720, lng:135.5012, hours:"11:00 – until sold out", closed:"Mon & Tue", station:"Shinsaibashi (4 min)", reservation:"no", coords:"medium", note:"Caramel-top mini cream puffs (choux), not shumai.", maps:"MooKEN モーケン 心斎橋筋1-5-26 大阪" },
  { id:"gariguette-osaka", best:"Strawberry 'Napoleon' mille-feuille", name:"GARIGUETTE Osaka", tag:"Mille-feuille", city:"Osaka", area:"Umeda", meal:"snack", address:"Grand Front Osaka, Umekita Plaza 1F, 4-1 Ofuka-cho, Kita-ku", lat:34.7050, lng:135.4948, hours:"11:00–19:00 (eat-in LO 18:30)", closed:"Follows building", station:"Osaka (Umekita)", reservation:"no", coords:"high", note:"Hand-held 'mille presse'; Napoleon ~¥1,200.", maps:"GARIGUETTE グランフロント大阪 うめきた広場" },
  { id:"gorichan", best:"Overstuffed handmade onigiri", name:"Onigiri Gorichan", tag:"Onigiri", city:"Osaka", area:"Nakazakicho", meal:"breakfast", address:"1-5-20 Nakazakicho, Kita-ku", lat:34.7080, lng:135.5074, hours:"07:00–20:00 (until sold out)", closed:"Irregular", station:"Nakazakicho (1 min)", reservation:"no", coords:"medium", note:"Big overstuffed onigiri; expect queues.", maps:"おにぎり ごりちゃん 中崎町 大阪市北区中崎町1-5-20" },
  { id:"canele-japon", best:"Japanese-flavour canelé", name:"Canelé du Japon (Sakuragawa)", tag:"Canelé", city:"Osaka", area:"Sakuragawa", meal:"snack", address:"1-6-24 Sakuragawa, Naniwa-ku", lat:34.6660, lng:135.4878, hours:"10:00–19:00 (or sold out)", closed:"Wednesday", station:"Sakuragawa (5 min)", reservation:"no", coords:"medium", note:"Japanese-flavoured canelé; good for gifts.", maps:"カヌレ堂 CANELÉ du JAPON 桜川店 大阪市浪速区桜川1-6-24" },
  { id:"amato-maeda", best:"Hot mitarashi dango", name:"Amato Maeda (Namba Walk)", tag:"Mitarashi dango", city:"Osaka", area:"Namba", meal:"snack", address:"Namba Walk, 1-5-12 Sennichimae, Chuo-ku", lat:34.6648, lng:135.5036, hours:"~10:00–21:00 (mall hours)", closed:"Follows Namba Walk", station:"Nippombashi / Namba (2 min)", reservation:"no", coords:"medium", note:"Hot mitarashi dango, 50+ year sauce. In the underground arcade.", maps:"甘党まえだ なんばウォーク 大阪市中央区千日前1-5-12" },
  { id:"wagyu-kingdom", best:"Kobe-beef yakiniku platter", name:"Wagyu Kingdom (WAGYU王国)", tag:"Kobe/Omi wagyu yakiniku", city:"Osaka", area:"Shinsaibashi / Dotonbori", meal:"dinner", address:"2-2-31 Shinsaibashisuji, Chuo-ku", lat:34.6695, lng:135.5010, hours:"11:30–24:00 (Fri/Sat to 03:00)", closed:"Open daily", station:"Namba / Nippombashi", reservation:"recommended", coords:"low", note:"Kobe Beef 'Tamatebako' platters. Verify exact storefront.", maps:"WAGYU王国 心斎橋筋2-2-31 大阪 神戸ビーフ wagyuハウス" },
  { id:"batten-yokato", best:"Hakata corn & pork-rib skewers", name:"Batten Yokato (Amerikamura)", tag:"Hakata yakitori", city:"Osaka", area:"Amerikamura", meal:"dinner", address:"2-4-11 Nishi-Shinsaibashi, Chuo-ku", lat:34.6715, lng:135.4985, hours:"16:00–02:00", closed:"Open daily", station:"Namba (3 min)", reservation:"recommended", coords:"medium", note:"Hakata-style skewers; famous corn & pork-rib.", maps:"バッテンよかとぉ アメリカ村店 大阪市中央区西心斎橋2-4-11" },
  { id:"sundi", best:"Cheap snacks & drinks (supermarket)", name:"Sundi (discount supermarket)", tag:"Cheap snacks / groceries", city:"Osaka", area:"Kishinosato", meal:"anytime", address:"1-9-9 Shioji, Nishinari-ku", lat:34.6320, lng:135.4945, hours:"10:00–19:30", closed:"Open daily", station:"Kishinosato (1 min)", reservation:"no", coords:"medium", note:"It's a Kansai discount supermarket chain — good for cheap snacks/drinks, not a cafe.", maps:"サンディ 岸里駅前店 大阪市西成区潮路1-9-9" },

  // ---- night-1 essentials + later additions ----
  { id:"ichiran-shimbashi", best:"Tonkotsu ramen in solo booths (24h)", name:"Ichiran Shimbashi", tag:"Tonkotsu ramen (24h)", city:"Tokyo", area:"Shimbashi", meal:"dinner", address:"B1F Karasu-tei Bldg, 2-8-8 Shimbashi, Minato-ku", lat:35.6664, lng:139.7575, hours:"24 hours", closed:"Open daily", station:"Shimbashi (3 min)", reservation:"no", coords:"medium", note:"Nearest operating Ichiran to the hotel — the Ginza branch closed in 2022. Solo booths, ticket machine, open all night.", maps:"一蘭 新橋店" },
  { id:"familymart-ginza", best:"Konbini: egg sando, Famichiki, ATM", name:"FamilyMart Ginza 1-chome", tag:"Convenience store (24h)", city:"Tokyo", area:"Ginza", meal:"snack", address:"1-16-7 Ginza, Chuo-ku", lat:35.6736, lng:139.7672, hours:"24 hours", closed:"Open daily", station:"Ginza-itchome (2 min)", reservation:"no", coords:"medium", note:"Nearest 24h konbini to Hotel Sunroute Ginza (~200 m). Late-night snacks, drinks, ATM.", maps:"ファミリーマート 銀座一丁目店" },
  { id:"cowcow-kitchen", best:"Fresh milk pie & cream puffs", name:"Cow Cow Kitchen (Tokyo Milk Cheese Factory)", tag:"Milk pie / cream puffs", city:"Tokyo", area:"Akihabara (+ branches)", meal:"snack", address:"Atre Akihabara 1, 1-17-6 Soto-Kanda, Chiyoda-ku", lat:35.6985, lng:139.7745, hours:"~10:00–21:00 (varies by branch)", closed:"Follows building", station:"Akihabara", reservation:"no", coords:"medium", note:"Takeout brand of Tokyo Milk Cheese Factory — fresh milk pie & cream puffs. Also at Shinjuku, Roppongi, Kita-Senju.", maps:"東京ミルクチーズ工場 カウカウキッチン アトレ秋葉原" },
  { id:"shirotae-akasaka", best:"¥270 rare (no-bake) cheesecake", name:"Shirotae (Seiyo-gashi Shirotae)", tag:"Cheesecake", city:"Tokyo", area:"Akasaka", meal:"snack", address:"4-1-4 Akasaka, Minato-ku (Nakanishi Bekkan Bldg)", lat:35.6745, lng:139.7370, hours:"~10:30–19:30", closed:"Sunday (verify)", station:"Akasaka-mitsuke (3 min)", reservation:"no", coords:"medium", note:"Your '赤坂中西別館ビル' = this shop. Since 1976; tiny ¥270 rare (no-bake) cheesecake.", maps:"西洋菓子しろたえ 赤坂" },
  { id:"tas-yard", best:"Veg curry in a plant-shop cafe", name:"Tas Yard", tag:"Cafe / plant shop", city:"Tokyo", area:"Sendagaya", meal:"lunch", address:"3-3-14 Sendagaya, Shibuya-ku", lat:35.6770, lng:139.7080, hours:"~11:30–18:00 (varies)", closed:"Irregular", station:"Kita-sando (5 min)", reservation:"no", coords:"medium", note:"Cafe + botanical shop by Landscape Products; veg curry & pasta. Check IG @tasyard.", maps:"Tas Yard 千駄ヶ谷" },
  { id:"shigekuni", best:"Crêpe with salted fermented butter", name:"Shigekuni", tag:"Cafe / bakery / bistro", city:"Tokyo", area:"Ebisu", meal:"breakfast", address:"1-14-15 Ebisu-Minami, Shibuya-ku", lat:35.6455, lng:139.7100, hours:"Cafe 9:00–15:00 (Sun to 17:00); bistro 17:30–23:00", closed:"Mon & Tue", station:"Ebisu (3 min)", reservation:"recommended", coords:"medium", note:"Bakery-cafe by day, French bistro by night; known for crêpes.", maps:"繁邦 Shigekuni 恵比寿" },

  // ---- Asakusa street snacks (temple-day cluster) ----
  { id:"asakusa-unana", best:"Charcoal-grilled eel onigiri", name:"Asakusa Unana", tag:"Grilled eel onigiri", city:"Tokyo", area:"Asakusa", meal:"snack", address:"2-7-21 Asakusa, Taito-ku", lat:35.7146, lng:139.7945, hours:"Wkdy 9:00–17:30; wknd 9:00–18:30", closed:"Wednesday", station:"Asakusa (5 min)", reservation:"no", coords:"high", note:"Binchotan-grilled domestic eel onigiri (~¥600); West Sando, expect a line.", maps:"浅草うなな 浅草2-7-21" },
  { id:"imo-pippi", best:"Roasted sweet-potato crème brûlée", name:"Imo Pippi", tag:"Sweet-potato crème brûlée", city:"Tokyo", area:"Asakusa", meal:"snack", address:"2-3-24 Asakusa, Taito-ku", lat:35.7138, lng:139.7955, hours:"11:00–18:00 (until sold out)", closed:"Irregular", station:"Asakusa (4 min)", reservation:"no", coords:"high", note:"Viral roasted sweet-potato brûlée + silky purple-imo with ice cream.", maps:"芋ぴっぴ 浅草店 浅草2-3-24" },
  { id:"tokyo-curry-pan", best:"Fried-to-order curry bread", name:"Tokyo Curry Pan (Kaminarimon)", tag:"Curry bread", city:"Tokyo", area:"Asakusa", meal:"snack", address:"1-20-4 Asakusa, Taito-ku", lat:35.7117, lng:139.7958, hours:"11:00–17:00", closed:"Check locally", station:"Asakusa (3 min)", reservation:"no", coords:"high", note:"Fried-to-order curry bread. Also a West Sando branch (2-7-13).", maps:"東京カレーパン 浅草雷門店 浅草1-20-4" },
  { id:"asakusa-ichigoza", best:"One-bite strawberry daifuku", name:"Asakusa Ichigoza", tag:"Strawberry daifuku", city:"Tokyo", area:"Asakusa", meal:"snack", address:"2-1-3 Asakusa, Taito-ku", lat:35.7129, lng:139.7951, hours:"10:00–18:00", closed:"Tuesday", station:"Asakusa (5 min)", reservation:"no", coords:"medium", note:"Asakusa's famous one-bite strawberry daifuku (koshian, choc, pistachio…). Several branches.", maps:"浅草苺座 浅草2-1-3" },
  { id:"anshinya", best:"Face-sized Taiwanese fried chicken", name:"Asakusa Anshinya", tag:"Taiwanese fried chicken", city:"Tokyo", area:"Asakusa", meal:"snack", address:"1-37-11 Asakusa, Taito-ku", lat:35.7136, lng:139.7948, hours:"~10:45 until sold out", closed:"Open daily", station:"Asakusa (5 min, Denboin-dori)", reservation:"no", coords:"high", note:"Viral face-sized Taiwanese fried chicken (zha ji pai); often sells out early.", maps:"浅草 安心や 浅草1-37-11" },
  { id:"asakusa-kagetsudo", best:"Jumbo melonpan", name:"Asakusa Kagetsudo", tag:"Jumbo melonpan", city:"Tokyo", area:"Asakusa", meal:"snack", address:"2-7-13 Asakusa, Taito-ku", lat:35.7147, lng:139.7943, hours:"9:00–16:30 (or sold out)", closed:"Open daily", station:"Asakusa (7 min, West Sando)", reservation:"no", coords:"high", note:"Famous palm-sized jumbo melonpan; sells out by late afternoon.", maps:"浅草花月堂 本店 浅草2-7-13" },
  { id:"imoya-kinjiro", best:"Freshly fried imo-kenpi & purple-imo soft serve", name:"Imoya Kinjiro (Nihonbashi)", tag:"Fried imo-kenpi / sweet potato", city:"Tokyo", area:"Nihonbashi", meal:"snack", address:"1F COREDO Muromachi 2, 2-3-1 Nihonbashi-Muromachi, Chuo-ku", lat:35.6872, lng:139.7735, hours:"11:00–20:00", closed:"Open daily", station:"Mitsukoshimae (Exit A6)", reservation:"no", coords:"high", note:"Freshly fried imo-kenpi (Nihonbashi-only olive-oil blend, ¥500) + purple-imo soft serve. Takeout only.", maps:"芋屋金次郎 日本橋店 コレド室町2" },

  { id:"yakiniku-inoue-ginza", name:"Yakiniku Inoue Ginza", best:"Smoke-bubble wagyu yukhoe + A5 tongue & harami", tag:"Wagyu yakiniku", city:"Tokyo", area:"Ginza", meal:"dinner", address:"1-6-6 Ginza, Chuo-ku", lat:35.6745, lng:139.7669, hours:"Wkdy lunch 11:00–15:00, dinner 17:00–23:00; wknd 11:00–23:00 (LO 22:00)", closed:"Dec 31 & Jan 1 only", station:"Ginza-itchome (1 min, Exit 6)", reservation:"recommended", coords:"medium", note:"Ginza honten; A4/A5 Kuroge wagyu. Signature smoked yukhoe burst tableside. Branches also in Kichijoji & Shibuya.", maps:"東京焼肉いのうえ 銀座本店 銀座" },

  // ---- later additions ----
  { id:"yakiniku-maruushi-ginza", name:"Yakiniku Maruushi Ginza Honten", best:"A4/A5 kuroge wagyu course; rooftop seats", tag:"Wagyu yakiniku", city:"Tokyo", area:"Ginza", meal:"dinner", address:"8F Ginza First Five Bldg, 1-5-10 Ginza, Chuo-ku", lat:35.6745, lng:139.7669, hours:"Mon–Fri 17:00–23:00; wknd 17:00–22:00", closed:"Open daily (dinner only)", station:"Ginza-itchome (Exit 5, 1 min)", reservation:"recommended", coords:"medium", note:"Affordable A4–A5 wagyu; flagship of the Maruushi group (2-chome branch nearby).", maps:"焼肉 マルウシ 銀座本店 銀座" },
  { id:"miyata-menji", name:"Kaettekita Miyata Menji", best:"Komugi no Daiginjo tsukemen", tag:"Tsukemen ramen", city:"Osaka", area:"Higashi-Shinsaibashi", meal:"lunch", address:"1-13-5 Higashi-Shinsaibashi, Chuo-ku", lat:34.6735, lng:135.5045, hours:"Tue–Fri 11:00–15:30 & 17:30–21:00; wknd 11:00–15:00 & 17:30–21:00", closed:"Monday (sells out early)", station:"Nagahoribashi / Shinsaibashi", reservation:"no", coords:"medium", note:"Tsukemen shop by comedian Tetsuji; now revived in central Osaka (no longer Esaka). Check it's open before going.", maps:"帰ってきた宮田麺児 東心斎橋" },
  { id:"egg-baby-cafe", name:"egg baby cafe", best:"Soft-boiled egg sando + firm pudding", tag:"Egg cafe", city:"Tokyo", area:"Okachimachi", meal:"breakfast", address:"5-10-9 Ueno, Taito-ku (AKI-OKA, under the tracks)", lat:35.7075, lng:139.7745, hours:"10:00–22:00 (food LO 21:00)", closed:"Check locally", station:"Okachimachi (2 min)", reservation:"no", coords:"medium", note:"Egg-specialty cafe under the JR tracks in Okachimachi/Ueno (not Shinjuku). Omelets, egg sando, pudding.", maps:"egg baby cafe エッグベイビーカフェ 御徒町" },

  // ---- Theme park ----
  { id:"usj", best:"Super Nintendo World, Harry Potter & more", name:"Universal Studios Japan", tag:"Theme park — all-day", city:"Osaka", area:"Konohana (Universal City)", meal:"attraction", address:"2-1-33 Sakurajima, Konohana-ku, Osaka", lat:34.6654, lng:135.4323, hours:"~9:00–21:00 (varies daily)", closed:"Open daily", station:"Universal City (5 min)", reservation:"required", coords:"high", note:"No re-entry once you leave — eat inside. Express Pass timed slots: Nintendo World 17:20–18:20. Download the USJ app for Area Timed Entry.", maps:"Universal Studios Japan" }
];

/* --------------------------- DAY PLAN ------------------------------ */
/* Suggested only — flexible. Each item references a spot id + meal slot.
   I clustered by area near your hotel that day and respected closed days
   where I could. Reservation spots are flagged on the cards. */
const ITINERARY = [
  { date:"2026-08-07", hotel:"sunroute-ginza", title:"Arrive Tokyo → Ginza",
    note:"Land Narita 19:00 — first night kept easy: nearest Ichiran (Shimbashi, 24h, since the Ginza branch closed) + grab essentials at the 24h FamilyMart by the hotel.",
    items:[ {meal:"dinner", spot:"ichiran-shimbashi"}, {meal:"snack", spot:"familymart-ginza"} ] },

  { date:"2026-08-08", hotel:"sunroute-ginza", title:"Ginza · Tsukiji · Nihonbashi",
    items:[ {meal:"breakfast", spot:"tsukiji-market"}, {meal:"snack", spot:"cloud-club-matcha"},
            {meal:"lunch", spot:"tsujihan-nihonbashi"}, {meal:"snack", spot:"imoya-kinjiro"},
            {meal:"snack", spot:"echire-marunouchi"}, {meal:"snack", spot:"hiiragi-ginza"},
            {meal:"snack", spot:"age3-ginza"},
            {meal:"dinner", spot:"yakiniku-inoue-ginza"}, {meal:"dinner", spot:"sushi-itsutsu"} ] },

  { date:"2026-08-09", hotel:"sunroute-ginza", title:"Shibuya · Harajuku · Omotesando",
    items:[ {meal:"breakfast", spot:"path"}, {meal:"snack", spot:"iam-donut"},
            {meal:"snack", spot:"amam-dacotan"}, {meal:"snack", spot:"the-matcha-tokyo"},
            {meal:"snack", spot:"hatoya"}, {meal:"snack", spot:"love-table"},
            {meal:"lunch", spot:"menya-musashi-shibuya"}, {meal:"lunch", spot:"tas-yard"},
            {meal:"snack", spot:"onibus-nakameguro"},
            {meal:"dinner", spot:"yoroniku"}, {meal:"dinner", spot:"pizza-marumo"} ] },

  { date:"2026-08-10", hotel:"aman-tokyo", title:"Move to Aman · Marunouchi",
    note:"Check out Sunroute → Aman (Otemachi). Mon: Ginza Hachigo / Path closed.",
    items:[ {meal:"breakfast", spot:"front-room"}, {meal:"lunch", spot:"rokurinsha"},
            {meal:"snack", spot:"butter-biei"},
            {meal:"dinner", spot:"tachigui-hiroya"} ] },

  { date:"2026-08-11", hotel:"fairfield-osaka-namba", title:"Shinkansen to Osaka (Namba)",
    note:"Breakfast at Aman (included), then check out → Tokyo to Shin-Osaka (~2h30 Nozomi). Osaka in the afternoon — Umeda on the way to Namba.",
    items:[ {meal:"breakfast", text:"Breakfast included at Aman Tokyo (FHR daily breakfast for two) — enjoy before checkout (guaranteed 4 pm)."},
            {meal:"snack", spot:"grenier-umeda"},
            {meal:"snack", spot:"amato-maeda"},
            {meal:"dinner", spot:"batten-yokato"} ] },

  { date:"2026-08-12", hotel:"fairfield-osaka-namba", title:"Universal Studios Japan 🎢",
    note:"All-day at USJ — NO re-entry once inside, so eat in the park. Show the Express Pass often (it's the orange button). Nintendo World timed entry 17:20–18:20; download the USJ app for Area Timed Entry tickets.",
    tickets:{
      express:[ {label:"Express Pass · Eric", pdf:"pdfs/usj-express-1.pdf"}, {label:"Express Pass · Megan", pdf:"pdfs/usj-express-2.pdf"} ],
      entry:[ {label:"Studio Pass · Eric", pdf:"pdfs/usj-studio-pass-1.pdf"}, {label:"Studio Pass · Megan", pdf:"pdfs/usj-studio-pass-2.pdf"} ]
    },
    items:[ {meal:"attraction", spot:"usj"} ] },

  { date:"2026-08-13", hotel:"doubletree-osaka-castle", title:"Osaka food day → Osaka Castle",
    note:"Check out Fairfield → DoubleTree (Osaka Castle). The big Osaka eating day (Umeda + Shinsaibashi + Namba).",
    items:[ {meal:"breakfast", spot:"gorichan"}, {meal:"snack", spot:"gariguette-osaka"},
            {meal:"lunch", spot:"kitan-hibiki"}, {meal:"lunch", spot:"miyata-menji"},
            {meal:"snack", spot:"mooken"}, {meal:"snack", spot:"canele-japon"},
            {meal:"dinner", spot:"wagyu-kingdom"} ] },

  { date:"2026-08-14", hotel:"knot-shinjuku", title:"Shinkansen back to Tokyo (Shinjuku)",
    note:"Check out DoubleTree → Shin-Osaka to Tokyo. KNOT Shinjuku in the evening.",
    items:[ {meal:"dinner", spot:"unatetsu-hanare"}, {meal:"snack", spot:"mister-donut"} ] },

  { date:"2026-08-15", hotel:"knot-shinjuku", title:"West Tokyo · Kichijoji + Shinjuku",
    items:[ {meal:"breakfast", spot:"jones-cafe"}, {meal:"breakfast", spot:"eteco-bread"},
            {meal:"lunch", spot:"hikiniku-kichijoji"},
            {meal:"snack", spot:"kuriya-kurogi"}, {meal:"snack", spot:"lambert"},
            {meal:"dinner", spot:"tatsunoya-shinjuku"} ] },

  { date:"2026-08-16", hotel:"keisei-monzennakacho", title:"Move to Monzen-nakacho",
    note:"Check out KNOT → Keisei Richmond (Koto). Kagurazaka on the way east.",
    items:[ {meal:"breakfast", spot:"brunch-no4"}, {meal:"lunch", spot:"400c-kagurazaka"} ] },

  { date:"2026-08-17", hotel:"keisei-monzennakacho", title:"Senso-ji temple + Asakusa snack crawl",
    note:"Temple day — graze your way around Asakusa. Many of these are on/near the West Sando street and sell out by afternoon, so go earlier.",
    items:[ {meal:"breakfast", spot:"popo-sandwich"},
            {meal:"attraction", spot:"sensoji"},
            {meal:"lunch", spot:"wagyu-ichinoya"},
            {meal:"snack", spot:"asakusa-kagetsudo"}, {meal:"snack", spot:"asakusa-unana"},
            {meal:"snack", spot:"anshinya"}, {meal:"snack", spot:"tokyo-curry-pan"},
            {meal:"snack", spot:"imo-pippi"}, {meal:"snack", spot:"asakusa-ichigoza"},
            {meal:"snack", spot:"benizuru"},
            {meal:"snack", spot:"okoppe-milk"} ] },

  { date:"2026-08-18", hotel:"keisei-monzennakacho", title:"Roppongi · Azabu · Akasaka · Akihabara",
    items:[ {meal:"breakfast", spot:"balcony-6th"},
            {meal:"snack", spot:"shirotae-akasaka"}, {meal:"snack", spot:"cowcow-kitchen"},
            {meal:"lunch", spot:"roast-beef-ohno"},
            {meal:"snack", spot:"harbs"},
            {meal:"dinner", spot:"pizza-pst"}, {meal:"dinner", spot:"wagyu-dendo"} ] },

  { date:"2026-08-19", hotel:"keisei-monzennakacho", title:"Nakameguro · Ebisu · Todoroki",
    items:[ {meal:"breakfast", spot:"little-bakery"}, {meal:"snack", spot:"neel-nakameguro"},
            {meal:"lunch", spot:"edw-yellow"}, {meal:"snack", spot:"fruits-season"},
            {meal:"snack", spot:"asako-iwayanagi"}, {meal:"dinner", spot:"sato-briand"} ] },

  { date:"2026-08-20", hotel:"keisei-monzennakacho", title:"Last day → Narita",
    note:"Check out Keisei. Flight QF80 dep 20:25 — head to Narita by ~17:00 (Skyliner / NEX).",
    items:[ {meal:"lunch", spot:"ginza-hachigo"}, {meal:"snack", spot:"brulee-merize"} ] }
];

/* Remove placeholder skip entries */
const SPOTS_CLEAN = SPOTS.filter(function(s){ return !s.skip; });

/* =====================================================================
   SHOPPING — "Megan mode" (separate toggle). Anime/figurine merch removed;
   gachapon + arcades kept. good = what it's good to shop for.
   ===================================================================== */
const SHOPS = [
  // ---- GINZA ----
  { id:"ginza-six", name:"Ginza Six (GSIX)", cat:"Luxury mall", city:"Tokyo", area:"Ginza", cluster:"Ginza 6-chome", lat:35.6695, lng:139.7637, hours:"10:30–20:30", closed:"Open daily", station:"Ginza (A3, 2 min)", good:"Luxury fashion & beauty flagships + Le Labo (1F) + rooftop", maps:"GINZA SIX 銀座シックス", coords:"high" },
  { id:"dover-street-market-ginza", name:"Dover Street Market Ginza", cat:"Avant-garde fashion", city:"Tokyo", area:"Ginza", cluster:"Ginza 6-chome", lat:35.6705, lng:139.7642, hours:"11:00–20:00", closed:"Open daily", station:"Ginza (A2, 2 min)", good:"Comme des Garçons, cult designers, rare collabs", maps:"ドーバー ストリート マーケット ギンザ", coords:"high" },
  { id:"uniqlo-tokyo-ginza", name:"Uniqlo Tokyo (flagship)", cat:"Apparel flagship", city:"Tokyo", area:"Ginza", cluster:"Ginza 6-chome", lat:35.6722, lng:139.7656, hours:"11:00–21:00", closed:"Open daily", station:"Ginza-itchome (4, 2 min)", good:"Full Uniqlo range + UT collabs, embroidery", maps:"ユニクロ TOKYO 銀座", coords:"high" },
  { id:"mitsukoshi-ginza", name:"Mitsukoshi Ginza", cat:"Department store", city:"Tokyo", area:"Ginza", cluster:"Ginza 4-chome", lat:35.6716, lng:139.7649, hours:"10:00–20:00", closed:"Open daily", station:"Ginza (direct)", good:"Cosmetics hall + depachika sweets", maps:"銀座三越", coords:"high" },
  { id:"muji-ginza", name:"MUJI Ginza (flagship)", cat:"Lifestyle flagship", city:"Tokyo", area:"Ginza", cluster:"Ginza 4-chome", lat:35.6726, lng:139.7639, hours:"11:00–21:00", closed:"Open daily", station:"Ginza (B4, 3 min)", good:"Homeware, bakery & food market, MUJI Hotel", maps:"無印良品 銀座", coords:"high" },
  { id:"matsuya-ginza", name:"Matsuya Ginza", cat:"Department store", city:"Tokyo", area:"Ginza", cluster:"Ginza 4-chome", lat:35.6727, lng:139.7657, hours:"10:00–20:00", closed:"Open daily", station:"Ginza (A12, direct)", good:"Designer fashion + strong depachika", maps:"松屋銀座", coords:"high" },
  { id:"wako-ginza", name:"Wako", cat:"Luxury / watches", city:"Tokyo", area:"Ginza", cluster:"Ginza 4-chome", lat:35.6714, lng:139.7646, hours:"10:30–19:00", closed:"Open daily", station:"Ginza (B1, 1 min)", good:"Grand Seiko watches, jewellery, famous sweets", maps:"和光 銀座", coords:"high" },
  { id:"itoya-ginza", name:"Itoya (G.Itoya)", cat:"Stationery flagship", city:"Tokyo", area:"Ginza", cluster:"Ginza 1-2 chome", lat:35.6730, lng:139.7674, hours:"10:00–20:00 (Sun to 19:00)", closed:"Open daily", station:"Ginza (A13, 2 min)", good:"Premium pens, paper, washi, gifts", maps:"伊東屋 銀座本店", coords:"high" },
  { id:"loft-ginza", name:"Ginza Loft", cat:"Variety / lifestyle", city:"Tokyo", area:"Ginza", cluster:"Ginza 1-2 chome", lat:35.6736, lng:139.7670, hours:"11:00–21:00", closed:"Open daily", station:"Ginza-itchome (5, 1 min)", good:"Stationery, beauty gadgets, travel goods", maps:"銀座ロフト", coords:"high" },
  { id:"tokyu-plaza-ginza", name:"Tokyu Plaza Ginza", cat:"Mall + duty free", city:"Tokyo", area:"Ginza", cluster:"Ginza west", lat:35.6712, lng:139.7616, hours:"11:00–21:00", closed:"Open daily", station:"Ginza (C2/C3, 1 min)", good:"Fashion + Lotte Duty Free (8–9F) tax-free beauty/luxury", maps:"東急プラザ銀座", coords:"high" },
  { id:"donki-ginza", name:"Don Quijote Ginza", cat:"Discount / variety", city:"Tokyo", area:"Ginza", cluster:"Ginza west", lat:35.6676, lng:139.7619, hours:"24 hours", closed:"Open daily", station:"Shimbashi (3 min)", good:"Cheap snacks, cosmetics, souvenirs (tax-free)", maps:"ドン・キホーテ 銀座本館", coords:"medium" },
  { id:"matsukiyo-ginza", name:"Matsumoto Kiyoshi (Ginza)", cat:"Drugstore / cosmetics", city:"Tokyo", area:"Ginza", cluster:"Ginza 4-chome", lat:35.6720, lng:139.7635, hours:"10:00–22:00", closed:"Open daily", station:"Ginza (1–3 min)", good:"J-beauty, skincare, medicine, snacks (tax-free)", maps:"マツモトキヨシ 銀座", coords:"medium" },
  { id:"ginza-luxury-row", name:"Ginza Luxury Row (Chuo-dori)", cat:"Luxury flagships", city:"Tokyo", area:"Ginza", cluster:"Ginza 4-chome", lat:35.6717, lng:139.7653, hours:"~11:00–20:00", closed:"Open daily", station:"Ginza (4-chome crossing)", good:"Chanel, LV Namiki, Hermès, Dior, Cartier, Tiffany", maps:"銀座 中央通り 4丁目", coords:"high" },

  // ---- SHINJUKU ----
  { id:"isetan-shinjuku", name:"Isetan Shinjuku", cat:"Department store", city:"Tokyo", area:"Shinjuku", cluster:"Shinjuku-sanchome", lat:35.6917, lng:139.7044, hours:"10:00–20:00", closed:"Open daily", station:"Shinjuku-sanchome (B5)", good:"Japan's best beauty hall + depachika", maps:"伊勢丹新宿店", coords:"high" },
  { id:"beams-japan-shinjuku", name:"Beams Japan Shinjuku", cat:"Fashion flagship", city:"Tokyo", area:"Shinjuku", cluster:"Shinjuku-sanchome", lat:35.6906, lng:139.7038, hours:"11:00–20:00", closed:"Open daily", station:"Shinjuku-sanchome (E)", good:"Made-in-Japan fashion, craft & gifts", maps:"ビームス ジャパン 新宿", coords:"high" },
  { id:"lumine-est-shinjuku", name:"Lumine EST Shinjuku", cat:"Fashion mall", city:"Tokyo", area:"Shinjuku", cluster:"Shinjuku South", lat:35.6915, lng:139.7022, hours:"Wkdy 11:00–22:00; wknd 10:30–21:00", closed:"Open daily", station:"Shinjuku (East, direct)", good:"Trend women's fashion & cosmetics", maps:"ルミネエスト新宿", coords:"high" },
  { id:"marui-shinjuku", name:"Marui (0101) Shinjuku", cat:"Fashion dept store", city:"Tokyo", area:"Shinjuku", cluster:"Shinjuku-sanchome", lat:35.6907, lng:139.7048, hours:"11:00–20:30", closed:"Open daily", station:"Shinjuku-sanchome (A1)", good:"Mid-range fashion, shoes/sizes, subculture (Annex)", maps:"新宿マルイ", coords:"high" },
  { id:"newoman-shinjuku", name:"NEWoMan Shinjuku", cat:"Upscale mall", city:"Tokyo", area:"Shinjuku", cluster:"Shinjuku South", lat:35.6892, lng:139.7008, hours:"11:00–22:00", closed:"Open daily", station:"Shinjuku (New South, direct)", good:"Curated upscale fashion, beauty + Le Labo", maps:"ニュウマン新宿", coords:"high" },
  { id:"takashimaya-shinjuku", name:"Takashimaya Times Square", cat:"Dept store complex", city:"Tokyo", area:"Shinjuku", cluster:"Shinjuku South", lat:35.6878, lng:139.7028, hours:"10:00–20:00 (Fri/Sat to 20:30)", closed:"Open daily", station:"Shinjuku (New South, 2 min)", good:"Depachika + Hands + Kinokuniya foreign books", maps:"新宿高島屋タイムズスクエア", coords:"high" },
  { id:"yodobashi-shinjuku", name:"Yodobashi Camera Shinjuku West", cat:"Electronics", city:"Tokyo", area:"Shinjuku", cluster:"Shinjuku West/Kabukicho", lat:35.6900, lng:139.6976, hours:"9:30–22:00", closed:"Open daily", station:"Shinjuku (West, 3–5 min)", good:"Cameras, electronics, hobby (tax-free)", maps:"ヨドバシカメラ 新宿西口本店", coords:"high" },
  { id:"donki-shinjuku", name:"Don Quijote Kabukicho", cat:"Discount / variety", city:"Tokyo", area:"Shinjuku", cluster:"Shinjuku West/Kabukicho", lat:35.6952, lng:139.7027, hours:"24 hours", closed:"Open daily", station:"Seibu-Shinjuku (3 min)", good:"Snacks, cosmetics, Kit Kats, souvenirs", maps:"ドン・キホーテ 新宿歌舞伎町店", coords:"high" },
  { id:"kinokuniya-shinjuku", name:"Kinokuniya Shinjuku (main)", cat:"Bookstore", city:"Tokyo", area:"Shinjuku", cluster:"Shinjuku-sanchome", lat:35.6909, lng:139.7033, hours:"10:30–21:00", closed:"Open daily", station:"Shinjuku-sanchome (B7)", good:"Books, manga, foreign titles upstairs", maps:"紀伊國屋書店 新宿本店", coords:"high" },

  // ---- SHIBUYA ----
  { id:"shibuya-parco", name:"Shibuya PARCO", cat:"Fashion + games", city:"Tokyo", area:"Shibuya", cluster:"Udagawacho", lat:35.6618, lng:139.6975, hours:"11:00–21:00 (6F from 10:00)", closed:"Open daily", station:"Shibuya (5 min)", good:"Designer fashion + 6F Nintendo/Pokémon/Jump", maps:"渋谷PARCO", coords:"high" },
  { id:"hands-shibuya", name:"Hands Shibuya", cat:"Variety / lifestyle", city:"Tokyo", area:"Shibuya", cluster:"Udagawacho", lat:35.6612, lng:139.6979, hours:"10:00–21:00", closed:"Open daily", station:"Shibuya (8 min)", good:"Stationery, travel goods, gadgets", maps:"ハンズ 渋谷", coords:"high" },
  { id:"loft-shibuya", name:"Loft Shibuya", cat:"Variety / stationery", city:"Tokyo", area:"Shibuya", cluster:"Udagawacho", lat:35.6622, lng:139.6985, hours:"11:00–21:00", closed:"Open daily", station:"Shibuya (8 min)", good:"Stationery, cosmetics, character goods", maps:"渋谷ロフト", coords:"high" },
  { id:"mega-donki-shibuya", name:"MEGA Don Quijote Shibuya", cat:"Discount / variety", city:"Tokyo", area:"Shibuya", cluster:"Udagawacho", lat:35.6616, lng:139.6967, hours:"24 hours", closed:"Open daily", station:"Shibuya (7 min)", good:"Snacks, cosmetics, electronics, souvenirs", maps:"MEGAドン・キホーテ渋谷本店", coords:"high" },
  { id:"shibuya-scramble-square", name:"Shibuya Scramble Square", cat:"Mall + Shibuya Sky", city:"Tokyo", area:"Shibuya", cluster:"Shibuya station-east", lat:35.6580, lng:139.7016, hours:"10:00–21:00 (Sky to 22:30)", closed:"Open daily", station:"Shibuya (direct)", good:"Fashion, beauty, gifts + rooftop Shibuya Sky", maps:"渋谷スクランブルスクエア", coords:"high" },
  { id:"miyashita-park", name:"Miyashita Park", cat:"Open-air mall", city:"Tokyo", area:"Shibuya", cluster:"Shibuya station-east", lat:35.6622, lng:139.7022, hours:"11:00–21:00", closed:"Open daily", station:"Shibuya (3 min)", good:"LV Men's, Gucci, KITH + rooftop park", maps:"ミヤシタパーク", coords:"high" },
  { id:"hikarie-shinqs", name:"Shibuya Hikarie (ShinQs)", cat:"Dept store / beauty", city:"Tokyo", area:"Shibuya", cluster:"Shibuya station-east", lat:35.6591, lng:139.7036, hours:"11:00–21:00", closed:"Open daily", station:"Shibuya (east, direct)", good:"Cosmetics, beauty, sweets (calmer crowds)", maps:"渋谷ヒカリエ ShinQs", coords:"high" },
  { id:"shibuya-109", name:"SHIBUYA109", cat:"Young women's fashion", city:"Tokyo", area:"Shibuya", cluster:"Dogenzaka", lat:35.6594, lng:139.6981, hours:"10:00–21:00", closed:"Open daily", station:"Shibuya (3 min)", good:"Trend-led Gen-Z women's fashion & accessories", maps:"SHIBUYA109", coords:"high" },

  // ---- HARAJUKU / OMOTESANDO ----
  { id:"atcosme-tokyo", name:"@cosme TOKYO", cat:"Cosmetics flagship", city:"Tokyo", area:"Harajuku", cluster:"Harajuku north", lat:35.6712, lng:139.7027, hours:"11:00–21:00", closed:"Open daily", station:"Harajuku (1 min)", good:"Japan's biggest cosmetics store — J-beauty & skincare", maps:"@cosme TOKYO 原宿", coords:"high" },
  { id:"onitsuka-tiger-omotesando", name:"Onitsuka Tiger Omotesando", cat:"Sneakers", city:"Tokyo", area:"Omotesando", cluster:"Omotesando/Aoyama", lat:35.6688, lng:139.7075, hours:"11:00–20:00", closed:"Open daily", station:"Meiji-jingumae", good:"Flagship sneakers + Japan-only Nippon Made line", maps:"オニツカタイガー 表参道", coords:"high" },
  { id:"le-labo-daikanyama", name:"Le Labo Daikanyama", cat:"Fragrance", city:"Tokyo", area:"Daikanyama", cluster:"Daikanyama", lat:35.6486, lng:139.6987, hours:"11:00–20:00", closed:"Open daily", station:"Daikanyama", good:"Hand-blended perfume + Tokyo-exclusive Gaiac 10", maps:"ル ラボ 代官山", coords:"high" },
  { id:"laforet-harajuku", name:"Laforet Harajuku", cat:"Fashion mall", city:"Tokyo", area:"Harajuku", cluster:"Harajuku north", lat:35.6691, lng:139.7054, hours:"11:00–20:00", closed:"Open daily", station:"Meiji-jingumae", good:"Edgy Japanese street/subculture fashion", maps:"ラフォーレ原宿", coords:"high" },
  { id:"tokyu-plaza-omotesando", name:"Tokyu Plaza Omotesando", cat:"Fashion mall", city:"Tokyo", area:"Harajuku", cluster:"Harajuku north", lat:35.6685, lng:139.7060, hours:"11:00–21:00", closed:"Open daily", station:"Meiji-jingumae", good:"Fashion/beauty + mirror entrance & rooftop", maps:"東急プラザ表参道 オモカド", coords:"high" },
  { id:"omotesando-hills", name:"Omotesando Hills", cat:"Upscale complex", city:"Tokyo", area:"Omotesando", cluster:"Omotesando/Aoyama", lat:35.6671, lng:139.7089, hours:"11:00–20:00", closed:"Open daily", station:"Omotesando", good:"Upscale designer & lifestyle (Tadao Ando)", maps:"表参道ヒルズ", coords:"high" },
  { id:"gyre-omotesando", name:"GYRE", cat:"Concept boutiques", city:"Tokyo", area:"Omotesando", cluster:"Omotesando/Aoyama", lat:35.6669, lng:139.7062, hours:"11:00–20:00", closed:"Open daily", station:"Meiji-jingumae", good:"PLAY Comme des Garçons + MoMA Design Store", maps:"ジャイル 表参道", coords:"high" },
  { id:"kiddy-land-harajuku", name:"Kiddy Land Harajuku", cat:"Character goods", city:"Tokyo", area:"Harajuku", cluster:"Omotesando/Aoyama", lat:35.6679, lng:139.7066, hours:"11:00–20:00", closed:"Open daily", station:"Meiji-jingumae", good:"Sanrio, Ghibli, Snoopy, Disney goods", maps:"キデイランド原宿", coords:"high" },
  { id:"ragtag-harajuku", name:"RAGTAG Harajuku", cat:"Secondhand designer", city:"Tokyo", area:"Harajuku", cluster:"Cat Street", lat:35.6669, lng:139.7055, hours:"11:00–20:00", closed:"Open daily", station:"Meiji-jingumae", good:"Pre-owned designer & luxury (men's & women's)", maps:"ラグタグ 原宿店", coords:"high" },
  { id:"wego-harajuku", name:"WEGO Harajuku (Takeshita)", cat:"Casual streetwear", city:"Tokyo", area:"Harajuku", cluster:"Harajuku north", lat:35.6707, lng:139.7044, hours:"10:00–21:00", closed:"Open daily", station:"Harajuku", good:"Affordable trendy youth streetwear", maps:"WEGO 原宿竹下通り店", coords:"medium" },
  { id:"cat-street-harajuku", name:"Cat Street", cat:"Streetwear strip", city:"Tokyo", area:"Harajuku", cluster:"Cat Street", lat:35.6675, lng:139.7045, hours:"~11:00–20:00", closed:"Varies", station:"Meiji-jingumae", good:"Supreme, BAPE, Nike, Stüssy streetwear", maps:"キャットストリート 原宿", coords:"medium" },
  { id:"omotesando-luxury", name:"Omotesando Luxury Flagships", cat:"Luxury flagships", city:"Tokyo", area:"Omotesando", cluster:"Omotesando/Aoyama", lat:35.6664, lng:139.7100, hours:"~11:00–20:00", closed:"Open daily", station:"Omotesando", good:"Dior, Louis Vuitton, Prada Aoyama (architecture)", maps:"表参道 ラグジュアリーブランド街", coords:"medium" },

  // ---- AKIHABARA (electronics, gacha, arcades — no anime/figurine merch) ----
  { id:"yodobashi-akiba", name:"Yodobashi Akiba", cat:"Electronics", city:"Tokyo", area:"Akihabara", cluster:"Akihabara", lat:35.6993, lng:139.7745, hours:"9:30–22:00", closed:"Open daily", station:"Akihabara (direct)", good:"One-stop electronics, cameras, duty-free", maps:"ヨドバシカメラ マルチメディアAkiba 秋葉原", coords:"high" },
  { id:"donki-akihabara", name:"Don Quijote Akihabara", cat:"Discount / variety", city:"Tokyo", area:"Akihabara", cluster:"Akihabara", lat:35.7012, lng:139.7715, hours:"10:00–05:00", closed:"Open daily", station:"Akihabara (3 min)", good:"Snacks, cosmetics, souvenirs", maps:"ドン・キホーテ 秋葉原店", coords:"high" },
  { id:"gigo-akihabara", name:"GiGO Akihabara (Bldg 3)", cat:"Arcade", city:"Tokyo", area:"Akihabara", cluster:"Akihabara", lat:35.7003, lng:139.7709, hours:"10:00–23:30", closed:"Open daily", station:"Akihabara (3 min)", good:"UFO catchers, rhythm games, purikura", maps:"GiGO 秋葉原3号館 秋葉原", coords:"high" },
  { id:"taito-hey-akihabara", name:"Taito Station Akihabara (HEY)", cat:"Arcade", city:"Tokyo", area:"Akihabara", cluster:"Akihabara", lat:35.6993, lng:139.7712, hours:"10:00–24:00", closed:"Open daily", station:"Akihabara (3 min)", good:"Claw machines + legendary retro game floor", maps:"タイトーステーション秋葉原店 HEY 秋葉原", coords:"high" },
  { id:"gachapon-kaikan-akiba", name:"Akihabara Gachapon Kaikan", cat:"Gachapon hall", city:"Tokyo", area:"Akihabara", cluster:"Akihabara", lat:35.7016, lng:139.7711, hours:"Mon–Thu 11:00–20:00; Fri/Sat to 22:00; Sun to 19:00", closed:"Jan 1", station:"Suehirocho (2 min)", good:"~500 capsule-toy machines", maps:"秋葉原ガチャポン会館 秋葉原", coords:"high" },

  // ---- ARCADES / GACHA (other Tokyo areas) ----
  { id:"gigo-shibuya", name:"GiGO Shibuya", cat:"Arcade", city:"Tokyo", area:"Shibuya", cluster:"Udagawacho", lat:35.6611, lng:139.6986, hours:"10:00–23:30", closed:"Open daily", station:"Shibuya (5 min)", good:"UFO catchers, rhythm games, purikura", maps:"GiGO 渋谷 宇田川町", coords:"medium" },
  { id:"gigo-shinjuku-kabukicho", name:"GiGO Shinjuku Kabukicho", cat:"Arcade", city:"Tokyo", area:"Shinjuku", cluster:"Shinjuku West/Kabukicho", lat:35.6948, lng:139.7018, hours:"10:00–01:00", closed:"Open daily", station:"Seibu-Shinjuku (3 min)", good:"Late-night claw machines & rhythm games", maps:"GiGO 新宿歌舞伎町 第二東亜会館", coords:"medium" },
  { id:"namco-tokyo-kabukicho", name:"namco TOKYO (Kabukicho Tower)", cat:"Arcade", city:"Tokyo", area:"Shinjuku", cluster:"Shinjuku West/Kabukicho", lat:35.6951, lng:139.7001, hours:"~11:00–23:30", closed:"Open daily", station:"Seibu-Shinjuku (1 min)", good:"Giant claw machines, stylish bar-arcade", maps:"namco TOKYO 東急歌舞伎町タワー", coords:"medium" },
  { id:"capsule-lab-harajuku", name:"Capsule Lab Harajuku", cat:"Gachapon hall", city:"Tokyo", area:"Harajuku", cluster:"Harajuku north", lat:35.6710, lng:139.7044, hours:"~10:00–20:00", closed:"Open daily", station:"Harajuku (1 min)", good:"Cute/character capsule toys on Takeshita St", maps:"カプセルラボ 原宿竹下通り", coords:"low" },

  // ---- OSAKA: Shinsaibashi / Namba / Amerikamura / Umeda ----
  { id:"shinsaibashi-suji", name:"Shinsaibashi-suji Arcade", cat:"Covered shopping street", city:"Osaka", area:"Shinsaibashi", cluster:"Shinsaibashi", lat:34.6730, lng:135.5015, hours:"~10:00–21:00", closed:"Varies", station:"Shinsaibashi / Namba", good:"600m of drugstores, fashion, snacks", maps:"心斎橋筋商店街", coords:"high" },
  { id:"daimaru-shinsaibashi", name:"Daimaru Shinsaibashi", cat:"Department store", city:"Osaka", area:"Shinsaibashi", cluster:"Shinsaibashi", lat:34.6726, lng:135.5012, hours:"10:00–20:00", closed:"Open daily", station:"Shinsaibashi (direct)", good:"Luxury, cosmetics, depachika", maps:"大丸 心斎橋店", coords:"high" },
  { id:"shinsaibashi-parco", name:"Shinsaibashi PARCO", cat:"Fashion mall", city:"Osaka", area:"Shinsaibashi", cluster:"Shinsaibashi", lat:34.6720, lng:135.5012, hours:"10:00–20:00", closed:"Open daily", station:"Shinsaibashi (direct)", good:"Trendy fashion + Hermès on Midosuji", maps:"心斎橋PARCO", coords:"high" },
  { id:"hands-shinsaibashi", name:"Hands Shinsaibashi", cat:"Variety / lifestyle", city:"Osaka", area:"Shinsaibashi", cluster:"Shinsaibashi", lat:34.6740, lng:135.5010, hours:"10:30–21:00", closed:"Open daily", station:"Shinsaibashi (3 min)", good:"Stationery, gadgets, travel goods, souvenirs", maps:"ハンズ 心斎橋店", coords:"high" },
  { id:"loft-shinsaibashi", name:"Loft Shinsaibashi", cat:"Variety / stationery", city:"Osaka", area:"Shinsaibashi", cluster:"Shinsaibashi", lat:34.6728, lng:135.5010, hours:"10:00–20:00", closed:"Open daily", station:"Shinsaibashi (direct)", good:"Stationery, beauty, cute variety goods", maps:"ロフト 心斎橋店", coords:"medium" },
  { id:"matsukiyo-shinsaibashi", name:"Matsumoto Kiyoshi (Shinsaibashi)", cat:"Drugstore / cosmetics", city:"Osaka", area:"Shinsaibashi", cluster:"Shinsaibashi", lat:34.6700, lng:135.5012, hours:"~10:00–22:00", closed:"Open daily", station:"Namba / Shinsaibashi", good:"Cosmetics, skincare, J-beauty, snacks", maps:"マツモトキヨシ 心斎橋筋", coords:"medium" },
  { id:"lv-maison-midosuji", name:"LV Maison Osaka Midosuji (+ luxury row)", cat:"Luxury flagships", city:"Osaka", area:"Shinsaibashi", cluster:"Shinsaibashi", lat:34.6709, lng:135.5007, hours:"11:00–20:30", closed:"Open daily", station:"Shinsaibashi (6, 3 min)", good:"LV flagship + Chanel, Dior, Cartier, Hermès", maps:"ルイ・ヴィトン メゾン大阪御堂筋", coords:"high" },
  { id:"apple-shinsaibashi", name:"Apple Shinsaibashi", cat:"Apple Store", city:"Osaka", area:"Shinsaibashi", cluster:"Shinsaibashi", lat:34.6722, lng:135.4998, hours:"10:00–21:00", closed:"Open daily", station:"Shinsaibashi (7, 2 min)", good:"Apple products & accessories", maps:"Apple 心斎橋", coords:"high" },
  { id:"amerikamura", name:"Amerikamura", cat:"Vintage / streetwear district", city:"Osaka", area:"Amerikamura", cluster:"Amerikamura", lat:34.6718, lng:135.4980, hours:"~12:00–20:00", closed:"Varies", station:"Shinsaibashi (7, 5 min)", good:"Vintage clothing, sneakers, streetwear (incl. Kinji)", maps:"アメリカ村 大阪", coords:"high" },
  { id:"donki-dotonbori", name:"Don Quijote Dotonbori", cat:"Discount / variety", city:"Osaka", area:"Dotonbori", cluster:"Namba/Dotonbori", lat:34.6695, lng:135.5025, hours:"24 hours", closed:"Open daily", station:"Namba (5 min)", good:"Snacks, cosmetics, souvenirs + Ferris wheel", maps:"ドン・キホーテ 道頓堀店", coords:"high" },
  { id:"gigo-dotonbori", name:"GiGO Osaka Dotonbori", cat:"Arcade", city:"Osaka", area:"Dotonbori", cluster:"Namba/Dotonbori", lat:34.6689, lng:135.5013, hours:"10:00–01:00", closed:"Open daily", station:"Namba (5 min)", good:"~300 claw machines, rhythm games, purikura", maps:"GiGO 大阪道頓堀本店 道頓堀", coords:"high" },
  { id:"round1-sennichimae", name:"Round1 Stadium Sennichimae", cat:"Arcade + amusement", city:"Osaka", area:"Namba", cluster:"Namba/Dotonbori", lat:34.6642, lng:135.5021, hours:"Arcade ~06:00–00:50; bowling 24h", closed:"Open daily", station:"Namba (3 min)", good:"Huge arcade + bowling/karaoke/SpoCha", maps:"ラウンドワン スタジアム 千日前店 なんば", coords:"medium" },
  { id:"taito-namba", name:"Taito Station Namba", cat:"Arcade", city:"Osaka", area:"Namba", cluster:"Namba/Dotonbori", lat:34.6647, lng:135.5032, hours:"10:00–24:00", closed:"Open daily", station:"Namba (3 min)", good:"Claw machines, rhythm/fighting games, purikura", maps:"タイトーステーション なんば店 千日前", coords:"medium" },
  { id:"gigo-namba-avion", name:"GiGO Namba Avion", cat:"Arcade", city:"Osaka", area:"Namba", cluster:"Namba/Dotonbori", lat:34.6616, lng:135.5018, hours:"~10:00–23:30", closed:"Open daily", station:"Namba (3 min)", good:"Claw (1F), rhythm (2F), gacha (3F)", maps:"GiGO なんばアビオン 難波", coords:"medium" },
  { id:"capsule-lab-namba-walk", name:"Capsule Lab Namba Walk", cat:"Gachapon hall", city:"Osaka", area:"Namba", cluster:"Namba/Dotonbori", lat:34.6659, lng:135.5015, hours:"10:00–21:00", closed:"Open daily", station:"Namba (in Namba Walk)", good:"300+ capsule-toy machines", maps:"カプセルラボ なんばウォーク", coords:"low" },
  { id:"bic-camera-namba", name:"BIC Camera Namba", cat:"Electronics", city:"Osaka", area:"Namba", cluster:"Namba/Dotonbori", lat:34.6645, lng:135.5035, hours:"10:00–21:00", closed:"Open daily", station:"Namba / Nippombashi", good:"Electronics, appliances, duty-free", maps:"ビックカメラ なんば店", coords:"high" },
  { id:"namba-city", name:"Namba CITY", cat:"Shopping mall", city:"Osaka", area:"Namba", cluster:"Namba/Dotonbori", lat:34.6630, lng:135.5020, hours:"11:00–21:00", closed:"Open daily", station:"Nankai Namba (direct)", good:"Fashion, accessories, gifts", maps:"なんばCITY", coords:"high" },
  { id:"namba-parks", name:"Namba Parks", cat:"Mall + rooftop garden", city:"Osaka", area:"Namba", cluster:"Namba/Dotonbori", lat:34.6615, lng:135.5018, hours:"11:00–21:00", closed:"Open daily", station:"Nankai Namba (5 min)", good:"Fashion, select shops + terraced garden", maps:"なんばパークス", coords:"high" },
  { id:"yodobashi-umeda", name:"Yodobashi Umeda (LINKS)", cat:"Electronics + fashion", city:"Osaka", area:"Umeda", cluster:"Umeda", lat:34.7045, lng:135.4960, hours:"9:30–22:00", closed:"Open daily", station:"Osaka/Umeda (1 min)", good:"Electronics + huge fashion zone, duty-free", maps:"ヨドバシカメラ マルチメディア梅田", coords:"high" },
  { id:"gashapon-hep-five", name:"Gashapon Dept Store (HEP FIVE)", cat:"Gachapon hall", city:"Osaka", area:"Umeda", cluster:"Umeda", lat:34.7047, lng:135.5002, hours:"11:00–22:30", closed:"Open daily", station:"Umeda (5 min)", good:"~600 capsule machines (largest in Kansai)", maps:"ガシャポンのデパート HEP FIVE 梅田", coords:"high" }
];
