import type { CategoryId } from '../categories'

// "Other" (and locale equivalents like "Sonstiges", "Otro", "Autre", "Lainnya",
// "Altro") intentionally falls back to its parent group: in Splitwise, "Other" is
// always rendered as a sub-item under a parent category (e.g. "Home - Other"),
// not as a top-level category of its own.
const CATEGORY_MAP: Record<string, CategoryId> = {
  // ── English ──────────────────────────────────────────────────────────
  // Uncategorized
  general: 'general',
  payment: 'payment',
  // Entertainment
  entertainment: 'entertainment',
  games: 'games',
  movies: 'movies',
  music: 'music',
  sports: 'sports',
  // Food and Drink
  'food and drink': 'food-and-drink',
  'dining out': 'dining-out',
  groceries: 'groceries',
  liquor: 'liquor',
  // Home
  home: 'home',
  electronics: 'electronics',
  furniture: 'furniture',
  'household supplies': 'household-supplies',
  maintenance: 'maintenance',
  mortgage: 'mortgage',
  pets: 'pets',
  rent: 'rent',
  services: 'services',
  // Life
  childcare: 'childcare',
  clothing: 'clothing',
  education: 'education',
  gifts: 'gifts',
  insurance: 'insurance',
  'medical expenses': 'medical-expenses',
  taxes: 'taxes',
  // Transportation
  transportation: 'transportation',
  bicycle: 'bicycle',
  'bus/train': 'bus-train',
  car: 'car',
  'gas/fuel': 'gas-fuel',
  hotel: 'hotel',
  parking: 'parking',
  plane: 'plane',
  taxi: 'taxi',
  // Utilities
  utilities: 'utilities',
  cleaning: 'cleaning',
  electricity: 'electricity',
  'heat/gas': 'heat-gas',
  trash: 'trash',
  'tv/phone/internet': 'tv-phone-internet',
  water: 'water',

  // ── Deutsch (German) ─────────────────────────────────────────────────
  // Unkategorisiert (Uncategorized)
  allgemein: 'general',
  // Essen und Trinken (Food and Drink)
  'essen und trinken': 'food-and-drink',
  alkohol: 'liquor',
  lebensmittel: 'groceries',
  restaurant: 'dining-out',
  // Leben (Life)
  bildung: 'education',
  geschenke: 'gifts',
  kinderbetreuung: 'childcare',
  kleidung: 'clothing',
  medikamente: 'medical-expenses',
  steuern: 'taxes',
  versicherung: 'insurance',
  // Nebenkosten (Utilities)
  nebenkosten: 'utilities',
  elektrizität: 'electricity',
  'fernsehen/telefon/internet': 'tv-phone-internet',
  'heizung/gas': 'heat-gas',
  müll: 'trash',
  reinigung: 'cleaning',
  wasser: 'water',
  // Unterhaltung (Entertainment)
  unterhaltung: 'entertainment',
  kino: 'movies',
  musik: 'music',
  spiele: 'games',
  sport: 'sports',
  // Verkehrsmittel (Transportation)
  verkehrsmittel: 'transportation',
  auto: 'car',
  'bus/zug': 'bus-train',
  fahrrad: 'bicycle',
  flugzeug: 'plane',
  parken: 'parking',
  treibstoff: 'gas-fuel',
  // Zuhause (Home)
  zuhause: 'home',
  dienstleistungen: 'services',
  elektronik: 'electronics',
  haushaltsgegenstände: 'household-supplies',
  haustiere: 'pets',
  instandhaltung: 'maintenance',
  miete: 'rent',
  möbel: 'furniture',
  zinsen: 'mortgage',

  // ── Español (Spanish) ─────────────────────────────────────────────────
  // Sin categoría (Uncategorized)
  // "general" already present in English
  // Comidas y bebidas (Food and Drink)
  'comidas y bebidas': 'food-and-drink',
  alimentos: 'groceries',
  licor: 'liquor',
  restaurantes: 'dining-out',
  // Vida (Life)
  formación: 'education',
  'gastos médicos': 'medical-expenses',
  guardería: 'childcare',
  impuestos: 'taxes',
  regalos: 'gifts',
  ropa: 'clothing',
  seguro: 'insurance',
  // Utilidades (Utilities)
  utilidades: 'utilities',
  agua: 'water',
  basura: 'trash',
  calefacción: 'heat-gas',
  electricidad: 'electricity',
  limpieza: 'cleaning',
  'tv/teléfono/internet': 'tv-phone-internet',
  // Entretenimiento (Entertainment)
  entretenimiento: 'entertainment',
  deportes: 'sports',
  juegos: 'games',
  música: 'music',
  películas: 'movies',
  // Transporte (Transportation)
  transporte: 'transportation',
  'autobús/tren': 'bus-train',
  avión: 'plane',
  bicicleta: 'bicycle',
  coche: 'car',
  estacionamiento: 'parking',
  gasolina: 'gas-fuel',
  // Casa (Home)
  casa: 'home',
  alquiler: 'rent',
  electrónica: 'electronics',
  hipoteca: 'mortgage',
  mantenimiento: 'maintenance',
  mascotas: 'pets',
  muebles: 'furniture',
  servicios: 'services',
  'suministros del hogar': 'household-supplies',

  // ── Français (French) ─────────────────────────────────────────────────
  // Sans catégorie (Uncategorized)
  général: 'general',
  // Nourriture et boissons (Food and Drink)
  'nourriture et boissons': 'food-and-drink',
  alcool: 'liquor',
  courses: 'groceries',
  sorties: 'dining-out',
  // Vie (Life)
  assurance: 'insurance',
  cadeaux: 'gifts',
  'dépenses médicales': 'medical-expenses',
  enfants: 'childcare',
  'impôts/taxes': 'taxes',
  scolarité: 'education',
  vêtements: 'clothing',
  // Services publics (Utilities)
  'services publics': 'utilities',
  'chauffage/gaz': 'heat-gas',
  eau: 'water',
  électricité: 'electricity',
  nettoyage: 'cleaning',
  poubelles: 'trash',
  'tv/téléphone/internet': 'tv-phone-internet',
  // Loisirs (Entertainment)
  loisirs: 'entertainment',
  cinéma: 'movies',
  jeux: 'games',
  musique: 'music',
  // "sports" already present in English
  // Transport (Transportation)
  transport: 'transportation',
  avion: 'plane',
  // "bus/train" already present in English
  essence: 'gas-fuel',
  hôtel: 'hotel',
  // "parking" already present in English
  // "taxi" already present in English
  vélo: 'bicycle',
  voiture: 'car',
  // Maison (Home)
  maison: 'home',
  animaux: 'pets',
  'articles ménagers': 'household-supplies',
  électronique: 'electronics',
  entretien: 'maintenance',
  location: 'rent',
  meubles: 'furniture',
  'prêt immobilier': 'mortgage',
  // "services" already present in English

  // ── Bahasa Indonesia (Indonesian) ─────────────────────────────────────
  // Tanpa kategori (Uncategorized)
  umum: 'general',
  // Hiburan (Entertainment)
  hiburan: 'entertainment',
  film: 'movies',
  // "musik" already present in German
  olahraga: 'sports',
  permainan: 'games',
  // Makanan dan minuman (Food and Drink)
  'makanan dan minuman': 'food-and-drink',
  'keperluan sehari-hari': 'groceries',
  'makan di luar': 'dining-out',
  'minuman keras': 'liquor',
  // Rumah (Home)
  rumah: 'home',
  'barang elektronik': 'electronics',
  'cicilan kredit': 'mortgage',
  'hewan peliharaan': 'pets',
  jasa: 'services',
  mebel: 'furniture',
  pemeliharaan: 'maintenance',
  'persediaan keluarga': 'household-supplies',
  sewa: 'rent',
  // Sehari-hari (Daily / Life)
  asuransi: 'insurance',
  edukasi: 'education',
  hadiah: 'gifts',
  kesehatan: 'medical-expenses',
  pajak: 'taxes',
  pakaian: 'clothing',
  'perawatan anak': 'childcare',
  // Transportasi (Transportation)
  transportasi: 'transportation',
  bbm: 'gas-fuel',
  'bus/kereta': 'bus-train',
  mobil: 'car',
  parkir: 'parking',
  pesawat: 'plane',
  sepeda: 'bicycle',
  taksi: 'taxi',
  // Utilitas (Utilities)
  utilitas: 'utilities',
  air: 'water',
  kebersihan: 'cleaning',
  listrik: 'electricity',
  'pemanas/gas': 'heat-gas',
  sampah: 'trash',
  'tv/telepon/internet': 'tv-phone-internet',

  // ── Italiano (Italian) ────────────────────────────────────────────────
  // Altro (Other / Uncategorized)
  generale: 'general',
  // Casa (Home)
  // "casa" already present in Spanish
  affitto: 'rent',
  'animali domestici': 'pets',
  arredamento: 'furniture',
  casalinghi: 'household-supplies',
  elettronica: 'electronics',
  manutenzione: 'maintenance',
  mutuo: 'mortgage',
  servizi: 'services',
  // Cibo e bevande (Food and Drink)
  'cibo e bevande': 'food-and-drink',
  alcolici: 'liquor',
  alimentari: 'groceries',
  ristorante: 'dining-out',
  // Intrattenimento (Entertainment)
  intrattenimento: 'entertainment',
  cinema: 'movies',
  giochi: 'games',
  musica: 'music',
  // "sport" already present in German
  // Spese personali (Personal expenses / Life)
  abbigliamento: 'clothing',
  "asilo/servizi per l'infanzia": 'childcare',
  assicurazione: 'insurance',
  istruzione: 'education',
  regali: 'gifts',
  'spese mediche': 'medical-expenses',
  tasse: 'taxes',
  // Trasporti (Transportation)
  trasporti: 'transportation',
  aereo: 'plane',
  // "auto" already present in German
  'autobus/treno': 'bus-train',
  bicicletta: 'bicycle',
  carburante: 'gas-fuel',
  parcheggio: 'parking',
  // Utenze (Utilities)
  utenze: 'utilities',
  acqua: 'water',
  'energia elettrica': 'electricity',
  pulizie: 'cleaning',
  'riscaldamento/gas': 'heat-gas',
  spazzatura: 'trash',
  'tv/telefono/internet': 'tv-phone-internet',

  // ── 日本語 (Japanese) ──────────────────────────────────────────────────
  // 未分類 (Uncategorized)
  一般: 'general',
  // 飲食 (Food and Drink)
  飲食: 'food-and-drink',
  お酒: 'liquor',
  外食: 'dining-out',
  食料品: 'groceries',
  // 生活 (Life)
  ギフト: 'gifts',
  保険: 'insurance',
  医療費: 'medical-expenses',
  教育関連: 'education',
  税金: 'taxes',
  衣料品: 'clothing',
  養育関連: 'childcare',
  // 公共料金 (Utilities)
  公共料金: 'utilities',
  クリーニング: 'cleaning',
  ゴミ: 'trash',
  'テレビ/電話/インターネット': 'tv-phone-internet',
  '暖気/ガス': 'heat-gas',
  水道: 'water',
  電気: 'electricity',
  // 娯楽 (Entertainment)
  娯楽: 'entertainment',
  ゲーム: 'games',
  スポーツ: 'sports',
  映画: 'movies',
  音楽: 'music',
  // 交通機関 (Transportation)
  交通機関: 'transportation',
  'ガス/燃料': 'gas-fuel',
  タクシー: 'taxi',
  'バス/電車': 'bus-train',
  ホテル: 'hotel',
  自転車: 'bicycle',
  車: 'car',
  飛行機: 'plane',
  駐車場: 'parking',
  // 自宅 (Home)
  自宅: 'home',
  サービス: 'services',
  ペット: 'pets',
  メンテナンス: 'maintenance',
  住宅ローン: 'mortgage',
  家具: 'furniture',
  家庭用品: 'household-supplies',
  家賃: 'rent',
  家電製品: 'electronics',

  // ── Nederlands (Dutch) ────────────────────────────────────────────────
  // Categorieloos (Uncategorized)
  algemeen: 'general',
  // Eten en drinken (Food and Drink)
  'eten en drinken': 'food-and-drink',
  boodschappen: 'groceries',
  drank: 'liquor',
  'uit eten': 'dining-out',
  // Huis (Home)
  huis: 'home',
  diensten: 'services',
  electronica: 'electronics',
  huisdieren: 'pets',
  'huishoudelijke benodigdheden': 'household-supplies',
  huur: 'rent',
  hypotheek: 'mortgage',
  meubels: 'furniture',
  onderhoud: 'maintenance',
  // Leven (Life)
  belasting: 'taxes',
  "kado's": 'gifts',
  kinderopvang: 'childcare',
  kleding: 'clothing',
  onderwijs: 'education',
  verzekering: 'insurance',
  ziektekosten: 'medical-expenses',
  // Nutsvoorzieningen (Utilities)
  'nuts-voorzieningen': 'utilities',
  afval: 'trash',
  elektriciteit: 'electricity',
  schoonmaak: 'cleaning',
  'tv/telefoon/internet': 'tv-phone-internet',
  'verwarming/gas': 'heat-gas',
  // "water" already present in English
  // Vermaak (Entertainment)
  vermaak: 'entertainment',
  films: 'movies',
  muziek: 'music',
  spelletjes: 'games',
  // "sport" already present in German
  // Vervoer (Transportation)
  vervoer: 'transportation',
  brandstof: 'gas-fuel',
  'bus/trein': 'bus-train',
  fiets: 'bicycle',
  parkeren: 'parking',
  vliegtuig: 'plane',

  // ── ภาษาไทย (Thai) ────────────────────────────────────────────────────
  // ไม่มีหมวดหมู่ (Uncategorized)
  ทั่วไป: 'general',
  // อาหารและเครื่องดื่ม (Food and Drink)
  อาหารและเครื่องดื่ม: 'food-and-drink',
  ของชำ: 'groceries',
  ทานข้าวนอกบ้าน: 'dining-out',
  สุรา: 'liquor',
  // ชีวิต (Life)
  การเลี้ยงดูบุตร: 'childcare',
  การศึกษา: 'education',
  ของขวัญ: 'gifts',
  ค่าใช้จ่ายทางการแพทย์: 'medical-expenses',
  ประกัน: 'insurance',
  เสื้อผ้า: 'clothing',
  // บ้าน (Home)
  บ้าน: 'home',
  ของใช้ในบ้าน: 'household-supplies',
  ค่าเช่า: 'rent',
  ซ่อมบำรุง: 'maintenance',
  บริการ: 'services',
  เฟอร์นิเจอร์: 'furniture',
  สัตว์เลี้ยง: 'pets',
  สินเชื่อบ้าน: 'mortgage',
  อิเล็กทรอนิกส์: 'electronics',
  // สาธารณูปโภค (Utilities)
  สาธารณูปโภค: 'utilities',
  การทำความสะอาด: 'cleaning',
  ขยะ: 'trash',
  'ความร้อน/ก๊าซ': 'heat-gas',
  'โทรทัศน์/โทรศัพท์/อินเทอร์เน็ต': 'tv-phone-internet',
  น้ำประปา: 'water',
  ไฟฟ้า: 'electricity',
  // ความบันเทิง (Entertainment)
  ความบันเทิง: 'entertainment',
  กีฬา: 'sports',
  เกม: 'games',
  ดนตรี: 'music',
  ภาพยนตร์: 'movies',
  // การคมนาคม (Transportation)
  การคมนาคม: 'transportation',
  // "hotel" already present in English
  // "taxi" already present in English

  // ── Polski (Polish) ───────────────────────────────────────────────────
  // Bez kategorii (Uncategorized)
  ogólne: 'general',
  // Jedzenie i napoje (Food and Drink)
  'jedzenie i napoje': 'food-and-drink',
  // "alkohol" already present in German
  'artykuły spożywcze': 'groceries',
  'jedzenie na mieście': 'dining-out',
  // Dom (Home)
  dom: 'home',
  agd: 'electronics',
  czynsz: 'rent',
  elektronika: 'electronics',
  kredyt: 'mortgage',
  meble: 'furniture',
  usługi: 'services',
  utrzymanie: 'maintenance',
  zwierzęta: 'pets',
  // Media (Utilities)
  media: 'utilities',
  'ogrzewanie/gaz': 'heat-gas',
  prąd: 'electricity',
  śmieci: 'trash',
  sprzątanie: 'cleaning',
  'tv/telefon/internet': 'tv-phone-internet',
  woda: 'water',
  // Rozrywka (Entertainment)
  rozrywka: 'entertainment',
  filmy: 'movies',
  gry: 'games',
  muzyka: 'music',
  sporty: 'sports',
  // Transport (Transportation)
  // "transport" already present in French
  'autobus/pociąg': 'bus-train',
  paliwo: 'gas-fuel',
  // "parking" already present in English
  rower: 'bicycle',
  samochód: 'car',
  samolot: 'plane',
  // Życie (Life)
  edukacja: 'education',
  'opieka nad dziećmi': 'childcare',
  podatki: 'taxes',
  prezenty: 'gifts',
  ubezpieczenie: 'insurance',
  ubrania: 'clothing',
  'wydatki medyczne': 'medical-expenses',

  // ── Português (Brasil) ────────────────────────────────────────────────
  // Sem categoria (Uncategorized)
  geral: 'general',
  // Comidas e bebidas (Food and Drink)
  'comidas e bebidas': 'food-and-drink',
  'bebidas alcoólicas': 'liquor',
  'jantar fora': 'dining-out',
  mercado: 'groceries',
  // Casa (Home)
  // "casa" already present in Spanish
  aluguel: 'rent',
  'animais de estimação': 'pets',
  eletrônicos: 'electronics',
  empréstimo: 'mortgage',
  manutenção: 'maintenance',
  móveis: 'furniture',
  'produtos de limpeza': 'household-supplies',
  serviços: 'services',
  // Entretenimento (Entertainment)
  entretenimento: 'entertainment',
  esportes: 'sports',
  filmes: 'movies',
  jogos: 'games',
  // "música" already present in Spanish
  // Serviços públicos (Utilities)
  'serviços públicos': 'utilities',
  água: 'water',
  'aquecimento/gás': 'heat-gas',
  eletricidade: 'electricity',
  limpeza: 'cleaning',
  lixo: 'trash',
  'tv/telefone/internet': 'tv-phone-internet',
  // Transporte (Transportation)
  // "transporte" already present in Spanish
  avião: 'plane',
  // "bicicleta" already present in Spanish
  carro: 'car',
  combustível: 'gas-fuel',
  estacionamento: 'parking',
  'ônibus/trem': 'bus-train',
  táxi: 'taxi',
  // Vida (Life)
  creche: 'childcare',
  'despesas médicas': 'medical-expenses',
  educação: 'education',
  impostos: 'taxes',
  presentes: 'gifts',
  // "seguro" already present in Spanish
  vestuário: 'clothing',

  // ── Português (Portugal) ──────────────────────────────────────────────
  // Sem categoria (Uncategorized)
  // "geral" already present in pt-BR
  // Alimentação (Food and Drink)
  alimentação: 'food-and-drink',
  bebida: 'liquor',
  jantar: 'dining-out',
  mercearia: 'groceries',
  // Casa (Home)
  // "casa" already present in Spanish
  // Diversão (Entertainment)
  diversão: 'entertainment',
  // "cinema" already present in Italian
  desporto: 'sports',
  // "jogos" already present in pt-BR
  // "música" already present in Spanish
  // Serviços (Utilities)
  // "serviços" maps to 'services' in pt-BR — skipping to avoid key collision
  // "água" already present in pt-BR
  // "aquecimento/gás" already present in pt-BR
  // "eletricidade" already present in pt-BR
  // "limpeza" already present in Spanish
  // "lixo" already present in pt-BR
  // "tv/telefone/internet" already present in pt-BR
  // Transportes (Transportation)
  transportes: 'transportation',
  'autocarro/comboio': 'bus-train',
  // "avião" already present in pt-BR
  // "carro" already present in pt-BR
  // "combustível" already present in pt-BR
  parque: 'parking',
  // "táxi" already present in pt-BR
  // Vida (Life)
  // "despesas médicas" already present in pt-BR
  ensino: 'education',
  // "impostos" already present in pt-BR
  prendas: 'gifts',
  puericultura: 'childcare',
  // "seguro" already present in Spanish
  // "vestuário" already present in pt-BR

  // ── Svenska (Swedish) ─────────────────────────────────────────────────
  // Okategoriserad (Uncategorized)
  // no explicit subcategory provided
  // Mat och dryck (Food and Drink)
  'mat och dryck': 'food-and-drink',
  livsmedel: 'groceries',
  restaurangbesök: 'dining-out',
  // Hem (Home)
  hem: 'home',
  'avbetalning/amortering': 'mortgage',
  förbrukningsvaror: 'household-supplies',
  husdjur: 'pets',
  hyra: 'rent',
  möbler: 'furniture',
  'skötsel/underhåll': 'maintenance',
  tjänster: 'services',
  // Livet (Life)
  barnomsorg: 'childcare',
  försäkringar: 'insurance',
  kläder: 'clothing',
  presenter: 'gifts',
  'sjukvård/medicin': 'medical-expenses',
  skatter: 'taxes',
  utbildning: 'education',
  // Underhållning (Entertainment)
  underhållning: 'entertainment',
  filmer: 'movies',
  spel: 'games',
  // Transport (Transportation)
  // "transport" already present in French
  'bensin/bränsle': 'gas-fuel',
  bil: 'car',
  'buss/tåg': 'bus-train',
  cykel: 'bicycle',
  flyg: 'plane',
  hotell: 'hotel',
  parkering: 'parking',
  // Verktyg (Utilities)
  verktyg: 'utilities',
  avfall: 'trash',
  elektricitet: 'electricity',
  städning: 'cleaning',
  // "tv/telefon/internet" already present in Polish
  värme: 'heat-gas',
  vatten: 'water',
}

/** Category names in any locale that represent the "Other" fallback concept. */
const OTHER_KEYS = new Set([
  'other',
  'sonstiges', // Deutsch
  'otro', // Español
  'autre', // Français
  'lainnya', // Bahasa Indonesia
  'altro', // Italiano
  'その他', // 日本語 (Japanese)
  'andere', // Nederlands (Dutch)
  'อื่นๆ', // ภาษาไทย (Thai)
  'inne', // Polski (Polish)
  'outros', // Português (Brasil)
  'outro', // Português (Portugal)
  'övrigt', // Svenska (Swedish)
])

export function splitwiseCategoryToId(name: string): CategoryId {
  const trimmed = name.trim()
  if (trimmed === '') return 'general'
  const key = trimmed.toLowerCase()
  if (key.includes(' - ')) {
    const [left, right] = key.split(' - ')
    if (OTHER_KEYS.has(right)) {
      return CATEGORY_MAP[left] ?? 'general'
    }
    return CATEGORY_MAP[right] ?? CATEGORY_MAP[left] ?? 'general'
  }
  return CATEGORY_MAP[key] ?? 'general'
}
